begin;

-- Profiles and address-free residency verification -------------------------------------------
alter table neighborhood.members
  add column bio text not null default '' check (char_length(bio) <= 300),
  add column verified_at timestamptz;

-- The address and the plain code exist only while a postcard is waiting to be sent. Marking the
-- postcard as mailed is the same statement that erases both; the constraint makes any other state
-- impossible to store. A successful confirmation deletes the whole row.
create table neighborhood.residency_checks (
  member_id uuid primary key references neighborhood.members on delete cascade,
  address text check (address is null or char_length(address) between 8 and 200),
  code text,
  code_hash text,
  status text not null default 'pending' check (status in ('pending','mailed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  mailed_at timestamptz,
  check ((status = 'pending' and address is not null and code is not null and code_hash is null)
      or (status = 'mailed' and address is null and code is null and code_hash is not null and mailed_at is not null))
);

-- Photos ------------------------------------------------------------------------------------
create table neighborhood.images (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references neighborhood.members on delete cascade,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  data bytea not null check (octet_length(data) between 64 and 300000),
  created_at timestamptz not null default now()
);
create index images_owner on neighborhood.images(owner_id,created_at desc);

-- Businesses --------------------------------------------------------------------------------
alter table neighborhood.businesses
  add column image_id uuid references neighborhood.images on delete set null,
  add column phone text check (phone is null or phone ~ '^[0-9+() .-]{7,20}$'),
  add column hours text check (hours is null or char_length(hours) <= 200);
alter table neighborhood.billing
  add column paid_at timestamptz,
  add column payment_ref text;

-- Posts -------------------------------------------------------------------------------------
alter table neighborhood.posts drop constraint posts_kind_check;
alter table neighborhood.posts
  add constraint posts_kind_check check (kind in ('discussion','request','event','alert','lost','sale','poll','offer')),
  add column image_id uuid references neighborhood.images on delete set null,
  add column price_cents integer check (price_cents between 0 and 10000000),
  add column event_at timestamptz,
  add column place text check (place is null or char_length(place) between 2 and 120),
  add column business_id uuid references neighborhood.businesses on delete cascade,
  add constraint posts_offer_business check ((kind = 'offer') = (business_id is not null)),
  add constraint posts_sale_price check ((kind = 'sale') = (price_cents is not null)),
  add constraint posts_event_time check (kind <> 'event' or event_at is not null);
create index posts_business on neighborhood.posts(business_id,created_at desc) where business_id is not null;
create index posts_image on neighborhood.posts(image_id) where image_id is not null;
create index businesses_image on neighborhood.businesses(image_id) where image_id is not null;

alter table neighborhood.replies add column parent_id uuid references neighborhood.replies on delete cascade;
create index replies_parent on neighborhood.replies(parent_id) where parent_id is not null;

create table neighborhood.reactions (
  post_id uuid not null references neighborhood.posts on delete cascade,
  member_id uuid not null references neighborhood.members on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,member_id)
);
create index reactions_member on neighborhood.reactions(member_id);
create table neighborhood.rsvps (
  post_id uuid not null references neighborhood.posts on delete cascade,
  member_id uuid not null references neighborhood.members on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,member_id)
);
create index rsvps_member on neighborhood.rsvps(member_id);
create table neighborhood.poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references neighborhood.posts on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  sort integer not null,
  unique (post_id,sort)
);
create table neighborhood.poll_votes (
  post_id uuid not null references neighborhood.posts on delete cascade,
  member_id uuid not null references neighborhood.members on delete cascade,
  option_id uuid not null references neighborhood.poll_options on delete cascade,
  primary key (post_id,member_id)
);
create index poll_votes_option on neighborhood.poll_votes(option_id);
create index poll_votes_member on neighborhood.poll_votes(member_id);

create table neighborhood.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references neighborhood.members on delete cascade,
  actor_id uuid references neighborhood.members on delete cascade,
  kind text not null check (kind in ('reply','like','rsvp','message','alert','review','vetting','payment','residency')),
  post_id uuid references neighborhood.posts on delete cascade,
  thread_id uuid references neighborhood.threads on delete cascade,
  business_id uuid references neighborhood.businesses on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_member on neighborhood.notifications(member_id,created_at desc);
