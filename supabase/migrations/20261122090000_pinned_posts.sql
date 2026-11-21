begin;

-- Pinned posts: admins can keep up to 3 posts at the top of a neighborhood's feed, for example a welcome post,
-- a how-to-get-verified guide or a community partner's announcement. A pin can end on a date or stay until it is
-- removed. Pins follow the post's own reach: a post shared with nearby neighborhoods is pinned there too.
alter table neighborhood.posts add column pinned_at timestamptz,
  add column pinned_by uuid references auth.users(id) on delete set null,
  add column pinned_until timestamptz,
  add constraint posts_pin_window check (pinned_until is null or pinned_at is not null);
create index posts_pinned on neighborhood.posts(area_id,pinned_at desc) where pinned_at is not null;

create function neighborhood.pinned_now(p neighborhood.posts) returns boolean
language sql stable set search_path = '' as $$
  select p.pinned_at is not null and p.removed_at is null and (p.pinned_until is null or p.pinned_until > now())
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
    'attending',exists(select 1 from neighborhood.rsvps x where x.post_id = p.id and x.member_id = actor),
    'pinned',neighborhood.pinned_now(p),'pinned_until',case when neighborhood.pinned_now(p) then p.pinned_until end)
  from neighborhood.members n join neighborhood.areas a on a.id = p.area_id
  left join neighborhood.businesses b on b.id = p.business_id where n.id = p.author_id
$$;

create function neighborhood.dispatch8(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  area text;
  scope text;
  item uuid;
  days integer;
  result jsonb;
  chosen neighborhood.posts%rowtype;
begin
  if op not in ('bootstrap','admin','pinned','pin_post','unpin_post') then
    return neighborhood.dispatch7(op,d);
  end if;
  is_admin := exists(select 1 from neighborhood.staff s where s.user_id = actor and s.role = 'admin');

  if op = 'bootstrap' then
    result := neighborhood.dispatch7(op,d);
    if jsonb_typeof(result) <> 'object' then return result; end if;
    return result || jsonb_build_object('canPin',is_admin);
  elsif op = 'admin' then
    result := neighborhood.dispatch7(op,d);
    return result || jsonb_build_object('pins',(select coalesce(jsonb_agg(to_jsonb(x) order by x.area,x.pinned_at desc),'[]'::jsonb) from (
      select p.id,p.title,a.name area,p.reach,p.pinned_at,p.pinned_until from neighborhood.posts p join neighborhood.areas a on a.id = p.area_id
      where neighborhood.pinned_now(p)) x));
  end if;

  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  select m.area_id into area from neighborhood.members m where m.id = actor;
  if area is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;

  if op = 'pinned' then
    scope := coalesce(nullif(d->>'scope',''),'area');
    return (select coalesce(jsonb_agg(neighborhood.post_json(f,actor) order by f.area_id = area desc,f.pinned_at desc),'[]'::jsonb) from (
      select f.* from neighborhood.posts f
      where neighborhood.pinned_now(f)
        and case when scope = 'region' then neighborhood.visible(f,area)
              when scope = 'nearby' then f.area_id = area or (f.reach <> 'area'
                and exists(select 1 from neighborhood.area_links l where l.area_id = area and l.nearby_id = f.area_id))
              else f.area_id = area end
        and not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = f.author_id)
      order by f.area_id = area desc,f.pinned_at desc limit 5) f);
  end if;

  if not is_admin then raise exception 'Only admins can pin posts.' using errcode = '42501'; end if;
  item := nullif(d->>'id','')::uuid;
  select * into chosen from neighborhood.posts x where x.id = item and x.removed_at is null for update;
  if chosen.id is null then raise exception 'Post unavailable.' using errcode = '42501'; end if;

  if op = 'unpin_post' then
    update neighborhood.posts set pinned_at = null,pinned_by = null,pinned_until = null where id = item;
  else
    days := nullif(d->>'days','')::integer;
    if days is not null and days not between 1 and 365 then raise exception 'Choose between 1 and 365 days, or leave it empty to keep it pinned.'; end if;
    if (select count(*) from neighborhood.posts x where x.area_id = chosen.area_id and x.id <> item and neighborhood.pinned_now(x)) >= 3 then
      raise exception '% already has 3 pinned posts. Unpin one first.',(select a.name from neighborhood.areas a where a.id = chosen.area_id);
    end if;
    update neighborhood.posts set pinned_at = now(),pinned_by = actor,
      pinned_until = case when days is null then null else now() + make_interval(days => days) end where id = item;
  end if;
  insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('days',days));
  return jsonb_build_object('id',item,'ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch8(text,jsonb),neighborhood.dispatch7(text,jsonb),neighborhood.pinned_now(neighborhood.posts)
  from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch8(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch8(op,d) end
$$;
commit;
