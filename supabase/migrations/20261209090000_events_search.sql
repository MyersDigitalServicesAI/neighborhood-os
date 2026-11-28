begin;

-- Searchable events: every event gets a category, and the Events page (members and public) can be searched by
-- neighborhood plus a radius in miles, by day, and by category.
--
-- Categories are a fixed list so filters stay useful. Events posted before this update, and every imported event, are
-- sorted into a category by their wording; anything unclear is "other". New events posted in the app carry the poster's pick.
alter table neighborhood.posts add column event_category text check (event_category is null or event_category in
  ('family','arts','food','civic','community','outdoors','classes','holiday','other'));

create function neighborhood.guess_event_category(t text) returns text
language sql immutable set search_path = '' as $$
  select case
    when t ~* '\m(ward|council|community meeting|town hall|zoning|commission|public hearing|city hall|voter|election|board of)\M' then 'civic'
    when t ~* '\m(kids?|children|toddlers?|babies|baby|family|families|storytime|story time|puppet|teens?|youth|preschool)\M' then 'family'
    when t ~* '\m(holiday|holidays|christmas|santa|menorah|hanukkah|kwanzaa|halloween|thanksgiving|tree lighting|new year|easter)\M' then 'holiday'
    when t ~* '\m(food|farmers?|market|tasting|dinner|brunch|brew|bake|baking|cooking|pantry|cookie|pizza)\M' then 'food'
    when t ~* '\m(art|arts|music|concert|gallery|theat(er|re)|film|movie|dance|poetry|craft|crafts|paint|painting|museum|author)\M' then 'arts'
    when t ~* '\m(volunteer|cleanup|clean-up|donat(e|ion)|(food|coat|toy|blood) drive|mutual aid)\M' then 'community'
    when t ~* '\m(trail|hike|hiking|bike|biking|yoga|fitness|soccer|baseball|basketball|garden|outdoors?|sports?|5k)\M' then 'outdoors'
    when t ~* '\m(class|classes|workshop|library|book|computer|learn|lesson|course|resume|english)\M' then 'classes'
    else 'other'
  end
$$;

-- Imports and older apps do not send a category, so one is filled in from the event's wording.
create function neighborhood.set_event_category() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'event' and new.event_category is null then
    -- Imported titles end "... at the <branch> library" and their text is boilerplate, so only the title is read.
    new.event_category := neighborhood.guess_event_category(case when new.source_url is not null
      then regexp_replace(new.title,' at the .* library$','') else new.title || ' ' || left(new.body,300) end);
  end if;
  return new;
end
$$;
create trigger posts_event_category before insert on neighborhood.posts
  for each row execute function neighborhood.set_event_category();

update neighborhood.posts set event_category = neighborhood.guess_event_category(case when source_url is not null
    then regexp_replace(title,' at the .* library$','') else title || ' ' || left(body,300) end)
  where kind = 'event' and event_category is null;

create index if not exists posts_event_search on neighborhood.posts(event_at) where kind = 'event' and removed_at is null;

-- Straight-line distance in miles between two points.
create function neighborhood.miles_between(lat1 double precision,lng1 double precision,lat2 double precision,lng2 double precision)
returns double precision language sql immutable strict set search_path = '' as $$
  select 3958.8 * 2 * asin(least(1,sqrt(
    power(sin(radians(lat2 - lat1) / 2),2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2),2))))
$$;

-- The events a viewer may see inside a time window, optionally within a radius of one neighborhood. A null home means
-- a public visitor: only events listed for all of Northeast Ohio. Members see what their feed shows, minus blocked authors.
create function neighborhood.event_rows(home text,actor uuid,starts timestamptz,ends timestamptz,pick text,miles integer,neighbors boolean)
returns table(post neighborhood.posts,area_name text,region text,away numeric)
language sql stable security definer set search_path = '' as $$
  select p,a.name,a.region,
    case when c.id is null then null else round(neighborhood.miles_between(c.lat,c.lng,a.lat,a.lng)::numeric,1) end
  from neighborhood.posts p
  join neighborhood.areas a on a.id = p.area_id
  left join neighborhood.areas c on c.id = pick
  where p.kind = 'event' and p.removed_at is null and p.event_at >= starts and p.event_at < ends
    and (case when home is null then p.reach = 'region' else neighborhood.visible(p,home) end)
    and (home is null or not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = p.author_id))
    and (not neighbors or p.source_url is null)
    and (pick is null or (miles is null and p.area_id = pick)
      or (miles is not null and (p.area_id = pick or neighborhood.miles_between(c.lat,c.lng,a.lat,a.lng) <= miles)))
$$;

