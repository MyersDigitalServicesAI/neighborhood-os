begin;

-- Owner tools for growing the first neighborhoods:
--   * The Admin page splits "admitted and not joined" into people who still need to confirm their email and people who
--     confirmed but never chose a neighborhood, with dates and whether a reminder went out.
--   * A member roster for admins: name, email, neighborhood, joined, verified, role and email settings. Admins only;
--     it is the same information an admin already sees one person at a time, gathered in one place.
--   * One reminder email, 48 hours after someone is let in with a confirmed email but hasn't chosen a neighborhood.
--     Sent once per person, by the daily mail job.
create table neighborhood.join_reminders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table neighborhood.join_reminders enable row level security;

alter table neighborhood.outbox drop constraint outbox_kind_check;
alter table neighborhood.outbox add constraint outbox_kind_check
  check (kind in ('reply','message','alert','admitted','invite','digest','reminder'));

create function neighborhood.queue_join_reminders() returns jsonb
language plpgsql set search_path = '' as $$
declare queued integer;
begin
  with due as (
    select u.id from auth.users u join neighborhood.pilot_access a on a.user_id = u.id
    where u.email_confirmed_at is not null and u.email_confirmed_at < now() - interval '48 hours'
      and u.created_at < now() - interval '48 hours'
      and not exists(select 1 from neighborhood.members m where m.id = u.id)
      and not exists(select 1 from neighborhood.join_reminders r where r.user_id = u.id)
    limit 200
  ), marked as (
    insert into neighborhood.join_reminders(user_id) select id from due on conflict do nothing returning user_id
  )
  insert into neighborhood.outbox(to_user,kind) select user_id,'reminder' from marked;
  get diagnostics queued = row_count;
  return jsonb_build_object('reminders',queued);
end
$$;

-- Server-only mail operations gain 'remind': queue the one-time reminders that are due.
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
  elsif d->>'op' = 'remind' then
    return neighborhood.queue_join_reminders();
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


create function neighborhood.dispatch16(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if op not in ('admin','roster') then
    return neighborhood.dispatch15(op,d);
  end if;
  if op = 'roster' then
    if not exists(select 1 from neighborhood.staff s where s.user_id = actor and s.role = 'admin') then
      raise exception 'Admins only.' using errcode = '42501';
    end if;
    return jsonb_build_object('members',(select coalesce(jsonb_agg(to_jsonb(x) order by x.area,x.name),'[]'::jsonb) from (
      select m.id,m.name,u.email,ar.name area,m.area_id,m.created_at joined,m.verified_at is not null verified,m.verified_via,
        s.role,m.email_notices,m.digest,u.last_sign_in_at last_seen
      from neighborhood.members m join auth.users u on u.id = m.id join neighborhood.areas ar on ar.id = m.area_id
      left join neighborhood.staff s on s.user_id = m.id
      where not m.sample order by ar.name,m.name limit 2000) x));
  end if;
  -- admin: the earlier layers check the admin role and build the page; this adds the joining breakdown.
  result := neighborhood.dispatch15(op,d);
  return result || jsonb_build_object('joining',(select coalesce(jsonb_agg(to_jsonb(x) order by x.signed_up desc),'[]'::jsonb) from (
      select u.id,u.email,u.created_at signed_up,u.email_confirmed_at is not null confirmed,u.confirmation_sent_at,
        u.last_sign_in_at last_seen,r.sent_at reminded_at
      from neighborhood.pilot_access a join auth.users u on u.id = a.user_id
      left join neighborhood.join_reminders r on r.user_id = u.id
      where not exists(select 1 from neighborhood.members m where m.id = u.id)
      order by u.created_at desc limit 200) x));
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch16(text,jsonb),neighborhood.dispatch15(text,jsonb),neighborhood.queue_join_reminders(),
  neighborhood.mail(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch16(text,jsonb) to authenticated;
grant execute on function neighborhood.mail(jsonb) to service_role;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch16(op,d) end
$$;
commit;
