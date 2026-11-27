begin;

create table if not exists public.budget_workspaces (
    user_id uuid primary key references auth.users(id) on delete cascade,
    version uuid not null,
    payload jsonb not null check (
        jsonb_typeof(payload) = 'object'
        and payload ?& array['schema', 'values', 'actuals', 'incomes']
        and jsonb_typeof(payload->'schema') = 'array'
        and jsonb_typeof(payload->'values') = 'object'
        and jsonb_typeof(payload->'actuals') = 'object'
        and jsonb_typeof(payload->'incomes') = 'object'
    )
);

alter table public.budget_workspaces enable row level security;
revoke all on public.budget_workspaces from public, anon, authenticated;
grant select, insert on public.budget_workspaces to authenticated;
grant update (version, payload) on public.budget_workspaces to authenticated;

drop policy if exists budget_read_own on public.budget_workspaces;
create policy budget_read_own on public.budget_workspaces for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists budget_insert_own on public.budget_workspaces;
create policy budget_insert_own on public.budget_workspaces for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists budget_update_own on public.budget_workspaces;
create policy budget_update_own on public.budget_workspaces for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

commit;
