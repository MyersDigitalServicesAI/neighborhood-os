import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, importEvents, actors } from './db.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const inDays = (days) => new Date(Date.now()+days*86400000).toISOString();

before(async()=>{
  db = await initDatabase();
  await fixtures(db);
  await importEvents(db,{ events:[
    { branch:'South Brooklyn', source_url:'https://cpl.libcal.com/event/501', title:'Ornament craft at the South Brooklyn library', body:'Make an ornament.', place:'CPL South Brooklyn', starts_at:inDays(2) }
  ]});
});
after(async()=>{ await db?.close(); });

test('public events reach neighbors in other communities; local-only events stay home',async()=>{
  // Jamal's cleanup was posted for Old Brooklyn only; the imported library event is citywide.
  const parma = await call('taylor','events');
  const titles = parma.events.map((e)=>e.title);
  assert.ok(titles.includes('Ornament craft at the South Brooklyn library'),'a Parma neighbor sees an Old Brooklyn library event');
  assert.ok(!titles.includes('Saturday trail cleanup at Brookside'),'an event kept local stays local');
  assert.equal(parma.events[0].area_id,'old-brooklyn');
  assert.deepEqual(parma.areas.map((a)=>[a.id,a.count]),[['old-brooklyn',1]]);

  const home = await call('ava','events');
  assert.ok(home.events.some((e)=>e.title==='Saturday trail cleanup at Brookside'),'neighbors still see their own local events');
  assert.ok(home.events.every((e,i,all)=>i===0 || all[i-1].event_at <= e.event_at),'soonest first');

  await call('ava','create_post',{kind:'event',reach:'region',title:'Pearl Road holiday market',when:inDays(5),place:'Pearl Road',body:'Local makers and hot cocoa on Pearl Road.'});
  await call('ava','create_post',{kind:'event',reach:'area',title:'Our block party',when:inDays(5),place:'Our street',body:'Just for our street this time.'});
  const after = (await call('taylor','events')).events.map((e)=>e.title);
  assert.ok(after.includes('Pearl Road holiday market'));
  assert.ok(!after.includes('Our block party'));
  assert.deepEqual((await call('taylor','events',{area:'parma'})).events,[],'filter by neighborhood');
  assert.equal((await call('taylor','events',{area:'old-brooklyn'})).events.length,2);
});

test('the next 7 days and this weekend narrow the list',async()=>{
  await call('ava','create_post',{kind:'event',reach:'region',title:'Far-off concert',when:inDays(20),place:'Downtown',body:'A concert three weeks out.'});
  const all = (await call('taylor','events')).events.map((e)=>e.title);
  const week = (await call('taylor','events',{when:'week'})).events.map((e)=>e.title);
  assert.ok(all.includes('Far-off concert') && !week.includes('Far-off concert'));
  const weekend = await call('taylor','events',{when:'weekend'});
  for (const e of weekend.events) {
    const day = new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'America/New_York'}).format(new Date(e.event_at));
    assert.ok(['Sat','Sun'].includes(day),e.title+' falls on the weekend');
  }
});
