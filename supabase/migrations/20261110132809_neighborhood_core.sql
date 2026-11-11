begin;
create schema neighborhood;
revoke all on schema neighborhood from public, anon, authenticated, service_role;

create table neighborhood.areas (
  id text primary key, name text not null, region text not null, sort integer not null
);
insert into neighborhood.areas values
 ('old-brooklyn','Old Brooklyn','Cleveland',1),
 ('parma','Parma','Cuyahoga County',2),
 ('brook-park','Brook Park','Cuyahoga County',3),
 ('lakewood','Lakewood','Cuyahoga County',4);

create table neighborhood.members (
  id uuid primary key references auth.users(id) on delete cascade,
  area_id text not null references neighborhood.areas,
  name text not null check (char_length(name) between 2 and 50),
  created_at timestamptz not null default now()
);
create table neighborhood.launch_settings (
  singleton boolean primary key check(singleton),
  public_enrollment boolean not null default false
);
insert into neighborhood.launch_settings(singleton) values (true);
create table neighborhood.pilot_access (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table neighborhood.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('moderator','admin'))
);
create table neighborhood.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references neighborhood.members on delete cascade,
  area_id text not null references neighborhood.areas,
  name text not null check (char_length(name) between 2 and 80),
  category text not null check (category in ('Home services','Food & drink','Retail','Health & wellness','Professional services','Other')),
  description text not null check (char_length(description) between 10 and 1000),
  website text check (website is null or (char_length(website) <= 250 and website ~ '^https://[A-Za-z0-9][^[:space:]]+$')),
  created_at timestamptz not null default now()
);
create unique index businesses_area_name on neighborhood.businesses(area_id,lower(name));
create index businesses_owner on neighborhood.businesses(owner_id);
create table neighborhood.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references neighborhood.members on delete cascade,
  area_id text not null references neighborhood.areas,
  kind text not null check (kind in ('discussion','request','event')),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 3 and 2400),
  created_at timestamptz not null default now(),
  closed boolean not null default false,
  removed_at timestamptz
);
create index posts_area_date on neighborhood.posts(area_id, created_at desc, id desc);
create index posts_author on neighborhood.posts(author_id);
create table neighborhood.replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references neighborhood.posts on delete cascade,
  author_id uuid not null references neighborhood.members on delete cascade,
  business_id uuid references neighborhood.businesses on delete set null,
  affiliated boolean not null default false,
  body text not null check (char_length(body) between 2 and 1600),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  check (business_id is null or affiliated)
);
create index replies_post_date on neighborhood.replies(post_id,created_at,id);
create index replies_author on neighborhood.replies(author_id);
create index replies_business on neighborhood.replies(business_id);
create table neighborhood.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references neighborhood.members on delete cascade,
  post_id uuid references neighborhood.posts on delete cascade,
  reply_id uuid references neighborhood.replies on delete cascade,
  reason text not null check(char_length(reason) between 12 and 700),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (num_nonnulls(post_id,reply_id)=1),
  unique nulls not distinct(reporter_id,post_id,reply_id)
);
create index content_reports_post on neighborhood.content_reports(post_id);
create index content_reports_reply on neighborhood.content_reports(reply_id);
create index content_reports_queue on neighborhood.content_reports(created_at) where resolved_at is null;

create table neighborhood.blocks (
  owner_id uuid not null references neighborhood.members on delete cascade,
  blocked_id uuid not null references neighborhood.members on delete cascade,
  primary key (owner_id,blocked_id), check(owner_id <> blocked_id)
);
create index blocks_target on neighborhood.blocks(blocked_id);
create table neighborhood.threads (
  id uuid primary key default gen_random_uuid(),
  member_a uuid not null references neighborhood.members on delete cascade,
  member_b uuid not null references neighborhood.members on delete cascade,
  updated_at timestamptz not null default now(),
  unique (member_a,member_b), check(member_a < member_b)
);
create index threads_member_b on neighborhood.threads(member_b);
create table neighborhood.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references neighborhood.threads on delete cascade,
  sender_id uuid not null references neighborhood.members on delete cascade,
  body text not null check (char_length(body) between 1 and 1800),
  created_at timestamptz not null default now()
);
create index messages_thread_date on neighborhood.messages(thread_id,created_at desc,id desc);
create index messages_sender on neighborhood.messages(sender_id);

