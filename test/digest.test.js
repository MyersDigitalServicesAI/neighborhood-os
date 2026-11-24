import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors, mail } from './db.js';
import { compose, mailerAdapter, deliver } from '../server/mail.js';
import { makeHandler } from '../server/handler.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const digests = async () => (await db.query("select o.to_user,o.payload from neighborhood.outbox o where o.kind = 'digest' and o.sent_at is null")).rows;
const resetWeek = () => db.exec("update neighborhood.members set digest_week = null; delete from neighborhood.outbox where kind = 'digest'");

before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

test('each neighbor gets one digest a week with their neighborhood’s talked-about posts and coming events',async()=>{
  const post = (await db.query("select id from neighborhood.posts where title = 'Looking for a reliable fence repair'")).rows[0];
  await call('jamal','reply',{ id:post.id,body:'Try the crew on Pearl Road.' });
  const result = await mail(db,{ op:'digest' });
  assert.ok(result.digests >= 4,'Old Brooklyn members get one');
  assert.ok(result.quiet >= 1,'Taylor’s Parma had a quiet week and is skipped');
  const ava = (await digests()).find((d)=>d.to_user===actors.ava).payload;
  assert.equal(ava.area,'Old Brooklyn');
  assert.equal(ava.posts[0].title,'Looking for a reliable fence repair','the most-discussed post comes first');
  assert.equal(ava.posts[0].replies,1);
  assert.ok(ava.posts.length <= 5 && ava.posts.every((p)=>p.preview.length <= 140));
  assert.ok(ava.events.some((e)=>e.title==='Saturday trail cleanup at Brookside'));
  assert.match(ava.token,/^[0-9a-f-]{36}$/);
  assert.ok(!(await digests()).some((d)=>d.to_user===actors.taylor));
  assert.ok(!(await digests()).some((d)=>d.to_user===actors.unconfirmed));

  assert.deepEqual(await mail(db,{ op:'digest' }),{ digests:0,quiet:0 },'never twice in one week');
});

test('blocked neighbors’ posts are left out, and the digest respects both email switches',async()=>{
  await resetWeek();
  await call('ava','block',{ peer:actors.jamal });
  await call('luis','set_digest',{ on:'false' });
  assert.equal((await call('luis','bootstrap')).digest,false);
  await call('devon','set_email_notices',{ on:'false' });
  await mail(db,{ op:'digest' });
  const queued = await digests();
  const ava = queued.find((d)=>d.to_user===actors.ava).payload;
  const jamalPosts = (await db.query('select title from neighborhood.posts where author_id = $1',[actors.jamal])).rows.map((r)=>r.title);
  assert.ok(![...ava.posts,...ava.events].some((p)=>jamalPosts.includes(p.title)),'nothing by someone Ava blocked');
  assert.ok(!queued.some((d)=>d.to_user===actors.luis),'digest switched off');
  assert.ok(!queued.some((d)=>d.to_user===actors.devon),'all email notices switched off');
  await call('luis','set_digest',{ on:'true' });
  await call('ava','unblock',{ peer:actors.jamal });
  await call('devon','set_email_notices',{ on:'true' });
});

