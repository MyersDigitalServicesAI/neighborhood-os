import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';
import { compose } from '../server/mail.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);

before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

test('a member becomes a moderator only after accepting an invitation; removing a role is immediate',async()=>{
  await assert.rejects(call('ava','invite_role',{ id:actors.jamal,role:'moderator' }),/Admin access/);
  await assert.rejects(call('rina','set_role',{ id:actors.ava,role:'moderator' }),/Send an invitation/);
  await assert.rejects(call('rina','invite_role',{ id:actors.rina,role:'admin' }),/yourself/);
  await call('rina','invite_role',{ id:actors.ava,role:'moderator',note:'You already help everyone on Pearl Road.' });
  const invite = (await call('ava','bootstrap')).roleInvite;
  assert.equal(invite.role,'moderator');
  assert.equal(invite.from,'Rina P.');
  assert.equal((await call('ava','bootstrap')).staff,null,'no role before accepting');
  assert.equal((await call('rina','admin')).roleInvites[0].name,'Ava M.');

  // The invitation also arrives as a labeled message from the team.
  const thread = (await db.query('select t.id from neighborhood.threads t where $1 in (t.member_a,t.member_b) and $2 in (t.member_a,t.member_b)',[actors.ava,actors.rina])).rows[0];
  const convo = await call('ava','thread',{ id:thread.id });
  assert.equal(convo.messages.at(-1).team,true);
  assert.match(convo.messages.at(-1).body,/invited you to be a moderator/);

  await assert.rejects(call('jamal','answer_role',{ id:invite.id,accept:true }),/no longer open/,'only the invitee can accept');
  await call('ava','answer_role',{ id:invite.id,accept:true });
  assert.equal((await call('ava','bootstrap')).staff,'moderator');
  assert.equal((await call('ava','bootstrap')).roleInvite,null);
  await assert.rejects(call('ava','answer_role',{ id:invite.id,accept:true }),/no longer open/);

  await call('rina','invite_role',{ id:actors.jamal,role:'admin' });
  await call('jamal','answer_role',{ id:(await call('jamal','bootstrap')).roleInvite.id,accept:false });
  assert.equal((await call('jamal','bootstrap')).staff,null,'declining leaves them a member');

  await call('rina','set_role',{ id:actors.ava,role:'' });
  assert.equal((await call('ava','bootstrap')).staff,null,'removal is immediate');
  const audit = (await db.query("select action from neighborhood.audit where action in ('invite_role','answer_role')")).rows;
  assert.ok(audit.length >= 4);
});

test('admins message any member as the Nabora team, in any neighborhood, unless the member blocked them',async()=>{
  await assert.rejects(call('ava','team_message',{ id:actors.taylor,body:'Hi' }),/Admin access/);
  // Taylor lives in Parma, outside Rina's neighborhood, and has never talked to Rina.
  const { id } = await call('rina','team_message',{ id:actors.taylor,body:'Hi Taylor, what would make Nabora more useful for Parma?' });
  const thread = await call('taylor','thread',{ id });
  assert.equal(thread.messages[0].team,true);
  assert.equal(thread.peer,'Rina P.');
  await call('taylor','message',{ id,body:'More events near Ridge Road!' });
  assert.equal((await call('rina','thread',{ id })).messages.at(-1).team,false,'replies are ordinary messages');
  const notified = (await db.query("select count(*)::int n from neighborhood.notifications where member_id = $1 and kind = 'message'",[actors.taylor])).rows[0].n;
  assert.ok(notified >= 1);

  await call('taylor','block',{ peer:actors.rina });
  await assert.rejects(call('rina','team_message',{ id:actors.taylor,body:'Following up.' }),/blocked/);
  await assert.rejects(call('rina','team_message',{ id:actors.rina,body:'Note to self' }),/yourself/);
});

test('admins ask one member, a neighborhood or everyone a question and see the answers collected',async()=>{
  await assert.rejects(call('ava','ask_question',{ audience:'all',question:'What should we build next?' }),/Admin access/);
  await assert.rejects(call('rina','ask_question',{ audience:'all',question:'Hm?' }),/between 10 and 500/);
  const everyone = await call('rina','ask_question',{ audience:'all',question:'What would make you post on Nabora more often?' });
  assert.ok(everyone.recipients >= 4);
  const area = await call('rina','ask_question',{ audience:'area',area:'old-brooklyn',question:'Should we host a meetup at the library?' });
  const one = await call('rina','ask_question',{ audience:'member',member:actors.jamal,question:'Could you help moderate Old Brooklyn?' });
  assert.equal(one.recipients,1);

  const jamal = (await call('jamal','bootstrap')).teamQuestions;
  assert.deepEqual(jamal.map((q)=>q.question),['What would make you post on Nabora more often?','Should we host a meetup at the library?','Could you help moderate Old Brooklyn?']);
  assert.ok(!(await call('rina','bootstrap')).teamQuestions.length,'the asker isn’t asked');
  await call('jamal','answer_question',{ id:everyone.id,answer:'Seeing my neighbors reply quickly.' });
  await assert.rejects(call('jamal','answer_question',{ id:everyone.id,answer:'Again' }),/already answered/);
  await assert.rejects(call('jamal','answer_question',{ id:everyone.id,answer:'' }),/up to 1,000/);
  assert.equal((await call('jamal','bootstrap')).teamQuestions.length,2);

  const detail = await call('rina','team_question',{ id:everyone.id });
  assert.equal(detail.answers.length,1);
  assert.equal(detail.answers[0].name,'Jamal R.');
  assert.equal(detail.answers[0].area,'Old Brooklyn');
  assert.equal((await call('rina','admin')).questions.find((q)=>q.id===everyone.id).answers,1);
  await assert.rejects(call('ava','team_question',{ id:everyone.id }),/Admin access/,'answers are for admins only');

  await call('rina','close_question',{ id:area.id });
  await assert.rejects(call('ava','answer_question',{ id:area.id,answer:'Yes please' }),/closed/);
  const emails = (await db.query("select count(*)::int n from neighborhood.outbox where kind = 'question'")).rows[0].n;
  assert.ok(emails >= everyone.recipients,'recipients with email notices on get an email');
  const message = compose({ kind:'question',payload:{ question:'What would make you post more?' } },'https://nabora.us');
  assert.equal(message.subject,'The Nabora team has a question for you');
  assert.match(message.text,/https:\/\/nabora.us\/#feed/);
});
