import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
let business;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const evidence = (id) => ({id,action:'approved',reason:'Synthetic checks exercised only.',attestation:true,
  identityEvidence:'Synthetic registration check.',controlEvidence:'Synthetic public contact challenge.',licenseEvidence:'Synthetic credential check.'});
before(async()=>{ db = await initDatabase(); business = await fixtures(db); });
after(async()=>{ await db?.close(); });

test('an admin waives the fee, but the badge still needs an approval from staff who do not own the business',async()=>{
  await assert.rejects(call('rina','waive_fee',{id:business,reason:'Founding business pilot'}),/apply for vetting first/);
  await call('luis','apply_vetting',{id:business,legal:'Fixture company',registration:'Fixture registry',contact:'Fixture contact'});
  await assert.rejects(call('devon','waive_fee',{id:business,reason:'Founding business pilot'}),/Admin access/,'moderators cannot waive fees');
  await assert.rejects(call('luis','waive_fee',{id:business,reason:'Founding business pilot'}),/Admin access/);
  await assert.rejects(call('rina','waive_fee',{id:business,reason:'short'}),/at least 8 characters/);
  assert.equal((await call('rina','admin')).fees[0].paid,false);

  await call('rina','waive_fee',{id:business,reason:'Founding business pilot'});
  await assert.rejects(call('rina','waive_fee',{id:business,reason:'Founding business pilot'}),/already paid or waived/);
  const mine = (await call('luis','my_businesses'))[0];
  assert.deepEqual([mine.paid,mine.waived,mine.verified],[true,true,false],'a waiver alone does not give the badge');
  await assert.rejects(call('luis','checkout',{id:business}),/Human vetting|already paid/);

  await call('devon','decide_vetting',evidence(business));
  assert.equal((await call('ava','business',{id:business})).verified,true);
  const audit = (await db.query("select actor,details from neighborhood.audit where action = 'vetting_fee_waived'")).rows;
  assert.deepEqual(audit.map((a)=>[a.actor,a.details.reason,a.details.own]),[[actors.rina,'Founding business pilot',false]]);
});

test('the owner can waive and approve their own business; a chosen vetter cannot approve their own',async()=>{
  const own = await call('rina','create_business',{name:'Rina Pottery Studio',category:'Retail',
    description:'Hand-thrown mugs and planters made in a small home studio near the library.',website:''});
  await call('rina','apply_vetting',{id:own.id,legal:'Rina Pottery LLC',registration:'Ohio SOS 1234567',contact:'Studio website'});
  await call('rina','waive_fee',{id:own.id,reason:'Founder business, reviewed by a second moderator'});
  assert.equal((await call('rina','admin')).fees.find((f)=>f.id===own.id).mine,true);
  assert.equal((await call('rina','moderation')).vetting.find((v)=>v.id===own.id).own,true,'the owner sees their own business in the queue');
  await call('rina','decide_vetting',evidence(own.id));
  assert.equal((await call('ava','business',{id:own.id})).verified,true);
  const audit = (await db.query("select details->>'own' own from neighborhood.audit where action = 'decide_vetting' and subject = $1",[own.id])).rows;
  assert.deepEqual(audit,[{own:'true'}],'a self-approval is marked in the audit log');

  const devonsShop = await call('devon','create_business',{name:'Devon Bike Repair',category:'Retail',
    description:'Tune-ups, flat repairs and used bikes from a garage workshop on the west side.',website:''});
  await call('devon','apply_vetting',{id:devonsShop.id,legal:'Devon Bikes',registration:'Ohio trade name 99887',contact:'Shop phone'});
  assert.equal((await call('devon','moderation')).vetting.some((v)=>v.id===devonsShop.id),false);
  await assert.rejects(call('devon','decide_vetting',evidence(devonsShop.id)),/unavailable or incomplete/);
});
