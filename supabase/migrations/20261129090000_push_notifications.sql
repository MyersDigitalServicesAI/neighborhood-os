begin;

-- Phone and desktop notifications (Web Push). A member turns them on per device; the browser hands back a push
-- address on its push service (Google, Apple, Mozilla or Microsoft) plus two encryption keys, saved here. Replies,
-- messages, safety alerts and RSVPs then queue a short notice that the server encrypts and sends with the backend
-- key. Notices carry no message text, only who did what and a link, like the emails.
create table neighborhood.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references neighborhood.members on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index push_subscriptions_member on neighborhood.push_subscriptions(member_id);

create table neighborhood.push_outbox (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references neighborhood.members on delete cascade,
  kind text not null check (kind in ('reply','message','alert','rsvp')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz
);
create index push_outbox_pending on neighborhood.push_outbox(created_at) where sent_at is null;
create index push_outbox_member on neighborhood.push_outbox(member_id,kind,created_at desc);
alter table neighborhood.push_subscriptions enable row level security;
alter table neighborhood.push_outbox enable row level security;

-- One notice per person, kind and post or conversation every 10 minutes, and only for people with a device signed up.
create function neighborhood.on_notification_push() returns trigger language plpgsql set search_path = '' as $$
declare payload jsonb;
begin
  if new.kind not in ('reply','message','alert','rsvp') then return null; end if;
  if not exists(select 1 from neighborhood.push_subscriptions s where s.member_id = new.member_id) then return null; end if;
  if exists(select 1 from neighborhood.push_outbox o where o.member_id = new.member_id and o.kind = new.kind
      and o.payload->>'post' is not distinct from new.post_id::text and o.payload->>'thread' is not distinct from new.thread_id::text
      and o.created_at > now() - interval '10 minutes') then return null; end if;
  select jsonb_strip_nulls(jsonb_build_object('actor',a.name,'post',new.post_id,'thread',new.thread_id,'title',p.title,'area',ar.name))
    into payload from (select 1) one
    left join neighborhood.members a on a.id = new.actor_id
    left join neighborhood.posts p on p.id = new.post_id
    left join neighborhood.areas ar on ar.id = p.area_id;
  insert into neighborhood.push_outbox(member_id,kind,payload) values(new.member_id,new.kind,coalesce(payload,'{}'::jsonb));
  return null;
end $$;
create trigger notifications_push after insert on neighborhood.notifications for each row execute function neighborhood.on_notification_push();

create function neighborhood.dispatch12(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if op not in ('bootstrap','save_push','remove_push') then
    return neighborhood.dispatch11(op,d);
  end if;
  if op = 'bootstrap' then
    result := neighborhood.dispatch11(op,d);
    if jsonb_typeof(result) <> 'object' or actor is null then return result; end if;
    return result || jsonb_build_object('pushDevices',(select count(*) from neighborhood.push_subscriptions s where s.member_id = actor));
  end if;
  if actor is null or not exists(select 1 from neighborhood.members m where m.id = actor) then
    raise exception 'Choose your neighborhood first.' using errcode = 'P0001';
  end if;
  if op = 'save_push' then
    if coalesce(d->>'endpoint','') !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
      or char_length(d->>'endpoint') > 1000 then
      raise exception 'This browser’s push service isn’t supported.' using errcode = 'P0001';
    end if;
    if coalesce(d->>'p256dh','') !~ '^[A-Za-z0-9_-]{80,100}$' or coalesce(d->>'auth','') !~ '^[A-Za-z0-9_-]{16,32}$' then
      raise exception 'The browser sent an invalid key. Try again.' using errcode = 'P0001';
    end if;
    -- A device that changes hands (sign out, someone else signs in) moves to the new account.
    insert into neighborhood.push_subscriptions(member_id,endpoint,p256dh,auth) values(actor,d->>'endpoint',d->>'p256dh',d->>'auth')
      on conflict (endpoint) do update set member_id = excluded.member_id,p256dh = excluded.p256dh,auth = excluded.auth,created_at = now();
    -- Keep the 10 most recent devices.
    delete from neighborhood.push_subscriptions s where s.member_id = actor and s.id not in
      (select k.id from neighborhood.push_subscriptions k where k.member_id = actor order by k.created_at desc limit 10);
    return jsonb_build_object('ok',true);
  end if;
  delete from neighborhood.push_subscriptions s where s.member_id = actor and s.endpoint = d->>'endpoint';
  return jsonb_build_object('ok',true);
end
$$;

-- Server-only queue access, called with the backend key. 'claim' hands out up to 50 unsent notices with each
-- person's devices; 'done' records the result and forgets devices the push service says are gone.
create function neighborhood.push(d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if d->>'op' = 'claim' then
    delete from neighborhood.push_outbox where sent_at < now() - interval '7 days' or created_at < now() - interval '2 days';
    with picked as (
      select o.id from neighborhood.push_outbox o
      where o.sent_at is null and o.attempts < 3 and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
      order by o.created_at limit least(greatest(coalesce((d->>'limit')::integer,20),1),50)
      for update skip locked
    ), claimed as (
      update neighborhood.push_outbox o set claimed_at = now(),attempts = o.attempts + 1 from picked where o.id = picked.id returning o.*
    )
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'payload',c.payload,
      'devices',(select coalesce(jsonb_agg(jsonb_build_object('endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)),'[]'::jsonb)
        from neighborhood.push_subscriptions s where s.member_id = c.member_id))),'[]'::jsonb) into result from claimed c;
    return result;
  elsif d->>'op' = 'done' then
    if jsonb_typeof(d->'gone') = 'array' then
      delete from neighborhood.push_subscriptions where endpoint in (select jsonb_array_elements_text(d->'gone'));
    end if;
    if jsonb_typeof(d->'sent') = 'array' then
      update neighborhood.push_subscriptions set last_sent_at = now() where endpoint in (select jsonb_array_elements_text(d->'sent'));
    end if;
    update neighborhood.push_outbox set sent_at = case when (d->>'ok')::boolean then now() end,
      claimed_at = case when (d->>'ok')::boolean then claimed_at end where id = (d->>'id')::uuid;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Unknown push operation.' using errcode = '22023';
end
$$;

create function public.neighborhood_push(d jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select neighborhood.push(d) $$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch12(text,jsonb),neighborhood.dispatch11(text,jsonb),neighborhood.push(jsonb),
  neighborhood.on_notification_push(),public.neighborhood_push(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch12(text,jsonb) to authenticated;
grant execute on function neighborhood.push(jsonb),public.neighborhood_push(jsonb) to service_role;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch12(op,d) end
$$;
commit;
