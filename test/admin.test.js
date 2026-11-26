import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors, mail } from './db.js';
import { compose, deliver } from '../server/mail.js';

let db;
const extra = '00000000-0000-4000-a000-000000000009';
const late = '00000000-0000-4000-a000-000000000010';
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const outbox = async () => (await db.query('select to_user,to_email,kind,payload,sent_at from neighborhood.outbox order by created_at')).rows;
before(async()=>{
  db = await initDatabase();
  await fixtures(db);
  await db.query('update neighborhood.launch_settings set public_enrollment = false');
  await db.query("insert into auth.users(id,email_confirmed_at,email) values($1,now(),'extra@neighborhood.test'),($2,now(),'late@neighborhood.test')",[extra,late]);
});
after(async()=>{ await db?.close(); });

test('only admins see the admin page, admit people and manage roles',async()=>{
  await assert.rejects(call('ava','admin'),/Admin access/);
  await assert.rejects(call('devon','admin'),/Admin access/,'moderators are not admins');
  const page = await call('rina','admin');
  assert.deepEqual(page.pending.map((p)=>p.email).sort(),['extra@neighborhood.test','late@neighborhood.test','new@neighborhood.test','unconfirmed@neighborhood.test']);
  assert.equal(page.team.find((m)=>m.me).role,'admin');
  assert.equal((await call(extra,'bootstrap')).canJoin,false);
  await assert.rejects(call(extra,'join',{name:'Extra E.',attest:true,area:'tremont'}),/Pilot access/);
  await call('rina','admit',{id:extra});
  assert.equal((await call(extra,'bootstrap')).canJoin,true);
  await call(extra,'join',{name:'Extra E.',attest:true,area:'tremont'});
  assert.deepEqual((await outbox()).filter((o)=>o.kind!=='alert').map((o)=>[o.to_user,o.kind]),[[extra,'admitted']]);
  assert.equal((await outbox()).filter((o)=>o.kind==='alert').length,4,'the fixture safety alert queued one email per other Old Brooklyn neighbor');
  await assert.rejects(call('rina','set_role',{id:actors.rina,role:''}),/own role/);
  // Promotions are invitations the member accepts.
  await assert.rejects(call('rina','set_role',{id:actors.devon,role:'admin'}),/Send an invitation/);
  await call('rina','invite_role',{id:actors.devon,role:'admin'});
  await call('devon','answer_role',{id:(await call('devon','bootstrap')).roleInvite.id,accept:true});
  assert.equal((await call('devon','admin')).members > 0,true);
  await call('devon','invite_role',{id:actors.jamal,role:'moderator'});
  await call('jamal','answer_role',{id:(await call('jamal','bootstrap')).roleInvite.id,accept:true});
  assert.equal((await call('jamal','bootstrap')).staff,'moderator');
  await call('rina','set_role',{id:actors.jamal,role:''});
  assert.equal((await call('jamal','bootstrap')).staff,null);
});

test('an invite link admits up to its limit and can be revoked',async()=>{
  await assert.rejects(call('ava','create_invite',{uses:1}),/Admin access/);
  const invite = await call('rina','create_invite',{note:'Pearl Road block club',email:'Friend@Example.com',area:'old-brooklyn',uses:1,days:7});
  assert.match(invite.code,/^[A-Z0-9]{10}$/);
  assert.equal(invite.emailed,true);
  const sent = (await outbox()).find((o)=>o.kind==='invite');
  assert.deepEqual([sent.to_email,sent.payload.code,sent.payload.area],['friend@example.com',invite.code,'Old Brooklyn']);
  assert.deepEqual(await call('new','invite_info',{invite:invite.code.toLowerCase()}),{valid:true,area:'old-brooklyn'});
  await call('new','join',{name:'Nia N.',attest:true,area:'old-brooklyn',invite:invite.code});
  assert.equal((await call('new','bootstrap')).member.name,'Nia N.');
  assert.equal((await call('new','invite_info',{invite:invite.code})).valid,false);
  await assert.rejects(call(late,'join',{name:'Late L.',attest:true,area:'parma',invite:invite.code}),/expired or been used up/);
  const second = await call('rina','create_invite',{uses:5});
  await call('rina','revoke_invite',{id:second.id});
  await assert.rejects(call(late,'join',{name:'Late L.',attest:true,area:'parma',invite:second.code}),/expired or been used up/);
  await assert.rejects(call(late,'join',{name:'Late L.',attest:true,area:'parma',invite:'NOTACODE00'}),/expired or been used up/);
  const listed = (await call('rina','admin')).invites;
  assert.deepEqual(listed.map((i)=>[i.uses,i.max_uses,!!i.revoked_at]),[[0,5,true],[1,1,false]]);
});

