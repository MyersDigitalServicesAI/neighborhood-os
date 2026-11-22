import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors, publicFood } from './db.js';
import { foodPage } from '../server/food-page.js';
import { makeHandler } from '../server/handler.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const idOf = async (slug) => (await db.query('select id from neighborhood.food_listings where slug = $1',[slug])).rows[0].id;

before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

test('anyone can browse local food, filtered by kind, neighborhood and SNAP, without seeing who manages a listing',async()=>{
  const all = await publicFood(db);
  assert.ok(all.listings.length >= 130,'the county listings are loaded');
  assert.ok(all.kinds.market >= 25 && all.kinds.garden >= 50 && all.kinds.csa >= 3);
  assert.ok(all.listings.every((f)=>!('owner_id' in f) && !('updated_by' in f)),'no account ids are exposed');
  assert.ok(all.listings.every((f)=>!/@|Garden Manager|Farm Manager/i.test(f.detail)),'garden managers’ personal contacts are not published');
  assert.equal(all.listings[0].region,'Cleveland','Cleveland listings come first');

  const markets = await publicFood(db,{ kind:'market', snap:true });
  assert.ok(markets.listings.length > 10 && markets.listings.every((f)=>f.kind==='market' && f.snap));
  const brooklyn = await publicFood(db,{ area:'old-brooklyn' });
  assert.ok(brooklyn.listings.some((f)=>f.name==='Old Brooklyn Farmers Market'));
  assert.ok(brooklyn.listings.every((f)=>f.area_id==='old-brooklyn'));
  assert.ok(all.areas.find((a)=>a.id==='old-brooklyn').count >= 2);
});

test('the neighborhood guide lists local food, and a grower can claim, get approved and keep their listing up to date',async()=>{
  const guide = await call('ava','guide');
  const market = guide.food.find((f)=>f.name==='Old Brooklyn Farmers Market');
  assert.ok(market && market.claimed===false && market.mine===false && market.claim_pending===false);

  await assert.rejects(call('ava','claim_food',{id:market.id,note:'short'}),/how you’re connected/);
  await call('ava','claim_food',{id:market.id,note:'I manage this market for Old Brooklyn CDC. Call the office to check.'});
  await assert.rejects(call('ava','claim_food',{id:market.id,note:'Sending the same claim again, just in case.'}),/already waiting/);
  assert.equal((await call('ava','guide')).food.find((f)=>f.id===market.id).claim_pending,true);
  await assert.rejects(call('ava','save_food',{id:market.id,fresh_now:'Corn!'}),/Claim it first/,'a pending claim gives no edit rights');

  await call('jamal','claim_food',{id:market.id,note:'I sell honey at this market every Thursday.'});
  const admin = await call('rina','admin');
  assert.deepEqual(admin.foodClaims.map((c)=>c.listing).sort(),['Old Brooklyn Farmers Market','Old Brooklyn Farmers Market']);
  await assert.rejects(call('devon','decide_food_claim',{id:admin.foodClaims[0].id,approve:true}),/Only admins/);
  const avaClaim = admin.foodClaims.find((c)=>/Old Brooklyn CDC/.test(c.note));
  await call('rina','decide_food_claim',{id:avaClaim.id,approve:true});
  assert.deepEqual((await call('rina','admin')).foodClaims,[],'other claims on the listing are closed');
  await assert.rejects(call('rina','decide_food_claim',{id:avaClaim.id,approve:true}),/already reviewed/);

  assert.deepEqual((await call('ava','bootstrap')).myFood.map((f)=>f.name),['Old Brooklyn Farmers Market']);
  await call('ava','save_food',{id:market.id,fresh_now:'Sweet corn and the last of the peaches this Thursday.',schedule:'Thursdays 5–8 p.m.',
    season:'July 9 – Sept. 24',detail:'Produce grown within five miles.',url:'https://www.oldbrooklyn.com/market',phone:'(216) 555-0123',snap:'false',perks:'true'});
  const updated = (await call('ava','guide')).food.find((f)=>f.id===market.id);
  assert.equal(updated.mine,true);
  assert.equal(updated.fresh_now,'Sweet corn and the last of the peaches this Thursday.');
  assert.equal(updated.snap,false,'an owner can switch SNAP off');
  await assert.rejects(call('ava','save_food',{id:market.id,url:'http://insecure.example'}),/https/);
  await assert.rejects(call('jamal','save_food',{id:market.id,fresh_now:'Not mine'}),/Claim it first/);
  await call('rina','save_food',{id:market.id,detail:'Corrected by an admin.',snap:'true'});
  await assert.rejects(call('luis','claim_food',{id:market.id,note:'I would like to manage this market please.'}),/already manages/);

  const shown = (await publicFood(db,{ area:'old-brooklyn' })).listings.find((f)=>f.id===market.id);
  assert.equal(shown.claimed,true);
  assert.equal(shown.detail,'Corrected by an admin.');
  const audit = (await db.query("select action from neighborhood.audit where action in ('claim_food','decide_food_claim','save_food')")).rows.map((r)=>r.action);
  assert.ok(['claim_food','decide_food_claim','save_food'].every((a)=>audit.includes(a)));
});

test('a declined claim lets the grower try again, and the public read is the only thing anonymous visitors can call',async()=>{
  const garden = await idOf('cleveland-roots');
  await call('luis','claim_food',{id:garden,note:'I volunteer at Cleveland Roots on Saturdays.'});
  const claim = (await call('rina','admin')).foodClaims.find((c)=>c.listing_id===garden);
  await call('rina','decide_food_claim',{id:claim.id,approve:false});
  await call('luis','claim_food',{id:garden,note:'I run Cleveland Roots. Here is our website to check.'});
  await assert.rejects(db.transaction(async (tx)=>{
    await tx.exec('set local role anon');
    await tx.query('select public.neighborhood_app($1,$2)',['claim_food',JSON.stringify({id:garden,note:'Anonymous claim attempt here.'})]);
  }),/permission denied/);
  await assert.rejects(db.transaction(async (tx)=>{
    await tx.exec('set local role anon');
    await tx.query('select * from neighborhood.food_listings');
  }),/permission denied/);
});

test('the public food page is readable HTML with structured data, and the route ignores unknown filters',async()=>{
  const data = await publicFood(db,{ kind:'market' });
  const html = foodPage({ ...data, listings:[...data.listings,{ ...data.listings[0], slug:'x', name:'<script>alert(1)</script>' }] },'https://nabora.us');
  assert.match(html,/<title>Farmers markets in Cleveland &amp; Cuyahoga County · Nabora<\/title>/);
  assert.match(html,/"@type":"LocalBusiness"/);
  assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/SNAP\/EBT/);
  assert.match(html,/Join and claim your listing/);

  const seen = [];
  const handler = makeHandler({ env:{ APP_ORIGIN:'https://nabora.us' }, local:true,
    database:{ configured:true, publicFood:async(d)=>{ seen.push(d); return { listings:[], kinds:{}, areas:[] }; } } });
  const out = { headers:{}, setHeader(k,v){ this.headers[k]=v; }, end(body){ this.body = body; } };
  await handler({ method:'GET', url:'/api/core?action=food-page&kind=pizza&area=DROP%20TABLE&snap=1', headers:{}, async *[Symbol.asyncIterator](){} },out);
  assert.equal(out.statusCode,200);
  assert.deepEqual(seen[0],{ kind:'', area:'', snap:true });
  assert.match(out.headers['Content-Type'],/text\/html/);
  assert.match(out.headers['Cache-Control'],/public/);
});
