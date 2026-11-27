begin;

-- Member feedback for the Nabora team.
--   * Any member can send feedback from their Account page: a type (bug, idea, a problem with a post or person, other)
--     and a message. It is always signed. The app adds the page they were on and a short device description, so a bug
--     can be reproduced.
--   * Admins see it in a Feedback section on the admin page, can mark it handled and reply privately as the team.
--   * Each admin with email notices on gets an email the moment feedback arrives.
create table neighborhood.feedback (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references neighborhood.members on delete cascade,
  kind text not null check (kind in ('bug','idea','problem','other')),
  body text not null check (char_length(body) between 10 and 2000),
  page text check (page is null or char_length(page) <= 200),
  device text check (device is null or char_length(device) <= 120),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create index feedback_open on neighborhood.feedback(created_at desc) where resolved_at is null;
alter table neighborhood.feedback enable row level security;

alter table neighborhood.outbox drop constraint outbox_kind_check;
alter table neighborhood.outbox add constraint outbox_kind_check
  check (kind in ('reply','message','alert','admitted','invite','digest','reminder','question','feedback'));

create function neighborhood.dispatch19(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  me neighborhood.members%rowtype;
  result jsonb;
  item uuid := nullif(d->>'id','')::uuid;
  fb neighborhood.feedback%rowtype;
  label text;
begin
  if op not in ('admin','send_feedback','feedback','resolve_feedback') then
    return neighborhood.dispatch18(op,d);
  end if;

  if op = 'send_feedback' then
    select * into me from neighborhood.members m where m.id = actor;
    if me.id is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
    perform neighborhood.limit_action(actor,op,5);
    if coalesce(d->>'kind','') not in ('bug','idea','problem','other') then raise exception 'Choose what your feedback is about.'; end if;
    if char_length(btrim(coalesce(d->>'body',''))) not between 10 and 2000 then
      raise exception 'Write between 10 and 2,000 characters.';
    end if;
    insert into neighborhood.feedback(member_id,kind,body,page,device)
      values(actor,d->>'kind',btrim(d->>'body'),nullif(left(btrim(coalesce(d->>'page','')),200),''),nullif(left(btrim(coalesce(d->>'device','')),120),''))
      returning * into fb;
    label := case fb.kind when 'bug' then 'Bug' when 'idea' then 'Idea' when 'problem' then 'Problem with a post or person' else 'Other' end;
    insert into neighborhood.outbox(to_user,kind,payload)
      select s.user_id,'feedback',jsonb_build_object('id',fb.id,'kind',label,'from',me.name,
        'area',(select a.name from neighborhood.areas a where a.id = me.area_id),'body',fb.body)
      from neighborhood.staff s join neighborhood.members m on m.id = s.user_id
      where s.role = 'admin' and m.email_notices and s.user_id <> actor;
    return jsonb_build_object('id',fb.id,'ok',true);
  end if;

  -- Everything below is for admins only.
  if not exists(select 1 from neighborhood.staff s where s.user_id = actor and s.role = 'admin') then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  if op = 'admin' then
    result := neighborhood.dispatch18(op,d);
    return result || jsonb_build_object('feedbackOpen',(select count(*) from neighborhood.feedback f where f.resolved_at is null));
  elsif op = 'feedback' then
    return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.open desc,x.created_at desc),'[]'::jsonb) from (
      select f.id,f.kind,f.body,f.page,f.device,f.created_at,f.resolved_at,f.resolved_at is null open,
        f.member_id,m.name,a.name area,(select r.name from neighborhood.members r where r.id = f.resolved_by) resolved_by
      from neighborhood.feedback f join neighborhood.members m on m.id = f.member_id join neighborhood.areas a on a.id = m.area_id
      order by f.resolved_at is null desc,f.created_at desc limit 200) x));
  end if;

  -- resolve_feedback: mark handled, or reopen with "open": true.
  update neighborhood.feedback f set resolved_at = case when (d->>'open')::boolean is true then null else now() end,
    resolved_by = case when (d->>'open')::boolean is true then null else actor end
    where f.id = item;
  if not found then raise exception 'Feedback unavailable.' using errcode = '42501'; end if;
  insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('open',(d->>'open')::boolean is true));
  return jsonb_build_object('ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch19(text,jsonb),neighborhood.dispatch18(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch19(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch19(op,d) end
$$;
commit;
