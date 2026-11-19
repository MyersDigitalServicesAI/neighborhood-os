begin;

-- Two more ways to become a verified neighbor, neither of which stores an address:
--   vouching: two verified neighbors from the same or a bordering area confirm they know you live there;
--   check-in: you scan a short-lived QR code shown by a partner (for example a CDC) at an in-person meeting.
alter table neighborhood.members
  add column verified_via text check (verified_via is null or verified_via in ('postcard','vouch','checkin'));
update neighborhood.members set verified_via = 'postcard' where verified_at is not null and verified_via is null;

create table neighborhood.vouches (
  voucher_id uuid not null references neighborhood.members on delete cascade,
  member_id uuid not null references neighborhood.members on delete cascade,
  created_at timestamptz not null default now(),
  primary key (voucher_id,member_id),
  check (voucher_id <> member_id)
);
create index vouches_member on neighborhood.vouches(member_id);
create index vouches_recent on neighborhood.vouches(voucher_id,created_at desc);

-- People an admin trusts to run check-ins for one area, typically partner staff.
create table neighborhood.hosts (
  user_id uuid not null references neighborhood.members on delete cascade,
  area_id text not null references neighborhood.areas on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id,area_id)
);
create index hosts_area on neighborhood.hosts(area_id);

create table neighborhood.checkins (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  area_id text not null references neighborhood.areas,
  host_id uuid references auth.users(id) on delete set null,
  label text not null check (char_length(label) between 2 and 80),
  max_uses integer not null check (max_uses between 1 and 300),
  uses integer not null default 0,
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index checkins_host on neighborhood.checkins(host_id,created_at desc);
create index checkins_area on neighborhood.checkins(area_id);
create table neighborhood.checkin_uses (
  checkin_id uuid not null references neighborhood.checkins on delete cascade,
  member_id uuid not null references neighborhood.members on delete cascade,
  verified boolean not null,
  undone_at timestamptz,
  used_at timestamptz not null default now(),
  primary key (checkin_id,member_id)
);
create index checkin_uses_member on neighborhood.checkin_uses(member_id);

alter table neighborhood.vouches enable row level security;
alter table neighborhood.hosts enable row level security;
alter table neighborhood.checkins enable row level security;
alter table neighborhood.checkin_uses enable row level security;

-- Same area, or an area that shares a border with it.
create function neighborhood.same_or_bordering(a text,b text) returns boolean
language sql stable set search_path = '' as $$
  select a = b or exists(select 1 from neighborhood.area_links l where l.area_id = a and l.nearby_id = b)
$$;

-- Marks a member verified without ever holding an address, and drops any postcard request still waiting,
-- which is the only place an address could be stored.
create function neighborhood.mark_verified(p_member uuid,p_via text) returns boolean
language plpgsql set search_path = '' as $$
begin
  update neighborhood.members set verified_at = now(),verified_via = p_via where id = p_member and verified_at is null;
  if not found then return false; end if;
  delete from neighborhood.residency_checks where member_id = p_member;
  insert into neighborhood.notifications(member_id,kind) values(p_member,'residency');
  insert into neighborhood.audit(actor,action,subject,details) values(p_member,'residency_verified',p_member,jsonb_build_object('via',p_via));
  return true;
end $$;

create function neighborhood.checkin_live(c neighborhood.checkins) returns boolean
language sql stable set search_path = '' as $$
  select c.ended_at is null and c.expires_at > now() and c.uses < c.max_uses
$$;

create function neighborhood.dispatch5(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  role_name text;
  me neighborhood.members%rowtype;
  target neighborhood.members%rowtype;
  c neighborhood.checkins%rowtype;
  item uuid;
  result jsonb;
  code_text text;
  received integer;
  verified_now boolean;
begin
  if op not in ('bootstrap','profile','join','confirm_residency','admin','vouch','unvouch','checkin_info','checkin',
      'create_checkin','checkins','checkin_host','end_checkin','undo_checkin','set_host') then
    return neighborhood.dispatch4(op,d);
  end if;
  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  if d is null or jsonb_typeof(d) <> 'object' or pg_column_size(d) > 20000 then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  select s.role into role_name from neighborhood.staff s where s.user_id = actor;
  select * into me from neighborhood.members m where m.id = actor;
  item := nullif(d->>'id','')::uuid;
  code_text := upper(btrim(coalesce(d->>'checkin','')));

  case op
  when 'bootstrap' then
    result := neighborhood.dispatch4(op,d);
    if me.id is null then return result; end if;
    return result || jsonb_build_object(
      'vouches',(select count(*) from neighborhood.vouches v where v.member_id = actor),
      'verifiedVia',me.verified_via,
      'hostAreas',case when role_name = 'admin' then to_jsonb(array['*'])
        else (select coalesce(jsonb_agg(h.area_id order by h.area_id),'[]'::jsonb) from neighborhood.hosts h where h.user_id = actor) end);
  when 'profile' then
    result := neighborhood.dispatch4(op,d);
    if result is null or jsonb_typeof(result) <> 'object' then return result; end if;
    select * into target from neighborhood.members m where m.id = (result->>'id')::uuid;
    return result || jsonb_build_object(
      'vouches',(select count(*) from neighborhood.vouches v where v.member_id = target.id),
      'vouched',exists(select 1 from neighborhood.vouches v where v.member_id = target.id and v.voucher_id = actor),
      'canVouch',me.id is not null and me.verified_at is not null and not me.sample and target.id <> actor and target.verified_at is null
        and neighborhood.same_or_bordering(me.area_id,target.area_id));
  when 'join' then
    -- A check-in code also admits someone who signs up at the meeting itself.
    if code_text <> '' and me.id is null and not exists(select 1 from neighborhood.pilot_access a where a.user_id = actor) then
      select * into c from neighborhood.checkins k where k.code = code_text;
      if not found or not neighborhood.checkin_live(c) then
        raise exception 'This check-in code has ended. Ask the host for the current one.';
      end if;
      insert into neighborhood.pilot_access(user_id) values(actor) on conflict do nothing;
    end if;
    return neighborhood.dispatch4(op,d - 'checkin');
  when 'confirm_residency' then
    result := neighborhood.dispatch4(op,d);
    update neighborhood.members set verified_via = 'postcard' where id = actor and verified_at is not null and verified_via is null;
    return result;
  when 'checkin_info' then
    select * into c from neighborhood.checkins k where k.code = code_text;
    return jsonb_build_object('valid',found and neighborhood.checkin_live(c),'area',c.area_id,
      'areaName',(select a.name from neighborhood.areas a where a.id = c.area_id),'label',c.label);
  when 'admin' then
    result := neighborhood.dispatch4(op,d);
    return result || jsonb_build_object('hosts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.area),'[]'::jsonb) from (
      select h.user_id id,m.name,h.area_id,a.name area from neighborhood.hosts h join neighborhood.members m on m.id = h.user_id
      join neighborhood.areas a on a.id = h.area_id) x));
  else
    null;
  end case;

  if me.id is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;

  case op
  when 'vouch' then
    if me.verified_at is null or me.sample then raise exception 'Only verified neighbors can vouch.' using errcode = '42501'; end if;
    select * into target from neighborhood.members m where m.id = item for update;
    if not found or target.sample or target.id = actor then raise exception 'Neighbor unavailable.' using errcode = '42501'; end if;
    if target.verified_at is not null then raise exception 'They are already verified.'; end if;
    if not neighborhood.same_or_bordering(me.area_id,target.area_id) then
      raise exception 'You can vouch only for neighbors in your neighborhood or one next to it.';
    end if;
    if exists(select 1 from neighborhood.vouches v where v.voucher_id = actor and v.member_id = item) then
      raise exception 'You already vouched for them.';
    end if;
    if (select count(*) from neighborhood.vouches v where v.voucher_id = actor and v.created_at > now() - interval '30 days') >= 5 then
      raise exception 'You can vouch for up to 5 neighbors every 30 days.';
    end if;
    insert into neighborhood.vouches(voucher_id,member_id) values(actor,item);
    insert into neighborhood.audit(actor,action,subject,details) values(actor,'vouch',item,'{}'::jsonb);
    received := (select count(*) from neighborhood.vouches v where v.member_id = item);
    verified_now := false;
    if received >= 2 then verified_now := neighborhood.mark_verified(item,'vouch');
    else insert into neighborhood.notifications(member_id,actor_id,kind) values(item,actor,'residency');
    end if;
    return jsonb_build_object('vouches',received,'verified',verified_now);
  when 'unvouch' then
    if exists(select 1 from neighborhood.members m where m.id = item and m.verified_at is not null) then
      raise exception 'They are already verified, so the vouch can no longer be withdrawn. Report the account if something is wrong.';
    end if;
    delete from neighborhood.vouches where voucher_id = actor and member_id = item;
    if not found then raise exception 'You have not vouched for them.'; end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,'unvouch',item,'{}'::jsonb);
    return jsonb_build_object('ok',true);
  when 'checkin' then
    select * into c from neighborhood.checkins k where k.code = code_text for update;
    if not found or not neighborhood.checkin_live(c) then
      raise exception 'This check-in code has ended. Ask the host for the current one.';
    end if;
    if exists(select 1 from neighborhood.checkin_uses u where u.checkin_id = c.id and u.member_id = actor) then
      return jsonb_build_object('verified',me.verified_at is not null,'already',true,'label',c.label);
    end if;
    if me.verified_at is null and not neighborhood.same_or_bordering(c.area_id,me.area_id) then
      raise exception 'This check-in verifies neighbors of %. Your account is in a different neighborhood.',(select a.name from neighborhood.areas a where a.id = c.area_id);
    end if;
    verified_now := me.verified_at is null and neighborhood.mark_verified(actor,'checkin');
    insert into neighborhood.checkin_uses(checkin_id,member_id,verified) values(c.id,actor,verified_now);
    update neighborhood.checkins set uses = uses + 1 where id = c.id;
    return jsonb_build_object('verified',true,'already',not verified_now,'label',c.label);
  else
    null;
  end case;

  -- Hosting: admins for any area, hosts for the areas they were given.
  if op = 'set_host' then
    if role_name is distinct from 'admin' then raise exception 'Admin access required.' using errcode = '42501'; end if;
    if not exists(select 1 from neighborhood.members m where m.id = item and not m.sample) then
      raise exception 'Member unavailable.' using errcode = '42501';
    end if;
    if nullif(d->>'area','') is null then raise exception 'Choose a neighborhood.'; end if;
    if coalesce((d->>'remove')::boolean,false) then
      delete from neighborhood.hosts where user_id = item and area_id = d->>'area';
    else
      insert into neighborhood.hosts(user_id,area_id,added_by) values(item,d->>'area',actor) on conflict do nothing;
    end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('area',d->>'area','remove',coalesce((d->>'remove')::boolean,false)));
    return jsonb_build_object('ok',true);
  elsif op = 'create_checkin' then
    if role_name is distinct from 'admin' and not exists(select 1 from neighborhood.hosts h where h.user_id = actor and h.area_id = d->>'area') then
      raise exception 'Only hosts for this neighborhood can run a check-in.' using errcode = '42501';
    end if;
    if not exists(select 1 from neighborhood.areas a where a.id = d->>'area') then raise exception 'Choose a neighborhood.'; end if;
    insert into neighborhood.checkins(code,area_id,host_id,label,max_uses,expires_at)
      values(translate(upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text),1,8)),'0189','WXYZ'),d->>'area',actor,
        coalesce(nullif(btrim(coalesce(d->>'label','')),''),'Community meeting'),
        least(greatest(coalesce(nullif(d->>'uses','')::integer,60),1),300),
        now() + make_interval(hours => least(greatest(coalesce(nullif(d->>'hours','')::integer,3),1),12)))
      returning * into c;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,c.id,jsonb_build_object('area',c.area_id,'uses',c.max_uses));
    return jsonb_build_object('id',c.id,'code',c.code);
  elsif op = 'checkins' then
    return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
      select k.id,k.code,k.label,k.area_id,a.name area,k.uses,k.max_uses,k.expires_at,k.ended_at,k.created_at,neighborhood.checkin_live(k) live
      from neighborhood.checkins k join neighborhood.areas a on a.id = k.area_id
      where k.host_id = actor or role_name = 'admin' order by k.created_at desc limit 30) x);
  end if;

  select * into c from neighborhood.checkins k where k.id = item;
  if not found or (c.host_id is distinct from actor and role_name is distinct from 'admin') then
    raise exception 'Check-in unavailable.' using errcode = '42501';
  end if;
  if op = 'checkin_host' then
    return to_jsonb(c) || jsonb_build_object('live',neighborhood.checkin_live(c),'area',(select a.name from neighborhood.areas a where a.id = c.area_id),
      'people',(select coalesce(jsonb_agg(to_jsonb(x) order by x.used_at desc),'[]'::jsonb) from (
        select u.member_id id,m.name,a.name area,u.verified,u.undone_at,u.used_at from neighborhood.checkin_uses u
        join neighborhood.members m on m.id = u.member_id join neighborhood.areas a on a.id = m.area_id
        where u.checkin_id = c.id order by u.used_at desc limit 300) x));
  elsif op = 'end_checkin' then
    update neighborhood.checkins set ended_at = now() where id = c.id and ended_at is null;
    return jsonb_build_object('ok',true);
  elsif op = 'undo_checkin' then
    update neighborhood.checkin_uses set undone_at = now()
      where checkin_id = c.id and member_id = (d->>'member')::uuid and undone_at is null and verified;
    if not found then raise exception 'Nothing to undo for this person.'; end if;
    update neighborhood.members set verified_at = null,verified_via = null where id = (d->>'member')::uuid and verified_via = 'checkin';
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,(d->>'member')::uuid,jsonb_build_object('checkin',c.id));
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Unknown operation.' using errcode = '22023';
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch5(text,jsonb),neighborhood.mark_verified(uuid,text),
  neighborhood.same_or_bordering(text,text),neighborhood.checkin_live(neighborhood.checkins) from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch4(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch5(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch5(op,d) end
$$;
commit;