-- One search for both audiences.
--   area    neighborhood id        miles   1, 3, 5 or 10 around that neighborhood
--   cat     a category             when    today, tomorrow, weekend, week or all
--   day     YYYY-MM-DD, wins over when
--   mine    'neighbors' hides events imported from public calendars
-- When nothing matches, 'suggested' lists matches within 10 miles so the page never ends on a dead end.
create function neighborhood.event_search(d jsonb,home text,actor uuid,expanded boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  zone constant text := 'America/New_York';
  pick text := nullif(d->>'area','');
  span text := coalesce(nullif(d->>'when',''),'all');
  cat text := nullif(d->>'cat','');
  miles integer := case when d->>'miles' in ('1','3','5','10') then (d->>'miles')::integer end;
  neighbors boolean := coalesce(d->>'mine','') = 'neighbors';
  day date;
  starts timestamptz := now() - interval '2 hours';
  ends timestamptz := now() + interval '60 days';
  local_now timestamp := now() at time zone zone;
  today date := (now() at time zone zone)::date;
  saturday timestamp;
  listed jsonb;
  suggested jsonb := '[]'::jsonb;
begin
  if cat is not null and cat not in ('family','arts','food','civic','community','outdoors','classes','holiday','other') then cat := null; end if;
  if pick is not null and not exists(select 1 from neighborhood.areas a where a.id = pick) then pick := null; end if;
  if pick is null then miles := null; end if;
  if expanded then miles := 10; end if;
  begin day := nullif(d->>'day','')::date; exception when others then day := null; end;
  if day is not null then
    span := 'day';
    starts := greatest(starts,day::timestamp at time zone zone);
    ends := least(ends,(day + 1)::timestamp at time zone zone);
  elsif span = 'today' then
    starts := greatest(starts,today::timestamp at time zone zone);
    ends := least(ends,(today + 1)::timestamp at time zone zone);
  elsif span = 'tomorrow' then
    starts := greatest(starts,(today + 1)::timestamp at time zone zone);
    ends := least(ends,(today + 2)::timestamp at time zone zone);
  elsif span = 'week' then
    ends := now() + interval '7 days';
  elsif span = 'weekend' then
    -- This coming weekend in Cleveland time: Saturday morning through Sunday night (the current one on a weekend).
    saturday := date_trunc('day',local_now) + make_interval(days => case extract(isodow from local_now)::int when 6 then 0 when 7 then -1
      else 6 - extract(isodow from local_now)::int end);
    starts := greatest(starts,saturday at time zone zone);
    ends := (saturday + interval '2 days') at time zone zone;
  else
    span := 'all';
  end if;

  select coalesce(jsonb_agg(case when home is null then
      jsonb_build_object('id',(r.post).id,'title',(r.post).title,'body',left((r.post).body,600),'place',(r.post).place,
        'event_at',(r.post).event_at,'area_id',(r.post).area_id,'area',r.area_name,'region',r.region,
        'link',split_part((r.post).source_url,'#',1),'category',(r.post).event_category,'away',r.away,
        'going',(select count(*) from neighborhood.rsvps v where v.post_id = (r.post).id))
    else
      neighborhood.post_json(r.post,actor) || jsonb_build_object('area_id',(r.post).area_id,'area',r.area_name,
        'category',(r.post).event_category,'away',r.away,'imported',(r.post).source_url is not null)
    end order by (r.post).event_at,(r.post).id),'[]'::jsonb)
    into listed
    from (select * from neighborhood.event_rows(home,actor,starts,ends,pick,miles,neighbors) x
      where cat is null or coalesce((x.post).event_category,'other') = cat order by (x.post).event_at,(x.post).id limit 60) r;

  if jsonb_array_length(listed) = 0 and pick is not null and coalesce(miles,0) < 10 and not expanded then
    suggested := neighborhood.event_search(d || jsonb_build_object('miles','10'),home,actor,true)->'events';
  end if;

  return jsonb_build_object('when',span,'area',pick,'miles',miles,'cat',cat,'day',day,'mine',case when neighbors then 'neighbors' end,
    'events',listed,'suggested',suggested,
    'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'count',x.n) order by x.name),'[]'::jsonb) from (
      select a.id,a.name,count(*) n
      from neighborhood.event_rows(home,actor,now() - interval '2 hours',now() + interval '60 days',null,null,neighbors) r
      join neighborhood.areas a on a.id = (r.post).area_id group by a.id,a.name) x),
    'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'count',x.n) order by x.id),'[]'::jsonb) from (
      select coalesce((r.post).event_category,'other') id,count(*) n
      from neighborhood.event_rows(home,actor,starts,ends,pick,miles,neighbors) r group by 1) x));
end
$$;

-- Public page: the same search, listed events only, and never who posted them.
create or replace function neighborhood.public_events(d jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$ select neighborhood.event_search(d,null,null) $$;

-- Members: the search in the app, and a chosen category on a new event.
create function neighborhood.dispatch21(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  home text;
  cat text := nullif(d->>'category','');
  result jsonb;
begin
  if op = 'create_post' then
    if d->>'kind' = 'event' and cat is not null and cat not in ('family','arts','food','civic','community','outdoors','classes','holiday','other') then
      raise exception 'Choose an event category.';
    end if;
    result := neighborhood.dispatch20(op,d);
    if d->>'kind' = 'event' and cat is not null and result->>'id' is not null then
      update neighborhood.posts set event_category = cat where id = (result->>'id')::uuid and author_id = actor and kind = 'event';
    end if;
    return result;
  elsif op = 'events' then
    if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
      raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
    end if;
    select m.area_id into home from neighborhood.members m where m.id = actor;
    if home is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
    return neighborhood.event_search(d,home,actor);
  end if;
  return neighborhood.dispatch20(op,d);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.guess_event_category(text),neighborhood.set_event_category(),neighborhood.miles_between(double precision,double precision,double precision,double precision),
  neighborhood.event_rows(text,uuid,timestamptz,timestamptz,text,integer,boolean),neighborhood.event_search(jsonb,text,uuid,boolean),
  neighborhood.dispatch21(text,jsonb),neighborhood.dispatch20(text,jsonb),neighborhood.public_events(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch21(text,jsonb) to authenticated;
grant execute on function neighborhood.public_events(jsonb) to anon, authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch21(op,d) end
$$;
commit;
