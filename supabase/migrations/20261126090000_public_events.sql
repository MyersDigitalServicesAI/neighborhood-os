begin;

-- Public events: anyone, signed in or not, can see what is happening across the city. Only events shared with all of
-- Northeast Ohio are listed, never one kept to a neighborhood, and never who posted it: a visitor sees the event, the
-- neighborhood and the organizer's link, and joins Nabora to RSVP or see more.
create function neighborhood.public_events(d jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  pick text := nullif(d->>'area','');
  span text := coalesce(nullif(d->>'when',''),'all');
  starts timestamptz := now() - interval '2 hours';
  ends timestamptz := now() + interval '60 days';
  local_now timestamp := now() at time zone 'America/New_York';
  saturday timestamp;
begin
  if span = 'week' then
    ends := now() + interval '7 days';
  elsif span = 'weekend' then
    saturday := date_trunc('day',local_now) + make_interval(days => case extract(isodow from local_now)::int when 6 then 0 when 7 then -1
      else 6 - extract(isodow from local_now)::int end);
    starts := greatest(starts,saturday at time zone 'America/New_York');
    ends := (saturday + interval '2 days') at time zone 'America/New_York';
  else
    span := 'all';
  end if;
  return jsonb_build_object('when',span,'area',pick,
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'body',left(p.body,600),'place',p.place,
        'event_at',p.event_at,'area_id',p.area_id,'area',a.name,'region',a.region,'link',split_part(p.source_url,'#',1),
        'going',(select count(*) from neighborhood.rsvps r where r.post_id = p.id)) order by p.event_at,p.id),'[]'::jsonb)
      from (select * from neighborhood.posts x where x.kind = 'event' and x.reach = 'region' and x.removed_at is null
          and x.event_at between starts and ends and (pick is null or x.area_id = pick) order by x.event_at,x.id limit 60) p
      join neighborhood.areas a on a.id = p.area_id),
    'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'count',x.n) order by x.name),'[]'::jsonb) from (
      select a.id,a.name,count(*) n from neighborhood.posts p join neighborhood.areas a on a.id = p.area_id
      where p.kind = 'event' and p.reach = 'region' and p.removed_at is null and p.event_at between now() - interval '2 hours' and now() + interval '60 days'
      group by a.id,a.name) x));
end
$$;

create function public.neighborhood_public_events(d jsonb default '{}'::jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$ select neighborhood.public_events(d) $$;
revoke all on function neighborhood.public_events(jsonb),public.neighborhood_public_events(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.public_events(jsonb) to anon, authenticated;
grant execute on function public.neighborhood_public_events(jsonb) to anon, authenticated;
commit;
