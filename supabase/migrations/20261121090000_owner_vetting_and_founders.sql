begin;

-- The platform owner. Only the owner, and people the owner chooses, can decide business vetting.
-- The owner may also approve their own business; every such decision is marked in the audit log.
create table neighborhood.platform_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict
);
-- On a fresh project with exactly one admin, that admin becomes the owner.
insert into neighborhood.platform_owner(user_id)
  select s.user_id from neighborhood.staff s where s.role = 'admin' and (select count(*) from neighborhood.staff x where x.role = 'admin') = 1;

create table neighborhood.vetters (
  user_id uuid primary key references neighborhood.members on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Founding neighbors: the first 50 people verified in each neighborhood keep a numbered badge.
alter table neighborhood.members add column founding_no integer check (founding_no between 1 and 50),
  add column founding_area text references neighborhood.areas;
create unique index members_founding on neighborhood.members(founding_area,founding_no) where founding_no is not null;

alter table neighborhood.platform_owner enable row level security;
alter table neighborhood.vetters enable row level security;

create function neighborhood.on_verified() returns trigger language plpgsql set search_path = '' as $$
declare next_no integer;
begin
  if new.verified_at is null then
    new.founding_no := null;
    new.founding_area := null;
  elsif old.verified_at is null and new.founding_no is null and not new.sample then
    perform pg_advisory_xact_lock(hashtext('founding:' || new.area_id));
    select coalesce(max(m.founding_no),0) + 1 into next_no from neighborhood.members m where m.founding_area = new.area_id;
    if next_no <= 50 then
      new.founding_no := next_no;
      new.founding_area := new.area_id;
    end if;
  end if;
  return new;
end $$;
create trigger members_founding before update of verified_at on neighborhood.members
  for each row when (old.verified_at is distinct from new.verified_at) execute function neighborhood.on_verified();

-- Members verified before this update get their numbers in the order they were verified.
do $$
declare r record;
begin
  for r in select m.id,m.area_id from neighborhood.members m where m.verified_at is not null and not m.sample and m.founding_no is null order by m.verified_at loop
    update neighborhood.members set founding_no = (select coalesce(max(x.founding_no),0) + 1 from neighborhood.members x where x.founding_area = r.area_id),
      founding_area = r.area_id
      where id = r.id and (select coalesce(max(x.founding_no),0) from neighborhood.members x where x.founding_area = r.area_id) < 50;
  end loop;
end $$;

create function neighborhood.can_vet(p_actor uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from neighborhood.platform_owner o where o.user_id = p_actor)
    or exists(select 1 from neighborhood.vetters v join neighborhood.staff s on s.user_id = v.user_id where v.user_id = p_actor)
$$;

create function neighborhood.dispatch7(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_owner boolean;
  item uuid;
  result jsonb;
  action_text text;
  reason_text text;
  owner_of uuid;
  me neighborhood.members%rowtype;
begin
  if op not in ('bootstrap','profile','moderation','decide_vetting','admin','set_vetter') then
    return neighborhood.dispatch6(op,d);
  end if;
  is_owner := exists(select 1 from neighborhood.platform_owner o where o.user_id = actor);
  item := nullif(d->>'id','')::uuid;

  if op = 'bootstrap' then
    result := neighborhood.dispatch6(op,d);
    select * into me from neighborhood.members m where m.id = actor;
    if me.id is null then return result; end if;
    return result || jsonb_build_object('owner',is_owner,'vetter',neighborhood.can_vet(actor),
      'founding',me.founding_no,
      -- Numbers are never reused, so the spots left count down from the highest number given.
      'foundingLeft',greatest(0,50 - (select coalesce(max(m.founding_no),0) from neighborhood.members m where m.founding_area = me.area_id)));
  elsif op = 'profile' then
    result := neighborhood.dispatch6(op,d);
    if result is null or jsonb_typeof(result) <> 'object' then return result; end if;
    return result || (select jsonb_build_object('founding',m.founding_no,'foundingArea',a.name)
      from neighborhood.members m left join neighborhood.areas a on a.id = m.founding_area where m.id = (result->>'id')::uuid);
  elsif op = 'moderation' then
    result := neighborhood.dispatch6(op,d);
    -- The vetting queue is only for the owner (every business, their own included) and chosen vetters (not their own).
    return result || jsonb_build_object('canVet',neighborhood.can_vet(actor),'vetting',
      case when not neighborhood.can_vet(actor) then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(v) order by v.pending desc,v.updated_at),'[]'::jsonb) from (
        select v.business_id id,v.legal_name,v.registration_ref,v.contact_ref,v.updated_at,v.status,b.name business,v.status = 'pending' pending,b.owner_id = actor own
        from neighborhood.vetting v join neighborhood.businesses b on b.id = v.business_id
        where (v.status = 'pending' or (v.status = 'approved' and v.expires_at > now())) and (is_owner or b.owner_id <> actor)
        order by (v.status = 'pending') desc,v.updated_at limit 40) v) end);
  elsif op = 'admin' then
    result := neighborhood.dispatch6(op,d);
    return result || jsonb_build_object('owner',is_owner,'vetters',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) from (
      select v.user_id id,m.name,s.role from neighborhood.vetters v join neighborhood.members m on m.id = v.user_id
      left join neighborhood.staff s on s.user_id = v.user_id) x));
  end if;

  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;

  if op = 'set_vetter' then
    if not is_owner then raise exception 'Only the platform owner can choose who vets businesses.' using errcode = '42501'; end if;
    if coalesce((d->>'remove')::boolean,false) then
      delete from neighborhood.vetters where user_id = item;
    else
      if not exists(select 1 from neighborhood.staff s join neighborhood.members m on m.id = s.user_id where s.user_id = item and not m.sample) then
        raise exception 'Make them a moderator or admin first.';
      end if;
      insert into neighborhood.vetters(user_id,added_by) values(item,actor) on conflict do nothing;
    end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('remove',coalesce((d->>'remove')::boolean,false)));
    return jsonb_build_object('ok',true);
  end if;

  -- decide_vetting
  if not neighborhood.can_vet(actor) then
    raise exception 'Only the platform owner and the people they choose can decide business vetting.' using errcode = '42501';
  end if;
  select b.owner_id into owner_of from neighborhood.businesses b where b.id = item for update;
  action_text := d->>'action';
  reason_text := btrim(coalesce(d->>'reason',''));
  if owner_of is null or (owner_of = actor and not is_owner) or action_text is null or action_text not in ('approved','declined','revoked')
      or char_length(reason_text) not between 12 and 700 then
    raise exception 'Vetting decision is unavailable or incomplete.' using errcode = '42501';
  end if;
  if action_text = 'approved' and (coalesce(char_length(btrim(d->>'identityEvidence')),0) not between 12 and 500
      or coalesce(char_length(btrim(d->>'controlEvidence')),0) not between 12 and 500
      or coalesce(char_length(btrim(d->>'licenseEvidence')),0) not between 12 and 500
      or d->>'attestation' is distinct from 'true') then
    raise exception 'Record independent identity, control and applicable license or insurance checks first.';
  end if;
  update neighborhood.vetting set status = action_text,decision_reason = reason_text,reviewed_by = actor,reviewed_at = now(),
    updated_at = now(),expires_at = case when action_text = 'approved' then now() + interval '1 year' end
    where business_id = item and ((status = 'pending' and action_text in ('approved','declined')) or (status = 'approved' and action_text = 'revoked'));
  if not found then raise exception 'This application cannot receive that decision.'; end if;
  insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,
    jsonb_build_object('outcome',action_text,'reason',reason_text,'identity',d->>'identityEvidence',
      'control',d->>'controlEvidence','license',d->>'licenseEvidence','own',owner_of = actor));
  perform neighborhood.notify(owner_of,actor,'vetting',null,null,item);
  return jsonb_build_object('id',item,'ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch7(text,jsonb),neighborhood.dispatch6(text,jsonb),neighborhood.can_vet(uuid),neighborhood.on_verified()
  from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch7(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch7(op,d) end
$$;
commit;
