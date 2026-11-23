import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, importEvents, actors } from './db.js';
import { pickLibrary, pickCouncil, plain, clevelandTime, gatherEvents } from '../server/events.js';
import { makeHandler } from '../server/handler.js';

let db;
before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

const soon = (days,hour = 16) => {
  const d = new Date(Date.now() + days*86400000);
  return d.toISOString().slice(0,10)+' '+String(hour).padStart(2,'0')+':00:00';
};
const libraryEvent = (id,title,campus,days,extra = {}) => ({ id,title,campus,startdt:soon(days),start:'4:00pm',end:'5:00pm',
  url:'https://cpl.libcal.com/event/'+id,description:'<p>Make a &amp; take &ldquo;craft&rdquo;.</p>',categories:' Arts, Crafts & Creativity',all_day:false,...extra });

test('library events: routine series and closed campuses are skipped, the best kinds come first, times are Cleveland time',()=>{
  const picked = pickLibrary([
    libraryEvent(1,'Aspire: Free GED Prep','South Brooklyn',2),
    libraryEvent(2,'Holiday Ornament Craft','South Brooklyn',3),
    libraryEvent(3,'Family Movie Day','South Brooklyn',4,{categories:' Family Fun'}),
    libraryEvent(4,'Exhibit','Main Library (Downtown)',2),
    libraryEvent(2,'Holiday Ornament Craft','South Brooklyn',3),
    libraryEvent(5,'Used Book Sale','Martin Luther King, Jr.',5,{categories:' Used Book Sale'}),
    libraryEvent(6,'Used Book Sale','Martin Luther King, Jr.',6,{categories:' Used Book Sale'})
  ]);
  assert.deepEqual(picked.map((e)=>e.source_url.split('/').pop()),['3','5','2']);
  assert.equal(picked[1].title,'Used Book Sale at the Martin L. King, Jr. library');
  assert.match(picked[1].body,/^Make a & take “craft”\.\n\nAt the Martin L\. King, Jr\. branch/);
  assert.match(picked[2].body,/Free at the South Brooklyn branch of Cleveland Public Library, 4:00pm to 5:00pm\. Details and any sign-up: https:\/\/cpl\.libcal\.com\/event\/2$/);
  assert.equal(clevelandTime('2026-12-05 16:00:00'),'2026-12-05T21:00:00.000Z','winter: UTC-5');
  assert.equal(clevelandTime('2026-07-04 16:00:00'),'2026-07-04T20:00:00.000Z','summer: UTC-4');
  assert.equal(plain('<p>One</p><p>Two&nbsp;&#8211; three</p>'),'One\nTwo – three');
});

test('council calendar: only ward community meetings with a time are kept',()=>{
  const html = '<script>var x = {"events":[{"title":"Ward 4 Community Meeting","start":"'+soon(3,18).replace(' ','T')+'","extendedProps":{"url":"/ward-4-meeting"},"description":"<p>6 pm at Estabrook Rec Center [details]</p>"},'+
    '{"title":"City Council Meeting","start":"2026-12-07T19:00:00","extendedProps":{"url":"/council"},"description":"<p>7 pm</p>"},'+
    '{"title":"Ward 9 Community Meeting","start":"2026-12-08T18:00:00","extendedProps":{"url":"/w9"},"description":"<p>Details soon</p>"}]};</script>';
  const meetings = pickCouncil(html.replace('{"events":',''));
  assert.deepEqual(meetings.map((m)=>[m.ward,m.title]),[[4,'Ward 4 Community Meeting']]);
  assert.match(meetings[0].body,/Source: Cleveland City Council events calendar, https:\/\/www\.clevelandcitycouncil\.gov\/ward-4-meeting$/);
  assert.deepEqual(pickCouncil('<html>no calendar</html>'),[]);
});

