import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';
import { compose } from '../server/mail.js';
import { makeHandler } from '../server/handler.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

test('members send signed feedback; every admin is emailed at once; only admins read it',async()=>{
  await assert.rejects(call('ava','send_feedback',{ kind:'complaint',body:'The map is slow to load on my phone.' }),/what your feedback is about/);
  await assert.rejects(call('ava','send_feedback',{ kind:'bug',body:'Slow.' }),/between 10 and 2,000/);
  await assert.rejects(call('unconfirmed','send_feedback',{ kind:'bug',body:'I cannot even sign in yet.' }));
  const { id } = await call('ava','send_feedback',{ kind:'bug',body:'The map is slow to load on my phone.',page:'#map',device:'Android · Chrome · 390px wide' });

  const mail = (await db.query("select to_user,payload from neighborhood.outbox where kind = 'feedback'")).rows;
  assert.deepEqual(mail.map((m)=>m.to_user),[actors.rina],'the admin is emailed, moderators are not');
  assert.deepEqual([mail[0].payload.from,mail[0].payload.kind,mail[0].payload.area],['Ava M.','Bug','Old Brooklyn']);
  const email = compose({ kind:'feedback',name:'Rina P.',payload:mail[0].payload },'https://nabora.us');
  assert.equal(email.subject,'New feedback on Nabora: Bug');
  assert.match(email.text,/Ava M\. in Old Brooklyn sent feedback \(Bug\): “The map is slow to load on my phone\.”/);
  assert.match(email.text,/https:\/\/nabora\.us\/#feedback/);
  assert.match(email.text,/because you are a Nabora admin/);
  assert.doesNotMatch(compose({ kind:'feedback',payload:{ body:'<script>x</script>' } },'https://nabora.us').html,/<script>/,'the message is escaped in the email');

  await assert.rejects(call('ava','feedback'),/Admin access/);
  await assert.rejects(call('devon','feedback'),/Admin access/,'moderators are not admins');
  const [item] = (await call('rina','feedback')).items;
  assert.deepEqual([item.id,item.name,item.area,item.kind,item.page,item.device,item.open],[id,'Ava M.','Old Brooklyn','bug','#map','Android · Chrome · 390px wide',true]);
  assert.equal((await call('rina','admin')).feedbackOpen,1);

  await assert.rejects(call('ava','resolve_feedback',{ id }),/Admin access/);
  await call('rina','resolve_feedback',{ id });
  const handled = (await call('rina','feedback')).items[0];
  assert.deepEqual([handled.open,handled.resolved_by],[false,'Rina P.']);
  assert.equal((await call('rina','admin')).feedbackOpen,0);
  await call('rina','resolve_feedback',{ id,open:true });
  assert.equal((await call('rina','admin')).feedbackOpen,1,'it can be reopened');

  // An admin's own feedback isn't emailed back to them, and members can't flood the inbox.
  await call('rina','send_feedback',{ kind:'idea',body:'Add a dark mode for late-night browsing.' });
  assert.equal((await db.query("select count(*)::int n from neighborhood.outbox where kind = 'feedback'")).rows[0].n,1);
  for (let i = 0; i < 5; i++) await call('jamal','send_feedback',{ kind:'other',body:'Feedback number '+i+' from Jamal.' });
  await assert.rejects(call('jamal','send_feedback',{ kind:'other',body:'One too many in an hour.' }),/limit/);
  await assert.rejects(db.transaction(async(tx)=>{ await tx.exec('set local role authenticated'); await tx.query('select * from neighborhood.feedback'); }),/permission denied/);
});

test('team actions, feedback and joining send their email right away instead of waiting for the daily job',async()=>{
  const origin = 'https://nabora.us';
  const drained = [];
  const handler = makeHandler({ env:{ APP_ORIGIN:origin },billing:{ enabled:false },pusher:{ enabled:false },
    mailer:{ enabled:true,send:async()=>true },
    database:{ configured:true,rpc:async()=>({ ok:true }),mail:async(d)=>{ drained.push(d.op); return []; } } });
  const send = async (action) => {
    const data = new TextEncoder().encode('{}');
    const res = { headers:{},setHeader(k,v){ this.headers[k]=v; },end(){} };
    await handler({ method:'POST',url:'/api/core?action='+action,headers:{ origin,'content-type':'application/json',cookie:'__Host-nh_access=t' },
      async *[Symbol.asyncIterator](){ yield data; } },res);
    return res.statusCode;
  };
  for (const action of ['team_message','ask_question','invite_role','send_feedback','join']) {
    drained.length = 0;
    assert.equal(await send(action),200,action);
    assert.ok(drained.includes('claim'),action+' sends its email immediately');
  }
  drained.length = 0;
  await send('feed');
  assert.deepEqual(drained,[],'reading the feed doesn’t touch the mail queue');
});