create index notifications_unread on neighborhood.notifications(member_id) where read_at is null;
create index notifications_actor on neighborhood.notifications(actor_id);
create index notifications_post on neighborhood.notifications(post_id);
create index notifications_thread on neighborhood.notifications(thread_id);
create index notifications_business on neighborhood.notifications(business_id);

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'neighborhood' loop
    execute format('alter table neighborhood.%I enable row level security',t);
  end loop;
end $$;

-- The vetted badge is now a one-time fee: current human approval plus a recorded, unrefunded payment.
create or replace function neighborhood.badge(p_business uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from neighborhood.vetting v join neighborhood.billing b using (business_id)
    where v.business_id = p_business and v.status = 'approved' and v.expires_at > now() and b.paid_at is not null
  )
$$;

create function neighborhood.notify(p_member uuid,p_actor uuid,p_kind text,p_post uuid,p_thread uuid,p_business uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if p_member is null or p_member is not distinct from p_actor then return; end if;
  if p_actor is not null and exists(select 1 from neighborhood.blocks where owner_id = p_member and blocked_id = p_actor) then return; end if;
  if exists(select 1 from neighborhood.notifications n where n.member_id = p_member and n.kind = p_kind and n.read_at is null
      and n.actor_id is not distinct from p_actor and n.post_id is not distinct from p_post
      and n.thread_id is not distinct from p_thread and n.business_id is not distinct from p_business) then return; end if;
  insert into neighborhood.notifications(member_id,actor_id,kind,post_id,thread_id,business_id)
    values(p_member,p_actor,p_kind,p_post,p_thread,p_business);
end
$$;

create function neighborhood.on_message() returns trigger language plpgsql set search_path = '' as $$
begin
  perform neighborhood.notify(case when t.member_a = new.sender_id then t.member_b else t.member_a end,new.sender_id,'message',null,t.id,null)
    from neighborhood.threads t where t.id = new.thread_id;
  return null;
end $$;
create trigger messages_notify after insert on neighborhood.messages for each row execute function neighborhood.on_message();

create function neighborhood.on_review_decision() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform neighborhood.notify(new.author_id,null,'review',null,null,new.business_id);
  end if;
  return null;
end $$;
create trigger reviews_notify after update on neighborhood.reviews for each row execute function neighborhood.on_review_decision();

create function neighborhood.on_vetting_decision() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    perform neighborhood.notify(b.owner_id,null,'vetting',null,null,b.id) from neighborhood.businesses b where b.id = new.business_id;
  end if;
  return null;
end $$;
create trigger vetting_notify after update on neighborhood.vetting for each row execute function neighborhood.on_vetting_decision();

create function neighborhood.residency_hash(p_member uuid,p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(upper(btrim(p_code)) || ':' || p_member::text,'UTF8')),'hex')
$$;

-- Removes verification requests that were never completed, including any address still waiting.
create function neighborhood.purge_residency() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from neighborhood.residency_checks where created_at < now() - interval '45 days';
  get diagnostics removed = row_count;
  return removed;
end $$;

create function neighborhood.post_json(p neighborhood.posts,actor uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',p.id,'author_id',p.author_id,'kind',p.kind,'title',p.title,'body',p.body,'created_at',p.created_at,
    'closed',p.closed,'image_id',p.image_id,'price_cents',p.price_cents,'event_at',p.event_at,'place',p.place,
    'author',n.name,'author_verified',n.verified_at is not null,
    'business_id',b.id,'business',b.name,'business_verified',b.id is not null and neighborhood.badge(b.id),
    'replies',(select count(*) from neighborhood.replies r where r.post_id = p.id and r.removed_at is null),
    'likes',(select count(*) from neighborhood.reactions x where x.post_id = p.id),
    'liked',exists(select 1 from neighborhood.reactions x where x.post_id = p.id and x.member_id = actor),
    'going',(select count(*) from neighborhood.rsvps x where x.post_id = p.id),
    'attending',exists(select 1 from neighborhood.rsvps x where x.post_id = p.id and x.member_id = actor))
  from neighborhood.members n left join neighborhood.businesses b on b.id = p.business_id where n.id = p.author_id