create table neighborhood.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references neighborhood.businesses on delete cascade,
  author_id uuid not null references neighborhood.members on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 20 and 1600),
  affiliated boolean not null,
  fingerprint text not null,
  status text not null default 'pending' check(status in ('pending','published','removed')),
  score numeric(4,3) not null check (score between 0 and 1),
  signals jsonb not null,
  model_version text not null default 'local-logistic-v1',
  decision_reason text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, author_id)
);
create index reviews_author on neighborhood.reviews(author_id);
create index reviews_fingerprint on neighborhood.reviews(fingerprint,created_at desc);
create index reviews_queue on neighborhood.reviews(score desc,created_at) where status = 'pending';
create table neighborhood.review_reports (
  review_id uuid not null references neighborhood.reviews on delete cascade,
  reporter_id uuid not null references neighborhood.members on delete cascade,
  reason text not null check (char_length(reason) between 12 and 700),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (review_id, reporter_id)
);
create index reports_reporter on neighborhood.review_reports(reporter_id);
create table neighborhood.appeals (
  review_id uuid primary key references neighborhood.reviews on delete cascade,
  explanation text not null check (char_length(explanation) between 20 and 1200),
  outcome text not null default 'pending' check (outcome in ('pending','restored','upheld')),
  reason text,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table neighborhood.vetting (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references neighborhood.businesses on delete cascade,
  legal_name text not null check (char_length(legal_name) between 2 and 150),
  registration_ref text not null check (char_length(registration_ref) between 3 and 180),
  contact_ref text not null check (char_length(contact_ref) between 3 and 180),
  status text not null default 'pending' check (status in ('pending','approved','declined','revoked')),
  decision_reason text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create table neighborhood.billing (
  business_id uuid primary key references neighborhood.businesses on delete cascade,
  subscription_id text unique,
  customer_id text,
  active boolean not null default false,
  paid_until timestamptz,
  observed_at timestamptz,
  checkout_key uuid
);
create table neighborhood.audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id) on delete set null,
  action text not null, subject uuid not null, details jsonb not null,
  created_at timestamptz not null default now()
);
create table neighborhood.quotas (
  actor uuid not null references neighborhood.members on delete cascade,
  operation text not null, bucket timestamptz not null,
  count integer not null,
  primary key(actor,operation)
);

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'neighborhood' loop
    execute format('alter table neighborhood.%I enable row level security',t);
  end loop;
end $$;

create function neighborhood.badge(p_business uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from neighborhood.vetting v join neighborhood.billing b using (business_id)
    where v.business_id = p_business and v.status = 'approved' and v.expires_at > now()
      and b.active and b.paid_until > now()
  )
$$;

create function neighborhood.limit_action(p_actor uuid,p_operation text,p_max integer) returns void
language plpgsql set search_path = '' as $$
declare hits integer;
begin
  insert into neighborhood.quotas(actor,operation,bucket,count) values (p_actor,p_operation,date_trunc('hour',now()),1)
  on conflict(actor,operation) do update set bucket = excluded.bucket,
    count = case when neighborhood.quotas.bucket = excluded.bucket then neighborhood.quotas.count + 1 else 1 end
  returning count into hits;
  if hits > p_max then raise exception 'Action limit reached. Try again later.' using errcode = 'P0001'; end if;
end
$$;

-- Fixed logistic model over explainable text features. Signals rank cases for a human.
create function neighborhood.screen(p_text text,p_affiliated boolean,p_duplicate boolean)
returns jsonb language sql immutable set search_path = '' as $$
  with features as (
    select p_affiliated as affiliation, p_duplicate as duplicate,
      p_text ~* '(paid (me|us)|discount.{0,30}review|in exchange|gift card|refund.{0,25}review)' as incentive,
      p_text ~* '(https?://|www\.|use (my|our) code|dm me|click here)' as promotion,
      p_text ~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[0-9]{3}[- .][0-9]{3}[- .][0-9]{4}|[0-9]{10})' as personal,
      p_text ~* '(kill (you|them|him|her)|hurt (you|them)|go die|home address)' as abuse,
      p_text ~ '(.)\1{6,}' as repetition
  )
  select jsonb_build_object('score',round((1/(1+exp(-(
    -3.2 + 4.0*affiliation::int + 4.0*duplicate::int + 3.2*incentive::int + 2.6*promotion::int
      + 4.8*personal::int + 5.2*abuse::int + 1.7*repetition::int
  ))))::numeric,3),'signals',to_jsonb(features)) from features
