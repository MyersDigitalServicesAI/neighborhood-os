begin;
-- Sample and test accounts are kept out of anything shown to the public.
alter table neighborhood.members add column sample boolean not null default false;

-- Public, signed-out counts for the landing page map. Small numbers are reported only as 'few' so a
-- count can never point at one or two identifiable households.
create function neighborhood.public_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  with counts as (
    select m.area_id,count(*) n from neighborhood.members m where not m.sample group by m.area_id
  )
  select jsonb_build_object(
    'areas',coalesce((select jsonb_object_agg(c.area_id,case when c.n >= 5 then to_jsonb(c.n) else to_jsonb('few'::text) end) from counts c),'{}'::jsonb),
    'total',(select case when coalesce(sum(c.n),0) >= 5 then to_jsonb(sum(c.n)::int) else to_jsonb('few'::text) end from counts c),
    'places',(select count(*) from counts))
$$;
revoke all on function neighborhood.public_counts() from public, anon, authenticated, service_role;
grant usage on schema neighborhood to anon;
grant execute on function neighborhood.public_counts() to anon, authenticated;
create function public.neighborhood_counts() returns jsonb
language sql stable security invoker set search_path = '' as $$ select neighborhood.public_counts() $$;
revoke all on function public.neighborhood_counts() from public, anon, authenticated, service_role;
grant execute on function public.neighborhood_counts() to anon, authenticated;
commit;
