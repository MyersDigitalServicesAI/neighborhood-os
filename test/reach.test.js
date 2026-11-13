import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
let business;
const call = (who,op,data) => rpc(db,actors[who],op,data);
const titles = async (who,data) => (await call(who,'feed',data)).map((p)=>p.title);
before(async()=>{
  db = await initDatabase();
  business = await fixtures(db);
  await call('new','join',{name:'Gwen F.',attest:true,area:'glenville'});
});
after(async()=>{ await db?.close(); });

test('every neighborhood has nearby neighborhoods and the links run both ways',async()=>{
  const lonely = await db.query('select a.id from neighborhood.areas a where not exists(select 1 from neighborhood.area_links l where l.area_id=a.id)');
  assert.equal(lonely.rows.length,0);
  const oneWay = await db.query('select 1 from neighborhood.area_links l where not exists(select 1 from neighborhood.area_links b where b.area_id=l.nearby_id and b.nearby_id=l.area_id)');
  assert.equal(oneWay.rows.length,0);
  const near = (await call('ava','bootstrap')).nearby;
  assert.ok(near.includes('Brooklyn Centre') && near.includes('Parma') && !near.includes('Glenville') && !near.includes('Old Brooklyn'),near.join(', '));
});

test('the author chooses how far a post travels, and each feed shows only what it should',async()=>{
  await assert.rejects(call('ava','create_post',{kind:'discussion',title:'Bad reach',body:'Not a real choice.',reach:'world'}),/who can see/);
  await call('ava','create_post',{kind:'discussion',title:'Only for Old Brooklyn',body:'Stays local.'});
  const nearby = await call('ava','create_post',{kind:'sale',title:'Nearby snow blower',body:'Runs well.',price:'80',reach:'nearby'});
  const region = await call('ava','create_post',{kind:'event',title:'Regional seed swap',body:'Everyone welcome.',when:new Date(Date.now()+86400000).toISOString(),place:'Public square',reach:'region'});

  for (const scope of [undefined,'nearby','region']) {
    const mine = await titles('ava',{scope});
    assert.ok(['Only for Old Brooklyn','Nearby snow blower','Regional seed swap'].every((t)=>mine.includes(t)),'own neighborhood sees everything at scope '+scope);
  }
  // Taylor is in Parma, which is linked to Old Brooklyn.
  assert.deepEqual(await titles('taylor',{}),[]);
  assert.deepEqual((await titles('taylor',{scope:'nearby'})).sort(),['Nearby snow blower','Regional seed swap']);
  assert.deepEqual((await titles('taylor',{scope:'region'})).sort(),['Nearby snow blower','Regional seed swap']);
  assert.deepEqual(await titles('taylor',{scope:'nearby',kind:'sale'}),['Nearby snow blower']);
  // Gwen is in Glenville, across the city.
  assert.deepEqual(await titles('new',{scope:'nearby'}),[]);
  assert.deepEqual(await titles('new',{scope:'region'}),['Regional seed swap']);

  const seen = await call('taylor','post',{id:nearby.id});
  assert.deepEqual([seen.area,seen.local,seen.reach],['Old Brooklyn',false,'nearby']);
  assert.equal((await call('ava','post',{id:nearby.id})).local,true);
  await assert.rejects(call('new','post',{id:nearby.id}),/unavailable/);
  await assert.rejects(call('new','react',{id:nearby.id}),/unavailable/);
  await assert.rejects(call('new','reply',{id:nearby.id,body:'Should not reach.'}),/unavailable/);
  await assert.rejects(call('new','report_content',{id:nearby.id,kind:'post',reason:'Cannot report what I cannot see.'}),/unavailable/);

  await call('taylor','react',{id:nearby.id});
  await call('taylor','reply',{id:nearby.id,body:'Is it still available?'});
  await call('new','rsvp',{id:region.id});
  await call('new','report_content',{id:region.id,kind:'post',reason:'Testing a report from another neighborhood.'});
  assert.deepEqual([(await call('ava','post',{id:nearby.id})).likes,(await call('ava','post',{id:region.id})).going],[1,1]);
  assert.ok((await call('ava','notifications')).some((n)=>n.kind==='reply' && n.actor==='Taylor K.'));
  assert.equal((await call('rina','moderation')).content.length,1);

  assert.deepEqual((await call('taylor','search',{q:'snow blower'})).posts.map((p)=>p.title),['Nearby snow blower']);
  assert.deepEqual((await call('new','search',{q:'snow blower'})).posts,[]);
});

