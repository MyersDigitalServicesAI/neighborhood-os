import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const post = async (who,title,reach = 'area') => (await call(who,'create_post',{kind:'discussion',reach,title,body:'A post for the pinned posts tests, long enough to pass.'})).id;

before(async()=>{
  db = await initDatabase();
  await fixtures(db);
});
after(async()=>{ await db?.close(); });

test('admins pin up to three posts per neighborhood, everyone sees them first',async()=>{
  assert.equal((await call('rina','bootstrap')).canPin,true);
  assert.equal((await call('devon','bootstrap')).canPin,false,'moderators cannot pin');
  const welcome = await post('rina','Welcome to the neighborhood');
  await assert.rejects(call('devon','pin_post',{id:welcome}),/Only admins/);
  await assert.rejects(call('ava','pin_post',{id:welcome}),/Only admins/);

  assert.deepEqual(await call('ava','pinned'),[]);
  await call('rina','pin_post',{id:welcome});
  const pinned = await call('ava','pinned');
  assert.deepEqual(pinned.map((p)=>[p.title,p.pinned]),[['Welcome to the neighborhood',true]]);
  assert.equal((await call('ava','post',{id:welcome})).pinned,true);
  assert.equal((await call('ava','feed')).find((p)=>p.id===welcome).pinned,true);
  assert.deepEqual(await call('taylor','pinned'),[],'a pin in Old Brooklyn stays in Old Brooklyn');

  const two = await post('ava','Second');
  const three = await post('ava','Third');
  const four = await post('ava','Fourth');
  await call('rina','pin_post',{id:two,days:'7'});
  await call('rina','pin_post',{id:three});
  await assert.rejects(call('rina','pin_post',{id:four}),/Old Brooklyn already has 3 pinned posts/);
  await call('rina','pin_post',{id:three,days:30});
  assert.ok((await call('ava','post',{id:two})).pinned_until,'a timed pin reports when it ends');
  await assert.rejects(call('rina','pin_post',{id:four,days:400}),/between 1 and 365/);

  await call('rina','unpin_post',{id:three});
  await call('rina','pin_post',{id:four});
  assert.deepEqual((await call('ava','pinned')).map((p)=>p.title),['Fourth','Second','Welcome to the neighborhood']);
  assert.equal((await call('rina','admin')).pins.length,3);
  const audit = (await db.query("select action from neighborhood.audit where action in ('pin_post','unpin_post')")).rows.length;
  assert.equal(audit,6);
});

test('pins end on their date, vanish with deleted posts, and follow the post reach',async()=>{
  const [second] = (await db.query("select id from neighborhood.posts where title = 'Second'")).rows;
  await db.query("update neighborhood.posts set pinned_until = now() - interval '1 minute' where id = $1",[second.id]);
  assert.ok(!(await call('ava','pinned')).some((p)=>p.title==='Second'),'an expired pin drops off');
  assert.equal((await call('ava','post',{id:second.id})).pinned,false);

  const [fourth] = (await db.query("select id from neighborhood.posts where title = 'Fourth'")).rows;
  await call('ava','delete_post',{id:fourth.id});
  assert.ok(!(await call('ava','pinned')).some((p)=>p.title==='Fourth'),'a deleted post is no longer pinned');

  const everyone = await post('rina','Northeast Ohio announcement','region');
  await call('rina','pin_post',{id:everyone});
  assert.deepEqual(await call('taylor','pinned'),[],'other neighborhoods only see it when they look region-wide');
  assert.deepEqual((await call('taylor','pinned',{scope:'region'})).map((p)=>p.title),['Northeast Ohio announcement']);
});
