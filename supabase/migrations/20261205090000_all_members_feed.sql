begin;

-- One Nabora-wide feed.
--   * New posts are visible to every member ('members' reach). Posts made before this update keep the reach their
--     author chose, so a post promised to stay in its neighborhood still does.
--   * Members-only is not public: only events the author lists on the public events page ('region') appear there.
--   * Any member can find any other member by name, open their profile, message them and block them. Blocks apply both ways.
--   * Events import every day, now also from Cuyahoga County Public Library branches in Parma and Brook Park, and each
--     morning one pinned "Today across Cleveland" post lists the day's events.
alter table neighborhood.posts drop constraint posts_reach_check;
alter table neighborhood.posts add constraint posts_reach_check check (reach in ('area','nearby','region','members'));

create or replace function neighborhood.visible(p neighborhood.posts,viewer text) returns boolean
language sql stable set search_path = '' as $$
  select p.area_id = viewer or p.reach in ('region','members') or (p.reach = 'nearby'
    and exists(select 1 from neighborhood.area_links l where l.area_id = viewer and l.nearby_id = p.area_id))
$$;

create function neighborhood.dispatch18(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  me neighborhood.members%rowtype;
  target neighborhood.members%rowtype;
  result jsonb;
  item uuid := nullif(d->>'id','')::uuid;
  wanted text;
  query_text text;
begin
  if op not in ('create_post','message','block','unblock','profile','search') then
    return neighborhood.dispatch17(op,d);
  end if;
  select * into me from neighborhood.members m where m.id = actor;

  if op = 'create_post' then
    -- Every new post reaches all members. An author can also list it publicly ('region'), which for events means the
    -- public events page.
    -- Apps opened before this update may still send 'area' or 'nearby'; those posts now reach all members too.
    if coalesce(nullif(d->>'reach',''),'members') not in ('area','nearby','region','members') then
      raise exception 'Choose who can see this post.';
    end if;
    wanted := case when d->>'reach' = 'region' then 'region' else 'members' end;
    result := neighborhood.dispatch17(op,d || jsonb_build_object('reach',case when wanted = 'region' then 'region' else 'area' end));
    if wanted = 'members' then
      update neighborhood.posts set reach = 'members' where id = (result->>'id')::uuid and author_id = actor;
    end if;
    return result;
  elsif op = 'message' then
    -- A first message to any member opens the conversation. The layers below still check blocks, length and rate.
    if item is null and me.id is not null then
      select * into target from neighborhood.members m where m.id = nullif(d->>'peer','')::uuid and not m.sample;
      if found and target.id <> actor and char_length(btrim(coalesce(d->>'body',''))) between 1 and 1800
          and not exists(select 1 from neighborhood.blocks b where (b.owner_id,b.blocked_id) in ((actor,target.id),(target.id,actor))) then
        insert into neighborhood.threads(member_a,member_b) values(least(actor,target.id),greatest(actor,target.id))
          on conflict (member_a,member_b) do nothing;
      end if;
    end if;
    return neighborhood.dispatch17(op,d);
  elsif op in ('block','unblock') then
    -- Anyone who can message any member can block any member.
    select * into target from neighborhood.members m where m.id = nullif(d->>'peer','')::uuid and not m.sample;
    if me.id is null or not found or target.id = actor then return neighborhood.dispatch17(op,d); end if;
    if op = 'block' then
      insert into neighborhood.blocks(owner_id,blocked_id) values(actor,target.id) on conflict do nothing;
    else
      delete from neighborhood.blocks b where b.owner_id = actor and b.blocked_id = target.id;
    end if;
    return jsonb_build_object('id',null,'ok',true);
  elsif op = 'search' then
    result := neighborhood.dispatch17(op,d);
    if jsonb_typeof(result) <> 'object' or me.id is null then return result; end if;
    query_text := lower(left(btrim(coalesce(d->>'q','')),80));
    return result || jsonb_build_object('neighbors',(select coalesce(jsonb_agg(to_jsonb(x) order by x.local desc,x.name),'[]'::jsonb) from (
      select n.id,n.name,n.verified_at is not null verified,a.name area,n.area_id = me.area_id local
      from neighborhood.members n join neighborhood.areas a on a.id = n.area_id
      where not n.sample and strpos(lower(n.name),query_text) > 0
        and not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = n.id)
      order by n.area_id = me.area_id desc,n.name limit 20) x));
  end if;

  -- profile: the layers below open profiles in the member's own neighborhood or of people whose posts they can see.
  -- Any other member's profile is built here with the same fields.
  result := neighborhood.dispatch17(op,d);
  if (result is not null and result <> 'null'::jsonb) or me.id is null or item is null then return result; end if;
  select * into target from neighborhood.members m where m.id = item and not m.sample;
  if not found then return result; end if;
  return (select jsonb_build_object('id',target.id,'name',target.name,'bio',target.bio,'verified',target.verified_at is not null,
      'joined',target.created_at,'area',a.name,
      'blocked',exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = target.id),
      'businesses',(select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'category',z.category,
        'verified',neighborhood.badge(z.id)) order by z.name),'[]'::jsonb) from neighborhood.businesses z where z.owner_id = target.id),
      'founding',target.founding_no,'foundingArea',(select f.name from neighborhood.areas f where f.id = target.founding_area),
      'vouches',(select count(*) from neighborhood.vouches v where v.member_id = target.id),
      'vouched',exists(select 1 from neighborhood.vouches v where v.member_id = target.id and v.voucher_id = actor),
      'canVouch',me.verified_at is not null and not me.sample and target.verified_at is null
        and neighborhood.same_or_bordering(me.area_id,target.area_id))
    from neighborhood.areas a where a.id = target.area_id);
