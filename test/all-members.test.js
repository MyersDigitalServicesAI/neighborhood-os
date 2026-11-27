import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors, importEvents, publicEvents } from './db.js';
import { pickCounty } from '../server/events.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const titles = async (who,data) => (await call(who,'feed',data)).map((p)=>p.title);
const threads = async () => (await db.query('select count(*)::int n from neighborhood.threads')).rows[0].n;
const inDays = (days) => new Date(Date.now()+days*86400000).toISOString();

before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

test('new posts reach every member in every neighborhood, and older apps can’t keep them local',async()=>{
  const fresh = await call('ava','create_post',{kind:'discussion',title:'Hello from Old Brooklyn',body:'New here and saying hi to everyone.'});
  const old = await call('ava','create_post',{kind:'sale',title:'Snow shovel',price:'5',body:'Sturdy and ready for winter.',reach:'area'});
  await assert.rejects(call('ava','create_post',{kind:'discussion',title:'Bad reach',body:'Not a real choice.',reach:'world'}),/who can see/);
  const rows = (await db.query('select id,reach from neighborhood.posts where id = any($1)',[[fresh.id,old.id]])).rows;
  assert.ok(rows.every((r)=>r.reach==='members'),'an app opened before the update still posts to all members');

  // Taylor lives in Parma.
  assert.ok((await titles('taylor',{scope:'region'})).includes('Hello from Old Brooklyn'),'the all-members feed shows it');
  assert.ok(!(await titles('taylor',{})).includes('Hello from Old Brooklyn'),'the my-neighborhood view stays local');
  const seen = await call('taylor','post',{id:fresh.id});
  assert.deepEqual([seen.reach,seen.local,seen.area],['members',false,'Old Brooklyn']);
  await call('taylor','reply',{id:fresh.id,body:'Welcome from Parma!'});
  assert.ok((await call('taylor','search',{q:'snow shovel'})).posts.length === 1);
  // Members-only is not public.
  assert.ok(!JSON.stringify(await publicEvents(db)).includes('Hello from Old Brooklyn'));
  // Fixture posts stand for older neighborhood-only posts, which stay home.
  assert.ok(!(await titles('taylor',{scope:'region'})).includes('Looking for a reliable fence repair'));
});

test('any member can find and message any other member; blocks, sample accounts and bad messages leave no conversation',async()=>{
  const far = await call('taylor','search',{q:'jamal'});
  assert.deepEqual(far.neighbors.map((n)=>[n.name,n.area]),[['Jamal R.','Old Brooklyn']]);
  const before = await threads();
  await assert.rejects(call('taylor','message',{peer:actors.jamal,body:''}));
  assert.equal(await threads(),before,'an empty message opens nothing');
  const { id } = await call('taylor','message',{peer:actors.jamal,body:'Do you know a good mechanic near Pearl Road?'});
  assert.equal((await call('jamal','thread',{id})).messages[0].body,'Do you know a good mechanic near Pearl Road?');

  await call('devon','block',{peer:actors.taylor});
  const count = await threads();
  await assert.rejects(call('taylor','message',{peer:actors.devon,body:'Hello?'}),/unavailable/);
  await assert.rejects(call('devon','message',{peer:actors.taylor,body:'Hello?'}),/unavailable/);
  assert.equal(await threads(),count,'a block opens nothing either way');
  assert.ok(!(await call('devon','search',{q:'taylor'})).neighbors.length,'people you blocked drop out of search');
  await call('devon','unblock',{peer:actors.taylor});
  await call('taylor','message',{peer:actors.devon,body:'Thanks for unblocking me.'});
  await assert.rejects(call('taylor','block',{peer:actors.taylor}),/unavailable/,'you can’t block yourself');

  await db.query('update neighborhood.members set sample = true where id = $1',[actors.luis]);
  await assert.rejects(call('taylor','message',{peer:actors.luis,body:'Hi'}),/unavailable/);
  assert.ok(!(await call('taylor','search',{q:'luis'})).neighbors.length);
  await db.query('update neighborhood.members set sample = false where id = $1',[actors.luis]);
});

