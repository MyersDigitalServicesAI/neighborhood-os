begin;

-- Local food: farmers markets, farm stands, urban farms, farm shares (CSAs) and community gardens. Anyone can browse
-- them on the public Local Food page, and each Cleveland neighborhood's Guide lists the ones inside it. Listings start
-- from public sources; a grower or market manager can claim theirs, and once an admin approves the claim they keep it
-- up to date themselves: hours, season, links and what's fresh right now.
create table neighborhood.food_listings (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  kind text not null check (kind in ('market','stand','farm','csa','garden')),
  name text not null check (char_length(name) between 2 and 120),
  detail text not null default '' check (char_length(detail) <= 900),
  address text check (address is null or char_length(address) between 3 and 160),
  city text check (city is null or char_length(city) between 2 and 60),
  area_id text references neighborhood.areas,
  region text not null check (region in ('Cleveland','Cuyahoga County','Cuyahoga Valley')),
  schedule text check (schedule is null or char_length(schedule) <= 300),
  season text check (season is null or char_length(season) <= 160),
  snap boolean not null default false,
  perks boolean not null default false,
  url text check (url is null or (url ~ '^https://' and char_length(url) <= 300)),
  phone text check (phone is null or phone ~ '^[0-9()+ .-]{7,20}$'),
  lat numeric(9,6) check (lat is null or lat between 40 and 43),
  lng numeric(9,6) check (lng is null or lng between -83 and -80),
  source text not null default '' check (char_length(source) <= 300),
  fresh_now text check (fresh_now is null or char_length(fresh_now) <= 280),
  owner_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  hidden_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index food_listings_area on neighborhood.food_listings(area_id,kind) where hidden_at is null;
create index food_listings_owner on neighborhood.food_listings(owner_id) where owner_id is not null;
alter table neighborhood.food_listings enable row level security;

create table neighborhood.food_claims (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references neighborhood.food_listings on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  note text not null check (char_length(note) between 10 and 600),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz
);
create unique index food_claims_one_pending on neighborhood.food_claims(listing_id,member_id) where status = 'pending';
alter table neighborhood.food_claims enable row level security;

-- What anyone may see about a listing. Never who claimed it, only that the grower keeps it up to date.
create function neighborhood.food_json(f neighborhood.food_listings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',f.id,'slug',f.slug,'kind',f.kind,'name',f.name,'detail',f.detail,'address',f.address,'city',f.city,
    'area_id',f.area_id,'area',(select a.name from neighborhood.areas a where a.id = f.area_id),'region',f.region,'schedule',f.schedule,
    'season',f.season,'snap',f.snap,'perks',f.perks,'url',f.url,'phone',f.phone,'lat',f.lat,'lng',f.lng,'source',f.source,
    'fresh_now',f.fresh_now,'claimed',f.owner_id is not null,'updated_at',f.updated_at)
$$;

create function neighborhood.public_food(d jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  pick_kind text := nullif(d->>'kind','');
  pick_area text := nullif(d->>'area','');
  snap_only boolean := coalesce((d->>'snap')::boolean,false);
begin
  return jsonb_build_object('kind',pick_kind,'area',pick_area,'snap',snap_only,
    'listings',(select coalesce(jsonb_agg(neighborhood.food_json(f) order by f.region <> 'Cleveland',f.region,
        case f.kind when 'market' then 1 when 'stand' then 2 when 'csa' then 3 when 'farm' then 4 else 5 end,f.name),'[]'::jsonb)
      from neighborhood.food_listings f where f.hidden_at is null and (pick_kind is null or f.kind = pick_kind)
        and (pick_area is null or f.area_id = pick_area) and (not snap_only or f.snap)),
    'kinds',(select coalesce(jsonb_object_agg(x.kind,x.n),'{}'::jsonb) from (select f.kind,count(*) n from neighborhood.food_listings f
      where f.hidden_at is null group by f.kind) x),
    'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'count',x.n) order by x.name),'[]'::jsonb) from (
      select a.id,a.name,count(*) n from neighborhood.food_listings f join neighborhood.areas a on a.id = f.area_id
      where f.hidden_at is null group by a.id,a.name) x));
