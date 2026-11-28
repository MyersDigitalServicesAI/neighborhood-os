begin;

-- Security hardening from the 2026-11-28 audit.
--   * set_role can no longer change the platform owner's role. Before this, any admin could demote the owner, and the
--     owner (who can't change their own role, which the older code still reports in its own words) could not undo it without database access. The owner's role can still be
--     changed by editing the staff table directly, which only someone with database access can do.
create function neighborhood.dispatch21(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if op = 'set_role' and jsonb_typeof(d) = 'object' and exists(select 1 from neighborhood.platform_owner o
      where o.user_id::text = d->>'id' and o.user_id is distinct from auth.uid()) then
    raise exception 'The platform owner’s role can’t be changed here.' using errcode = '42501';
  end if;
  return neighborhood.dispatch20(op,d);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch21(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch21(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch21(op,d) end
$$;
commit;