test('events that name their neighborhood land there, and County library events stay in Parma and Brook Park',async()=>{
  const result = await importEvents(db,{ events:[
    { area:'parma', source_url:'https://attend.cuyahogalibrary.org/event/1', title:'Holiday sing along at the Parma-Powers library', body:'Sing with us.', place:'CCPL Parma-Powers', starts_at:inDays(3) },
    { area:'atlantis', source_url:'https://attend.cuyahogalibrary.org/event/2', title:'Nowhere', body:'Nope.', place:'Nowhere', starts_at:inDays(3) }
  ]});
  assert.deepEqual([result.posted,result.skipped],[1,1]);
  const [row] = (await db.query("select area_id,reach from neighborhood.posts where source_url = 'https://attend.cuyahogalibrary.org/event/1'")).rows;
  assert.deepEqual(row,{ area_id:'parma', reach:'region' });

  const base = { private_event:'0', registration_cost:'0', datestring:'Saturday, December 5', event_start:'2026-12-05 14:00:00', description:'Details.' };
  const picked = pickCounty([
    { ...base, id:'1', library:'Parma-Snow Branch', title:'Laser Basics', time_string:'2:00pm - 3:00pm', url:'https://attend.cuyahogalibrary.org/event/1' },
    { ...base, id:'2', library:'Parma-Snow Branch', title:'Laser Basics', time_string:'3:30pm - 4:30pm', url:'https://attend.cuyahogalibrary.org/event/2' },
    { ...base, id:'3', library:'Brook Park Branch', title:'Kids Cafe', time_string:'3:30pm - 4:30pm', url:'https://attend.cuyahogalibrary.org/event/3' },
    { ...base, id:'4', library:'Brook Park Branch', title:'Beginning Reader Kits', time_string:'All day', url:'https://attend.cuyahogalibrary.org/event/4' },
    { ...base, id:'5', library:'Parma Heights Branch', title:'Wooden Puzzles', time_string:'6:00pm - 7:30pm', url:'https://attend.cuyahogalibrary.org/event/5' },
    { ...base, id:'6', library:'Brook Park Branch', title:'Cleveland’s 1928 Mafia Summit', time_string:'6:00pm - 7:00pm', url:'https://attend.cuyahogalibrary.org/event/6' },
    { ...base, id:'7', library:'Brook Park Branch', title:'Paid workshop', registration_cost:'15', time_string:'6:00pm - 7:00pm', url:'https://attend.cuyahogalibrary.org/event/7' },
    { ...base, id:'8', library:'Brook Park Branch', title:'Lookalike', time_string:'6:00pm - 7:00pm', url:'https://evil.example/event/8' }
  ]);
  assert.deepEqual(picked.map((e)=>[e.area,e.title]),[['parma','Laser Basics at the Parma-Snow library'],['brook-park','Cleveland’s 1928 Mafia Summit at the Brook Park library']]);
  assert.match(picked[0].body,/Free at the Parma-Snow branch of Cuyahoga County Public Library, Saturday, December 5, 2:00pm - 3:00pm/);
  assert.deepEqual(pickCounty(null),[]);
});

