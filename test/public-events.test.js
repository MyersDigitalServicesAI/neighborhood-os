import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, importEvents, publicEvents, actors } from './db.js';
import { eventsPage } from '../server/events-page.js';
import { makeHandler } from '../server/handler.js';

let db;
const inDays = (days) => new Date(Date.now()+days*86400000).toISOString();
before(async()=>{
  db = await initDatabase();
  await fixtures(db);
  await importEvents(db,{ events:[{ branch:'South Brooklyn', source_url:'https://cpl.libcal.com/event/701', title:'Puppet show at the South Brooklyn library',
    body:'A puppet show for families.', place:'CPL South Brooklyn', starts_at:inDays(2) }]});
  await rpc(db,actors.ava,'create_post',{kind:'event',reach:'region',title:'Pearl Road <holiday> market',when:inDays(4),place:'Pearl Road',body:'Makers & cocoa on Pearl Road.'});
  await rpc(db,actors.ava,'create_post',{kind:'event',reach:'area',title:'Our block party',when:inDays(4),place:'Our street',body:'Just for our street.'});
});
after(async()=>{ await db?.close(); });

test('anyone can list citywide events, never local ones and never who posted them',async()=>{
  const data = await publicEvents(db);
  const titles = data.events.map((e)=>e.title);
  assert.deepEqual(titles,['Puppet show at the South Brooklyn library','Pearl Road <holiday> market']);
  assert.ok(!titles.includes('Our block party'));
  assert.ok(!titles.includes('Saturday trail cleanup at Brookside'),'the fixture event was kept to the neighborhood');
  for (const e of data.events) for (const key of ['author','author_id','author_verified']) assert.equal(key in e,false,'no '+key);
  assert.equal(data.events[0].link,'https://cpl.libcal.com/event/701');
  assert.deepEqual(data.areas,[{id:'old-brooklyn',name:'Old Brooklyn',count:2}]);
  assert.deepEqual((await publicEvents(db,{area:'tremont'})).events,[]);
  assert.equal((await publicEvents(db,{when:'week'})).events.length,2);
  await assert.rejects(db.transaction(async (tx)=>{ await tx.exec('set local role anon'); await tx.query('select * from neighborhood.posts'); }),
    /permission denied/,'visitors cannot read posts directly');
});

test('the public page is plain, escaped HTML with event data for search engines',async()=>{
  const html = eventsPage(await publicEvents(db),'https://nabora.us');
  assert.match(html,/<title>Things to do in Cleveland · Nabora Events<\/title>/);
  assert.match(html,/Pearl Road &lt;holiday&gt; market/);
  assert.ok(!html.includes('<holiday>'),'titles are escaped');
  const json = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(json.itemListElement.length,2);
  assert.equal(json.itemListElement[0].item['@type'],'Event');
  assert.equal(json.itemListElement[0].item.sameAs,'https://cpl.libcal.com/event/701');
  assert.ok(!html.includes('Ava'),'no poster names');
  assert.match(eventsPage({events:[],areas:[],when:'weekend'},'https://nabora.us'),/Things to do in Cleveland this weekend/);
});

test('the public endpoints need no session, validate filters and may be cached',async()=>{
  const seen = [];
  const handler = makeHandler({ env:{ APP_ORIGIN:'https://nabora.us' }, local:true, database:{ configured:true, publicEvents:async(d)=>{ seen.push(d); return { events:[],areas:[],when:'all',area:null }; } } });
  const get = async (url) => { const out = { headers:{}, setHeader(k,v){ this.headers[k]=v; }, end(body){ this.body = String(body); } };
    await handler({ method:'GET', url, headers:{}, async *[Symbol.asyncIterator](){} },out); return out; };
  const page = await get('/api/core?action=events-page&when=week&area=old-brooklyn');
  assert.equal(page.statusCode,200);
  assert.match(page.headers['Content-Type'],/text\/html/);
  assert.match(page.headers['Cache-Control'],/s-maxage=600/);
  const json = await get('/api/core?action=public-events&when=sometime&area=../../etc');
  assert.equal(JSON.parse(json.body).when,'all');
  assert.deepEqual(seen,[{when:'week',area:'old-brooklyn'},{when:'',area:''}]);
});
