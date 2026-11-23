import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors, push } from './db.js';
import { deliverPush, notice, pushAdapter } from '../server/push.js';
import { makeHandler } from '../server/handler.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const device = (n) => ({ endpoint:'https://fcm.googleapis.com/fcm/send/device-'+n+'-'+'x'.repeat(20), p256dh:'B'+'a'.repeat(86), auth:'c'.repeat(22) });
const database = { push:(d)=>push(db,d) };

before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

test('a neighbor turns on notifications for a device, and only real push services are accepted',async()=>{
  assert.equal((await call('ava','bootstrap')).pushDevices,0);
  await call('ava','save_push',device(1));
  await call('ava','save_push',device(1));
  assert.equal((await call('ava','bootstrap')).pushDevices,1,'saving the same device twice keeps one');
  await assert.rejects(call('ava','save_push',{ ...device(2),endpoint:'https://evil.example/collect/'+'x'.repeat(20) }),/push service/);
  await assert.rejects(call('ava','save_push',{ ...device(2),auth:'short' }),/invalid key/);
  await assert.rejects(db.transaction(async (tx)=>{
    await tx.exec('set local role authenticated');
    await tx.query('select public.neighborhood_push($1)',[JSON.stringify({ op:'claim' })]);
  }),/permission denied/,'members cannot read the queue or other people’s devices');

  // A shared phone that signs in to another account moves to that account.
  await call('jamal','save_push',device(1));
  assert.equal((await call('ava','bootstrap')).pushDevices,0);
  assert.equal((await call('jamal','bootstrap')).pushDevices,1);
  await call('jamal','remove_push',{ endpoint:device(1).endpoint });
  assert.equal((await call('jamal','bootstrap')).pushDevices,0);
});

test('replies and messages become one notice per thread, sent to every device and forgetting dead ones',async()=>{
  await call('ava','save_push',device(3));
  await call('ava','save_push',device(4));
  const post = (await db.query("select id from neighborhood.posts where title = 'Looking for a reliable fence repair'")).rows[0];
  await call('jamal','reply',{ id:post.id,body:'Try the crew on Pearl Road.' });
  await call('luis','reply',{ id:post.id,body:'Seconding that.' });
  await call('jamal','message',{ peer:actors.ava,body:'Private details here.' });
  await call('ava','reply',{ id:post.id,body:'Thanks!' });   // no notice to yourself; Luis has no device

  const sent = [];
  const pusher = { enabled:true, async send(d,message) { sent.push([d.endpoint,message]); return d.endpoint.includes('device-4') ? 'gone' : 'sent'; } };
  const result = await deliverPush(database,pusher);
  assert.deepEqual(result,{ pushed:2,pushFailed:0 },'two replies within 10 minutes are one notice, plus one for the message');
  const messages = sent.map(([,m])=>m);
  const replyNotice = messages.find((m)=>m.tag.startsWith('reply'));
  assert.equal(replyNotice.title,'Jamal R. replied');
  assert.equal(replyNotice.url,'/#post/'+post.id);
  const dm = messages.find((m)=>m.tag.startsWith('message'));
  assert.doesNotMatch(JSON.stringify(dm),/Private details/,'message text is never sent through push services');
  assert.equal((await call('ava','bootstrap')).pushDevices,1,'the device the push service reported gone is forgotten');
  assert.deepEqual(await push(db,{ op:'claim' }),[],'nothing is sent twice');
});

test('failed sends are retried, and notices are worded for each kind',async()=>{
  const event = (await db.query("select id from neighborhood.posts where title = 'Saturday trail cleanup at Brookside'")).rows[0];
  await call('jamal','save_push',device(5));
  await call('ava','rsvp',{ id:event.id });
  let tries = 0;
  const flaky = { enabled:true, async send() { tries++; return tries === 1 ? 'failed' : 'sent'; } };
  assert.deepEqual(await deliverPush(database,flaky),{ pushed:0,pushFailed:1 });
  await db.query('update neighborhood.push_outbox set claimed_at = now() - interval \'6 minutes\'');
  assert.deepEqual(await deliverPush(database,flaky),{ pushed:1,pushFailed:0 });

  assert.deepEqual(notice({ kind:'alert',payload:{ title:'Downed wire on W. 25th',area:'Old Brooklyn',post:'p1' } }),
    { title:'Safety alert in Old Brooklyn',body:'Downed wire on W. 25th',url:'/#post/p1',tag:'alert:p1' });
  assert.equal(notice({ kind:'like',payload:{} }),null);
  assert.equal(pushAdapter({}).enabled,false,'without keys nothing is sent');
});

test('the server only shares the public key, and refuses push addresses outside the known push services',async()=>{
  const env = { APP_ORIGIN:'https://nabora.us',VAPID_PUBLIC_KEY:'BPublicKey',VAPID_PRIVATE_KEY:'private',SUPABASE_SECRET_KEY:'s' };
  const calls = [];
  const handler = makeHandler({ env,local:true,billing:{ enabled:false },
    database:{ configured:true, rpc:async(t,op,d)=>{ calls.push(op); return { ok:true }; } } });
  const run = async (action,{ method='POST',body={} } = {}) => {
    const data = new TextEncoder().encode(JSON.stringify(body));
    const res = { headers:{},setHeader(k,v){ this.headers[k]=v; },end(v){ this.body = JSON.parse(v); } };
    await handler({ method,url:'/api/core?action='+action,headers:{ host:'nabora.us',origin:'https://nabora.us',cookie:'nh_access=t','content-type':'application/json' },
      async *[Symbol.asyncIterator](){ yield data; } },res);
    return res;
  };
  const config = await run('config',{ method:'GET' });
  assert.equal(config.body.push,'BPublicKey');
  assert.doesNotMatch(JSON.stringify(config.body),/private/);
  assert.equal((await run('save_push',{ body:{ endpoint:'http://169.254.169.254/latest' } })).statusCode,400);
  assert.deepEqual(calls,[],'a bad address never reaches the database');
  assert.equal((await run('save_push',{ body:device(9) })).statusCode,200);
});

test('the Android app link file lists only well-formed signing fingerprints',async()=>{
  const fingerprint = Array.from({ length:32 },(_,i)=>i.toString(16).padStart(2,'0')).join(':').toUpperCase();
  const get = async (env) => {
    const res = { headers:{},setHeader(k,v){ this.headers[k]=v; },end(v){ this.body = JSON.parse(v); } };
    await makeHandler({ env:{ APP_ORIGIN:'https://nabora.us',...env },billing:{ enabled:false },database:{ configured:true } })(
      { method:'GET',url:'/api/core?action=assetlinks',headers:{},async *[Symbol.asyncIterator](){} },res);
    return res;
  };
  assert.deepEqual((await get({})).body,[]);
  const res = await get({ ANDROID_CERT_SHA256:fingerprint.toLowerCase()+', not-a-print' });
  assert.equal(res.body[0].target.package_name,'us.nabora.app');
  assert.deepEqual(res.body[0].target.sha256_cert_fingerprints,[fingerprint]);
  assert.match(res.headers['Cache-Control'],/public/);
});
