import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
let farArea;
let borderArea;
const walkIn = '00000000-0000-4000-a000-000000000021';
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const verified = async (who) => (await call(who,'bootstrap')).member.verified_at !== null;
const verify = (who,via) => db.query("update neighborhood.members set verified_at = now(),verified_via = $2 where id = $1",[actors[who] ?? who,via]);

before(async()=>{
  db = await initDatabase();
  await fixtures(db);
  await db.query('update neighborhood.launch_settings set public_enrollment = false');
  await db.query("insert into auth.users(id,email_confirmed_at,email) values($1,now(),'walkin@neighborhood.test')",[walkIn]);
  borderArea = (await db.query("select nearby_id from neighborhood.area_links where area_id = 'old-brooklyn' order by nearby_id limit 1")).rows[0].nearby_id;
  farArea = (await db.query(`select id from neighborhood.areas a where a.id <> 'old-brooklyn'
    and not exists(select 1 from neighborhood.area_links l where l.area_id = 'old-brooklyn' and l.nearby_id = a.id) order by id limit 1`)).rows[0].id;
});
after(async()=>{ await db?.close(); });

test('two verified neighbors from the same or a bordering area vouch someone into verified',async()=>{
  await assert.rejects(call('ava','vouch',{id:actors.luis}),/Only verified neighbors/,'an unverified member cannot vouch');
  await verify('ava','postcard');
  await verify('jamal','postcard');
  await db.query("insert into neighborhood.residency_checks(member_id,address,code) values($1,'4200 Pearl Road, Cleveland OH','ABC123')",[actors.luis]);

  const before = await call('ava','profile',{id:actors.luis});
  assert.deepEqual([before.vouches,before.vouched,before.canVouch],[0,false,true]);
  assert.deepEqual(await call('ava','vouch',{id:actors.luis}),{vouches:1,verified:false});
  await assert.rejects(call('ava','vouch',{id:actors.luis}),/already vouched/);
  await assert.rejects(call('ava','vouch',{id:actors.ava}),/unavailable/,'nobody vouches for themselves');
  assert.equal(await verified('luis'),false);
  assert.equal((await call('luis','bootstrap')).vouches,1);

  assert.deepEqual(await call('jamal','vouch',{id:actors.luis}),{vouches:2,verified:true});
  const luis = await call('luis','bootstrap');
  assert.equal(luis.verifiedVia,'vouch');
  assert.equal((await db.query('select count(*)::int n from neighborhood.residency_checks where member_id = $1',[actors.luis])).rows[0].n,0,
    'a waiting postcard request, and the address in it, is erased once vouching verifies them');
  assert.equal((await call('jamal','profile',{id:actors.luis})).canVouch,false,'already verified');
  await assert.rejects(call('ava','unvouch',{id:actors.luis}),/already verified/);
});

test('vouching stops at the neighborhood border and at five a month',async()=>{
  const far = '00000000-0000-4000-a000-000000000022';
  const near = '00000000-0000-4000-a000-000000000023';
  await db.query("insert into auth.users(id,email_confirmed_at,email) values($1,now(),'far@neighborhood.test'),($2,now(),'near@neighborhood.test')",[far,near]);
  await db.query('insert into neighborhood.pilot_access(user_id) values($1),($2)',[far,near]);
  await rpc(db,far,'join',{name:'Faye F.',attest:true,area:farArea});
  await rpc(db,near,'join',{name:'Nate N.',attest:true,area:borderArea});
  await rpc(db,near,'create_post',{kind:'discussion',reach:'nearby',title:'Hello from next door',body:'New here and saying hello to the neighborhoods around us.'});
  await rpc(db,far,'create_post',{kind:'discussion',reach:'region',title:'Hello from across town',body:'Just saying hello to everyone across the region today.'});
  assert.equal((await call('ava','profile',{id:near})).canVouch,true,'a bordering neighborhood counts');
  await call('ava','vouch',{id:near});
  await call('ava','unvouch',{id:near});
  assert.equal((await call(near,'bootstrap')).vouches,0,'a vouch can be withdrawn before it verifies anyone');
  await assert.rejects(call('ava','vouch',{id:far}),/neighborhood or one next to it/);

  for (let i = 0; i < 4; i++) {
    const id = '00000000-0000-4000-a000-00000000003'+i;
    await db.query("insert into auth.users(id,email_confirmed_at,email) values($1,now(),$2)",[id,'n'+i+'@neighborhood.test']);
    await db.query('insert into neighborhood.pilot_access(user_id) values($1)',[id]);
    await rpc(db,id,'join',{name:'Neighbor '+i,attest:true,area:'old-brooklyn'});
    await call('ava','vouch',{id});
  }
  await assert.rejects(call('ava','vouch',{id:actors.devon}),/up to 5 neighbors every 30 days/);
});