test('replies, messages and alerts queue at most one email per conversation and respect the off switch',async()=>{
  await db.query('delete from neighborhood.outbox');
  const post = await call('ava','create_post',{kind:'discussion',title:'Leaf pickup dates',body:'Anyone know when the city comes by?'});
  await call('jamal','reply',{id:post.id,body:'I think the second week of the month.'});
  await call('luis','reply',{id:post.id,body:'Same here.'});
  const queued = (await outbox()).filter((o)=>o.to_user===actors.ava);
  assert.deepEqual(queued.map((o)=>[o.kind,o.payload.title,o.payload.actor]),[['reply','Leaf pickup dates','Jamal R.']]);
  await call('jamal','message',{peer:actors.ava,body:'Private note with details.'});
  const note = (await outbox()).find((o)=>o.kind==='message');
  assert.equal(JSON.stringify(note.payload).includes('Private note'),false,'message text never goes into the email queue');
  await call('luis','set_email_notices',{on:false});
  assert.equal((await call('luis','bootstrap')).emailNotices,false);
  await call('jamal','message',{peer:actors.luis,body:'Hello Luis.'});
  assert.equal((await outbox()).some((o)=>o.to_user===actors.luis),false);
  assert.equal((await call('ava','bootstrap')).email,'ava@neighborhood.test');
});

test('only the server can drain the email queue, and a sent email is not sent twice',async()=>{
  await assert.rejects(db.transaction(async(tx)=>{ await tx.exec('set local role authenticated'); await tx.query("select public.neighborhood_mail('{\"op\":\"claim\"}')"); }),/permission denied/);
  const database = { mail:(d)=>mail(db,d) };
  const delivered = [];
  const mailer = { enabled:true, async send(item) { delivered.push(item); return item.kind !== 'message'; } };
  const first = await deliver(database,mailer);
  assert.ok(first.sent >= 1 && first.failed === 1,JSON.stringify(first));
  assert.ok(delivered.every((item)=>item.email.endsWith('@neighborhood.test') || item.email === 'friend@example.com'));
  delivered.length = 0;
  await db.query("update neighborhood.outbox set claimed_at = now() - interval '11 minutes' where sent_at is null");
  const second = await deliver(database,mailer);
  assert.deepEqual([second.sent,second.failed,delivered.map((d)=>d.kind)],[0,1,['message']],'only the failed email is retried');
  assert.deepEqual(await deliver(database,{enabled:false}),{sent:0,failed:0});
  const text = compose({kind:'message',name:'Ava M.',payload:{actor:'Jamal R.',thread:'t1'}},'https://example.test');
  assert.match(text.subject,/Jamal R\. sent you a message/);
  assert.match(text.text,/https:\/\/example\.test\/#thread\/t1/);
  assert.match(text.text,/Turn them off under Account/);
  assert.equal(compose({kind:'unknown'},'https://example.test'),null);
});

test('members can delete their own account and everything they posted',async()=>{
  const post = await call('taylor','create_post',{kind:'discussion',title:'Parma porch lights',body:'Leaving mine on for trick or treat.'});
  await assert.rejects(call('taylor','delete_account',{confirm:'delete'}),/Type DELETE/);
  assert.deepEqual(await call('taylor','delete_account',{confirm:'DELETE'}),{deleted:true});
  assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[actors.taylor])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from neighborhood.posts where id=$1',[post.id])).rows[0].n,0);
  await assert.rejects(call('taylor','bootstrap'),/confirmed email/);
  await call('rina','set_role',{id:actors.devon,role:''});
  await assert.rejects(call('rina','delete_account',{confirm:'DELETE'}),/another admin/);
});
