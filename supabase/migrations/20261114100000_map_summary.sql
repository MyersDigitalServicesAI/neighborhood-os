begin;
-- What the map shows for each area: how many neighbors have joined and how many recent posts the viewer can see.
create function neighborhood.map_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  area text;
begin
  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  select m.area_id into area from neighborhood.members m where m.id = actor;
  if area is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_object_agg(a.id,jsonb_build_object(
      'members',(select count(*) from neighborhood.members m where m.area_id = a.id),
      'posts',(select count(*) from neighborhood.posts p where p.area_id = a.id and p.removed_at is null
        and p.created_at > now() - interval '30 days' and neighborhood.visible(p,area)))),'{}'::jsonb)
    from neighborhood.areas a
    where exists(select 1 from neighborhood.members m where m.area_id = a.id));
end
$$;
revoke all on function neighborhood.map_summary() from public, anon, authenticated, service_role;
grant execute on function neighborhood.map_summary() to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch3(op,d) end
$$;
commit;
