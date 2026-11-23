begin;

-- Printable flyers. Each flyer is an invite link with a QR code, labeled with where it was posted ("South Brooklyn
-- library", "Gypsy Beans"), so the Admin page shows which spot and which neighbor brings people in. Admins can print
-- for any neighborhood; verified neighbors can print for their own. Scanning it lets the new neighbor straight in,
-- preset to that neighborhood, and counts the sign-up against the flyer.
alter table neighborhood.invites add column flyer boolean not null default false;
alter table neighborhood.invites add column place text check (place is null or char_length(place) between 2 and 60);
create index invites_flyers on neighborhood.invites(created_by,created_at desc) where flyer;

create function neighborhood.flyer_json(i neighborhood.invites) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',i.id,'code',i.code,'place',i.place,'area_id',i.area_id,
    'area',(select a.name from neighborhood.areas a where a.id = i.area_id),'uses',i.uses,'max_uses',i.max_uses,
    'expires_at',i.expires_at,'created_at',i.created_at,
    'active',i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses)
$$;

create function neighborhood.dispatch13(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  me neighborhood.members%rowtype;
  is_admin boolean;
  result jsonb;
  inv neighborhood.invites%rowtype;
  target text;
  label text;
begin
  if op not in ('bootstrap','admin','flyers','create_flyer','revoke_flyer') then
    return neighborhood.dispatch12(op,d);
  end if;
  is_admin := exists(select 1 from neighborhood.staff s where s.user_id = actor and s.role = 'admin');
  select * into me from neighborhood.members m where m.id = actor;

  if op = 'bootstrap' then
    result := neighborhood.dispatch12(op,d);
    if jsonb_typeof(result) <> 'object' then return result; end if;
    return result || jsonb_build_object('canFlyer',is_admin or (me.id is not null and me.verified_at is not null and not me.sample));
  elsif op = 'admin' then
    result := neighborhood.dispatch12(op,d);
    -- Flyers get their own list, ranked by sign-ups, so the plain invite list stays short.
    return result || jsonb_build_object('invites',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
        select i.id,i.code,i.note,i.email,i.max_uses,i.uses,i.expires_at,i.revoked_at,i.created_at,ar.name area
        from neighborhood.invites i left join neighborhood.areas ar on ar.id = i.area_id
        where not i.flyer order by i.created_at desc limit 50) x),
      'flyers',(select coalesce(jsonb_agg(neighborhood.flyer_json(i) ||
        jsonb_build_object('by',(select m.name from neighborhood.members m where m.id = i.created_by)) order by i.uses desc,i.created_at desc),'[]'::jsonb)
      from (select * from neighborhood.invites x where x.flyer order by x.uses desc,x.created_at desc limit 100) i));
  end if;

  if me.id is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
  if not is_admin and (me.verified_at is null or me.sample) then
    raise exception 'Verify that you live in your neighborhood to print flyers.' using errcode = '42501';
  end if;

  if op = 'flyers' then
    return jsonb_build_object('flyers',(select coalesce(jsonb_agg(neighborhood.flyer_json(i) order by i.created_at desc),'[]'::jsonb)
      from neighborhood.invites i where i.flyer and i.created_by = actor and i.revoked_at is null));
  elsif op = 'create_flyer' then
    target := coalesce(nullif(d->>'area',''),me.area_id);
    if not is_admin and target <> me.area_id then
      raise exception 'You can print flyers for your own neighborhood.' using errcode = '42501';
    end if;
    if not exists(select 1 from neighborhood.areas a where a.id = target) then raise exception 'Choose a neighborhood.'; end if;
    label := btrim(regexp_replace(coalesce(d->>'place',''),'\s+',' ','g'));
    if char_length(label) < 2 or char_length(label) > 60 then
      raise exception 'Say where this flyer will go, like “South Brooklyn library” (up to 60 characters).';
    end if;
    if not is_admin and (select count(*) from neighborhood.invites i where i.flyer and i.created_by = actor
        and i.revoked_at is null and i.expires_at > now()) >= 5 then
      raise exception 'You have 5 flyers out already. Retire one before making another.';
    end if;
    if not is_admin and (select count(*) from neighborhood.invites i where i.flyer and i.created_by = actor
        and i.created_at > now() - interval '1 day') >= 10 then
      raise exception 'That’s a lot of flyers for one day. Try again tomorrow.';
    end if;
    insert into neighborhood.invites(code,created_by,note,area_id,max_uses,expires_at,flyer,place)
      values(translate(upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text),1,10)),'01','XY'),actor,
        'Flyer · '||left(label,110),target,case when is_admin then 500 else 100 end,now() + interval '180 days',true,label)
      returning * into inv;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,inv.id,jsonb_build_object('area',target,'place',label));
    return neighborhood.flyer_json(inv);
  end if;
  -- revoke_flyer: the person who made it, or an admin.
  update neighborhood.invites i set revoked_at = now() where i.id = nullif(d->>'id','')::uuid and i.flyer and i.revoked_at is null
    and (i.created_by = actor or is_admin);
  if not found then raise exception 'Flyer unavailable.' using errcode = '42501'; end if;
  insert into neighborhood.audit(actor,action,subject,details) values(actor,op,nullif(d->>'id','')::uuid,'{}'::jsonb);
  return jsonb_build_object('ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch13(text,jsonb),neighborhood.dispatch12(text,jsonb),neighborhood.flyer_json(neighborhood.invites)
  from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch13(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch13(op,d) end
$$;
commit;
