begin;

-- Weekly event import: the server reads public calendars (Cleveland Public Library, City Council ward meetings)
-- and hands the events to this function, which places each one in its neighborhood and posts it from the platform
-- owner's account. Every imported post keeps its source link, so an event is never posted twice.
alter table neighborhood.posts add column source_url text check (source_url is null or (source_url ~ '^https://' and char_length(source_url) <= 300));
create unique index posts_source_url on neighborhood.posts(source_url) where source_url is not null;
-- Library events posted by hand before this job existed keep their link, so the job won't repost them.
update neighborhood.posts p set source_url = substring(p.body from 'https://cpl\.libcal\.com/event/[0-9]+')
  where p.kind = 'event' and p.body ~ 'https://cpl\.libcal\.com/event/[0-9]+'
    and not exists(select 1 from neighborhood.posts x where x.source_url = substring(p.body from 'https://cpl\.libcal\.com/event/[0-9]+'));

create function neighborhood.branch_key(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(lower(t),'^cleveland public library · ',''),'[^a-z0-9]|branch$','','g')
$$;

create function neighborhood.import_events(d jsonb) returns jsonb
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
          values(owner,target,'event','nearby',left(e->>'title',120),left(coalesce(e->>'body',''),2400),
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

create function public.neighborhood_events(d jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select neighborhood.import_events(d) $$;
revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.import_events(jsonb),neighborhood.branch_key(text),public.neighborhood_events(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.import_events(jsonb),public.neighborhood_events(jsonb) to service_role;
commit;