end
$$;
create function public.neighborhood_public_food(d jsonb default '{}'::jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$ select neighborhood.public_food(d) $$;

create function neighborhood.dispatch11(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  result jsonb;
  item uuid;
  chosen neighborhood.food_listings%rowtype;
  claim neighborhood.food_claims%rowtype;
  clean jsonb;
begin
  if op not in ('bootstrap','guide','admin','claim_food','save_food','decide_food_claim') then
    return neighborhood.dispatch10(op,d);
  end if;
  is_admin := exists(select 1 from neighborhood.staff s where s.user_id = actor and s.role = 'admin');

  if op = 'bootstrap' then
    result := neighborhood.dispatch10(op,d);
    if jsonb_typeof(result) <> 'object' then return result; end if;
    return result || jsonb_build_object('myFood',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'area_id',f.area_id) order by f.name),'[]'::jsonb)
      from neighborhood.food_listings f where f.owner_id = actor and f.hidden_at is null));
  elsif op = 'guide' then
    result := neighborhood.dispatch10(op,d);
    return result || jsonb_build_object('food',(select coalesce(jsonb_agg(neighborhood.food_json(f) || jsonb_build_object('mine',coalesce(f.owner_id = actor,false),
        'claim_pending',exists(select 1 from neighborhood.food_claims c where c.listing_id = f.id and c.member_id = actor and c.status = 'pending'))
        order by case f.kind when 'market' then 1 when 'stand' then 2 when 'csa' then 3 when 'farm' then 4 else 5 end,f.name),'[]'::jsonb)
      from neighborhood.food_listings f where f.area_id = result->'area'->>'id' and f.hidden_at is null));
  elsif op = 'admin' then
    result := neighborhood.dispatch10(op,d);
    return result || jsonb_build_object('foodClaims',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'listing',f.name,'listing_id',f.id,
        'kind',f.kind,'area',coalesce((select a.name from neighborhood.areas a where a.id = f.area_id),f.city),'note',c.note,'created_at',c.created_at,
        'name',m.name,'email',u.email,'owned',f.owner_id is not null) order by c.created_at),'[]'::jsonb)
      from neighborhood.food_claims c join neighborhood.food_listings f on f.id = c.listing_id join auth.users u on u.id = c.member_id
      left join neighborhood.members m on m.id = c.member_id where c.status = 'pending'));
  end if;

  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  if not exists(select 1 from neighborhood.members m where m.id = actor) then
    raise exception 'Choose your neighborhood first.' using errcode = '42501';
  end if;
  item := nullif(d->>'id','')::uuid;

  if op = 'claim_food' then
    select * into chosen from neighborhood.food_listings f where f.id = item and f.hidden_at is null;
    if chosen.id is null then raise exception 'Listing unavailable.'; end if;
    if chosen.owner_id = actor then raise exception 'This listing is already yours.'; end if;
    if chosen.owner_id is not null then raise exception 'Someone already manages this listing. If that’s wrong, tell us from the Account page.'; end if;
    if char_length(btrim(coalesce(d->>'note',''))) < 10 then
      raise exception 'Tell us how you’re connected to %, for example your role and a phone number or website we can check.',chosen.name;
    end if;
    if (select count(*) from neighborhood.food_claims c where c.member_id = actor and c.created_at > now() - interval '1 day') >= 5 then
      raise exception 'You’ve sent several claims today. Try again tomorrow.';
    end if;
    begin
      insert into neighborhood.food_claims(listing_id,member_id,note) values(item,actor,left(btrim(d->>'note'),600)) returning id into item;
    exception when unique_violation then
      raise exception 'Your claim for % is already waiting for review.',chosen.name;
    end;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,chosen.id,jsonb_build_object('claim',item));
    return jsonb_build_object('id',item,'ok',true);
  end if;

  if op = 'decide_food_claim' then
    if not is_admin then raise exception 'Only admins can review claims.' using errcode = '42501'; end if;
    select * into claim from neighborhood.food_claims c where c.id = item and c.status = 'pending' for update;
    if claim.id is null then raise exception 'That claim was already reviewed.'; end if;
    if coalesce((d->>'approve')::boolean,false) then
      update neighborhood.food_listings set owner_id = claim.member_id,claimed_at = now(),updated_by = actor,updated_at = now()
        where id = claim.listing_id and owner_id is null;
      if not found then raise exception 'Someone already manages this listing. Decline this claim, or release the listing first.'; end if;
      update neighborhood.food_claims set status = 'approved',decided_by = actor,decided_at = now() where id = claim.id;
      -- Other people's claims on the same listing are closed.
      update neighborhood.food_claims set status = 'declined',decided_by = actor,decided_at = now()
        where listing_id = claim.listing_id and status = 'pending';
    else
      update neighborhood.food_claims set status = 'declined',decided_by = actor,decided_at = now() where id = claim.id;
    end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,claim.listing_id,jsonb_build_object('claim',claim.id,'approve',d->'approve'));
    return jsonb_build_object('id',claim.id,'ok',true);
  end if;

  -- save_food: the listing's owner, or an admin, keeps it up to date.
  select * into chosen from neighborhood.food_listings f where f.id = item and f.hidden_at is null for update;
  if chosen.id is null then raise exception 'Listing unavailable.'; end if;
  if chosen.owner_id is distinct from actor and not is_admin then
    raise exception 'Only the grower who manages this listing can change it. Claim it first.' using errcode = '42501';
  end if;
  clean := jsonb_build_object('detail',btrim(coalesce(d->>'detail','')),'schedule',nullif(btrim(coalesce(d->>'schedule','')),''),
    'season',nullif(btrim(coalesce(d->>'season','')),''),'url',nullif(btrim(coalesce(d->>'url','')),''),
    'phone',nullif(btrim(coalesce(d->>'phone','')),''),'fresh_now',nullif(btrim(coalesce(d->>'fresh_now','')),''));
  if clean->>'url' is not null and clean->>'url' !~ '^https://' then raise exception 'Links must start with https://'; end if;
  if clean->>'phone' is not null and clean->>'phone' !~ '^[0-9()+ .-]{7,20}$' then raise exception 'Enter a phone number like (216) 555-0123.'; end if;
  if char_length(clean->>'detail') > 900 then raise exception 'Keep the description under 900 characters.'; end if;
  if char_length(coalesce(clean->>'fresh_now','')) > 280 then raise exception 'Keep “Fresh now” under 280 characters.'; end if;
  update neighborhood.food_listings set detail = clean->>'detail',schedule = left(clean->>'schedule',300),season = left(clean->>'season',160),
    url = clean->>'url',phone = clean->>'phone',fresh_now = clean->>'fresh_now',
    snap = coalesce((d->>'snap')::boolean,snap),perks = coalesce((d->>'perks')::boolean,perks),updated_by = actor,updated_at = now()
    where id = item;
  insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,d - 'id');
  return jsonb_build_object('id',item,'ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch11(text,jsonb),neighborhood.dispatch10(text,jsonb),neighborhood.food_json(neighborhood.food_listings),
  neighborhood.public_food(jsonb),public.neighborhood_public_food(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch11(text,jsonb) to authenticated;
grant execute on function neighborhood.public_food(jsonb),public.neighborhood_public_food(jsonb) to anon, authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch11(op,d) end
$$;
commit;