test('the unsubscribe link turns off only the digest, needs no sign-in, and a stale digest is never sent',async()=>{
  await resetWeek();
  await mail(db,{ op:'digest' });
  const token = (await digests()).find((d)=>d.to_user===actors.ava).payload.token;
  const env = { APP_ORIGIN:'https://nabora.us',SUPABASE_SECRET_KEY:'s' };
  const handler = makeHandler({ env,billing:{ enabled:false },database:{ configured:true,mail:(d)=>mail(db,d) } });
  const visit = async (method,query) => {
    const res = { headers:{},setHeader(k,v){ this.headers[k]=v; },end(v){ this.body = String(v ?? ''); } };
    await handler({ method,url:'/api/core?action=unsubscribe&'+query,headers:{},async *[Symbol.asyncIterator](){ yield new TextEncoder().encode('List-Unsubscribe=One-Click'); } },res);
    return res;
  };
  const page = await visit('GET','t='+token);
  assert.match(page.body,/Stop the weekly digest\?/);
  assert.equal((await call('ava','bootstrap')).digest,true,'just opening the link changes nothing');
  const done = await visit('POST','t='+token);
  assert.equal(done.statusCode,200);
  assert.match(done.body,/No more weekly digest/);
  const ava = await call('ava','bootstrap');
  assert.equal(ava.digest,false);
  assert.equal(ava.emailNotices,true,'reply and message emails stay on');
  assert.match((await visit('POST','t=not-a-token')).body,/didn’t work/);
  assert.match((await visit('GET','t=00000000-0000-4000-a000-00000000000x')).body,/didn’t work/);

  await db.query("update neighborhood.outbox set created_at = now() - interval '3 days' where kind = 'digest'");
  assert.ok(!(await mail(db,{ op:'claim',limit:25 })).some((m)=>m.kind==='digest'),'last week’s news is dropped, not sent');
});

test('the digest email reads well, links back, and carries one-click unsubscribe headers',async()=>{
  const item = { id:'o1',kind:'digest',name:'Ava M.',email:'ava@neighborhood.test',payload:{ area:'Old Brooklyn',token:'00000000-0000-4000-a000-000000000001',
    posts:[{ id:'p1',title:'Best pizza on Pearl <Rd>?',preview:'Looking for recommendations',replies:3 }],
    events:[{ id:'e1',title:'Ward 4 community meeting',event_at:'2026-12-02T23:00:00Z',place:'South Brooklyn library',area:'Brooklyn Centre' }] } };
  const message = compose(item,'https://nabora.us');
  assert.equal(message.subject,'This week in Old Brooklyn: Best pizza on Pearl <Rd>?');
  assert.match(message.text,/Wed, Dec 2, 6:00 PM · South Brooklyn library · Brooklyn Centre/);
  assert.match(message.html,/Best pizza on Pearl &lt;Rd&gt;\?/);
  assert.doesNotMatch(message.html,/<Rd>/);
  assert.match(message.html,/https:\/\/nabora.us\/#post\/p1/);

  const sent = [];
  const mailer = mailerAdapter({ RESEND_API_KEY:'k',EMAIL_FROM:'Nabora <hello@nabora.us>',APP_ORIGIN:'https://nabora.us',SUPABASE_SECRET_KEY:'s' },
    async (url,options) => { sent.push(JSON.parse(options.body)); return { ok:true }; });
  const queue = [item];
  await deliver({ mail:async(d)=>d.op==='claim' ? queue.splice(0) : {} },mailer);
  assert.equal(sent[0].headers['List-Unsubscribe'],'<https://nabora.us/api/core?action=unsubscribe&t=00000000-0000-4000-a000-000000000001>');
  assert.equal(sent[0].headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  assert.equal(compose({ kind:'reply',payload:{} },'https://nabora.us').unsubscribe,undefined,'reply emails don’t get the digest header');
});

test('the evening job queues digests on Thursdays, or on demand with the cron secret',async()=>{
  await resetWeek();
  const env = { APP_ORIGIN:'https://nabora.us',CRON_SECRET:'c',SUPABASE_SECRET_KEY:'s' };
  const handler = makeHandler({ env,billing:{ enabled:false },mailer:{ enabled:true,send:async()=>true },
    pusher:{ enabled:false },database:{ configured:true,mail:(d)=>mail(db,d),push:async()=>[] } });
  const res = { headers:{},setHeader(k,v){ this.headers[k]=v; },end(v){ this.body = JSON.parse(v); } };
  await handler({ method:'GET',url:'/api/core?action=deliver&digest=1',headers:{ authorization:'Bearer c' },async *[Symbol.asyncIterator](){} },res);
  assert.equal(res.statusCode,200);
  assert.ok(res.body.digests >= 4);
  assert.ok(res.body.sent >= 4,'queued digests go out in the same run');
});