$$;

create function neighborhood.dispatch2(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  m neighborhood.members%rowtype;
  role_name text;
  area text;
  item uuid;
  target uuid;
  parent uuid;
  image uuid;
  body_text text;
  kind_text text;
  query_text text;
  action_text text;
  result jsonb;
  amount integer;
  starts timestamptz;
  option_label text;
  position integer := 0;
  cursor_time timestamptz;
  cursor_id uuid;
  p neighborhood.posts%rowtype;
  b neighborhood.businesses%rowtype;
  rc neighborhood.residency_checks%rowtype;
  bill neighborhood.billing%rowtype;
  r neighborhood.replies%rowtype;
begin
  if op not in ('feed','post','create_post','close_post','delete_post','reply','delete_reply','react','rsvp','vote','upload_image','image',
      'notifications','read_notifications','search','profile','update_profile','request_residency','cancel_residency','confirm_residency',
      'decide_residency','directory','my_businesses','business','create_business','update_business','checkout') then
    if op = 'billing_portal' then raise exception 'Unknown operation.' using errcode = '22023'; end if;
    result := neighborhood.dispatch(op,d);
    if op = 'bootstrap' and jsonb_typeof(result->'member') = 'object' then
      result := result || jsonb_build_object(
        'unread',(select count(*) from neighborhood.notifications n where n.member_id = actor and n.read_at is null),
        'residency',(select c.status from neighborhood.residency_checks c where c.member_id = actor));
    elsif op = 'moderation' then
      perform neighborhood.purge_residency();
      result := result || jsonb_build_object('residency',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]'::jsonb) from (
        select c.member_id id,n.name,a.name area,c.address,c.code,c.created_at
        from neighborhood.residency_checks c join neighborhood.members n on n.id = c.member_id
        join neighborhood.areas a on a.id = n.area_id
        where c.status = 'pending' and c.member_id <> actor order by c.created_at limit 40
      ) c));
    end if;
    return result;
  end if;

  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  if d is null or jsonb_typeof(d) <> 'object' then raise exception 'Invalid request.' using errcode = '22023'; end if;
  if op = 'upload_image' then
    if char_length(coalesce(d->>'data','')) not between 80 and 410000 or pg_column_size(d - 'data') > 2000 then
      raise exception 'Photo is too large.' using errcode = 'P0001';
    end if;
  elsif pg_column_size(d) > 20000 then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  select * into m from neighborhood.members where id = actor;
  if m.id is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
  select role into role_name from neighborhood.staff where user_id = actor;
  area := m.area_id;
  item := nullif(d->>'id','')::uuid;
  body_text := btrim(d->>'body');
  action_text := d->>'action';
  image := nullif(d->>'image','')::uuid;
  cursor_time := coalesce(nullif(d->>'before','')::timestamptz,'infinity'::timestamptz);
  cursor_id := coalesce(nullif(d->>'cursor','')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
  if image is not null and not exists(select 1 from neighborhood.images i where i.id = image and i.owner_id = actor) then
    raise exception 'Photo unavailable.' using errcode = '42501';
  end if;

  case op
  when 'feed' then
    target := nullif(d->>'author','')::uuid;
    return (select coalesce(jsonb_agg(neighborhood.post_json(f,actor) order by f.created_at desc,f.id desc),'[]'::jsonb) from (
      select f.* from neighborhood.posts f
      where f.area_id = area and f.removed_at is null and (f.created_at,f.id) < (cursor_time,cursor_id)
        and (nullif(d->>'kind','') is null or f.kind = d->>'kind')
        and (target is null or (f.author_id = target and f.business_id is null))
        and (nullif(d->>'fresh','') is null or (not f.closed and f.created_at > now() - interval '48 hours'))
        and not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = f.author_id)
      order by f.created_at desc,f.id desc limit 25
    ) f);
  when 'post' then
    select * into p from neighborhood.posts where id = item and area_id = area and removed_at is null;
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
    perform neighborhood.limit_action(actor,op,10);
    kind_text := d->>'kind';
    if kind_text = 'alert' then perform neighborhood.limit_action(actor,'create_alert',3); end if;
    if kind_text = 'sale' then
      amount := round(coalesce(nullif(btrim(d->>'price'),''),'0')::numeric * 100)::integer;
    end if;
    if kind_text = 'event' then
      starts := nullif(d->>'when','')::timestamptz;
      if starts is null or starts < now() - interval '1 day' then raise exception 'Choose when the event starts.'; end if;
    end if;
    if kind_text = 'offer' then
      target := nullif(d->>'business','')::uuid;
      if not exists(select 1 from neighborhood.businesses z where z.id = target and z.owner_id = actor and z.area_id = area) then
        raise exception 'You can only post as your own business.' using errcode = '42501';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(target::text,31));
      if (select count(*) from neighborhood.posts x where x.business_id = target and x.removed_at is null
          and x.created_at > now() - interval '7 days') >= 2 then
        raise exception 'A business can share two updates a week.';
      end if;
    end if;
    insert into neighborhood.posts(author_id,area_id,kind,title,body,image_id,price_cents,event_at,place,business_id)
      values(actor,area,kind_text,btrim(d->>'title'),body_text,image,amount,starts,
        case when kind_text in ('event','sale','lost','alert') then nullif(btrim(d->>'place'),'') end,
        case when kind_text = 'offer' then target end) returning id into item;
    if kind_text = 'poll' then
      for option_label in select btrim(value) from jsonb_each_text(d) where key ~ '^option[1-6]$' and btrim(value) <> '' order by key loop
        position := position + 1;
        insert into neighborhood.poll_options(post_id,label,sort) values(item,option_label,position);
      end loop;
      if position < 2 then raise exception 'A poll needs at least two choices.'; end if;
    elsif kind_text = 'alert' then
      insert into neighborhood.notifications(member_id,actor_id,kind,post_id)
        select n.id,actor,'alert',item from neighborhood.members n where n.area_id = area and n.id <> actor
          and not exists(select 1 from neighborhood.blocks k where k.owner_id = n.id and k.blocked_id = actor);
    end if;
  when 'close_post' then
    update neighborhood.posts set closed = true where id = item and author_id = actor
      and kind in ('request','sale','lost','alert','poll') and removed_at is null;
    if not found then raise exception 'Post unavailable.' using errcode = '42501'; end if;
  when 'delete_post' then
    update neighborhood.posts set removed_at = now() where id = item and author_id = actor and removed_at is null;
    if not found then raise exception 'Post unavailable.' using errcode = '42501'; end if;
  when 'reply' then
    perform neighborhood.limit_action(actor,op,30);
    select * into p from neighborhood.posts where id = item and area_id = area and removed_at is null for update;
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
  when 'delete_reply' then
    update neighborhood.replies set removed_at = now() where id = item and author_id = actor and removed_at is null;
    if not found then raise exception 'Reply unavailable.' using errcode = '42501'; end if;
  when 'react','rsvp' then
    perform neighborhood.limit_action(actor,op,120);
    select * into p from neighborhood.posts where id = item and area_id = area and removed_at is null;
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
        where x.id = item and x.area_id = area and x.removed_at is null and x.kind = 'poll' and not x.closed and o.id = target) then
      raise exception 'Poll unavailable.' using errcode = '42501';
    end if;
    insert into neighborhood.poll_votes(post_id,member_id,option_id) values(item,actor,target)
      on conflict(post_id,member_id) do update set option_id = excluded.option_id;
  when 'upload_image' then
    perform neighborhood.limit_action(actor,op,20);
    if (select count(*) from neighborhood.images i where i.owner_id = actor) >= 400 then raise exception 'Photo limit reached.'; end if;
    insert into neighborhood.images(owner_id,mime,data) values(actor,d->>'mime',decode(d->>'data','base64')) returning id into item;
  when 'image' then
    return (select jsonb_build_object('mime',i.mime,'data',translate(encode(i.data,'base64'),E'\n',''))
      from neighborhood.images i join neighborhood.members o on o.id = i.owner_id where i.id = item and o.area_id = area);
  when 'notifications' then
    return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb) from (
      select n.id,n.kind,n.created_at,n.read_at is not null as read,a.name actor,n.post_id,x.title,n.thread_id,n.business_id,z.name business
      from neighborhood.notifications n left join neighborhood.members a on a.id = n.actor_id
      left join neighborhood.posts x on x.id = n.post_id left join neighborhood.businesses z on z.id = n.business_id
      where n.member_id = actor and (x.id is null or x.removed_at is null) order by n.created_at desc,n.id limit 50
    ) x);
  when 'read_notifications' then
    update neighborhood.notifications set read_at = now() where member_id = actor and read_at is null;
  when 'search' then
    query_text := lower(left(btrim(coalesce(d->>'q','')),80));
    if char_length(query_text) < 2 then raise exception 'Search for at least two characters.'; end if;
    return jsonb_build_object(
      'posts',(select coalesce(jsonb_agg(neighborhood.post_json(x,actor) order by x.created_at desc),'[]'::jsonb) from (
        select x.* from neighborhood.posts x where x.area_id = area and x.removed_at is null
          and strpos(lower(x.title || ' ' || x.body),query_text) > 0
          and not exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = x.author_id)
        order by x.created_at desc limit 20) x),
      'businesses',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) from (
        select z.id,z.name,z.category,z.description,z.image_id,neighborhood.badge(z.id) verified from neighborhood.businesses z
        where z.area_id = area and strpos(lower(z.name || ' ' || z.category || ' ' || z.description),query_text) > 0
        order by z.name limit 12) x),
      'neighbors',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) from (
        select n.id,n.name,n.verified_at is not null verified from neighborhood.members n
        where n.area_id = area and strpos(lower(n.name),query_text) > 0 order by n.name limit 12) x));
  when 'profile' then
    return (select jsonb_build_object('id',n.id,'name',n.name,'bio',n.bio,'verified',n.verified_at is not null,'joined',n.created_at,
      'blocked',exists(select 1 from neighborhood.blocks k where k.owner_id = actor and k.blocked_id = n.id),
      'businesses',(select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'category',z.category,
        'verified',neighborhood.badge(z.id)) order by z.name),'[]'::jsonb) from neighborhood.businesses z where z.owner_id = n.id))
      from neighborhood.members n where n.id = coalesce(item,actor) and n.area_id = area);
  when 'update_profile' then
    perform neighborhood.limit_action(actor,op,10);
    update neighborhood.members set name = btrim(d->>'name'),bio = btrim(coalesce(d->>'bio','')) where id = actor;
  when 'request_residency' then
    perform neighborhood.limit_action(actor,op,3);
    if m.verified_at is not null then raise exception 'Your address is already verified.'; end if;
    if d->>'consent' is distinct from 'true' then raise exception 'Confirm how your address will be used.'; end if;
    delete from neighborhood.residency_checks where member_id = actor and created_at < now() - interval '45 days';
    if exists(select 1 from neighborhood.residency_checks where member_id = actor) then
      raise exception 'A verification is already in progress.';
    end if;
    insert into neighborhood.residency_checks(member_id,address,code)
      values(actor,btrim(d->>'address'),upper(substr(md5(gen_random_uuid()::text || actor::text),1,6)));
  when 'cancel_residency' then
    delete from neighborhood.residency_checks where member_id = actor;
  when 'confirm_residency' then
    select * into rc from neighborhood.residency_checks where member_id = actor and status = 'mailed' for update;
    if not found then raise exception 'No postcard code is waiting for this account.'; end if;
    if rc.attempts >= 5 then
      delete from neighborhood.residency_checks where member_id = actor;
      return jsonb_build_object('ok',false,'message','Too many incorrect codes. Start a new verification.');
    end if;
    if rc.code_hash is distinct from neighborhood.residency_hash(actor,coalesce(d->>'code','')) then
      update neighborhood.residency_checks set attempts = attempts + 1 where member_id = actor;
      return jsonb_build_object('ok',false,'message','That code does not match. Check the postcard and try again.');
    end if;
    update neighborhood.members set verified_at = now() where id = actor;
    delete from neighborhood.residency_checks where member_id = actor;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,'residency_verified',actor,'{}'::jsonb);
  when 'decide_residency' then
    if role_name is null then raise exception 'Moderator access required.' using errcode = '42501'; end if;
    select * into rc from neighborhood.residency_checks where member_id = item and status = 'pending' and member_id <> actor for update;
    if not found or action_text is null or action_text not in ('mailed','declined') then
      raise exception 'Verification decision unavailable.' using errcode = '42501';
    end if;
    if action_text = 'mailed' then
      update neighborhood.residency_checks set status = 'mailed',code_hash = neighborhood.residency_hash(item,rc.code),
        address = null,code = null,mailed_at = now() where member_id = item;
    else
      delete from neighborhood.residency_checks where member_id = item;
    end if;
    perform neighborhood.notify(item,null,'residency',null,null,null);
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('outcome',action_text));
  when 'directory' then
    return (select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]'::jsonb) from (
      select z.id,z.name,z.category,z.description,z.image_id,neighborhood.badge(z.id) verified,
        (select round(avg(v.rating),1) from neighborhood.reviews v where v.business_id = z.id and v.status = 'published') rating,
        (select count(*) from neighborhood.reviews v where v.business_id = z.id and v.status = 'published') reviews
      from neighborhood.businesses z where z.area_id = area
        and (nullif(d->>'category','') is null or z.category = d->>'category')
        and (nullif(d->>'q','') is null or strpos(lower(z.name || ' ' || z.category || ' ' || z.description),lower(left(d->>'q',80))) > 0)
        and (nullif(d->>'vetted','') is null or neighborhood.badge(z.id))
        and (nullif(d->>'afterName','') is null or (z.name,z.id) > (d->>'afterName',cursor_id))
      order by z.name,z.id limit 25
    ) x);
  when 'my_businesses' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'category',z.category,'description',z.description,
      'website',z.website,'phone',z.phone,'hours',z.hours,'image_id',z.image_id,'verified',neighborhood.badge(z.id),'vetting',v.status,
      'vettingReason',v.decision_reason,'vettingExpires',v.expires_at,'paid',l.paid_at is not null) order by z.name),'[]'::jsonb)
      from neighborhood.businesses z left join neighborhood.vetting v on v.business_id = z.id
      left join neighborhood.billing l on l.business_id = z.id where z.owner_id = actor);
  when 'business' then
    select * into b from neighborhood.businesses where id = item and area_id = area;
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
    return to_jsonb(b) || jsonb_build_object('verified',neighborhood.badge(item),
      'owner',(select n.name from neighborhood.members n where n.id = b.owner_id),
      'rating',(select round(avg(v.rating),1) from neighborhood.reviews v where v.business_id = item and v.status = 'published'),
      'review_count',(select count(*) from neighborhood.reviews v where v.business_id = item and v.status = 'published'),
      'updates',(select coalesce(jsonb_agg(neighborhood.post_json(x,actor) order by x.created_at desc),'[]'::jsonb) from (
        select x.* from neighborhood.posts x where x.business_id = item and x.removed_at is null order by x.created_at desc limit 5) x),
      'reviews',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) from (
        select v.id,v.rating,v.body,v.created_at,v.affiliated,v.author_id <> actor as reportable,n.name author,
          n.verified_at is not null author_verified
        from neighborhood.reviews v join neighborhood.members n on n.id = v.author_id
        where v.business_id = item and v.status = 'published' and (v.created_at,v.id) < (cursor_time,cursor_id)
        order by v.created_at desc,v.id desc limit 25
      ) x),'ownReview',exists(select 1 from neighborhood.reviews v where v.business_id = item and v.author_id = actor));
  when 'create_business' then
    perform neighborhood.limit_action(actor,op,3);
    if (select count(*) from neighborhood.businesses where owner_id = actor) >= 5 then raise exception 'Business profile limit reached.'; end if;
    insert into neighborhood.businesses(owner_id,area_id,name,category,description,website,phone,hours,image_id)
      values(actor,area,btrim(d->>'name'),d->>'category',btrim(d->>'description'),nullif(btrim(d->>'website'),''),
        nullif(btrim(d->>'phone'),''),nullif(btrim(d->>'hours'),''),image)
      returning id into item;
  when 'update_business' then
    perform neighborhood.limit_action(actor,op,10);
    select * into b from neighborhood.businesses where id = item and owner_id = actor for update;
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
    if b.category is distinct from d->>'category' or b.website is distinct from nullif(btrim(d->>'website'),'')
        or b.phone is distinct from nullif(btrim(d->>'phone'),'') then
      update neighborhood.vetting set status = 'revoked',decision_reason = 'Business contact or category changed. Apply for a fresh check.',
        updated_at = now(),expires_at = null where business_id = item and status in ('approved','pending');
      if found then insert into neighborhood.audit(actor,action,subject,details)
        values(actor,'vetting_invalidated',item,jsonb_build_object('reason','Profile contact or category changed')); end if;
    end if;
    update neighborhood.businesses set category = d->>'category',description = btrim(d->>'description'),
      website = nullif(btrim(d->>'website'),''),phone = nullif(btrim(d->>'phone'),''),hours = nullif(btrim(d->>'hours'),''),
      image_id = coalesce(image,image_id) where id = item;
  when 'checkout' then
    select * into b from neighborhood.businesses where id = item and owner_id = actor for update;
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
    if not exists(select 1 from neighborhood.vetting v where v.business_id = item and v.status = 'approved' and v.expires_at > now()) then
      raise exception 'Human vetting must be approved before payment.' using errcode = '42501';
    end if;
    select * into bill from neighborhood.billing where business_id = item for update;
    if bill.paid_at is not null then raise exception 'The vetting fee is already paid for this business.'; end if;
    if bill.checkout_key is null then
      insert into neighborhood.billing(business_id,checkout_key) values(item,gen_random_uuid())
        on conflict(business_id) do update set checkout_key = excluded.checkout_key returning * into bill;
    end if;
    return jsonb_build_object('id',item,'key',bill.checkout_key,'customer',bill.customer_id);
  end case;
  return jsonb_build_object('id',item,'ok',true);