test('a host runs a check-in that verifies residents on the spot and can be undone',async()=>{
  await assert.rejects(call('devon','create_checkin',{area:'old-brooklyn'}),/Only hosts/,'moderators are not hosts');
  await call('rina','set_host',{id:actors.devon,area:'old-brooklyn'});
  assert.deepEqual((await call('devon','bootstrap')).hostAreas,['old-brooklyn']);
  assert.deepEqual((await call('rina','bootstrap')).hostAreas,['*']);
  await assert.rejects(call('devon','create_checkin',{area:farArea}),/Only hosts/,'a host is limited to their own neighborhood');
  const session = await call('devon','create_checkin',{area:'old-brooklyn',label:'Old Brooklyn CDC monthly meeting',hours:2,uses:3});
  assert.match(session.code,/^[A-HJ-NP-Z2-9]{8}$/);

  assert.deepEqual(await call('taylor','checkin_info',{checkin:session.code.toLowerCase()}),
    {valid:true,area:'old-brooklyn',areaName:'Old Brooklyn',label:'Old Brooklyn CDC monthly meeting'});
  const parmaBorders = (await db.query("select 1 from neighborhood.area_links where area_id = 'old-brooklyn' and nearby_id = 'parma'")).rows.length > 0;
  if (!parmaBorders) await assert.rejects(call('taylor','checkin',{checkin:session.code}),/different neighborhood/);

  assert.equal(await verified('devon'),false);
  assert.deepEqual(await call('devon','checkin',{checkin:session.code}),{verified:true,already:false,label:'Old Brooklyn CDC monthly meeting'});
  assert.equal((await call('devon','bootstrap')).verifiedVia,'checkin');
  assert.equal((await call('devon','checkin',{checkin:session.code})).already,true,'scanning twice is harmless');

  // Someone with no account yet signs up at the meeting: the code admits them, then verifies them.
  await assert.rejects(rpc(db,walkIn,'join',{name:'Walk In',attest:true,area:'old-brooklyn'}),/Pilot access/);
  await rpc(db,walkIn,'join',{name:'Walk In',attest:true,area:'old-brooklyn',checkin:session.code});
  assert.equal((await rpc(db,walkIn,'checkin',{checkin:session.code})).verified,true);

  const host = await call('devon','checkin_host',{id:session.id});
  assert.deepEqual(host.people.map((p)=>[p.name,p.verified]),[['Walk In',true],['Devon W.',true]]);
  await assert.rejects(call('ava','checkin_host',{id:session.id}),/unavailable/,'only the host and admins see who checked in');
  await call('devon','undo_checkin',{id:session.id,member:walkIn});
  assert.equal((await rpc(db,walkIn,'bootstrap')).member.verified_at,null);

  await call('devon','end_checkin',{id:session.id});
  assert.equal((await call('ava','checkin_info',{checkin:session.code})).valid,false);
  await assert.rejects(call('luis','checkin',{checkin:session.code}),/has ended/);
  assert.equal((await call('devon','checkins'))[0].live,false);
  assert.equal((await call('rina','admin')).hosts[0].area,'Old Brooklyn');
});

test('a check-in stops at its use limit and its expiry',async()=>{
  const session = await call('rina','create_checkin',{area:'old-brooklyn',uses:1});
  await call('ava','checkin',{checkin:session.code});
  await assert.rejects(call('jamal','checkin',{checkin:session.code}),/has ended/);
  const later = await call('rina','create_checkin',{area:'old-brooklyn'});
  await db.query("update neighborhood.checkins set expires_at = now() - interval '1 minute' where id = $1",[later.id]);
  await assert.rejects(call('jamal','checkin',{checkin:later.code}),/has ended/);
  await assert.rejects(call('rina','set_host',{id:actors.ava}),/Choose a neighborhood/);
  await assert.rejects(call('ava','set_host',{id:actors.jamal,area:'old-brooklyn'}),/Admin access/);
});
