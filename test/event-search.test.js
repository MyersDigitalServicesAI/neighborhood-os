import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initDatabase, fixtures, rpc, importEvents, publicEvents, actors } from './db.js';
import { eventsPage } from '../server/events-page.js';
import { eventCategories, searchFilters } from '../server/event-filters.js';

let db;
const inDays = (days) => new Date(Date.now()+days*86400000).toISOString();
const clevelandDay = (iso) => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(iso));
const search = (actor,data = {}) => rpc(db,actors[actor],'events',data);
const titles = (data) => data.events.map((e)=>e.title);
let distance;
before(async()=>{
  db = await initDatabase();
  await fixtures(db);
  await importEvents(db,{ events:[
    { branch:'South Brooklyn', source_url:'https://cpl.libcal.com/event/801', title:'Puppet show at the South Brooklyn library',
      body:'A puppet show for families.', place:'CPL South Brooklyn', starts_at:inDays(2) },
    { ward:13, source_url:'https://clevelandcitycouncil.org/ward13-801', title:'Ward 13 community meeting', body:'Meet your council member.', place:'Rec center', starts_at:inDays(3) }]});
  await rpc(db,actors.ava,'create_post',{kind:'event',reach:'region',category:'food',title:'Pearl Road cocoa market',when:inDays(9),place:'Pearl Road',body:'Makers and cocoa.'});
  await rpc(db,actors.taylor,'create_post',{kind:'event',reach:'region',category:'arts',title:'Parma open mic night',when:inDays(9),place:'Ridge Road',body:'Songs and poems from neighbors.'});
  distance = Number((await db.query("select round(neighborhood.miles_between(a.lat,a.lng,b.lat,b.lng)::numeric,1) d from neighborhood.areas a, neighborhood.areas b where a.id = 'old-brooklyn' and b.id = 'parma'")).rows[0].d);
});
after(async()=>{ await db?.close(); });

test('every event has a category: the poster picks one, imports and older events are sorted by their wording',async()=>{
  const all = await search('ava');
  const byTitle = Object.fromEntries(all.events.map((e)=>[e.title,e.category]));
  assert.equal(byTitle['Pearl Road cocoa market'],'food');
  assert.equal(byTitle['Parma open mic night'],'arts');
  assert.equal(byTitle['Puppet show at the South Brooklyn library'],'family');
  assert.equal(byTitle['Ward 13 community meeting'],'civic');
  assert.ok(all.events.every((e)=>e.category),'nothing is left uncategorized');
  const nulls = await db.query("select count(*)::int n from neighborhood.posts where kind = 'event' and event_category is null");
  assert.equal(nulls.rows[0].n,0);
  await assert.rejects(rpc(db,actors.ava,'create_post',{kind:'event',reach:'region',category:'nonsense',title:'Bad category',when:inDays(5),place:'Somewhere',body:'Should not post.'}),/Choose an event category/);
  // An app opened before this update sends no category: the wording decides.
  await rpc(db,actors.ava,'create_post',{kind:'event',reach:'region',title:'Winter holiday lights walk',when:inDays(6),place:'Pearl Road',body:'Lights on the avenue.'});
  assert.equal(titles(await search('ava',{cat:'holiday'})).includes('Winter holiday lights walk'),true);
});

test('members filter by category and by day',async()=>{
  const civic = await search('ava',{cat:'civic'});
  assert.ok(civic.events.length>=1 && titles(civic).every((t)=>t==='Ward 13 community meeting'),'a ward meeting is posted once per neighborhood the ward covers');
  const counts = Object.fromEntries((await search('ava')).categories.map((c)=>[c.id,c.count]));
  assert.equal(counts.civic,civic.events.length);
  assert.equal(counts.food,1);
  const onDay = await search('ava',{day:clevelandDay(inDays(9))});
  assert.equal(onDay.when,'day');
  assert.deepEqual(titles(onDay).sort(),['Parma open mic night','Pearl Road cocoa market']);
  assert.deepEqual((await search('ava',{day:clevelandDay(inDays(9)),cat:'food'})).events.map((e)=>e.title),['Pearl Road cocoa market']);
  assert.deepEqual((await search('ava',{day:'2020-01-01'})).events,[],'a past day has nothing');
  assert.equal((await search('ava',{day:'not-a-date',cat:'civic'})).events.length,civic.events.length,'a bad day is ignored');
  assert.equal((await search('ava',{when:'today'})).events.every((e)=>clevelandDay(e.event_at)===clevelandDay(new Date().toISOString())),true);
  assert.equal((await search('ava',{when:'tomorrow'})).when,'tomorrow');
  assert.equal((await search('ava',{cat:'bogus'})).cat,null,'unknown categories are ignored');
});