test('one “Today across Cleveland” post a day lists today’s shared events, is pinned for everyone and replaces yesterday’s',async()=>{
  await db.query("insert into neighborhood.posts(author_id,area_id,kind,reach,title,body,source_url,pinned_at,pinned_until) values($1,'downtown','discussion','members','Old roundup','Yesterday.','https://nabora.us/#events?day=2000-01-01',now() - interval '1 day',now() + interval '1 hour')",[actors.rina]);
  assert.deepEqual(await importEvents(db,{ op:'roundup' }),{ roundup:'none' },'no events today, no post');
  assert.ok(!(await call('taylor','pinned',{scope:'region'})).some((p)=>p.title==='Old roundup'),'yesterday’s roundup comes down even on a quiet day');

  const soon = "now() + interval '1 second'";
  await db.query(`insert into neighborhood.posts(author_id,area_id,kind,reach,title,body,event_at) values
    ($1,'old-brooklyn','event','region','Tree lighting','Lights on.',${soon}),
    ($1,'parma','event','members','Cookie swap','Bring a dozen.',${soon}),
    ($1,'old-brooklyn','event','area','Private block party','Just us.',${soon})`,[actors.ava]);
  const posted = await importEvents(db,{ op:'roundup' });
  assert.deepEqual(posted,{ roundup:'posted', events:2 });
  const [roundup] = (await call('taylor','pinned',{scope:'region'})).filter((p)=>p.title.startsWith('Today across Cleveland'));
  assert.ok(roundup,'pinned for a member in another neighborhood');
  assert.match(roundup.body,/Tree lighting \(Old Brooklyn\)/);
  assert.match(roundup.body,/Cookie swap \(Parma\)/);
  assert.doesNotMatch(roundup.body,/Private block party/,'neighborhood-only events stay out');
  assert.equal(roundup.reach,'members');
  assert.deepEqual(await importEvents(db,{ op:'roundup' }),{ roundup:'exists' },'once a day');
  assert.ok(!JSON.stringify(await publicEvents(db)).includes('Today across Cleveland'));
});

test('members can only reach the new layer through the app entry point',async()=>{
  for (const statement of ["select neighborhood.dispatch17('feed','{}')","select neighborhood.daily_roundup()","select public.neighborhood_events('{\"op\":\"roundup\"}')"]) {
    await assert.rejects(db.transaction(async(tx)=>{ await tx.exec('set local role authenticated'); await tx.query(statement); }),/permission denied/,statement);
  }
});

test('imported events never repost a person’s email, from any source, and keep the organizer’s link',async()=>{
  const { withoutContacts, pickLibrary } = await import('../server/events.js');
  const text = 'Come join us for an all-abilities book club!\n\nWe read books and more.\n\nIf you have any questions, email or call Kathleen at keiben@cuyahogalibrary.org/216-661-4240\n\nFor more information, visit https://nextchapterbookclub.org/program/';
  const clean = withoutContacts(text);
  assert.doesNotMatch(clean,/@|Kathleen|661-4240/);
  assert.match(clean,/all-abilities book club!\n\nWe read books and more\.\n\nFor more information, visit https:\/\/nextchapterbookclub\.org\/program\//);
  assert.equal(withoutContacts('Great fun. Write to jo.smith@example.org with questions. See you there!'),'Great fun. See you there!','only the sentence with the address goes');
  assert.equal(withoutContacts('Call the branch at 216-267-5250.'),'Call the branch at 216-267-5250.','the branch’s own phone line stays');

  const county = pickCounty([{ id:'9', library:'Parma-Snow Branch', title:'Book club', time_string:'11:00am - 12:00pm', url:'https://attend.cuyahogalibrary.org/event/9',
    private_event:'0', registration_cost:'0', datestring:'Saturday, November 28', event_start:'2026-11-28 11:00:00', long_description:'<p>'+text.replaceAll('\n\n','</p><p>')+'</p>' }]);
  assert.doesNotMatch(county[0].body,/@|Kathleen/);
  assert.match(county[0].body,/Details and any sign-up: https:\/\/attend\.cuyahogalibrary\.org\/event\/9$/);

  const library = pickLibrary([{ id:1, title:'Chess Club', campus:'Hough', categories:'Games, Strategy', url:'https://cpl.libcal.com/event/1', start:'4:00pm', end:'5:00pm',
    startdt:'2026-12-01 16:00:00', description:'Learn chess. Contact mr.jones@cpl.org with questions.' }]);
  assert.match(library[0].body,/^Learn chess\.\n\nFree at the Hough branch/);
});
