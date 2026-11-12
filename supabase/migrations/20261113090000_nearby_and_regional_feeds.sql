begin;

-- Approximate neighborhood centres, used only to work out which neighborhoods are near each other.
alter table neighborhood.areas add column lat double precision, add column lng double precision;
update neighborhood.areas a set lat = v.lat,lng = v.lng from (values
 ('bellaire-puritas',41.435,-81.800),('broadway-slavic-village',41.455,-81.640),('brooklyn-centre',41.452,-81.700),
 ('buckeye-shaker-square',41.484,-81.590),('buckeye-woodhill',41.487,-81.612),('central',41.493,-81.655),
 ('clark-fulton',41.465,-81.710),('collinwood-nottingham',41.565,-81.560),('cudell',41.475,-81.755),
 ('cuyahoga-valley',41.470,-81.670),('detroit-shoreway',41.483,-81.730),('downtown',41.500,-81.690),
 ('edgewater',41.488,-81.755),('euclid-green',41.560,-81.535),('fairfax',41.497,-81.625),('glenville',41.535,-81.615),
 ('goodrich-kirtland-park',41.515,-81.670),('hopkins',41.410,-81.840),('hough',41.512,-81.635),('jefferson',41.455,-81.785),
 ('kamms-corners',41.445,-81.820),('kinsman',41.478,-81.630),('lee-harvard',41.445,-81.565),('lee-seville',41.435,-81.575),
 ('mount-pleasant',41.462,-81.590),('north-shore-collinwood',41.580,-81.570),('ohio-city',41.485,-81.708),
 ('old-brooklyn',41.435,-81.705),('st-clair-superior',41.525,-81.650),('stockyards',41.465,-81.725),('tremont',41.478,-81.690),
 ('union-miles',41.445,-81.610),('university-circle',41.508,-81.605),('west-boulevard',41.462,-81.752),
 ('brook-park',41.398,-81.822),('lakewood',41.482,-81.798),('parma',41.385,-81.729)
) v(id,lat,lng) where a.id = v.id;

-- Which neighborhoods count as nearby. Seeded from the five closest centres in each direction; rows can be
-- added or removed by an operator to match real boundaries.
create table neighborhood.area_links (
  area_id text not null references neighborhood.areas on delete cascade,
  nearby_id text not null references neighborhood.areas on delete cascade,
  primary key (area_id,nearby_id), check (area_id <> nearby_id)
);
create index area_links_nearby on neighborhood.area_links(nearby_id);
alter table neighborhood.area_links enable row level security;
insert into neighborhood.area_links(area_id,nearby_id)
  select a.id,b.id from neighborhood.areas a cross join lateral (
    select c.id from neighborhood.areas c where c.id <> a.id and c.lat is not null
    order by power((c.lat - a.lat) * 111.0,2) + power((c.lng - a.lng) * 83.4,2),c.id limit 5
  ) b where a.lat is not null;
insert into neighborhood.area_links(area_id,nearby_id)
  select l.nearby_id,l.area_id from neighborhood.area_links l on conflict do nothing;

-- The author chooses how far a post travels. Existing posts stay inside their own neighborhood.
alter table neighborhood.posts add column reach text not null default 'area' check (reach in ('area','nearby','region'));
create index posts_reach_date on neighborhood.posts(created_at desc,id desc) where reach <> 'area';

create function neighborhood.visible(p neighborhood.posts,viewer text) returns boolean
language sql stable set search_path = '' as $$
  select p.area_id = viewer or p.reach = 'region' or (p.reach = 'nearby'
    and exists(select 1 from neighborhood.area_links l where l.area_id = viewer and l.nearby_id = p.area_id))
$$;

create or replace function neighborhood.post_json(p neighborhood.posts,actor uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',p.id,'author_id',p.author_id,'kind',p.kind,'title',p.title,'body',p.body,'created_at',p.created_at,
    'closed',p.closed,'image_id',p.image_id,'price_cents',p.price_cents,'event_at',p.event_at,'place',p.place,
    'reach',p.reach,'area',a.name,'local',p.area_id = (select v.area_id from neighborhood.members v where v.id = actor),
    'author',n.name,'author_verified',n.verified_at is not null,
    'business_id',b.id,'business',b.name,'business_verified',b.id is not null and neighborhood.badge(b.id),
    'replies',(select count(*) from neighborhood.replies r where r.post_id = p.id and r.removed_at is null),
    'likes',(select count(*) from neighborhood.reactions x where x.post_id = p.id),
    'liked',exists(select 1 from neighborhood.reactions x where x.post_id = p.id and x.member_id = actor),
    'going',(select count(*) from neighborhood.rsvps x where x.post_id = p.id),
    'attending',exists(select 1 from neighborhood.rsvps x where x.post_id = p.id and x.member_id = actor))
  from neighborhood.members n join neighborhood.areas a on a.id = p.area_id
  left join neighborhood.businesses b on b.id = p.business_id where n.id = p.author_id
