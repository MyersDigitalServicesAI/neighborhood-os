import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
let business;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const review = (body,extra = {}) => ({ id:business,rating:5,body,attest:true,no_incentive:true,...extra });

before(async()=>{
  db = await initDatabase(); await fixtures(db);
  business = (await db.query("select id from neighborhood.businesses where name = 'Juniper Home Repair'")).rows[0].id;
});
after(async()=>{ await db?.close(); });

test('a reviewer confirms nobody paid them, says how they are connected, and competitors are disclosed automatically',async()=>{
  await assert.rejects(call('ava','submit_review',{ ...review('Fixed our gutters fast and cleaned up after.'),no_incentive:false }),/nobody paid you/);
  await assert.rejects(call('ava','submit_review',review('Fixed our gutters fast and cleaned up after.',{ relationship:'cousin' })),/connected/);
  await call('ava','submit_review',review('Fixed our gutters fast and cleaned up after. My cousin works there.',{ relationship:'family' }));

  // Jamal owns another home-services business in Old Brooklyn, so his review of a rival is labeled.
  await call('jamal','create_business',{ pledge:true,name:'Brookside Handyman',category:'Home services',description:'Small fixes around the house. Fixture business for testing.',website:'' });
  await call('jamal','submit_review',{ ...review('Did a decent job on a door frame for a neighbor of mine.'),rating:2 });
  const rows = (await db.query('select author_id,relationship,affiliated,no_incentive,signals,score from neighborhood.reviews where business_id = $1',[business])).rows;
  const ava = rows.find((r)=>r.author_id===actors.ava);
  const jamal = rows.find((r)=>r.author_id===actors.jamal);
  assert.equal(ava.relationship,'family');
  assert.equal(ava.affiliated,true);
  assert.equal(ava.no_incentive,true);
  assert.equal(jamal.relationship,'competitor');
  assert.equal(jamal.affiliated,true,'a competitor’s review carries the connection label');
  assert.equal(jamal.signals.competitor,true);
  assert.equal(jamal.signals.new_account,true,'fixture accounts are brand new');
  assert.equal(jamal.signals.unverified,true);
  assert.ok(Number(jamal.score) > 0 && Number(jamal.score) < 1);
});

test('a burst of reviews for one business is flagged for moderators',async()=>{
  await call('taylor','join',{ name:'Taylor K.',attest:true,area:'old-brooklyn' }).catch(()=>{});
  await db.query("update neighborhood.members set area_id = 'old-brooklyn' where id = $1",[actors.taylor]);
  await call('taylor','submit_review',review('Third review in a day for this business, testing the burst check.'));
  const row = (await db.query('select signals from neighborhood.reviews where author_id = $1 and business_id = $2',[actors.taylor,business])).rows[0];
  assert.equal(row.signals.burst,false,'two earlier reviews are not a burst yet');
  await call('devon','submit_review',review('A fourth review for the same business on the same day, burst check.'));
  const devon = (await db.query('select signals from neighborhood.reviews where author_id = $1 and business_id = $2',[actors.devon,business])).rows[0];
  assert.equal(devon.signals.burst,true);
});

test('removing a review names a content-neutral rule, never a low rating, and the business page shows every rating and the removals',async()=>{
  const queue = (await call('rina','moderation')).reviews;
  const harsh = queue.find((r)=>r.author_id===actors.jamal);
  await assert.rejects(call('rina','decide_review',{ id:harsh.id,action:'removed',reason:'Too negative for this business page.' }),/never removed for being negative/);
  await assert.rejects(call('rina','decide_review',{ id:harsh.id,action:'removed',category:'negative',reason:'Too negative for this business page.' }),/never removed for being negative/);
  await call('rina','decide_review',{ id:harsh.id,action:'published',reason:'Firsthand, and the competitor connection is labeled.' });
  const family = queue.find((r)=>r.author_id===actors.ava);
  await call('rina','decide_review',{ id:family.id,action:'removed',category:'personal_info',reason:'Names a private person who works there.' });
  const stored = (await db.query('select removal_category from neighborhood.reviews where id = $1',[family.id])).rows[0];
  assert.equal(stored.removal_category,'personal_info');
  const audit = (await db.query("select details from neighborhood.audit where action = 'decide_review' and subject = $1",[family.id])).rows[0];
  assert.equal(audit.details.category,'personal_info');

  const page = await call('luis','business',{ id:business });
  assert.deepEqual(page.breakdown,{ 1:0,2:1,3:0,4:0,5:0 },'every published rating counts, including the low one');
  assert.equal(page.removed_count,1);
  assert.equal(page.reviews[0].relationship,'competitor');
  assert.equal(page.pledged,true);
});

test('businesses take the integrity pledge before listing or applying for the vetted badge',async()=>{
  await assert.rejects(call('devon','create_business',{ name:'Devon Bike Repair',category:'Retail',description:'Bike tune-ups and flat fixes. Fixture business for testing.',website:'' }),/integrity pledge/);
  const shop = await call('devon','create_business',{ pledge:true,name:'Devon Bike Repair',category:'Retail',description:'Bike tune-ups and flat fixes. Fixture business for testing.',website:'' });
  await assert.rejects(call('devon','apply_vetting',{ id:shop.id,legal:'Devon Bikes',registration:'Ohio trade name 99887',contact:'Shop phone' }),/integrity pledge/);
  const pledged = (await db.query('select pledged_at from neighborhood.businesses where id = $1',[shop.id])).rows[0];
  assert.ok(pledged.pledged_at);
});
