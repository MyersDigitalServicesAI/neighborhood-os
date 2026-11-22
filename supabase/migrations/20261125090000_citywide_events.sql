begin;

-- Events are for the whole city: neighbors can discover what is happening in other communities. A new event is
-- shared with all of Northeast Ohio unless its poster keeps it local, and the weekly import posts citywide too.
-- Upcoming events already posted by Nabora itself (the platform owner, or imported from a public calendar) go citywide now.
update neighborhood.posts p set reach = 'region'
  where p.kind = 'event' and p.removed_at is null and p.event_at > now() and p.reach <> 'region'
    and (p.source_url is not null or p.author_id = (select o.user_id from neighborhood.platform_owner o));

create or replace function neighborhood.import_events(d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select o.user_id from neighborhood.platform_owner o);
  e jsonb;
  starts timestamptz;
  areas text[];
  target text;
  per_area jsonb := '{}'::jsonb;
  posted integer := 0;
  skipped integer := 0;
  max_total integer := least(coalesce((d->>'limit')::integer,45),100);
  key text;
begin
  if owner is null then raise exception 'No platform owner is set.'; end if;
  for e in select value from jsonb_array_elements(coalesce(d->'events','[]'::jsonb)) loop
    exit when posted >= max_total;
    begin
      starts := nullif(e->>'starts_at','')::timestamptz;
    exception when others then
      starts := null;
    end;
    if starts is null or starts < now() or starts > now() + interval '15 days'
        or coalesce(e->>'source_url','') !~ '^https://' or char_length(coalesce(e->>'title','')) < 3 or char_length(btrim(coalesce(e->>'body',''))) < 3
        or exists(select 1 from neighborhood.posts p where p.source_url = e->>'source_url') then
      skipped := skipped + 1;
      continue;
    end if;
    if e ? 'branch' then
      key := neighborhood.branch_key(e->>'branch');
      areas := array(select g.area_id from neighborhood.guide_items g
        where g.kind = 'library' and g.hidden_at is null and neighborhood.branch_key(g.name) = key limit 1);
    elsif e ? 'ward' then
      areas := array(select g.area_id from neighborhood.guide_items g where g.kind = 'ward' and g.hidden_at is null
        and g.name like 'Ward ' || (e->>'ward')::integer || ' ·%' and g.detail like 'Most of%' order by g.area_id);
    else
      areas := '{}';
    end if;
    if cardinality(areas) = 0 then skipped := skipped + 1; continue; end if;
    foreach target in array areas loop
      exit when posted >= max_total;
      -- At most 3 new events per neighborhood per run, and none once a neighborhood already has 4 coming up.
      if coalesce((per_area->>target)::integer,0) >= 3 or (select count(*) from neighborhood.posts p where p.area_id = target
          and p.kind = 'event' and p.event_at > now() and p.removed_at is null) >= 4 then
        skipped := skipped + 1;
        continue;
      end if;
      -- One malformed event is skipped instead of stopping the whole run.
      begin
        insert into neighborhood.posts(author_id,area_id,kind,reach,title,body,place,event_at,source_url)
          values(owner,target,'event','region',left(e->>'title',120),left(coalesce(e->>'body',''),2400),
            nullif(left(coalesce(e->>'place',''),120),''),starts,
            case when target = areas[1] then e->>'source_url' else (e->>'source_url') || '#' || target end);
      exception when check_violation or unique_violation or not_null_violation then
        skipped := skipped + 1;
        continue;
      end;
      per_area := per_area || jsonb_build_object(target,coalesce((per_area->>target)::integer,0) + 1);
      posted := posted + 1;
    end loop;
  end loop;
  insert into neighborhood.audit(actor,action,subject,details) values(owner,'import_events',owner,jsonb_build_object('posted',posted,'skipped',skipped,'areas',per_area));
  return jsonb_build_object('posted',posted,'skipped',skipped,'areas',per_area,
    'empty',(select coalesce(jsonb_agg(a.name order by a.name),'[]'::jsonb) from neighborhood.areas a where a.region = 'Cleveland'
      and not exists(select 1 from neighborhood.posts p where p.area_id = a.id and p.kind = 'event' and p.event_at > now() and p.removed_at is null)));
end
$$;


create function neighborhood.dispatch10(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  home text;
  pick text;
  span text;
  starts timestamptz := now() - interval '2 hours';
  ends timestamptz := now() + interval '60 days';
  local_now timestamp := now() at time zone 'America/New_York';
  saturday timestamp;
begin
  if op <> 'events' then return neighborhood.dispatch9(op,d); end if;
  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  select m.area_id into home from neighborhood.members m where m.id = actor;
  if home is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
  pick := nullif(d->>'area','');
  span := coalesce(nullif(d->>'when',''),'all');
  if span = 'week' then
    ends := now() + interval '7 days';
  elsif span = 'weekend' then
    -- This coming weekend in Cleveland time: Saturday morning through Sunday night (the current one on a weekend).
    saturday := date_trunc('day',local_now) + make_interval(days => case extract(isodow from local_now)::int when 6 then 0 when 7 then -1
      else 6 - extract(isodow from local_now)::int end);
    starts := greatest(starts,saturday at time zone 'America/New_York');
    ends := (saturday + interval '2 days') at time zone 'America/New_York';
  end if;
  return jsonb_build_object('when',span,'area',pick,
    'events',(select coalesce(jsonb_agg(neighborhood.post_json(p,actor) || jsonb_build_object('area_id',p.area_id) order by p.event_at,p.id),'[]'::jsonb) from (
      select p.* from neighborhood.posts p
      where p.kind = 'event' and p.removed_at is null and p.event_at between starts and ends and neighborhood.visible(p,home)
        and (pick is null or p.area_id = pick)
        and not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = p.author_id)
      order by p.event_at,p.id limit 60) p),
    'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'count',x.n) order by x.name),'[]'::jsonb) from (
      select a.id,a.name,count(*) n from neighborhood.posts p join neighborhood.areas a on a.id = p.area_id
      where p.kind = 'event' and p.removed_at is null and p.event_at between now() - interval '2 hours' and now() + interval '60 days'
        and neighborhood.visible(p,home)
        and not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = p.author_id)
      group by a.id,a.name) x));
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch10(text,jsonb),neighborhood.dispatch9(text,jsonb),neighborhood.import_events(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch10(text,jsonb) to authenticated;
grant execute on function neighborhood.import_events(jsonb) to service_role;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch10(op,d) end
$$;
commit;