$$;

create function neighborhood.dispatch(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  m neighborhood.members%rowtype;
  role_name text;
  may_join boolean;
  report neighborhood.content_reports%rowtype;
  item uuid;
  target uuid;
  area text;
  body_text text;
  reason_text text;
  action_text text;
  fingerprint_text text;
  classification jsonb;
  previous_reviewer uuid;
  business neighborhood.businesses%rowtype;
  bill neighborhood.billing%rowtype;
  convo neighborhood.threads%rowtype;
  chosen_post neighborhood.posts%rowtype;
  review neighborhood.reviews%rowtype;
  cursor_time timestamptz;
  cursor_id uuid;
begin
  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  if d is null or jsonb_typeof(d) <> 'object' or pg_column_size(d) > 20000 then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  select * into m from neighborhood.members where id = actor;
  select role into role_name from neighborhood.staff where user_id = actor;
  select public_enrollment or exists(select 1 from neighborhood.pilot_access where user_id=actor)
    into may_join from neighborhood.launch_settings where singleton;
  if op = 'bootstrap' then
    return jsonb_build_object('member',case when m.id is not null then to_jsonb(m) end,'staff',role_name,'canJoin',coalesce(may_join,false),
      'areas',(select jsonb_agg(to_jsonb(a) - 'sort' order by a.sort) from neighborhood.areas a));
  elsif op = 'join' then
    if m.id is not null then raise exception 'Your neighborhood is already set.'; end if;
    if may_join is distinct from true or d->>'attest' is distinct from 'true' then
      raise exception 'Pilot access and neighborhood attestation are required.' using errcode = '42501';
    end if;
    insert into neighborhood.members(id,area_id,name) values (actor,d->>'area',btrim(d->>'name'));
    return jsonb_build_object('ok',true);
  end if;
  if m.id is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
  area := m.area_id;
  item := nullif(d->>'id','')::uuid;
  body_text := btrim(d->>'body');
  reason_text := btrim(d->>'reason');
  action_text := d->>'action';
  cursor_time := coalesce(nullif(d->>'before','')::timestamptz,'infinity'::timestamptz);
  cursor_id := coalesce(nullif(d->>'cursor','')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
  if op in ('moderation','decide_review','decide_appeal','decide_vetting','decide_content') and role_name is null then
    raise exception 'Moderator access required.' using errcode = '42501';
  end if;

  case op
  when 'feed' then
    return (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc),'[]'::jsonb) from (
      select p.id,p.author_id,p.kind,p.title,p.body,p.created_at,p.closed,n.name author,
        (select count(*) from neighborhood.replies r where r.post_id = p.id and r.removed_at is null) as replies
      from neighborhood.posts p join neighborhood.members n on n.id = p.author_id
      where p.area_id = area and p.removed_at is null and (p.created_at,p.id) < (cursor_time,cursor_id)
        and (nullif(d->>'kind','') is null or p.kind = d->>'kind')
      order by p.created_at desc,p.id desc limit 25
    ) p);
  when 'post' then
    select * into chosen_post from neighborhood.posts where id = item and area_id = area and removed_at is null;
    if not found then raise exception 'Post unavailable.' using errcode = '42501'; end if;
    return (select to_jsonb(chosen_post) || jsonb_build_object('author',n.name,'replies',(
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) from (
        select r.id,r.author_id,r.body,r.created_at,r.affiliated,mr.name author,b.id business_id,b.name business
        from neighborhood.replies r join neighborhood.members mr on mr.id = r.author_id
        left join neighborhood.businesses b on b.id = r.business_id where r.post_id = item and r.removed_at is null
        order by r.created_at,r.id limit 150
      ) r)) from neighborhood.members n where n.id = chosen_post.author_id);
  when 'create_post' then
    perform neighborhood.limit_action(actor,op,10);
    insert into neighborhood.posts(author_id,area_id,kind,title,body)
      values(actor,area,d->>'kind',btrim(d->>'title'),body_text) returning id into item;
  when 'close_post' then
    update neighborhood.posts set closed = true where id = item and author_id = actor and kind = 'request' and removed_at is null;
    if not found then raise exception 'Request unavailable.' using errcode = '42501'; end if;
  when 'reply' then
    perform neighborhood.limit_action(actor,op,30);
    select * into chosen_post from neighborhood.posts where id = item and area_id = area and removed_at is null for update;
    if not found or chosen_post.closed then raise exception 'This conversation is unavailable.' using errcode = '42501'; end if;
    target := nullif(d->>'business','')::uuid;
    if target is not null and not exists(select 1 from neighborhood.businesses b where b.id = target and b.owner_id = actor and b.area_id = area) then
      raise exception 'You can only reply as your own business.' using errcode = '42501';
    end if;
    insert into neighborhood.replies(post_id,author_id,business_id,affiliated,body)
      values(item,actor,target,target is not null or coalesce((d->>'affiliated')::boolean,false),body_text);
  when 'report_content' then
    perform neighborhood.limit_action(actor,op,10);
    if d->>'kind' = 'post' then
      select p.id into target from neighborhood.posts p where p.id=item and p.area_id=area
        and p.removed_at is null and p.author_id<>actor for update;
      if target is not null then insert into neighborhood.content_reports(reporter_id,post_id,reason)
        values(actor,target,reason_text) on conflict do nothing; end if;
    elsif d->>'kind' = 'reply' then
      select r.id into target from neighborhood.replies r join neighborhood.posts p on p.id=r.post_id
        where r.id=item and p.area_id=area and r.removed_at is null and p.removed_at is null and r.author_id<>actor for update of r;
      if target is not null then insert into neighborhood.content_reports(reporter_id,reply_id,reason)
        values(actor,target,reason_text) on conflict do nothing; end if;
    end if;
    if target is null then raise exception 'Content unavailable.' using errcode = '42501'; end if;
  when 'directory' then
    return (select coalesce(jsonb_agg(to_jsonb(b) order by b.name,b.id),'[]'::jsonb) from (
      select b.id,b.name,b.category,b.description,neighborhood.badge(b.id) verified
      from neighborhood.businesses b where b.area_id = area
        and (nullif(d->>'category','') is null or b.category = d->>'category')
        and (nullif(d->>'q','') is null or strpos(lower(b.name||' '||b.category),lower(left(d->>'q',80))) > 0)
        and (nullif(d->>'afterName','') is null or (b.name,b.id) > (d->>'afterName',cursor_id))
      order by b.name,b.id limit 25
    ) b);
  when 'my_businesses' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'description',b.description,
      'website',b.website,'verified',neighborhood.badge(b.id),'vetting',v.status,'vettingReason',v.decision_reason,
      'vettingExpires',v.expires_at,'billing',coalesce(bl.active,false),'hasCustomer',bl.customer_id is not null,'hasSubscription',bl.subscription_id is not null) order by b.name),'[]'::jsonb)
      from neighborhood.businesses b left join neighborhood.vetting v on v.business_id = b.id
      left join neighborhood.billing bl on bl.business_id = b.id where b.owner_id = actor);
  when 'business' then
    select * into business from neighborhood.businesses where id = item and area_id = area;
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
    return to_jsonb(business) || jsonb_build_object('verified',neighborhood.badge(item),'reviews',(
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb) from (
        select r.id,r.rating,r.body,r.created_at,r.affiliated,r.author_id <> actor as reportable,n.name author
        from neighborhood.reviews r join neighborhood.members n on n.id = r.author_id
        where r.business_id = item and r.status = 'published' and (r.created_at,r.id) < (cursor_time,cursor_id)
        order by r.created_at desc,r.id desc limit 25
      ) r),'ownReview',exists(select 1 from neighborhood.reviews r where r.business_id = item and r.author_id = actor));
  when 'create_business' then
    perform neighborhood.limit_action(actor,op,3);
    if (select count(*) from neighborhood.businesses where owner_id = actor) >= 5 then raise exception 'Business profile limit reached.'; end if;
    insert into neighborhood.businesses(owner_id,area_id,name,category,description,website)
      values(actor,area,btrim(d->>'name'),d->>'category',btrim(d->>'description'),nullif(btrim(d->>'website'),''))
      returning id into item;
  when 'update_business' then
    perform neighborhood.limit_action(actor,op,10);
    select * into business from neighborhood.businesses where id=item and owner_id=actor for update;
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
    if business.category is distinct from d->>'category' or business.website is distinct from nullif(btrim(d->>'website'),'') then
      update neighborhood.vetting set status='revoked',decision_reason='Business contact or category changed. Apply for a fresh check.',
        updated_at=now(),expires_at=null where business_id=item and status in ('approved','pending');
      if found then insert into neighborhood.audit(actor,action,subject,details)
        values(actor,'vetting_invalidated',item,jsonb_build_object('reason','Profile contact or category changed')); end if;
    end if;
    update neighborhood.businesses set category = d->>'category',description = btrim(d->>'description'),
      website = nullif(btrim(d->>'website'),'') where id = item and owner_id = actor;
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
  when 'threads' then
    return (select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc,t.id desc),'[]'::jsonb) from (
      select t.id,t.updated_at,n.id peer_id,n.name peer
      from neighborhood.threads t join neighborhood.members n on n.id = case when t.member_a = actor then t.member_b else t.member_a end
      where actor in (t.member_a,t.member_b) and (t.updated_at,t.id) < (cursor_time,cursor_id)
      order by t.updated_at desc,t.id desc limit 30
    ) t);
  when 'thread' then
    select * into convo from neighborhood.threads where id = item and actor in(member_a,member_b);
    if not found then raise exception 'Conversation unavailable.' using errcode = '42501'; end if;
    target := case when convo.member_a = actor then convo.member_b else convo.member_a end;
    return (select jsonb_build_object('id',item,'peer',n.name,'peer_id',target,
      'blocked',exists(select 1 from neighborhood.blocks where owner_id = actor and blocked_id = target),
      'messages',(select coalesce(jsonb_agg(to_jsonb(msg) order by msg.created_at,msg.id),'[]'::jsonb) from (
        select id,sender_id,body,created_at from neighborhood.messages where thread_id = item
          and (created_at,id) < (cursor_time,cursor_id) order by created_at desc,id desc limit 40
      ) msg)) from neighborhood.members n where n.id = target);
  when 'message', 'block', 'unblock' then
    if op = 'message' and item is not null then
      select * into convo from neighborhood.threads where id = item and actor in(member_a,member_b);
      if not found then raise exception 'Conversation unavailable.' using errcode = '42501'; end if;
      target := case when convo.member_a = actor then convo.member_b else convo.member_a end;
    else
      target := nullif(d->>'peer','')::uuid;
    end if;
    if target is null or target = actor or not exists(select 1 from neighborhood.members n where n.id = target and n.area_id = area) then
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
  when 'submit_review' then
    perform neighborhood.limit_action(actor,op,5);
    select * into business from neighborhood.businesses where id = item and area_id = area;
    if not found or business.owner_id = actor then raise exception 'You cannot review this business.' using errcode = '42501'; end if;
    if d->>'attest' is distinct from 'true' then raise exception 'Confirm this is firsthand experience.'; end if;
    fingerprint_text := md5(regexp_replace(lower(body_text),'[^[:alnum:]]','','g'));
    perform pg_advisory_xact_lock(hashtextextended(fingerprint_text,17));
    classification := neighborhood.screen(body_text,coalesce((d->>'affiliated')::boolean,false),
      exists(select 1 from neighborhood.reviews r where r.fingerprint = fingerprint_text and r.created_at > now() - interval '90 days'));
    insert into neighborhood.reviews(business_id,author_id,rating,body,affiliated,fingerprint,score,signals)
      values(item,actor,(d->>'rating')::integer,body_text,coalesce((d->>'affiliated')::boolean,false),fingerprint_text,
        (classification->>'score')::numeric,classification->'signals') returning id into item;
  when 'report_review' then
    perform neighborhood.limit_action(actor,op,10);
    select r.* into review from neighborhood.reviews r join neighborhood.businesses b on b.id = r.business_id
      where r.id = item and r.status = 'published' and b.area_id = area and r.author_id <> actor for update of r;
    if not found then
      raise exception 'Review unavailable.' using errcode = '42501';
    end if;
    insert into neighborhood.review_reports(review_id,reporter_id,reason) values(item,actor,reason_text)
      on conflict(review_id,reporter_id) do nothing;
  when 'my_reviews' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'business_id',b.id,'business',b.name,'rating',r.rating,
      'body',r.body,'status',r.status,'reason',r.decision_reason,'appeal',a.outcome,'appealReason',a.reason)
      order by r.created_at desc),'[]'::jsonb) from neighborhood.reviews r
      join neighborhood.businesses b on b.id = r.business_id left join neighborhood.appeals a on a.review_id = r.id
      where r.author_id = actor);
  when 'appeal' then
    perform neighborhood.limit_action(actor,op,5);
    select * into review from neighborhood.reviews where id = item and author_id = actor and status = 'removed' for update;
    if not found then raise exception 'Review unavailable for appeal.' using errcode = '42501'; end if;
    insert into neighborhood.appeals(review_id,explanation) values(item,body_text);
  when 'apply_vetting' then
    perform neighborhood.limit_action(actor,op,5);
    select * into business from neighborhood.businesses where id = item and owner_id = actor for update;
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
    insert into neighborhood.vetting(business_id,legal_name,registration_ref,contact_ref)
      values(item,btrim(d->>'legal'),btrim(d->>'registration'),btrim(d->>'contact'))
      on conflict(business_id) do update set legal_name=excluded.legal_name,registration_ref=excluded.registration_ref,
        contact_ref=excluded.contact_ref,status='pending',reviewed_at=null,reviewed_by=null,decision_reason=null,
        expires_at=null,updated_at=now()
      where neighborhood.vetting.status in ('declined','revoked') or neighborhood.vetting.expires_at <= now();
    if not found then raise exception 'This business already has an active application or approval.'; end if;
  when 'checkout', 'billing_portal' then
    select * into business from neighborhood.businesses where id = item and owner_id = actor for update;
    if not found then raise exception 'Business unavailable.' using errcode = '42501'; end if;
    select * into bill from neighborhood.billing where business_id = item for update;
    if op = 'billing_portal' then
      if bill.customer_id is null then raise exception 'No billing account found.'; end if;
      return jsonb_build_object('customer',bill.customer_id);
    end if;
    if not exists(select 1 from neighborhood.vetting v where v.business_id = item and v.status = 'approved' and v.expires_at > now()) then
      raise exception 'Human vetting must be approved before payment.' using errcode = '42501';
    end if;
    if bill.subscription_id is not null then raise exception 'Manage your existing subscription in the billing portal.'; end if;
    if bill.checkout_key is null then
      insert into neighborhood.billing(business_id,checkout_key) values(item,gen_random_uuid())
        on conflict(business_id) do update set checkout_key=excluded.checkout_key
        returning * into bill;
    end if;
    return jsonb_build_object('id',item,'key',bill.checkout_key,'customer',bill.customer_id);
  when 'moderation' then
    return jsonb_build_object(
      'content',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]'::jsonb) from (
        select c.id,c.reason,c.created_at,case when c.reply_id is not null then 'Reply to ' || p.title else p.title end title,coalesce(r.body,p.body) body
        from neighborhood.content_reports c left join neighborhood.replies r on r.id=c.reply_id
        join neighborhood.posts p on p.id=coalesce(c.post_id,r.post_id)
        where c.resolved_at is null and p.removed_at is null and r.removed_at is null
          and c.reporter_id<>actor and coalesce(r.author_id,p.author_id)<>actor
        order by c.created_at limit 40
      ) c),
      'reviews',(select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc,r.created_at),'[]'::jsonb) from (
        select r.id,r.author_id,r.rating,r.body,r.affiliated,r.status,r.score,r.signals,r.model_version,r.created_at,b.name business,
          (select coalesce(jsonb_agg(rr.reason order by rr.created_at),'[]'::jsonb) from neighborhood.review_reports rr
            where rr.review_id=r.id and rr.resolved_at is null) reports
        from neighborhood.reviews r join neighborhood.businesses b on b.id = r.business_id
        where (r.status = 'pending' or (r.status = 'published' and exists(
          select 1 from neighborhood.review_reports rr where rr.review_id=r.id and rr.resolved_at is null)))
          and actor <> r.author_id and actor <> b.owner_id
        order by r.score desc,r.created_at limit 40
      ) r),
      'appeals',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]'::jsonb) from (
        select a.review_id id,a.explanation,a.created_at,r.body,r.rating,r.decision_reason,b.name business
        from neighborhood.appeals a join neighborhood.reviews r on r.id = a.review_id
        join neighborhood.businesses b on b.id = r.business_id
        where a.outcome = 'pending' and actor is distinct from r.decided_by and actor <> r.author_id and actor <> b.owner_id
        order by a.created_at limit 40
      ) a),
      'vetting',(select coalesce(jsonb_agg(to_jsonb(v) order by v.updated_at),'[]'::jsonb) from (
        select v.business_id id,v.legal_name,v.registration_ref,v.contact_ref,v.updated_at,v.status,b.name business
        from neighborhood.vetting v join neighborhood.businesses b on b.id = v.business_id
        where (v.status = 'pending' or (v.status = 'approved' and v.expires_at > now())) and actor <> b.owner_id
        order by (v.status = 'pending') desc,v.updated_at limit 40
      ) v));
  when 'decide_content' then
    select c.* into report from neighborhood.content_reports c left join neighborhood.replies r on r.id=c.reply_id
      join neighborhood.posts p on p.id=coalesce(c.post_id,r.post_id)
      where c.id=item and c.resolved_at is null and p.removed_at is null and r.removed_at is null
        and c.reporter_id<>actor and coalesce(r.author_id,p.author_id)<>actor for update of c;
    if not found or action_text is null or action_text not in ('keep','remove')
      or coalesce(char_length(reason_text),0) not between 12 and 700 then
      raise exception 'Content decision unavailable or incomplete.' using errcode = '42501';
    end if;
    if action_text='remove' and report.reply_id is not null then
      update neighborhood.replies set removed_at=now() where id=report.reply_id and removed_at is null;
    elsif action_text='remove' then
      update neighborhood.posts set removed_at=now() where id=report.post_id and removed_at is null;
    end if;
    update neighborhood.content_reports set resolved_at=now() where id=item;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('outcome',action_text,'reason',reason_text));
  when 'decide_review' then
    select r.* into review from neighborhood.reviews r join neighborhood.businesses b on b.id = r.business_id
      where r.id = item and actor <> r.author_id and actor <> b.owner_id for update of r;
    if not found or action_text is null or action_text not in ('published','removed')
      or coalesce(char_length(reason_text),0) not between 12 and 700
      or (review.status <> 'pending' and not (review.status = 'published' and exists(
        select 1 from neighborhood.review_reports where review_id = item and resolved_at is null))) then
      raise exception 'Review decision is unavailable or incomplete.' using errcode = '42501';
    end if;
    update neighborhood.reviews set status=action_text,decision_reason=reason_text,decided_by=actor,decided_at=now() where id=item;
    update neighborhood.review_reports set resolved_at=now() where review_id=item and resolved_at is null;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('outcome',action_text,'reason',reason_text));
  when 'decide_appeal' then
    select r.decided_by into previous_reviewer from neighborhood.reviews r join neighborhood.businesses b on b.id=r.business_id
      where r.id=item and r.status='removed' and actor <> r.author_id and actor <> b.owner_id for update of r;
    if not found or actor = previous_reviewer or action_text is null or action_text not in ('restored','upheld')
      or coalesce(char_length(reason_text),0) not between 12 and 700 then
      raise exception 'An independent moderator and a decision reason are required.' using errcode = '42501';
    end if;
    update neighborhood.appeals set outcome=action_text,reason=reason_text,resolved_by=actor where review_id=item and outcome='pending';
    if not found then raise exception 'Appeal unavailable.' using errcode = '42501'; end if;
    if action_text = 'restored' then
      update neighborhood.reviews set status='published',decision_reason=reason_text,decided_by=actor,decided_at=now() where id=item;
    end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('outcome',action_text,'reason',reason_text));
  when 'decide_vetting' then
    select * into business from neighborhood.businesses where id=item and owner_id <> actor for update;
    if not found or action_text is null or action_text not in ('approved','declined','revoked')
      or coalesce(char_length(reason_text),0) not between 12 and 700 then
      raise exception 'Vetting decision is unavailable or incomplete.' using errcode = '42501';
    end if;
    if action_text='approved' and (coalesce(char_length(btrim(d->>'identityEvidence')),0) not between 12 and 500
      or coalesce(char_length(btrim(d->>'controlEvidence')),0) not between 12 and 500
      or coalesce(char_length(btrim(d->>'licenseEvidence')),0) not between 12 and 500
      or d->>'attestation' is distinct from 'true') then
      raise exception 'Record independent identity, control and applicable license or insurance checks first.';
    end if;
    update neighborhood.vetting set status=action_text,decision_reason=reason_text,reviewed_by=actor,reviewed_at=now(),
      updated_at=now(),expires_at=case when action_text='approved' then now()+interval '1 year' end
      where business_id=item and ((status='pending' and action_text in ('approved','declined')) or (status='approved' and action_text='revoked'));
    if not found then raise exception 'This application cannot receive that decision.'; end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,
      jsonb_build_object('outcome',action_text,'reason',reason_text,'identity',d->>'identityEvidence',
        'control',d->>'controlEvidence','license',d->>'licenseEvidence'));
  else
    raise exception 'Unknown operation.' using errcode = '22023';
  end case;
  return jsonb_build_object('id',item,'ok',true);
