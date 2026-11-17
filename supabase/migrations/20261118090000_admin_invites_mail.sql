begin;

-- Email preference. Notices are on by default and can be switched off on the Account page.
alter table neighborhood.members add column email_notices boolean not null default true;

-- Invite links. A code admits whoever redeems it, up to max_uses times, until it expires or is revoked.
create table neighborhood.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{10}$'),
  created_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 120),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  area_id text references neighborhood.areas,
  max_uses integer not null check (max_uses between 1 and 500),
  uses integer not null default 0,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_created_by on neighborhood.invites(created_by);
create index invites_area on neighborhood.invites(area_id);
create table neighborhood.invite_uses (
  invite_id uuid not null references neighborhood.invites on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  used_at timestamptz not null default now(),
  primary key (invite_id,user_id)
);
create index invite_uses_user on neighborhood.invite_uses(user_id);

-- Outgoing email. Rows are written inside the database and sent by the server with the backend key.
create table neighborhood.outbox (
  id uuid primary key default gen_random_uuid(),
  to_user uuid references auth.users(id) on delete cascade,
  to_email text,
  kind text not null check (kind in ('reply','message','alert','admitted','invite')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz,
  check (num_nonnulls(to_user,to_email) = 1)
);
create index outbox_pending on neighborhood.outbox(created_at) where sent_at is null;
create index outbox_user on neighborhood.outbox(to_user,kind,created_at desc);

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'neighborhood' loop
    execute format('alter table neighborhood.%I enable row level security',t);
  end loop;
end $$;

-- Replies, messages and safety alerts become an email, at most one per person, kind and post or
-- conversation every 30 minutes, and never to someone who switched notices off.
create function neighborhood.on_notification() returns trigger language plpgsql set search_path = '' as $$
declare
  wants boolean;
  payload jsonb;
begin
  if new.kind not in ('reply','message','alert') then return null; end if;
  select m.email_notices into wants from neighborhood.members m where m.id = new.member_id;
  if wants is distinct from true then return null; end if;
  if exists(select 1 from neighborhood.outbox o where o.to_user = new.member_id and o.kind = new.kind
      and o.payload->>'post' is not distinct from new.post_id::text and o.payload->>'thread' is not distinct from new.thread_id::text
      and o.created_at > now() - interval '30 minutes') then return null; end if;
  select jsonb_strip_nulls(jsonb_build_object('actor',a.name,'post',new.post_id,'thread',new.thread_id,'title',p.title,'area',ar.name))
    into payload from (select 1) one
    left join neighborhood.members a on a.id = new.actor_id
    left join neighborhood.posts p on p.id = new.post_id
    left join neighborhood.areas ar on ar.id = p.area_id;
  insert into neighborhood.outbox(to_user,kind,payload) values(new.member_id,new.kind,coalesce(payload,'{}'::jsonb));
  return null;
end $$;
create trigger notifications_mail after insert on neighborhood.notifications for each row execute function neighborhood.on_notification();

create function neighborhood.dispatch4(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  role_name text;
  item uuid;
  result jsonb;
  inv neighborhood.invites%rowtype;
  code_text text;
  invited_email text;
begin
  if op not in ('bootstrap','join','invite_info','set_email_notices','delete_account','admin','admit','create_invite','revoke_invite','set_role') then
    return neighborhood.dispatch3(op,d);
  end if;
  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  if d is null or jsonb_typeof(d) <> 'object' or pg_column_size(d) > 20000 then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  select s.role into role_name from neighborhood.staff s where s.user_id = actor;
  item := nullif(d->>'id','')::uuid;
  code_text := upper(btrim(coalesce(d->>'invite','')));

  if op = 'bootstrap' then
    result := neighborhood.dispatch3(op,d);
    return result || jsonb_build_object('email',(select u.email from auth.users u where u.id = actor),
      'emailNotices',(select m.email_notices from neighborhood.members m where m.id = actor));
  elsif op = 'invite_info' then
    select * into inv from neighborhood.invites i where i.code = code_text;
    return jsonb_build_object('valid',found and inv.revoked_at is null and inv.expires_at > now() and inv.uses < inv.max_uses,
      'area',inv.area_id);
  elsif op = 'join' then
    if code_text <> '' and not exists(select 1 from neighborhood.pilot_access a where a.user_id = actor)
        and not exists(select 1 from neighborhood.members m where m.id = actor) then
      select * into inv from neighborhood.invites i where i.code = code_text for update;
      if not found or inv.revoked_at is not null or inv.expires_at <= now() or inv.uses >= inv.max_uses then
        raise exception 'This invite link has expired or been used up. Ask for a new one.';
      end if;
      insert into neighborhood.invite_uses(invite_id,user_id) values(inv.id,actor) on conflict do nothing;
      if found then update neighborhood.invites set uses = uses + 1 where id = inv.id; end if;
      insert into neighborhood.pilot_access(user_id) values(actor) on conflict do nothing;
    end if;
    return neighborhood.dispatch3(op,d - 'invite');
  elsif op = 'set_email_notices' then
    update neighborhood.members set email_notices = coalesce((d->>'on')::boolean,false) where id = actor;
    if not found then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
    return jsonb_build_object('ok',true);
  elsif op = 'delete_account' then
    if d->>'confirm' is distinct from 'DELETE' then raise exception 'Type DELETE to confirm.'; end if;
    if role_name = 'admin' and not exists(select 1 from neighborhood.staff s where s.role = 'admin' and s.user_id <> actor) then
      raise exception 'Add another admin before deleting the only admin account.';
    end if;
    insert into neighborhood.audit(actor,action,subject,details) values(null,'account_deleted',actor,'{}'::jsonb);
    delete from auth.users where id = actor;
    return jsonb_build_object('deleted',true);
  end if;

  if role_name is distinct from 'admin' then raise exception 'Admin access required.' using errcode = '42501'; end if;
  case op
  when 'admin' then
    return jsonb_build_object(
      'pending',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
        select u.id,u.email,u.created_at,u.email_confirmed_at is not null confirmed from auth.users u
        where not exists(select 1 from neighborhood.members m where m.id = u.id)
          and not exists(select 1 from neighborhood.pilot_access a where a.user_id = u.id)
        order by u.created_at desc limit 100) x),
      'admitted',(select count(*) from neighborhood.pilot_access a where not exists(select 1 from neighborhood.members m where m.id = a.user_id)),
      'members',(select count(*) from neighborhood.members m where not m.sample),
      'invites',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
        select i.id,i.code,i.note,i.email,i.max_uses,i.uses,i.expires_at,i.revoked_at,i.created_at,ar.name area
        from neighborhood.invites i left join neighborhood.areas ar on ar.id = i.area_id
        order by i.created_at desc limit 50) x),
      'team',(select coalesce(jsonb_agg(to_jsonb(x) order by x.role nulls last,x.name),'[]'::jsonb) from (
        select m.id,m.name,ar.name area,s.role,m.id = actor me from neighborhood.members m join neighborhood.areas ar on ar.id = m.area_id
        left join neighborhood.staff s on s.user_id = m.id where not m.sample
        order by s.role nulls last,m.created_at desc limit 100) x));
  when 'admit' then
    if not exists(select 1 from auth.users u where u.id = item) then raise exception 'Account unavailable.' using errcode = '42501'; end if;
    insert into neighborhood.pilot_access(user_id) values(item) on conflict do nothing;
    if found then insert into neighborhood.outbox(to_user,kind) values(item,'admitted'); end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,'{}'::jsonb);
  when 'create_invite' then
    invited_email := nullif(lower(btrim(coalesce(d->>'email',''))),'');
    insert into neighborhood.invites(code,created_by,note,email,area_id,max_uses,expires_at)
      values(translate(upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text),1,10)),'01','XY'),actor,nullif(btrim(coalesce(d->>'note','')),''),
        invited_email,nullif(d->>'area',''),coalesce(nullif(d->>'uses','')::integer,1),
        now() + make_interval(days => least(greatest(coalesce(nullif(d->>'days','')::integer,14),1),90)))
      returning * into inv;
    if invited_email is not null then
      insert into neighborhood.outbox(to_email,kind,payload) values(invited_email,'invite',jsonb_build_object('code',inv.code,
        'inviter',(select m.name from neighborhood.members m where m.id = actor),'area',(select ar.name from neighborhood.areas ar where ar.id = inv.area_id)));
    end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,inv.id,jsonb_build_object('uses',inv.max_uses,'emailed',invited_email is not null));
    return jsonb_build_object('id',inv.id,'code',inv.code,'emailed',invited_email is not null);
  when 'revoke_invite' then
    update neighborhood.invites set revoked_at = now() where id = item and revoked_at is null;
    if not found then raise exception 'Invite unavailable.' using errcode = '42501'; end if;
  when 'set_role' then
    if item = actor then raise exception 'You cannot change your own role.'; end if;
    if not exists(select 1 from neighborhood.members m where m.id = item and not m.sample) then
      raise exception 'Member unavailable.' using errcode = '42501';
    end if;
    if nullif(d->>'role','') is null then
      delete from neighborhood.staff where user_id = item;
    elsif d->>'role' in ('moderator','admin') then
      insert into neighborhood.staff(user_id,role) values(item,d->>'role') on conflict(user_id) do update set role = excluded.role;
    else
      raise exception 'Choose a role.';
    end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('role',d->>'role'));
  end case;
  return jsonb_build_object('id',item,'ok',true);
