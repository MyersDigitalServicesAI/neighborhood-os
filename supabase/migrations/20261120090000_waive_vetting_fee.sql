begin;

-- Admins can waive the one-time $250 vetting fee, for example for founding businesses or community partners.
-- A waiver stands in for the payment only: the business still needs a human vetting approval from staff who
-- don't own it before the badge shows. Every waiver is audited with its reason.
alter table neighborhood.billing add column waived_by uuid references auth.users(id) on delete set null,
  add column waive_reason text check (waive_reason is null or char_length(waive_reason) between 8 and 300);

create function neighborhood.dispatch6(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  role_name text;
  item uuid;
  reason text;
  result jsonb;
begin
  if op not in ('admin','waive_fee','my_businesses') then
    return neighborhood.dispatch5(op,d);
  end if;
  result := case when op = 'waive_fee' then null else neighborhood.dispatch5(op,d) end;
  select s.role into role_name from neighborhood.staff s where s.user_id = actor;

  if op = 'my_businesses' then
    return (select coalesce(jsonb_agg(e || jsonb_build_object('waived',exists(
      select 1 from neighborhood.billing l where l.business_id = (e->>'id')::uuid and l.waived_by is not null and l.paid_at is not null))),'[]'::jsonb)
      from jsonb_array_elements(result) e);
  elsif op = 'admin' then
    return result || jsonb_build_object('fees',(select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc),'[]'::jsonb) from (
      select b.id,b.name,m.name owner,v.status,v.updated_at,l.paid_at is not null paid,l.waived_by is not null waived,b.owner_id = actor mine
      from neighborhood.vetting v join neighborhood.businesses b on b.id = v.business_id join neighborhood.members m on m.id = b.owner_id
      left join neighborhood.billing l on l.business_id = b.id
      where v.status in ('pending','approved') order by v.updated_at desc limit 50) x));
  end if;

  -- waive_fee
  if actor is null or role_name is distinct from 'admin' then raise exception 'Admin access required.' using errcode = '42501'; end if;
  item := nullif(d->>'id','')::uuid;
  reason := btrim(coalesce(d->>'reason',''));
  if char_length(reason) < 8 then raise exception 'Give a reason of at least 8 characters. It is kept in the audit log.'; end if;
  if not exists(select 1 from neighborhood.vetting v where v.business_id = item and v.status in ('pending','approved')) then
    raise exception 'The business must apply for vetting first.';
  end if;
  insert into neighborhood.billing(business_id,paid_at,active,payment_ref,waived_by,waive_reason,observed_at)
    values(item,now(),true,'waived',actor,left(reason,300),now())
    on conflict(business_id) do update set paid_at = now(),active = true,payment_ref = 'waived',checkout_key = null,
      waived_by = actor,waive_reason = left(reason,300),observed_at = now()
    where neighborhood.billing.paid_at is null;
  if not found then raise exception 'The fee for this business is already paid or waived.'; end if;
  insert into neighborhood.audit(actor,action,subject,details) values(actor,'vetting_fee_waived',item,
    jsonb_build_object('reason',left(reason,300),'own',exists(select 1 from neighborhood.businesses b where b.id = item and b.owner_id = actor)));
  perform neighborhood.notify(z.owner_id,actor,'payment',null,null,z.id) from neighborhood.businesses z where z.id = item;
  return jsonb_build_object('id',item,'ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch6(text,jsonb),neighborhood.dispatch5(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch6(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch6(op,d) end
$$;
commit;