test('messages, profiles and business pages open only through a post the member can see',async()=>{
  await assert.rejects(call('new','message',{peer:actors.jamal,body:'Hello from far away.'}),/Neighbor unavailable/);
  assert.equal(await call('new','profile',{id:actors.jamal}),null);
  await assert.rejects(call('new','business',{id:business}),/unavailable/);
  assert.equal((await call('new','profile',{id:actors.ava})).area,'Old Brooklyn');
  const thread = await call('new','message',{peer:actors.ava,body:'Is the seed swap indoors?'});
  await call('ava','message',{id:thread.id,body:'Yes, in the hall.'});
  assert.equal((await call('new','thread',{id:thread.id})).messages.length,2);
  assert.deepEqual((await call('new','feed',{author:actors.ava})).map((p)=>p.title),['Regional seed swap']);

  await call('luis','delete_post',{id:(await call('luis','feed',{kind:'offer'}))[0].id});
  await call('luis','create_post',{kind:'offer',business,title:'Regional estimate week',body:'Free estimates across the county.',reach:'region'});
  const shop = await call('new','business',{id:business});
  assert.deepEqual([shop.name,shop.area,shop.local,shop.updates.length],['Juniper Home Repair','Old Brooklyn',false,1]);
  assert.equal((await call('ava','business',{id:business})).local,true);
  await assert.rejects(call('new','submit_review',{id:business,rating:5,body:'Reviews stay with the home neighborhood.',attest:true}),/cannot review/);
  assert.equal((await call('new','directory',{})).length,0);
});

test('a photo travels with a post that is shared wider, and no further',async()=>{
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const local = await call('jamal','upload_image',{mime:'image/png',data:png});
  const shared = await call('jamal','upload_image',{mime:'image/png',data:png});
  await call('jamal','create_post',{kind:'lost',title:'Lost glove',body:'Left at the park.',image:local.id});
  await call('jamal','create_post',{kind:'lost',title:'Lost dog seen heading north',body:'Brown terrier.',image:shared.id,reach:'region'});
  assert.equal(await call('new','image',{id:local.id}),null);
  assert.equal((await call('new','image',{id:shared.id})).data,png);
});

test('the wider dispatcher is the only one client roles can call',async()=>{
  for (const statement of ["select neighborhood.dispatch2('feed','{}')",'select * from neighborhood.area_links']) {
    await assert.rejects(db.transaction(async(tx)=>{
      await tx.exec('set local role authenticated');
      await tx.query(statement);
    }),/permission denied/,statement);
  }
});

test('the map shows true borders, every suburb, and only counts the viewer may see',async()=>{
  const areas = await db.query("select count(*)::int n,count(*) filter (where region='Cleveland')::int city from neighborhood.areas");
  assert.deepEqual(areas.rows[0],{n:91,city:34});
  const near = (await call('ava','bootstrap')).nearby;
  assert.deepEqual(near,['Brooklyn','Brooklyn Centre','Brooklyn Heights','Cuyahoga Heights','Parma','Stockyards']);
  const mine = await call('ava','map');
  assert.ok(mine['old-brooklyn'].members >= 5 && mine['old-brooklyn'].posts >= 5);
  assert.equal(mine.parma.members,1);
  assert.equal(mine.lakewood,undefined,'areas with no members are left out');
  const far = await call('new','map');
  assert.ok(far['old-brooklyn'].posts < mine['old-brooklyn'].posts,'local-only posts are not counted for other neighborhoods');
  await assert.rejects(call('unconfirmed','map'),/confirmed email/);
  await assert.rejects(db.transaction(async(tx)=>{ await tx.exec('set local role anon'); await tx.query('select neighborhood.map_summary()'); }),/permission denied/);
});
