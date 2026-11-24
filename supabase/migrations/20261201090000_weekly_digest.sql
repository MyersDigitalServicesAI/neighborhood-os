begin;

-- Weekly digest: every Thursday evening, each member with email notices on gets "This week in <neighborhood>":
-- the most-discussed posts from the past 7 days and the events coming up in the next 7, from their neighborhood and
-- events shared from the ones next door. Quiet weeks are skipped, so an empty email never trains people to ignore it.
-- Every digest carries a one-click unsubscribe link (also sent as the List-Unsubscribe header Gmail and Yahoo require
-- for bulk mail) that turns off only the digest, with no sign-in needed.
alter table neighborhood.members add column digest boolean not null default true;
alter table neighborhood.members add column digest_token uuid not null default gen_random_uuid();
alter table neighborhood.members add column digest_week date;
create unique index members_digest_token on neighborhood.members(digest_token);

alter table neighborhood.outbox drop constraint outbox_kind_check;
alter table neighborhood.outbox add constraint outbox_kind_check check (kind in ('reply','message','alert','admitted','invite','digest'));

-- What one member's digest would show this week, or null when there's nothing worth sending.
create function neighborhood.digest_for(p_member uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  me neighborhood.members%rowtype;
  top jsonb;
  coming jsonb;
begin
  select * into me from neighborhood.members m where m.id = p_member;
  if not found then return null; end if;
  select coalesce(jsonb_agg(x.item order by x.score desc,x.created_at desc),'[]'::jsonb) into top from (
    select jsonb_build_object('id',p.id,'title',p.title,'kind',p.kind,'preview',left(regexp_replace(p.body,'\s+',' ','g'),140),
        'replies',(select count(*) from neighborhood.replies r where r.post_id = p.id and r.removed_at is null)) item,
      (select count(*) from neighborhood.replies r where r.post_id = p.id and r.removed_at is null)*2
        + (select count(*) from neighborhood.reactions x where x.post_id = p.id) score, p.created_at
    from neighborhood.posts p
    where p.area_id = me.area_id and p.removed_at is null and p.kind <> 'event'
      and p.created_at > now() - interval '7 days'
      and not exists(select 1 from neighborhood.blocks b where (b.owner_id = p_member and b.blocked_id = p.author_id)
        or (b.owner_id = p.author_id and b.blocked_id = p_member))
    order by score desc,p.created_at desc limit 5) x;
  select coalesce(jsonb_agg(x.item order by x.event_at),'[]'::jsonb) into coming from (
    select jsonb_build_object('id',p.id,'title',p.title,'event_at',p.event_at,'place',p.place,
        'area',case when p.area_id <> me.area_id then (select a.name from neighborhood.areas a where a.id = p.area_id) end) item,p.event_at
    from neighborhood.posts p
    where p.kind = 'event' and p.removed_at is null and p.event_at between now() and now() + interval '7 days'
      and (p.area_id = me.area_id or (p.reach in ('nearby','region')
        and exists(select 1 from neighborhood.area_links l where l.area_id = me.area_id and l.nearby_id = p.area_id)))
      and not exists(select 1 from neighborhood.blocks b where (b.owner_id = p_member and b.blocked_id = p.author_id)
        or (b.owner_id = p.author_id and b.blocked_id = p_member))
    order by p.area_id = me.area_id desc,p.event_at limit 6) x;
  if jsonb_array_length(top) = 0 and jsonb_array_length(coming) = 0 then return null; end if;
  return jsonb_build_object('area',(select a.name from neighborhood.areas a where a.id = me.area_id),
    'posts',top,'events',coming,'token',me.digest_token);
end
$$;

-- Queues this week's digests (once per member per week, America/New_York weeks). Returns how many were queued
-- and how many were skipped because their neighborhood had a quiet week.
create function neighborhood.queue_digests() returns jsonb
language plpgsql set search_path = '' as $$
declare
  week date := date_trunc('week',now() at time zone 'America/New_York')::date;
  m record;
  content jsonb;
  queued integer := 0;
  quiet integer := 0;
begin
  for m in select x.id from neighborhood.members x join auth.users u on u.id = x.id
      where x.email_notices and x.digest and not x.sample and u.email_confirmed_at is not null
        and x.digest_week is distinct from week
      for update of x skip locked loop
    content := neighborhood.digest_for(m.id);
    update neighborhood.members set digest_week = week where id = m.id;
    if content is null then quiet := quiet + 1; continue; end if;
    insert into neighborhood.outbox(to_user,kind,payload) values(m.id,'digest',content);
    queued := queued + 1;
  end loop;
  return jsonb_build_object('digests',queued,'quiet',quiet);
end
$$;

-- Server-only mail operations gain 'digest' (queue this week's) and 'unsubscribe' (by the token in the link).
create or replace function neighborhood.mail(d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if d->>'op' = 'claim' then
    delete from neighborhood.outbox where sent_at < now() - interval '30 days' or (sent_at is null and attempts >= 3 and created_at < now() - interval '7 days');
    -- A digest that couldn't go out within two days is stale; drop it rather than send last week's news.
    delete from neighborhood.outbox where kind = 'digest' and sent_at is null and created_at < now() - interval '2 days';
    with picked as (
      select o.id from neighborhood.outbox o
      where o.sent_at is null and o.attempts < 3 and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
        and (o.to_email is not null or exists(select 1 from auth.users u where u.id = o.to_user and u.email_confirmed_at is not null))
      order by (o.kind = 'digest'),o.created_at limit least(greatest(coalesce((d->>'limit')::integer,10),1),25)
      for update skip locked
    ), claimed as (
      update neighborhood.outbox o set claimed_at = now(),attempts = o.attempts + 1 from picked where o.id = picked.id returning o.*
    )
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'payload',c.payload,
      'email',coalesce(c.to_email,(select u.email from auth.users u where u.id = c.to_user)),
      'name',(select m.name from neighborhood.members m where m.id = c.to_user))),'[]'::jsonb) into result from claimed c;
    return result;
  elsif d->>'op' = 'done' then
    update neighborhood.outbox set sent_at = case when (d->>'ok')::boolean then now() end,
      claimed_at = case when (d->>'ok')::boolean then claimed_at end where id = (d->>'id')::uuid;
    return jsonb_build_object('ok',true);
  elsif d->>'op' = 'purge' then
    return jsonb_build_object('purged',neighborhood.purge_residency());
  elsif d->>'op' = 'digest' then
    return neighborhood.queue_digests();
  elsif d->>'op' = 'unsubscribe' then
    if coalesce(d->>'token','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok',false);
    end if;
    update neighborhood.members set digest = false where digest_token = (d->>'token')::uuid;
    if found then
      insert into neighborhood.audit(actor,action,subject,details)
        select m.id,'digest_unsubscribe',m.id,'{}'::jsonb from neighborhood.members m where m.digest_token = (d->>'token')::uuid;
    end if;
    return jsonb_build_object('ok',found);
  end if;
  raise exception 'Unknown mail operation.' using errcode = '22023';
end
$$;

create function neighborhood.dispatch14(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if op not in ('bootstrap','set_digest') then
    return neighborhood.dispatch13(op,d);
  end if;
  if op = 'bootstrap' then
    result := neighborhood.dispatch13(op,d);
    if jsonb_typeof(result) <> 'object' then return result; end if;
    return result || jsonb_build_object('digest',(select m.digest from neighborhood.members m where m.id = actor));
  end if;
  update neighborhood.members set digest = coalesce((d->>'on')::boolean,false) where id = actor;
  if not found then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
  return jsonb_build_object('ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch14(text,jsonb),neighborhood.dispatch13(text,jsonb),neighborhood.digest_for(uuid),
  neighborhood.queue_digests(),neighborhood.mail(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch14(text,jsonb) to authenticated;
grant execute on function neighborhood.mail(jsonb) to service_role;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch14(op,d) end
$$;
commit;
