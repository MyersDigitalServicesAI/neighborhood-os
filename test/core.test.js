import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, sync, actors } from './db.js';
let db;
let business;
const call = (actor,op,data) => rpc(db,actors[actor],op,data);
before(async()=>{ db = await initDatabase(); business = await fixtures(db); });
after(async()=>{ await db?.close(); });

test('confirmed accounts, pilot enrollment, and neighborhood attestation are enforced in SQL',async()=>{
  await assert.rejects(call('unconfirmed','bootstrap'),/confirmed email/);
  await db.exec('update neighborhood.launch_settings set public_enrollment=false');
  assert.equal((await call('new','bootstrap')).canJoin,false);
  await assert.rejects(call('new','join',{area:'old-brooklyn',name:'New T.',attest:true}),/Pilot access/);
  await db.query('insert into neighborhood.pilot_access values($1)',[actors.new]);
  await assert.rejects(call('new','join',{area:'old-brooklyn',name:'New T.'}),/attestation/);
  await call('new','join',{area:'old-brooklyn',name:'New T.',attest:true});
  assert.equal((await call('new','bootstrap')).member.name,'New T.');
});
test('feed isolation, personal referrals, free disclosed replies, and close permissions',async()=>{
  const req = (await call('ava','feed',{kind:'request'}))[0];
  assert.equal((await call('taylor','feed')).length,0);
  await assert.rejects(call('taylor','post',{id:req.id}),/unavailable/);
  await assert.rejects(call('ava','reply',{id:req.id,business,body:'Spoofed company response.'}),/own business/);
  await call('jamal','reply',{id:req.id,body:'Try a neighborhood carpenter. They helped me last year.'});
  await call('luis','reply',{id:req.id,business,body:'My business can take a look this week.'});
  await call('new','reply',{id:req.id,affiliated:true,body:'I work for a crew nearby and can share details.'});
  const detail = await call('ava','post',{id:req.id});
  assert.deepEqual(detail.replies.map((r)=>r.affiliated),[false,true,true]);
  assert.equal(detail.replies[1].business,'Juniper Home Repair');
  assert.equal(detail.replies[2].business_id,null);
  await assert.rejects(call('luis','close_post',{id:req.id}),/unavailable/);
  await call('ava','close_post',{id:req.id});
  await assert.rejects(call('luis','reply',{id:req.id,body:'This should be closed.'}),/unavailable/);
});
test('only conversation participants see messages and blocking prevents sends both ways',async()=>{
  const {id} = await call('ava','message',{peer:actors.jamal,body:'Private conversation about a fixture.'});
  assert.equal((await call('jamal','thread',{id})).messages[0].body,'Private conversation about a fixture.');
  await assert.rejects(call('luis','thread',{id}),/unavailable/);
  await assert.rejects(call('rina','thread',{id}),/unavailable/);
  await assert.rejects(call('taylor','message',{peer:actors.ava,body:'cross-area'}),/unavailable/);
  await call('jamal','block',{peer:actors.ava});
  await assert.rejects(call('ava','message',{id,body:'Denied message'}),/unavailable/);
  await assert.rejects(call('jamal','message',{id,body:'Denied message'}),/unavailable/);
  await call('jamal','unblock',{peer:actors.ava});
  await call('jamal','message',{id,body:'Messages restored'});
  assert.equal((await call('ava','thread',{id})).messages.length,2);
});
test('business profile ownership and neighborhood boundaries are enforced',async()=>{
  assert.equal((await call('taylor','directory')).length,0);
  await assert.rejects(call('taylor','business',{id:business}),/unavailable/);
  await assert.rejects(call('ava','update_business',{id:business,category:'Retail',description:'Unauthorized changes'}),/unavailable/);
  const b = await call('ava','business',{id:business});
  assert.equal(b.verified,false);
  assert.equal('vetting' in b,false);
});
test('local screening queues reviews, humans decide, and a different moderator decides an appeal',async()=>{
  await assert.rejects(call('luis','submit_review',{id:business,rating:5,attest:true,body:'The business did excellent work.'}),/cannot review/);
  await assert.rejects(call('ava','submit_review',{id:business,rating:5,body:'Excellent work at the fixture address.'}),/firsthand/);
  const body = 'They gave me a gift card in exchange for a review. Test fixture only.';
  const {id} = await call('ava','submit_review',{id:business,rating:5,body,attest:true});
  const duplicate = await call('jamal','submit_review',{id:business,rating:5,body,attest:true});
  await assert.rejects(call('ava','moderation'),/Moderator access/);
  assert.equal((await call('jamal','business',{id:business})).reviews.length,0);
  const cases = (await call('rina','moderation')).reviews;
  const incentivized = cases.find((r)=>r.id===id);
  assert.equal(incentivized.signals.incentive,true);
  assert.equal(incentivized.model_version,'local-bernoulli-v2');
  assert.ok(incentivized.score >= .45);
  assert.ok(cases.find((r)=>r.id===duplicate.id).score > incentivized.score);
  assert.equal(cases.find((r)=>r.id===duplicate.id).signals.duplicate,true);
  await call('rina','decide_review',{id,action:'removed',reason:'The review mentions an incentive tied to the submission.'});
  await assert.rejects(call('jamal','appeal',{id,body:'I am not the author of this review and cannot appeal.'}),/unavailable/);
  await call('ava','appeal',{id,body:'This fixture tests independent moderator reconsideration.'});
  await assert.rejects(call('rina','decide_appeal',{id,action:'restored',reason:'Same person must be denied.'}),/independent moderator/);
  await call('devon','decide_appeal',{id,action:'restored',reason:'Independent synthetic test decision recorded.'});
  assert.equal((await call('ava','my_reviews'))[0].appeal,'restored');
  assert.equal((await call('jamal','business',{id:business})).reviews[0].id,id);
  await call('luis','report_review',{id,reason:'Please review this potentially incentivized submission.'});
  assert.ok((await call('rina','moderation')).reviews.some((review)=>review.id===id && review.reports.length===1));
  await call('rina','decide_review',{id,action:'published',reason:'Report resolved after a synthetic test review.'});
});
test('posts and replies can be reported locally and removed by staff',async()=>{
  const {id} = await call('ava','create_post',{kind:'discussion',title:'Synthetic report target',body:'This post exists for the moderation regression test.'});
  await assert.rejects(call('taylor','report_content',{id,kind:'post',reason:'Cross area report must fail.'}),/unavailable/);
  await call('jamal','report_content',{id,kind:'post',reason:'Please review this synthetic post fixture.'});
  const {content} = await call('rina','moderation');
  assert.equal(content[0].title,'Synthetic report target');
  await assert.rejects(call('ava','decide_content',{id:content[0].id,action:'remove',reason:'Self decision should be denied.'}),/Moderator access/);
  await call('rina','decide_content',{id:content[0].id,action:'remove',reason:'Removed a synthetic test post in moderation.'});
  await assert.rejects(call('jamal','post',{id}),/unavailable/);
  assert.ok(!(await call('ava','feed')).some((p)=>p.id===id));
});
test('badge requires independent vetting and current paid entitlement; invalidation removes it',async()=>{
  await assert.rejects(call('luis','checkout',{id:business}),/Human vetting/);
  await call('luis','apply_vetting',{id:business,legal:'Fixture company',registration:'Fixture registry',contact:'Fixture contact'});
  await assert.rejects(call('rina','decide_vetting',{id:business,action:'approved',reason:'Incomplete evidence test.'}),/Record independent/);
  const evidence = {id:business,action:'approved',reason:'Synthetic checks exercised only.',attestation:true,
    identityEvidence:'Synthetic registration check.',controlEvidence:'Synthetic public contact challenge.',
    licenseEvidence:'Synthetic credential check.'};
  await assert.rejects(call('luis','decide_vetting',evidence),/Moderator access/);
  await call('rina','decide_vetting',evidence);
  assert.equal((await call('ava','business',{id:business})).verified,false);
  const checkout = await call('luis','checkout',{id:business});
  assert.equal((await call('luis','checkout',{id:business})).key,checkout.key);
  const payment = {business,checkoutKey:checkout.key,payment:'pi_fixture',customer:'cus_fixture',paid:true,observedAt:new Date().toISOString()};
  assert.equal(await sync(db,{...payment,checkoutKey:crypto.randomUUID()}),false);
  assert.equal(await sync(db,{...payment,paid:false}),false);
  assert.equal((await call('ava','business',{id:business})).verified,false);
  assert.equal(await sync(db,payment),true);
  assert.equal(await sync(db,payment),true);
  assert.equal((await call('ava','business',{id:business})).verified,true);
  assert.equal((await call('luis','my_businesses'))[0].paid,true);
  await assert.rejects(call('luis','checkout',{id:business}),/already paid/);
  assert.equal(await sync(db,{business,checkoutKey:checkout.key,expired:true,observedAt:new Date().toISOString()}),false);
  assert.equal(await sync(db,{business,payment:'pi_other',refunded:true,observedAt:new Date().toISOString()}),false);
  assert.equal((await call('ava','business',{id:business})).verified,true);
  await call('luis','update_business',{id:business,category:'Retail',description:'Synthetic profile change.',website:''});
  assert.equal((await call('ava','business',{id:business})).verified,false);
  await assert.rejects(call('luis','checkout',{id:business}),/Human vetting/);
  await call('luis','apply_vetting',{id:business,legal:'Fixture company',registration:'Fixture registry',contact:'Fixture contact'});
  await call('devon','decide_vetting',{...evidence,reason:'Synthetic recheck after the profile change.'});
  assert.equal((await call('ava','business',{id:business})).verified,true,'a paid fee carries over to a fresh approval');
  assert.equal(await sync(db,{business,payment:'pi_fixture',refunded:true,observedAt:new Date().toISOString()}),true);
  assert.equal((await call('ava','business',{id:business})).verified,false);
  assert.ok((await call('luis','checkout',{id:business})).key !== checkout.key);
});
test('private tables and privileged billing RPC are inaccessible to clients',async()=>{
  await assert.rejects(db.transaction(async(tx)=>{
    await tx.exec('set local role authenticated');
    await tx.exec('select * from neighborhood.messages');
  }),/permission denied/);
  await assert.rejects(db.transaction(async(tx)=>{
    await tx.exec('set local role authenticated');
    await tx.exec("select public.neighborhood_billing('{}')");
  }),/permission denied/);
  await assert.rejects(db.transaction(async(tx)=>{
    await tx.exec('set local role anon');
    await tx.exec("select public.neighborhood_app('bootstrap')");
  }),/permission denied/);
});
