import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors, mail } from './db.js';
import { compose } from '../server/mail.js';
import { rosterCsv } from '../web/views.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const stranger = '00000000-0000-4000-a000-0000000000aa';
const pending = '00000000-0000-4000-a000-0000000000ab';

before(async()=>{
  db = await initDatabase(); await fixtures(db);
  // One person let in and confirmed three days ago who never chose a neighborhood, one who never confirmed.
  await db.query("insert into auth.users(id,email,email_confirmed_at,created_at) values($1,'late@neighborhood.test',now() - interval '3 days',now() - interval '3 days'),($2,'unconfirmed@neighborhood.test',null,now() - interval '3 days')",[stranger,pending]);
  await db.query('insert into neighborhood.pilot_access(user_id) values($1),($2)',[stranger,pending]);
});
after(async()=>{ await db?.close(); });

test('only admins see the member roster, with each member’s email, name and neighborhood',async()=>{
  await assert.rejects(call('ava','roster'),/Admins only/);
  await assert.rejects(call('devon','roster'),/Admins only/,'moderators are not admins');
  const { members } = await call('rina','roster');
  const ava = members.find((m)=>m.name==='Ava M.');
  assert.equal(ava.email,'ava@neighborhood.test');
  assert.equal(ava.area,'Old Brooklyn');
  assert.equal(ava.role,null);
  assert.equal(members.find((m)=>m.name==='Rina P.').role,'admin');
  assert.ok(members.every((m)=>m.email && m.name && m.area));
  assert.ok(!members.some((m)=>m.email==='late@neighborhood.test'),'people who haven’t joined aren’t members');
});

test('the admin page splits people who still need to confirm from people who need to choose a neighborhood',async()=>{
  const admin = await call('rina','admin');
  const late = admin.joining.find((j)=>j.email==='late@neighborhood.test');
  const unconfirmed = admin.joining.find((j)=>j.email==='unconfirmed@neighborhood.test');
  assert.equal(late.confirmed,true);
  assert.equal(unconfirmed.confirmed,false);
  assert.equal(late.reminded_at,null);
  await assert.rejects(call('ava','admin'));
});

test('one reminder goes to confirmed people 48 hours after joining stalls, never twice, never to the unconfirmed',async()=>{
  assert.deepEqual(await mail(db,{ op:'remind' }),{ reminders:1 });
  const queued = (await db.query("select to_user from neighborhood.outbox where kind = 'reminder'")).rows.map((r)=>r.to_user);
  assert.deepEqual(queued,[stranger]);
  assert.deepEqual(await mail(db,{ op:'remind' }),{ reminders:0 },'only once');
  assert.ok((await call('rina','admin')).joining.find((j)=>j.email==='late@neighborhood.test').reminded_at);

  const message = compose({ kind:'reminder',name:null,payload:{} },'https://nabora.us');
  assert.equal(message.subject,'One step left to join your neighbors on Nabora');
  assert.match(message.text,/https:\/\/nabora.us\/#login/);
});

test('the roster CSV opens cleanly in a spreadsheet and can’t run formulas',()=>{
  const csv = rosterCsv([{ name:'=HYPERLINK("x")',email:'a@b.test',area:'Old Brooklyn, West',joined:'2026-11-20T10:00:00Z',verified:true,verified_via:'postcard',role:'admin',email_notices:true,digest:false,last_seen:null }]);
  const [header,row] = csv.trim().split('\r\n');
  assert.equal(header,'Name,Email,Neighborhood,Joined,Verified,Verified by,Role,Email notices,Weekly digest,Last signed in');
  assert.ok(row.startsWith('"\'=HYPERLINK(""x"")"'),'formulas are neutralized');
  assert.match(row,/"Old Brooklyn, West"/);
  assert.match(row,/,2026-11-20,yes,postcard,admin,on,off,$/);
});
