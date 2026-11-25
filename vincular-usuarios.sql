-- Reemplaza el correo del administrador. Completa el correo de cada analista
-- cuando su usuario ya exista en Authentication → Users.
-- Deja NULL para omitir las cuentas que aún no creaste.
do $$
declare
  admin_email text := 'administrador@ejemplo.com';
  admin_id uuid;
  analyst_id uuid;
  entry record;
begin
  select id into admin_id from auth.users where lower(email) = lower(btrim(admin_email));
  if admin_id is null then
    raise exception 'Primero crea el usuario administrador con correo % en Authentication → Users.', admin_email;
  end if;

  insert into public.risk_access (user_id, workspace_owner, role, catalog_id)
    values (admin_id, admin_id, 'admin', null)
    on conflict (user_id) do update set workspace_owner = excluded.workspace_owner, role = excluded.role, catalog_id = excluded.catalog_id;

  for entry in select * from (values
    (null::text, 'risk', '1'),      -- Luis Menendez (si usará una cuenta de analista aparte)
    (null::text, 'risk', '2'),      -- Julio Hernández
    (null::text, 'risk', '3'),      -- Renato Escobar
    (null::text, 'risk', '4'),      -- Roger González
    (null::text, 'risk', '5'),      -- Andrés López
    (null::text, 'research', 'william'), -- William Espinoza
    (null::text, 'research', 'victor')   -- Victor de León
  ) as users(email, role, catalog_id)
  where email is not null
  loop
    select id into analyst_id from auth.users where lower(email) = lower(btrim(entry.email));
    if analyst_id is null then
      raise exception 'El usuario % aún no existe en Authentication → Users.', entry.email;
    end if;
    if analyst_id = admin_id then
      raise exception 'El correo administrador debe ser distinto del correo de analista.';
    end if;
    insert into public.risk_access (user_id, workspace_owner, role, catalog_id)
      values (analyst_id, admin_id, entry.role, entry.catalog_id)
      on conflict (user_id) do update set workspace_owner = excluded.workspace_owner, role = excluded.role, catalog_id = excluded.catalog_id;
  end loop;
end $$;