$$;

-- Handles everything that has to look beyond the member's own neighborhood and passes the rest on.
create function neighborhood.dispatch3(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  m neighborhood.members%rowtype;
  area text;
  item uuid;
  target uuid;
  parent uuid;
  scope text;
  body_text text;
  reason_text text;
  result jsonb;
  cursor_time timestamptz;
  cursor_id uuid;
  p neighborhood.posts%rowtype;
  b neighborhood.businesses%rowtype;
  r neighborhood.replies%rowtype;
  convo neighborhood.threads%rowtype;
begin
  if op not in ('feed','post','create_post','reply','react','rsvp','vote','report_content','message','block','unblock',
      'image','search','profile','business') then
    result := neighborhood.dispatch2(op,d);
    if op = 'bootstrap' and jsonb_typeof(result->'member') = 'object' then
      result := result || jsonb_build_object('nearby',(select coalesce(jsonb_agg(a.name order by a.name),'[]'::jsonb)
        from neighborhood.area_links l join neighborhood.areas a on a.id = l.nearby_id
        where l.area_id = result->'member'->>'area_id'));
    end if;
    return result;
  end if;

  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  if d is null or jsonb_typeof(d) <> 'object' or pg_column_size(d) > 20000 then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  select * into m from neighborhood.members where id = actor;
  if m.id is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
  area := m.area_id;
  item := nullif(d->>'id','')::uuid;
  body_text := btrim(d->>'body');
  reason_text := btrim(d->>'reason');
  scope := coalesce(nullif(d->>'scope',''),'area');
  cursor_time := coalesce(nullif(d->>'before','')::timestamptz,'infinity'::timestamptz);
  cursor_id := coalesce(nullif(d->>'cursor','')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);

  case op
  when 'feed' then
    target := nullif(d->>'author','')::uuid;
    return (select coalesce(jsonb_agg(neighborhood.post_json(f,actor) order by f.created_at desc,f.id desc),'[]'::jsonb) from (
      select f.* from neighborhood.posts f
      where f.removed_at is null and (f.created_at,f.id) < (cursor_time,cursor_id)
        and case when target is not null or scope = 'region' then neighborhood.visible(f,area)
              when scope = 'nearby' then f.area_id = area or (f.reach <> 'area'
                and exists(select 1 from neighborhood.area_links l where l.area_id = area and l.nearby_id = f.area_id))
              else f.area_id = area end
        and (nullif(d->>'kind','') is null or f.kind = d->>'kind')
        and (target is null or (f.author_id = target and f.business_id is null))
        and (nullif(d->>'fresh','') is null or (not f.closed and f.created_at > now() - interval '48 hours'))
        and not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = f.author_id)
      order by f.created_at desc,f.id desc limit 25
    ) f);
  when 'post' then
    select * into p from neighborhood.posts x where x.id = item and x.removed_at is null and neighborhood.visible(x,area);
    if not found then raise exception 'Post unavailable.' using errcode = '42501'; end if;
    return neighborhood.post_json(p,actor) || jsonb_build_object(
      'replies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb) from (
        select x.id,x.author_id,x.parent_id,x.body,x.created_at,x.affiliated,n.name author,n.verified_at is not null author_verified,
          z.id business_id,z.name business
        from neighborhood.replies x join neighborhood.members n on n.id = x.author_id
        left join neighborhood.businesses z on z.id = x.business_id where x.post_id = item and x.removed_at is null
        order by x.created_at,x.id limit 200
      ) x),
      'options',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,
          'votes',(select count(*) from neighborhood.poll_votes v where v.option_id = o.id)) order by o.sort),'[]'::jsonb)
        from neighborhood.poll_options o where o.post_id = item),
      'vote',(select v.option_id from neighborhood.poll_votes v where v.post_id = item and v.member_id = actor));
  when 'create_post' then
    if coalesce(nullif(d->>'reach',''),'area') not in ('area','nearby','region') then
      raise exception 'Choose who can see this post.';
    end if;
    result := neighborhood.dispatch2(op,d - 'reach');
    update neighborhood.posts set reach = coalesce(nullif(d->>'reach',''),'area') where id = (result->>'id')::uuid and author_id = actor;
    return result;
  when 'reply' then
    perform neighborhood.limit_action(actor,op,30);
    select * into p from neighborhood.posts x where x.id = item and x.removed_at is null and neighborhood.visible(x,area) for update;
    if not found or (p.closed and p.kind in ('request','poll')) then
      raise exception 'This conversation is unavailable.' using errcode = '42501';
    end if;
    target := nullif(d->>'business','')::uuid;
    if target is not null and not exists(select 1 from neighborhood.businesses z where z.id = target and z.owner_id = actor and z.area_id = area) then
      raise exception 'You can only reply as your own business.' using errcode = '42501';
    end if;
    parent := nullif(d->>'parent','')::uuid;
    if parent is not null then
      select * into r from neighborhood.replies where id = parent and post_id = item and removed_at is null;
      if not found then raise exception 'Reply unavailable.' using errcode = '42501'; end if;
      parent := coalesce(r.parent_id,r.id);
      perform neighborhood.notify(r.author_id,actor,'reply',item,null,null);
    end if;
    insert into neighborhood.replies(post_id,author_id,business_id,affiliated,body,parent_id)
      values(item,actor,target,target is not null or coalesce((d->>'affiliated')::boolean,false),body_text,parent);
    perform neighborhood.notify(p.author_id,actor,'reply',item,null,null);
  when 'react','rsvp' then
    perform neighborhood.limit_action(actor,op,120);
    select * into p from neighborhood.posts x where x.id = item and x.removed_at is null and neighborhood.visible(x,area);
    if not found or (op = 'rsvp' and p.kind <> 'event') then raise exception 'Post unavailable.' using errcode = '42501'; end if;
    if op = 'react' then
      delete from neighborhood.reactions where post_id = item and member_id = actor;
      if not found then
        insert into neighborhood.reactions(post_id,member_id) values(item,actor);
        perform neighborhood.notify(p.author_id,actor,'like',item,null,null);
      end if;
    else
      delete from neighborhood.rsvps where post_id = item and member_id = actor;
      if not found then
        insert into neighborhood.rsvps(post_id,member_id) values(item,actor);
        perform neighborhood.notify(p.author_id,actor,'rsvp',item,null,null);
      end if;
    end if;
  when 'vote' then
    perform neighborhood.limit_action(actor,op,60);
    target := nullif(d->>'option','')::uuid;
    if not exists(select 1 from neighborhood.posts x join neighborhood.poll_options o on o.post_id = x.id
        where x.id = item and x.removed_at is null and x.kind = 'poll' and not x.closed and o.id = target
          and neighborhood.visible(x,area)) then
      raise exception 'Poll unavailable.' using errcode = '42501';
    end if;
    insert into neighborhood.poll_votes(post_id,member_id,option_id) values(item,actor,target)
      on conflict(post_id,member_id) do update set option_id = excluded.option_id;
  when 'report_content' then
    perform neighborhood.limit_action(actor,op,10);
    if d->>'kind' = 'post' then
      select x.id into target from neighborhood.posts x where x.id = item and x.removed_at is null and x.author_id <> actor
        and neighborhood.visible(x,area) for update;
      if target is not null then insert into neighborhood.content_reports(reporter_id,post_id,reason)
        values(actor,target,reason_text) on conflict do nothing; end if;
    elsif d->>'kind' = 'reply' then
      select y.id into target from neighborhood.replies y join neighborhood.posts x on x.id = y.post_id
        where y.id = item and y.removed_at is null and x.removed_at is null and y.author_id <> actor
          and neighborhood.visible(x,area) for update of y;
      if target is not null then insert into neighborhood.content_reports(reporter_id,reply_id,reason)
        values(actor,target,reason_text) on conflict do nothing; end if;
    end if;
    if target is null then raise exception 'Content unavailable.' using errcode = '42501'; end if;
  when 'message','block','unblock' then
    if op = 'message' and item is not null then
      select * into convo from neighborhood.threads where id = item and actor in(member_a,member_b);
      if not found then raise exception 'Conversation unavailable.' using errcode = '42501'; end if;
      target := case when convo.member_a = actor then convo.member_b else convo.member_a end;
    else
      target := nullif(d->>'peer','')::uuid;
    end if;
    -- A neighbor can be reached if they share the neighborhood, already share a conversation, or wrote a post the member can see.
    if target is null or target = actor or not exists(select 1 from neighborhood.members n where n.id = target and (n.area_id = area
        or exists(select 1 from neighborhood.threads t where t.member_a = least(actor,target) and t.member_b = greatest(actor,target))
        or exists(select 1 from neighborhood.posts x where x.author_id = target and x.removed_at is null and neighborhood.visible(x,area)))) then
      raise exception 'Neighbor unavailable.' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(least(actor,target)::text || greatest(actor,target)::text,23));
    if op = 'block' then
      insert into neighborhood.blocks values(actor,target) on conflict do nothing;
    elsif op = 'unblock' then
      delete from neighborhood.blocks where owner_id = actor and blocked_id = target;
    else
      perform neighborhood.limit_action(actor,op,45);
      if exists(select 1 from neighborhood.blocks where (owner_id,blocked_id) in ((actor,target),(target,actor))) then
        raise exception 'Messaging is unavailable for this conversation.' using errcode = '42501';
      end if;
      insert into neighborhood.threads(member_a,member_b) values (least(actor,target),greatest(actor,target))
        on conflict (member_a,member_b) do update set updated_at = now() returning id into item;
      insert into neighborhood.messages(thread_id,sender_id,body) values(item,actor,body_text);
    end if;
  when 'image' then
    return (select jsonb_build_object('mime',i.mime,'data',translate(encode(i.data,'base64'),E'\n',''))
      from neighborhood.images i join neighborhood.members o on o.id = i.owner_id where i.id = item and (o.area_id = area
        or exists(select 1 from neighborhood.businesses z where z.image_id = i.id)
        or exists(select 1 from neighborhood.posts x where x.image_id = i.id and x.removed_at is null and neighborhood.visible(x,area))));
  when 'search' then
    result := neighborhood.dispatch2(op,d);
    return result || jsonb_build_object('posts',(select coalesce(jsonb_agg(neighborhood.post_json(x,actor) order by x.created_at desc),'[]'::jsonb) from (
      select x.* from neighborhood.posts x where x.removed_at is null and neighborhood.visible(x,area)
        and strpos(lower(x.title || ' ' || x.body),lower(left(btrim(d->>'q'),80))) > 0
        and not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = x.author_id)
      order by x.created_at desc limit 20) x));
  when 'profile' then
    return (select jsonb_build_object('id',n.id,'name',n.name,'bio',n.bio,'verified',n.verified_at is not null,'joined',n.created_at,
      'area',a.name,'blocked',exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = n.id),
      'businesses',(select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'category',z.category,
        'verified',neighborhood.badge(z.id)) order by z.name),'[]'::jsonb) from neighborhood.businesses z where z.owner_id = n.id))
      from neighborhood.members n join neighborhood.areas a on a.id = n.area_id where n.id = coalesce(item,actor) and (n.area_id = area
        or exists(select 1 from neighborhood.posts x where x.author_id = n.id and x.removed_at is null and neighborhood.visible(x,area))));
  when 'business' then
    -- A business profile opens for its own neighborhood and for anyone who can see one of its updates.
    select * into b from neighborhood.businesses z where z.id = item and (z.area_id = area
      or exists(select 1 from neighborhood.posts x where x.business_id = z.id and x.removed_at is null and neighborhood.visible(x,area)));
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
    return to_jsonb(b) || jsonb_build_object('verified',neighborhood.badge(item),'area',(select a.name from neighborhood.areas a where a.id = b.area_id),
      'local',b.area_id = area,
      'owner',(select n.name from neighborhood.members n where n.id = b.owner_id),
      'rating',(select round(avg(v.rating),1) from neighborhood.reviews v where v.business_id = item and v.status = 'published'),
      'review_count',(select count(*) from neighborhood.reviews v where v.business_id = item and v.status = 'published'),
      'updates',(select coalesce(jsonb_agg(neighborhood.post_json(x,actor) order by x.created_at desc),'[]'::jsonb) from (
        select x.* from neighborhood.posts x where x.business_id = item and x.removed_at is null and neighborhood.visible(x,area)
        order by x.created_at desc limit 5) x),
      'reviews',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) from (
        select v.id,v.rating,v.body,v.created_at,v.affiliated,v.author_id <> actor as reportable,n.name author,
          n.verified_at is not null author_verified
        from neighborhood.reviews v join neighborhood.members n on n.id = v.author_id
        where v.business_id = item and v.status = 'published' and (v.created_at,v.id) < (cursor_time,cursor_id)
        order by v.created_at desc,v.id desc limit 25
      ) x),'ownReview',exists(select 1 from neighborhood.reviews v where v.business_id = item and v.author_id = actor));
  end case;
  return jsonb_build_object('id',item,'ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on all functions in schema neighborhood from public, anon, authenticated, service_role;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select neighborhood.dispatch3(op,d) $$;
grant execute on function neighborhood.dispatch3(text,jsonb) to authenticated;
grant execute on function neighborhood.sync_payment(jsonb),neighborhood.purge_residency() to service_role;
commit;
