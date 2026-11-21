begin;

-- Neighborhood Guide: the lasting, practical information about a neighborhood (council ward, police district,
-- libraries, rec centers, parks, food help, development groups). It sits beside the feed so resource listings
-- never crowd out neighbors' posts. Every item names its source. Admins can correct, add or hide items.
create table neighborhood.guide_items (
  id uuid primary key default gen_random_uuid(),
  area_id text not null references neighborhood.areas,
  section text not null check (section in ('civic','places','help','groups')),
  kind text not null check (kind ~ '^[a-z]{2,20}$'),
  name text not null check (char_length(name) between 2 and 160),
  detail text not null default '' check (char_length(detail) <= 700),
  address text check (address is null or char_length(address) between 3 and 160),
  phone text check (phone is null or phone ~ '^[0-9()+ .-]{7,20}$'),
  url text check (url is null or (url ~ '^https://' and char_length(url) <= 300)),
  source text not null default '' check (char_length(source) <= 160),
  sort integer not null default 100,
  hidden_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index guide_items_area on neighborhood.guide_items(area_id,section,sort) where hidden_at is null;
alter table neighborhood.guide_items enable row level security;

create function neighborhood.dispatch9(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  area text;
  item uuid;
  result jsonb;
  clean jsonb;
begin
  if op not in ('bootstrap','guide','save_guide_item','hide_guide_item') then
    return neighborhood.dispatch8(op,d);
  end if;
  is_admin := exists(select 1 from neighborhood.staff s where s.user_id = actor and s.role = 'admin');
  if op = 'bootstrap' then
    result := neighborhood.dispatch8(op,d);
    if jsonb_typeof(result) <> 'object' then return result; end if;
    return result || jsonb_build_object('canEditGuide',is_admin);
  end if;

  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  if not exists(select 1 from neighborhood.members m where m.id = actor) then
    raise exception 'Choose your neighborhood first.' using errcode = '42501';
  end if;

  if op = 'guide' then
    area := coalesce(nullif(d->>'area',''),(select m.area_id from neighborhood.members m where m.id = actor));
    if not exists(select 1 from neighborhood.areas a where a.id = area) then raise exception 'Neighborhood unavailable.'; end if;
    return (select jsonb_build_object('area',jsonb_build_object('id',a.id,'name',a.name,'region',a.region),
      'items',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'section',g.section,'kind',g.kind,'name',g.name,'detail',g.detail,
          'address',g.address,'phone',g.phone,'url',g.url,'source',g.source,'updated_at',g.updated_at) order by g.section,g.sort,g.name),'[]'::jsonb)
        from neighborhood.guide_items g where g.area_id = a.id and g.hidden_at is null))
      from neighborhood.areas a where a.id = area);
  end if;

  if not is_admin then raise exception 'Only admins can change the neighborhood guide.' using errcode = '42501'; end if;
  item := nullif(d->>'id','')::uuid;
  if op = 'hide_guide_item' then
    update neighborhood.guide_items set hidden_at = now(),updated_by = actor,updated_at = now() where id = item and hidden_at is null;
    if not found then raise exception 'Guide item unavailable.'; end if;
  else
    clean := jsonb_build_object('name',btrim(coalesce(d->>'name','')),'detail',btrim(coalesce(d->>'detail','')),
      'address',nullif(btrim(coalesce(d->>'address','')),''),'phone',nullif(btrim(coalesce(d->>'phone','')),''),
      'url',nullif(btrim(coalesce(d->>'url','')),''),'source',btrim(coalesce(d->>'source','')));
    if char_length(clean->>'name') < 2 then raise exception 'Give the listing a name.'; end if;
    if clean->>'url' is not null and clean->>'url' !~ '^https://' then raise exception 'Links must start with https://'; end if;
    if clean->>'phone' is not null and clean->>'phone' !~ '^[0-9()+ .-]{7,20}$' then raise exception 'Enter a phone number like (216) 555-0123.'; end if;
    if item is null then
      if coalesce(d->>'section','') not in ('civic','places','help','groups') then raise exception 'Choose a section.'; end if;
      if not exists(select 1 from neighborhood.areas a where a.id = d->>'area') then raise exception 'Choose a neighborhood.'; end if;
      insert into neighborhood.guide_items(area_id,section,kind,name,detail,address,phone,url,source,updated_by)
        values(d->>'area',d->>'section','custom',clean->>'name',clean->>'detail',clean->>'address',clean->>'phone',clean->>'url',
          coalesce(nullif(clean->>'source',''),'Added by Nabora'),actor)
        returning id into item;
    else
      update neighborhood.guide_items set name = clean->>'name',detail = clean->>'detail',address = clean->>'address',phone = clean->>'phone',
        url = clean->>'url',source = case when clean->>'source' = '' then source else clean->>'source' end,updated_by = actor,updated_at = now()
        where id = item and hidden_at is null;
      if not found then raise exception 'Guide item unavailable.'; end if;
    end if;
  end if;
  insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,d - 'id');
  return jsonb_build_object('id',item,'ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch9(text,jsonb),neighborhood.dispatch8(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch9(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch9(op,d) end
$$;
commit;