end
$$;

-- Server-only mail queue access, called with the backend key. 'claim' hands out up to 25 unsent emails with
-- their addresses and marks them in flight; 'done' records the result. Old sent rows are removed.
create function neighborhood.mail(d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if d->>'op' = 'claim' then
    delete from neighborhood.outbox where sent_at < now() - interval '30 days' or (sent_at is null and attempts >= 3 and created_at < now() - interval '7 days');
    with picked as (
      select o.id from neighborhood.outbox o
      where o.sent_at is null and o.attempts < 3 and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
        and (o.to_email is not null or exists(select 1 from auth.users u where u.id = o.to_user and u.email_confirmed_at is not null))
      order by o.created_at limit least(greatest(coalesce((d->>'limit')::integer,10),1),25)
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
  end if;
  raise exception 'Unknown mail operation.' using errcode = '22023';
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch4(text,jsonb),neighborhood.mail(jsonb),neighborhood.on_notification()
  from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch3(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch4(text,jsonb) to authenticated;
grant execute on function neighborhood.mail(jsonb) to service_role;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch4(op,d) end
$$;
create function public.neighborhood_mail(d jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select neighborhood.mail(d) $$;
revoke all on function public.neighborhood_mail(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.neighborhood_mail(jsonb) to service_role;
commit;
