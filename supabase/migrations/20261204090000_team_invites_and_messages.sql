begin;

-- Admin tools for running the team and talking with members.
--   * Role invitations: an admin invites a member to be a moderator or admin; the role starts only when the member
--     accepts. Promotions no longer happen instantly. Removing or lowering a role still does, so access can be cut
--     off immediately.
--   * Team messages: an admin can message any member, in any neighborhood, in a normal private conversation. Those
--     messages are labeled "From the Nabora team". A member who blocked the admin stays blocked.
--   * Team questions: an admin asks one member, one neighborhood or everyone a question. Members answer from their
--     feed; answers are collected for admins. Recipients with email notices on get an email.
create table neighborhood.role_invites (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references neighborhood.members on delete cascade,
  role text not null check (role in ('moderator','admin')),
  invited_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  accepted boolean
);
create unique index role_invites_pending on neighborhood.role_invites(member_id) where decided_at is null;

alter table neighborhood.messages add column team boolean not null default false;

create table neighborhood.team_questions (
  id uuid primary key default gen_random_uuid(),
  asked_by uuid references auth.users(id) on delete set null,
  question text not null check (char_length(question) between 10 and 500),
  audience text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create table neighborhood.team_question_recipients (
  question_id uuid not null references neighborhood.team_questions on delete cascade,
  member_id uuid not null references neighborhood.members on delete cascade,
  answer text check (answer is null or char_length(answer) between 1 and 1000),
  answered_at timestamptz,
  primary key (question_id,member_id)
);
create index team_question_recipients_member on neighborhood.team_question_recipients(member_id) where answered_at is null;
alter table neighborhood.role_invites enable row level security;
alter table neighborhood.team_questions enable row level security;
alter table neighborhood.team_question_recipients enable row level security;

alter table neighborhood.outbox drop constraint outbox_kind_check;
alter table neighborhood.outbox add constraint outbox_kind_check
  check (kind in ('reply','message','alert','admitted','invite','digest','reminder','question'));

-- Sends a team message from an admin to a member, creating the conversation if needed.
create function neighborhood.team_message(p_admin uuid,p_member uuid,p_body text) returns uuid
language plpgsql set search_path = '' as $$
declare convo uuid;
begin
  if p_member = p_admin then raise exception 'You can’t message yourself.'; end if;
  if not exists(select 1 from neighborhood.members m where m.id = p_member and not m.sample) then
    raise exception 'Member unavailable.' using errcode = '42501';
  end if;
  if exists(select 1 from neighborhood.blocks b where b.owner_id = p_member and b.blocked_id = p_admin) then
    raise exception 'This member has blocked messages from you.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 1800 then raise exception 'Write a message of up to 1,800 characters.'; end if;
  insert into neighborhood.threads(member_a,member_b) values(least(p_admin,p_member),greatest(p_admin,p_member))
    on conflict (member_a,member_b) do update set updated_at = now() returning id into convo;
  insert into neighborhood.messages(thread_id,sender_id,body,team) values(convo,p_admin,btrim(p_body),true);
  return convo;
end
$$;

create function neighborhood.dispatch17(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  result jsonb;
  item uuid := nullif(d->>'id','')::uuid;
  inv neighborhood.role_invites%rowtype;
  member_role text;
  q neighborhood.team_questions%rowtype;
  convo uuid;
  label text;
  sent integer;
  admin_name text;
begin
  if op not in ('bootstrap','admin','thread','set_role','invite_role','answer_role','cancel_role_invite',
      'team_message','ask_question','team_questions','team_question','close_question','answer_question') then
    return neighborhood.dispatch16(op,d);
  end if;
  is_admin := exists(select 1 from neighborhood.staff s where s.user_id = actor and s.role = 'admin');

  if op = 'bootstrap' then
    result := neighborhood.dispatch16(op,d);
    if jsonb_typeof(result) <> 'object' or actor is null then return result; end if;
    return result || jsonb_build_object(
      'roleInvite',(select jsonb_build_object('id',i.id,'role',i.role,'note',i.note,'from',(select m.name from neighborhood.members m where m.id = i.invited_by))
        from neighborhood.role_invites i where i.member_id = actor and i.decided_at is null),
      'teamQuestions',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'question',t.question,'asked_at',t.created_at) order by t.created_at),'[]'::jsonb)
        from neighborhood.team_question_recipients r join neighborhood.team_questions t on t.id = r.question_id
        where r.member_id = actor and r.answered_at is null and t.closed_at is null));
  elsif op = 'thread' then
    result := neighborhood.dispatch16(op,d);
    if jsonb_typeof(result->'messages') <> 'array' then return result; end if;
    return result || jsonb_build_object('messages',(select coalesce(jsonb_agg(e.value || jsonb_build_object('team',coalesce(m.team,false)) order by e.ordinality),'[]'::jsonb)
      from jsonb_array_elements(result->'messages') with ordinality e left join neighborhood.messages m on m.id = (e.value->>'id')::uuid));
  elsif op = 'answer_role' then
    -- Only the invitee can answer, and only while the admin who sent it is still an admin.
    select * into inv from neighborhood.role_invites i where i.id = item and i.member_id = actor and i.decided_at is null
      and exists(select 1 from neighborhood.staff s where s.user_id = i.invited_by and s.role = 'admin') for update;
    if not found then raise exception 'This invitation is no longer open.' using errcode = '42501'; end if;
    update neighborhood.role_invites set decided_at = now(),accepted = (d->>'accept')::boolean is true where id = inv.id;
    if (d->>'accept')::boolean is true then
      insert into neighborhood.staff(user_id,role) values(actor,inv.role) on conflict(user_id) do update set role = excluded.role
        where neighborhood.staff.role <> 'admin';
    end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,inv.id,jsonb_build_object('role',inv.role,'accepted',(d->>'accept')::boolean is true));
    return jsonb_build_object('ok',true,'accepted',(d->>'accept')::boolean is true,'role',inv.role);
  elsif op = 'answer_question' then
    if char_length(btrim(coalesce(d->>'answer',''))) not between 1 and 1000 then raise exception 'Write an answer of up to 1,000 characters.'; end if;
    update neighborhood.team_question_recipients r set answer = btrim(d->>'answer'),answered_at = now()
      where r.question_id = item and r.member_id = actor and r.answered_at is null
        and exists(select 1 from neighborhood.team_questions t where t.id = r.question_id and t.closed_at is null);
    if not found then raise exception 'This question is closed or already answered.' using errcode = '42501'; end if;
    return jsonb_build_object('ok',true);
  elsif op = 'admin' then
    if not is_admin then raise exception 'Admin access is required.' using errcode = '42501'; end if;
    result := neighborhood.dispatch16(op,d);
    return result || jsonb_build_object(
      'roleInvites',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'member_id',i.member_id,'name',m.name,'role',i.role,'created_at',i.created_at) order by i.created_at desc),'[]'::jsonb)
        from neighborhood.role_invites i join neighborhood.members m on m.id = i.member_id where i.decided_at is null),
      'questions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
        select t.id,t.question,t.audience,t.created_at,t.closed_at,
          (select count(*) from neighborhood.team_question_recipients r where r.question_id = t.id) recipients,
          (select count(*) from neighborhood.team_question_recipients r where r.question_id = t.id and r.answered_at is not null) answers
        from neighborhood.team_questions t order by t.created_at desc limit 30) x));
  end if;

  -- Everything below is for admins only.
  if not is_admin then raise exception 'Admin access is required.' using errcode = '42501'; end if;

  if op = 'set_role' then
    -- Promotions need the member's consent through an invitation; removing or lowering a role takes effect at once.
    select s.role into member_role from neighborhood.staff s where s.user_id = item;
    if nullif(d->>'role','') is not null and (member_role is null or (member_role = 'moderator' and d->>'role' = 'admin')) then
      raise exception 'Send an invitation instead. They become a moderator or admin when they accept.';
    end if;
    result := neighborhood.dispatch16(op,d);
    -- Removing or lowering a role also withdraws any invitation they haven't answered yet.
    update neighborhood.role_invites set decided_at = now(),accepted = false where member_id = item and decided_at is null;
    return result;
  elsif op = 'invite_role' then
    perform neighborhood.limit_action(actor,op,30);
    if coalesce(d->>'role','') not in ('moderator','admin') then raise exception 'Choose moderator or admin.'; end if;
    if item = actor then raise exception 'You can’t invite yourself.'; end if;
    if not exists(select 1 from neighborhood.members m where m.id = item and not m.sample) then raise exception 'Member unavailable.' using errcode = '42501'; end if;
    select s.role into member_role from neighborhood.staff s where s.user_id = item;
    if member_role = d->>'role' or member_role = 'admin' then raise exception 'They already have that role or a higher one.'; end if;
    update neighborhood.role_invites set decided_at = now(),accepted = false where member_id = item and decided_at is null;
    insert into neighborhood.role_invites(member_id,role,invited_by,note) values(item,d->>'role',actor,nullif(left(btrim(coalesce(d->>'note','')),300),''))
      returning * into inv;
    select m.name into admin_name from neighborhood.members m where m.id = actor;
    label := case when inv.role = 'admin' then 'an admin' else 'a moderator' end;
    perform neighborhood.team_message(actor,item,coalesce(admin_name,'The Nabora team')||' invited you to be '||label||' on Nabora.'||
      coalesce(' “'||inv.note||'”','')||' Open your Account page to accept or decline.');
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,jsonb_build_object('role',inv.role));
    return jsonb_build_object('id',inv.id,'ok',true);
  elsif op = 'cancel_role_invite' then
    update neighborhood.role_invites set decided_at = now(),accepted = false where id = item and decided_at is null;
    if not found then raise exception 'Invitation unavailable.' using errcode = '42501'; end if;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,'{}'::jsonb);
    return jsonb_build_object('ok',true);
  elsif op = 'team_message' then
    perform neighborhood.limit_action(actor,op,120);
    convo := neighborhood.team_message(actor,item,d->>'body');
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,item,'{}'::jsonb);
    return jsonb_build_object('id',convo,'ok',true);
  elsif op = 'ask_question' then
    perform neighborhood.limit_action(actor,op,5);
    if char_length(btrim(coalesce(d->>'question',''))) not between 10 and 500 then raise exception 'Write a question between 10 and 500 characters.'; end if;
    if coalesce(d->>'audience','') not in ('all','area','member') then raise exception 'Choose who to ask.'; end if;
    if d->>'audience' = 'area' and not exists(select 1 from neighborhood.areas a where a.id = d->>'area') then raise exception 'Choose a neighborhood.'; end if;
    if d->>'audience' = 'member' and not exists(select 1 from neighborhood.members m where m.id = nullif(d->>'member','')::uuid and not m.sample) then
      raise exception 'Choose a member.';
    end if;
    insert into neighborhood.team_questions(asked_by,question,audience)
      values(actor,btrim(d->>'question'),case d->>'audience' when 'all' then 'Everyone'
        when 'area' then (select a.name from neighborhood.areas a where a.id = d->>'area')
        else (select m.name from neighborhood.members m where m.id = (d->>'member')::uuid) end)
      returning * into q;
    insert into neighborhood.team_question_recipients(question_id,member_id)
      select q.id,m.id from neighborhood.members m
      where not m.sample and m.id <> actor
        and (d->>'audience' = 'all' or (d->>'audience' = 'area' and m.area_id = d->>'area') or (d->>'audience' = 'member' and m.id = (d->>'member')::uuid))
      limit 5000;
    get diagnostics sent = row_count;
    insert into neighborhood.outbox(to_user,kind,payload)
      select r.member_id,'question',jsonb_build_object('question',q.question)
      from neighborhood.team_question_recipients r join neighborhood.members m on m.id = r.member_id
      where r.question_id = q.id and m.email_notices;
    insert into neighborhood.audit(actor,action,subject,details) values(actor,op,q.id,jsonb_build_object('audience',q.audience,'recipients',sent));
    return jsonb_build_object('id',q.id,'recipients',sent,'ok',true);
  elsif op = 'team_questions' then
    return jsonb_build_object('questions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
      select t.id,t.question,t.audience,t.created_at,t.closed_at,
        (select count(*) from neighborhood.team_question_recipients r where r.question_id = t.id) recipients,
        (select count(*) from neighborhood.team_question_recipients r where r.question_id = t.id and r.answered_at is not null) answers
      from neighborhood.team_questions t order by t.created_at desc limit 100) x));
  elsif op = 'team_question' then
    select * into q from neighborhood.team_questions t where t.id = item;
    if not found then raise exception 'Question unavailable.' using errcode = '42501'; end if;
    return jsonb_build_object('id',q.id,'question',q.question,'audience',q.audience,'created_at',q.created_at,'closed_at',q.closed_at,
      'recipients',(select count(*) from neighborhood.team_question_recipients r where r.question_id = q.id),
      'answers',(select coalesce(jsonb_agg(jsonb_build_object('member_id',r.member_id,'name',m.name,'area',a.name,'answer',r.answer,'answered_at',r.answered_at) order by r.answered_at desc),'[]'::jsonb)
        from neighborhood.team_question_recipients r join neighborhood.members m on m.id = r.member_id join neighborhood.areas a on a.id = m.area_id
        where r.question_id = q.id and r.answered_at is not null));
  end if;
  -- close_question
  update neighborhood.team_questions set closed_at = now() where id = item and closed_at is null;
  if not found then raise exception 'Question unavailable.' using errcode = '42501'; end if;
  return jsonb_build_object('ok',true);
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch17(text,jsonb),neighborhood.dispatch16(text,jsonb),neighborhood.team_message(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch17(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch17(op,d) end
$$;
commit;