end
$$;

-- Event import: same rules as before, plus events that name their neighborhood directly ('area').
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
  single boolean;
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
    single := false;
    if e ? 'branch' then
      key := neighborhood.branch_key(e->>'branch');
      areas := array(select g.area_id from neighborhood.guide_items g
        where g.kind = 'library' and g.hidden_at is null and neighborhood.branch_key(g.name) = key limit 1);
      if cardinality(areas) = 1 then
        areas := areas || array(select l.nearby_id from neighborhood.area_links l join neighborhood.areas a on a.id = l.nearby_id
          where l.area_id = areas[1] and a.region = 'Cleveland'
            and not exists(select 1 from neighborhood.guide_items g where g.area_id = l.nearby_id and g.kind = 'library' and g.hidden_at is null)
          order by (select count(*) from neighborhood.posts p where p.area_id = l.nearby_id and p.kind = 'event'
            and p.event_at > now() and p.removed_at is null),l.nearby_id);
      end if;
      single := true;
    elsif e ? 'area' then
      areas := array(select a.id from neighborhood.areas a where a.id = e->>'area');
      single := true;
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
            case when single or target = areas[1] then e->>'source_url' else (e->>'source_url') || '#' || target end);
      exception when check_violation or unique_violation or not_null_violation then
        skipped := skipped + 1;
        continue;
      end;
      per_area := per_area || jsonb_build_object(target,coalesce((per_area->>target)::integer,0) + 1);
      posted := posted + 1;
      exit when single;
    end loop;
  end loop;
  insert into neighborhood.audit(actor,action,subject,details) values(owner,'import_events',owner,jsonb_build_object('posted',posted,'skipped',skipped,'areas',per_area));
  return jsonb_build_object('posted',posted,'skipped',skipped,'areas',per_area,
    'empty',(select coalesce(jsonb_agg(a.name order by a.name),'[]'::jsonb) from neighborhood.areas a where a.region = 'Cleveland'
      and not exists(select 1 from neighborhood.posts p where p.area_id = a.id and p.kind = 'event' and p.event_at > now() and p.removed_at is null)));
end
$$;

-- "Today across Cleveland": one post each morning listing the day's member-visible events by neighborhood, pinned at the
-- top of the all-members feed until the next morning. Runs once per day; a second run the same day does nothing.
create function neighborhood.daily_roundup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select o.user_id from neighborhood.platform_owner o);
  today date := (now() at time zone 'America/New_York')::date;
  link text := 'https://nabora.us/#events?day=' || to_char((now() at time zone 'America/New_York')::date,'YYYY-MM-DD');
  lines text[];
  body text := '';
  shown integer := 0;
  total integer;
  line text;
  new_id uuid;
begin
  if owner is null then raise exception 'No platform owner is set.'; end if;
  if exists(select 1 from neighborhood.posts p where p.source_url = link) then return jsonb_build_object('roundup','exists'); end if;
  lines := array(select '• ' || to_char(p.event_at at time zone 'America/New_York','FMHH12:MI AM') || ' · ' || p.title || ' (' || a.name || ')'
    from neighborhood.posts p join neighborhood.areas a on a.id = p.area_id
    where p.kind = 'event' and p.removed_at is null and p.reach in ('region','members')
      and (p.event_at at time zone 'America/New_York')::date = today and p.event_at > now() - interval '1 hour'
    order by p.event_at,a.name,p.title);
  total := cardinality(lines);
  -- Earlier roundups come down whether or not there is a new one.
  update neighborhood.posts p set pinned_until = now() where p.source_url like 'https://nabora.us/#events?day=%' and neighborhood.pinned_now(p);
  if total = 0 then return jsonb_build_object('roundup','none'); end if;
  foreach line in array lines loop
    exit when char_length(body) + char_length(line) > 2150;
    body := body || line || E'\n';
    shown := shown + 1;
  end loop;
  body := 'Here’s what’s happening in Cleveland neighborhoods today.' || E'\n\n' || body ||
    case when total > shown then E'\n' || (total - shown) || ' more on the Events page.' else '' end ||
    E'\n\nOpen any event in the feed for details, or see them all on the Events page.';
  insert into neighborhood.posts(author_id,area_id,kind,reach,title,body,source_url,pinned_at,pinned_by,pinned_until)
    values(owner,'downtown','discussion','members','Today across Cleveland · ' || to_char(today,'FMDay, FMMonth FMDD'),body,link,
      now(),owner,(today + 1 + time '05:00') at time zone 'America/New_York')
    returning id into new_id;
  insert into neighborhood.audit(actor,action,subject,details) values(owner,'daily_roundup',new_id,jsonb_build_object('events',total));
  return jsonb_build_object('roundup','posted','events',total);
end
$$;

create or replace function public.neighborhood_events(d jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when d->>'op' = 'roundup' then neighborhood.daily_roundup() else neighborhood.import_events(d) end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch18(text,jsonb),neighborhood.dispatch17(text,jsonb),neighborhood.daily_roundup(),
  neighborhood.import_events(jsonb),public.neighborhood_events(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch18(text,jsonb) to authenticated;
grant execute on function neighborhood.daily_roundup(),neighborhood.import_events(jsonb),public.neighborhood_events(jsonb) to service_role;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch18(op,d) end
$$;
commit;