test('members search a neighborhood and a radius around it',async()=>{
  const here = await search('ava',{area:'old-brooklyn'});
  assert.ok(here.events.every((e)=>e.area_id==='old-brooklyn'));
  assert.ok(!titles(here).includes('Parma open mic night'));
  const radius = [1,3,5,10].find((m)=>m>=distance);
  assert.ok(radius,'Old Brooklyn and Parma are within 10 miles: '+distance);
  const wide = await search('ava',{area:'old-brooklyn',miles:String(radius)});
  assert.ok(titles(wide).includes('Parma open mic night'));
  assert.equal(wide.events.find((e)=>e.title==='Parma open mic night').away,distance);
  assert.equal(wide.events.find((e)=>e.title==='Pearl Road cocoa market').away,0);
  const smaller = [1,3,5,10].filter((m)=>m<distance).at(-1);
  if (smaller) assert.ok(!titles(await search('ava',{area:'old-brooklyn',miles:String(smaller)})).includes('Parma open mic night'));
  assert.equal((await search('ava',{miles:'5'})).miles,null,'a radius needs a neighborhood');
  assert.equal((await search('ava',{area:'old-brooklyn',miles:'7'})).miles,null,'only 1, 3, 5 and 10 miles');
  assert.equal((await search('ava',{area:'nowhere'})).area,null,'unknown neighborhoods are ignored');
});

test('posted by neighbors only hides imported events',async()=>{
  const mine = await search('ava',{mine:'neighbors'});
  assert.ok(!titles(mine).includes('Ward 13 community meeting'));
  assert.ok(!titles(mine).includes('Puppet show at the South Brooklyn library'));
  assert.ok(titles(mine).includes('Pearl Road cocoa market'));
  assert.ok((await search('ava')).events.some((e)=>e.imported===true));
});

test('an empty search suggests events within 10 miles instead of a dead end',async()=>{
  const none = await search('ava',{area:'old-brooklyn',cat:'outdoors',when:'today'});
  assert.deepEqual(none.events,[]);
  const near = await search('ava',{area:'old-brooklyn',cat:'arts',day:clevelandDay(inDays(9)),miles:'1'});
  if (distance>1) {
    assert.deepEqual(near.events,[]);
    assert.deepEqual(titles({events:near.suggested}),['Parma open mic night'],'found within 10 miles');
  }
  assert.deepEqual((await search('ava',{cat:'outdoors',when:'today'})).suggested,[],'nothing to widen without a neighborhood');
});

test('members never see events from people they blocked',async()=>{
  await rpc(db,actors.ava,'block',{peer:actors.taylor});
  assert.ok(!titles(await search('ava')).includes('Parma open mic night'));
  assert.ok(!(await search('ava')).categories.some((c)=>c.id==='arts'&&c.count>0));
  await rpc(db,actors.ava,'unblock',{peer:actors.taylor});
});

test('the public search lists only public events, with categories, distance and no posters',async()=>{
  await rpc(db,actors.ava,'create_post',{kind:'event',reach:'area',category:'family',title:'Private cul-de-sac picnic',when:inDays(9),place:'Our street',body:'Just us.'});
  const data = await publicEvents(db,{cat:'family'});
  assert.deepEqual(titles(data),['Puppet show at the South Brooklyn library']);
  const wide = await publicEvents(db,{area:'old-brooklyn',miles:'10'});
  assert.ok(titles(wide).includes('Parma open mic night'));
  assert.ok(!titles(wide).includes('Private cul-de-sac picnic'));
  for (const e of wide.events) for (const key of ['author','author_id','author_verified','imported']) assert.equal(key in e,false,'no '+key);
  assert.deepEqual(titles(await publicEvents(db,{day:clevelandDay(inDays(9))})).sort(),['Parma open mic night','Pearl Road cocoa market']);
  assert.ok((await publicEvents(db,{mine:'neighbors'})).events.every((e)=>!/library|Ward/.test(e.title)));
});

