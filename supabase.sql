begin;

create table if not exists public.risk_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_owner uuid not null references auth.users(id) on delete cascade,
  role text not null,
  catalog_id text,
  check (
    (role = 'admin' and workspace_owner = user_id and catalog_id is null)
    or (role in ('risk', 'research') and workspace_owner <> user_id and nullif(btrim(catalog_id), '') is not null)
  )
);

alter table public.risk_access enable row level security;
revoke all on public.risk_access from public, anon, authenticated;
grant select on public.risk_access to authenticated;
drop policy if exists access_self on public.risk_access;
create policy access_self on public.risk_access for select to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.risk_workspace (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and payload ?& array['cases', 'people', 'researchers', 'departments', 'types']
    and jsonb_typeof(payload->'cases') = 'array'
    and jsonb_typeof(payload->'people') = 'array'
    and jsonb_typeof(payload->'researchers') = 'array'
    and jsonb_typeof(payload->'departments') = 'array'
    and jsonb_typeof(payload->'types') = 'array'
  )
);

alter table public.risk_workspace enable row level security;
revoke all on public.risk_workspace from public, anon, authenticated;
grant select, insert on public.risk_workspace to authenticated;
grant update (payload, revision) on public.risk_workspace to authenticated;

drop policy if exists workspace_read on public.risk_workspace;
drop policy if exists workspace_create on public.risk_workspace;
drop policy if exists workspace_update on public.risk_workspace;
create policy workspace_read on public.risk_workspace for select to authenticated
  using (owner_id in (select user_id from public.risk_access where role = 'admin'));
create policy workspace_create on public.risk_workspace for insert to authenticated
  with check (owner_id in (select user_id from public.risk_access where role = 'admin'));
create policy workspace_update on public.risk_workspace for update to authenticated
  using (owner_id in (select user_id from public.risk_access where role = 'admin'))
  with check (owner_id in (select user_id from public.risk_access where role = 'admin'));

-- Returns only the cases assigned to the caller and the catalog entries they reference.
create or replace function public.risk_my_cases()
returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  with membership as (
    select role, workspace_owner, catalog_id
    from public.risk_access
    where user_id = (select auth.uid()) and role in ('risk', 'research')
  ), workspace as (
    select w.payload, m.role, m.catalog_id
    from membership m
    left join public.risk_workspace w on w.owner_id = m.workspace_owner
  ), assigned as (
    select c.item
    from workspace w
    cross join lateral pg_catalog.jsonb_array_elements(w.payload->'cases') c(item)
    where (w.role = 'risk' and c.item->>'person' = w.catalog_id)
       or (w.role = 'research' and c.item->>'researcher' = w.catalog_id)
  )
  select pg_catalog.jsonb_build_object(
    'cases', coalesce((select pg_catalog.jsonb_agg(item) from assigned), '[]'::jsonb),
    'people', coalesce((select pg_catalog.jsonb_agg(e.item) from pg_catalog.jsonb_array_elements(w.payload->'people') e(item)
      where e.item->>'id' in (select item->>'person' from assigned)), '[]'::jsonb),
    'researchers', coalesce((select pg_catalog.jsonb_agg(e.item) from pg_catalog.jsonb_array_elements(w.payload->'researchers') e(item)
      where e.item->>'id' in (select item->>'researcher' from assigned)), '[]'::jsonb),
    'departments', coalesce((select pg_catalog.jsonb_agg(e.item) from pg_catalog.jsonb_array_elements(w.payload->'departments') e(item)
      where e.item->>'id' in (select item->>'department' from assigned)), '[]'::jsonb),
    'types', coalesce((select pg_catalog.jsonb_agg(e.item) from pg_catalog.jsonb_array_elements(w.payload->'types') e(item)
      where e.item->>'id' in (select coalesce(item->>'type', 'matrix') from assigned)), '[]'::jsonb)
  )
  from workspace w;
$function$;

revoke all on function public.risk_my_cases() from public, anon, authenticated;
grant execute on function public.risk_my_cases() to authenticated;

commit;