test('import places events in their neighborhood, from the owner, once, and within the weekly limits',async()=>{
  const base = { body:'Details', place:'Somewhere' };
  const events = [
    { ...base, branch:'South Brooklyn', source_url:'https://cpl.libcal.com/event/91', title:'Ornament craft', starts_at:new Date(Date.now()+2*86400000).toISOString() },
    { ...base, branch:'Atlantis', source_url:'https://cpl.libcal.com/event/92', title:'Unknown branch', starts_at:new Date(Date.now()+2*86400000).toISOString() },
    { ...base, branch:'South Brooklyn', source_url:'https://cpl.libcal.com/event/93', title:'Too far out', starts_at:new Date(Date.now()+30*86400000).toISOString() },
    { ...base, ward:4, source_url:'https://www.clevelandcitycouncil.gov/w4', title:'Ward 4 Community Meeting', starts_at:new Date(Date.now()+3*86400000).toISOString() },
    { ...base, body:'', branch:'South Brooklyn', source_url:'https://cpl.libcal.com/event/90', title:'No description', starts_at:new Date(Date.now()+2*86400000).toISOString() },
    { ...base, branch:'South Brooklyn', source_url:'https://cpl.libcal.com/event/89', title:'x'.repeat(5), place:'p'.repeat(5), starts_at:'not a date' },
    ...[94,95,96].map((id)=>({ ...base, branch:'South Brooklyn', source_url:'https://cpl.libcal.com/event/'+id, title:'Event '+id, starts_at:new Date(Date.now()+4*86400000).toISOString() }))
  ];
  const first = await importEvents(db,{ events });
  assert.equal(first.areas['old-brooklyn'],3,'stops at 3 new events for Old Brooklyn');
  assert.equal(first.posted,5,'the 2 extra library events go next door');
  const rows = (await db.query("select author_id,area_id,reach,title,source_url from neighborhood.posts where source_url is not null order by event_at,title")).rows;
  const home = rows.filter((r)=>r.area_id==='old-brooklyn');
  assert.deepEqual(home.map((r)=>r.title),['Ornament craft','Ward 4 Community Meeting','Event 94']);
  assert.deepEqual(rows.filter((r)=>r.area_id!=='old-brooklyn').map((r)=>r.title),['Event 95','Event 96']);
  assert.ok(rows.every((r)=>r.author_id===actors.rina && r.reach==='region'));
  const again = await importEvents(db,{ events });
  assert.equal(again.posted,0,'never posts the same event twice, and Old Brooklyn now has 4 coming up');
  assert.ok(again.empty.includes('Tremont'));
});

test('the weekly job needs its secret and reports what it posted',async()=>{
  const calls = [];
  const handler = makeHandler({ env:{ CRON_SECRET:'s3cret', SUPABASE_SECRET_KEY:'x' }, local:true,
    database:{ configured:true, importEvents:async(d)=>{ calls.push(d); return { posted:d.events.length, skipped:0, areas:{}, empty:[] }; } },
    gather:async()=>({ events:[{ title:'x' }], failures:['council'] }) });
  const run = async (headers) => { const out = { headers:{}, setHeader(k,v){ this.headers[k]=v; }, end(body){ this.body = body; } };
    await handler({ method:'GET', url:'/api/core?action=events', headers, async *[Symbol.asyncIterator](){} },out); return out; };
  assert.equal((await run({})).statusCode,401);
  const ok = await run({ authorization:'Bearer s3cret' });
  assert.equal(ok.statusCode,200);
  assert.deepEqual(JSON.parse(ok.body),{ posted:1, skipped:0, areas:{}, empty:[], found:1, failures:['council'] });
  assert.equal(calls[0].limit,100);
});

test('gathering survives a calendar that is down',async()=>{
  const request = async (url) => url.startsWith('https://cpl') ? { ok:true, json:async()=>({ results:[libraryEvent(7,'Puppet Show','Hough',2,{categories:' Family Fun'})] }) } : { ok:false, status:503 };
  const { events, failures } = await gatherEvents(request);
  assert.equal(events.length,1);
  assert.deepEqual(failures,['council']);
});

test('a full branch neighborhood passes its extra library events to the emptiest bordering neighborhood without a branch, once each',async()=>{
  const at = new Date(Date.now()+5*86400000).toISOString();
  const events = [101,102,103,104,105,106].map((id)=>({ branch:'Cleveland Public Library · Harvard-Lee branch', source_url:'https://cpl.libcal.com/event/'+id,
    title:'Harvard-Lee event '+id, body:'Details', place:'Cleveland Public Library, Harvard-Lee branch', starts_at:at }));
  const result = await importEvents(db,{ events });
  assert.equal(result.posted,6);
  assert.equal(result.areas['lee-harvard'],3,'the branch neighborhood fills first');
  const rows = (await db.query("select area_id,source_url from neighborhood.posts where source_url like 'https://cpl.libcal.com/event/10_%' order by source_url")).rows;
  assert.equal(rows.length,6,'each event is posted once');
  assert.ok(rows.every((r)=>!r.source_url.includes('#')));
  const borrowers = [...new Set(rows.map((r)=>r.area_id).filter((a)=>a!=='lee-harvard'))];
  assert.ok(borrowers.includes('lee-seville'));
  for (const area of borrowers) {
    const { rows:[link] } = await db.query("select a.region,exists(select 1 from neighborhood.guide_items g where g.area_id = $1 and g.kind = 'library') branch,"+
      " exists(select 1 from neighborhood.area_links l where l.area_id = 'lee-harvard' and l.nearby_id = $1) next_door from neighborhood.areas a where a.id = $1",[area]);
    assert.deepEqual(link,{ region:'Cleveland', branch:false, next_door:true },area);
  }
  assert.equal((await importEvents(db,{ events })).posted,0,'never posted again');
});