test('the public page shows the filters, the chosen search and a way out of an empty one',async()=>{
  const data = await publicEvents(db,{area:'old-brooklyn',miles:'10',cat:'arts'});
  const html = eventsPage(data,'https://nabora.us');
  assert.match(html,/Arts &amp; culture events in Old Brooklyn and within 10 miles/);
  assert.match(html,/<meta name="robots" content="noindex,follow">/);
  assert.match(html,/name="day"/);
  assert.match(html,/name="miles"/);
  assert.match(html,/Parma open mic night/);
  const plain = eventsPage(await publicEvents(db),'https://nabora.us');
  assert.ok(!plain.includes('noindex'),'the plain page stays indexable');
  assert.match(plain,/cat=family/);
  const empty = eventsPage(await publicEvents(db,{area:'old-brooklyn',miles:'1',cat:'arts',day:clevelandDay(inDays(9))}),'https://nabora.us');
  if (distance>1) assert.match(empty,/Nothing matches that exactly/);
  assert.ok(!eventsPage({events:[{id:'1',title:'<b>x</b>',event_at:inDays(1),area:'A',area_id:'a',category:'<i>'}],categories:[],areas:[]},'https://nabora.us').includes('<b>x</b>'));
});

test('filters read from a link are limited to known values',()=>{
  const f = (q) => searchFilters(new URLSearchParams(q));
  assert.deepEqual(f('cat=family&miles=5&day=2026-12-25&mine=neighbors'),{cat:'family',miles:'5',day:'2026-12-25',mine:'neighbors'});
  assert.deepEqual(f('cat=<script>&miles=99&day=2026-13-45&mine=1'),{cat:'',miles:'',day:'',mine:''});
});

test('the category list is the same in the database, the server and the app',async()=>{
  const keys = eventCategories.map(([key])=>key);
  const sql = await readFile(new URL('../supabase/migrations/20261209090000_events_search.sql',import.meta.url),'utf8');
  const check = sql.match(/event_category in\s*\(([^)]*)\)/)[1].match(/'(\w+)'/g).map((k)=>k.slice(1,-1));
  assert.deepEqual(check,keys);
  const web = await readFile(new URL('../web/views.js',import.meta.url),'utf8');
  const list = web.slice(web.indexOf('export const eventCategories'),web.indexOf('const categoryName'));
  assert.deepEqual([...list.matchAll(/\['(\w+)','([^']+)'\]/g)].map((m)=>[m[1],m[2]]),eventCategories);
});

test('category guesses avoid the false positives that library names and common words caused',async()=>{
  const guess = async (t) => (await db.query('select neighborhood.guess_event_category($1) c',[t])).rows[0].c;
  assert.equal(await guess('Computer class'),'classes');
  assert.equal(await guess('Walk-in tax help'),'other');
  assert.equal(await guess('Coffee with a Cop'),'other');
  assert.equal(await guess('Winter coat drive'),'community');
  assert.equal(await guess('Martin Luther King Day program'),'other');
  const imported = await db.query("select event_category c from neighborhood.posts where title like 'Puppet show%'");
  assert.equal(imported.rows[0].c,'family');
});

test('the public page can switch off neighbors-only, and empty searches are kept out of search engines',async()=>{
  const html = eventsPage(await publicEvents(db,{mine:'neighbors'}),'https://nabora.us');
  assert.ok(!/type="hidden" name="mine"/.test(html),'the checkbox is the only source of the filter');
  const nothing = eventsPage(await publicEvents(db,{cat:'outdoors',when:'today'}),'https://nabora.us');
  assert.match(nothing,/noindex/);
});

test('a neighborhood without coordinates is not treated as 12,000 miles away',async()=>{
  const miles = (await db.query('select neighborhood.miles_between(null,-81.7,41.4,-81.7) m')).rows[0].m;
  assert.equal(miles,null);
});