end
$$;

-- One-time vetting fee. Called only by the server with the backend secret after it has re-read the
-- Checkout Session or PaymentIntent from the payment provider.
create function neighborhood.sync_payment(d jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  business_key uuid := (d->>'business')::uuid;
  observation timestamptz := (d->>'observedAt')::timestamptz;
  existing neighborhood.billing%rowtype;
begin
  select * into existing from neighborhood.billing where business_id = business_key for update;
  if not found then return false; end if;
  if d->>'refunded' = 'true' then
    if existing.payment_ref is null or existing.payment_ref is distinct from d->>'payment' then return false; end if;
    update neighborhood.billing set paid_at = null,active = false,checkout_key = null,observed_at = observation where business_id = business_key;
    insert into neighborhood.audit(actor,action,subject,details) values(null,'vetting_fee_refunded',business_key,jsonb_build_object('payment',d->>'payment'));
    return true;
  end if;
  if existing.checkout_key is null or existing.checkout_key::text is distinct from d->>'checkoutKey' then return false; end if;
  if d->>'expired' = 'true' then
    if existing.paid_at is not null then return false; end if;
    update neighborhood.billing set checkout_key = null,observed_at = observation where business_id = business_key;
    return true;
  end if;
  if d->>'paid' is distinct from 'true' or nullif(d->>'payment','') is null then return false; end if;
  if existing.paid_at is not null then return true; end if;
  update neighborhood.billing set paid_at = observation,active = true,payment_ref = d->>'payment',customer_id = d->>'customer',
    observed_at = observation where business_id = business_key;
  insert into neighborhood.audit(actor,action,subject,details) values(null,'vetting_fee_paid',business_key,jsonb_build_object('payment',d->>'payment'));
  perform neighborhood.notify(z.owner_id,null,'payment',null,null,z.id) from neighborhood.businesses z where z.id = business_key;
  return true;
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on all functions in schema neighborhood from public, anon, authenticated, service_role;

create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select neighborhood.dispatch2(op,d) $$;
create or replace function public.neighborhood_billing(d jsonb) returns boolean
language sql security invoker set search_path = '' as $$ select neighborhood.sync_payment(d) $$;
grant execute on function neighborhood.dispatch2(text,jsonb) to authenticated;
grant execute on function neighborhood.sync_payment(jsonb),neighborhood.purge_residency() to service_role;
commit;