end
$$;

create function neighborhood.sync_billing(d jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  business_key uuid := (d->>'business')::uuid;
  observation timestamptz := (d->>'observedAt')::timestamptz;
  existing neighborhood.billing%rowtype;
begin
  select * into existing from neighborhood.billing where business_id = business_key for update;
  if not found or existing.checkout_key is null or existing.checkout_key::text is distinct from d->>'checkoutKey' then
    return false;
  end if;
  if d->>'expired' = 'true' then
    if existing.subscription_id is not null then return false; end if;
    update neighborhood.billing set checkout_key=null,observed_at=observation where business_id=business_key;
    return true;
  end if;
  if existing.subscription_id is not null and existing.subscription_id is distinct from d->>'subscription' then
    return false;
  end if;
  if existing.observed_at is not null and existing.observed_at >= observation then return true; end if;
  update neighborhood.billing set subscription_id=case when d->>'terminal'='true' then null else d->>'subscription' end,
    checkout_key=case when d->>'terminal'='true' then null else existing.checkout_key end,
    customer_id=d->>'customer',active=coalesce((d->>'active')::boolean,false),paid_until=(d->>'paidUntil')::timestamptz,observed_at=observation
  where business_id=business_key;
  return true;
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on all functions in schema neighborhood from public, anon, authenticated, service_role;

-- PostgREST only exposes public. Role-specific wrappers expose no tables or internal helpers.
create function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select neighborhood.dispatch(op,d) $$;
create function public.neighborhood_billing(d jsonb) returns boolean
language sql security invoker set search_path = '' as $$ select neighborhood.sync_billing(d) $$;
revoke all on function public.neighborhood_app(text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.neighborhood_billing(jsonb) from public, anon, authenticated, service_role;
grant usage on schema neighborhood to authenticated,service_role;
grant execute on function neighborhood.dispatch(text,jsonb),public.neighborhood_app(text,jsonb) to authenticated;
grant execute on function neighborhood.sync_billing(jsonb),public.neighborhood_billing(jsonb) to service_role;
commit;
