import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
let business;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const evidence = (id) => ({id,action:'approved',reason:'Synthetic checks exercised only.',attestation:true,
  identityEvidence:'Synthetic registration check.',controlEvidence:'Synthetic public contact challenge.',licenseEvidence:'Synthetic credential check.'});
const verify = (who) => db.query('update neighborhood.members set verified_at = now() where id = $1',[actors[who] ?? who]);
before(async()=>{ db = await initDatabase(); business = await fixtures(db); });
after(async()=>{ await db?.close(); });

test('only the owner and the vetters they choose decide business vetting',async()=>{
  await call('luis','apply_vetting',{id:business,legal:'Fixture company',registration:'Fixture registry',contact:'Fixture contact'});
  await call('rina','set_vetter',{id:actors.devon,remove:true});
  assert.equal((await call('devon','moderation')).vetting.length,0,'a moderator without vetting rights sees no vetting queue');
  await assert.rejects(call('devon','decide_vetting',evidence(business)),/platform owner and the people they choose/);
  await assert.rejects(call('devon','set_vetter',{id:actors.devon}),/Only the platform owner/);
  await assert.rejects(call('rina','set_vetter',{id:actors.ava}),/moderator or admin first/);
  await call('rina','set_vetter',{id:actors.devon});
  assert.deepEqual((await call('rina','admin')).vetters.map((v)=>v.name),['Devon W.']);
  assert.equal((await call('devon','bootstrap')).vetter,true);
  assert.deepEqual([(await call('rina','bootstrap')).owner,(await call('devon','bootstrap')).owner],[true,false]);
  await call('devon','decide_vetting',evidence(business));
  assert.equal((await call('ava','business',{id:business})).verified,false,'approved but the fee is not paid yet');
  await call('rina','decide_vetting',{id:business,action:'revoked',reason:'Owner revoked this synthetic approval.'});
});

test('the first 50 verified neighbors in each neighborhood get a founding number',async()=>{
  assert.equal((await call('ava','bootstrap')).foundingLeft,50);
  await verify('jamal');
  await verify('ava');
  await verify('taylor');
  assert.equal((await call('jamal','bootstrap')).founding,1);
  assert.equal((await call('ava','bootstrap')).founding,2);
  assert.equal((await call('taylor','bootstrap')).founding,1,'numbering is per neighborhood');
  assert.equal((await call('ava','bootstrap')).foundingLeft,48);
  const profile = await call('luis','profile',{id:actors.ava});
  assert.deepEqual([profile.founding,profile.foundingArea],[2,'Old Brooklyn']);

  // An undone verification gives the number up; becoming verified again takes the next free one.
  await db.query('update neighborhood.members set verified_at = null where id = $1',[actors.jamal]);
  assert.equal((await call('jamal','bootstrap')).founding,null);
  await verify('jamal');
  assert.equal((await call('jamal','bootstrap')).founding,3);

  for (let i = 0; i < 48; i++) {
    const id = '00000000-0000-4000-b000-'+String(i).padStart(12,'0');
    await db.query("insert into auth.users(id,email_confirmed_at,email) values($1,now(),$2)",[id,'f'+i+'@neighborhood.test']);
    await rpc(db,id,'join',{name:'Founder '+i,attest:true,area:'old-brooklyn'});
    await verify(id);
  }
  const last = '00000000-0000-4000-b000-000000000047';
  assert.equal((await rpc(db,last,'bootstrap')).founding,null,'number 51 does not get a badge');
  assert.equal((await rpc(db,last,'bootstrap')).foundingLeft,0);
  assert.equal((await db.query("select max(founding_no)::int n from neighborhood.members where founding_area = 'old-brooklyn'")).rows[0].n,50);
});
