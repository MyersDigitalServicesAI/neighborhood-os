import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeHandler } from '../server/handler.js';
import { verifyStripeEvent, paymentState } from '../server/billing.js';

const origin = 'https://neighborhood.example';
const request = async (handler,action,{method='POST',body={},headers={}}={}) => {
  const data = new TextEncoder().encode(JSON.stringify(body));
  const req = {method,url:'/api/core?action='+action,headers:{origin,'content-type':'application/json',...headers},
    async *[Symbol.asyncIterator](){yield data;}};
  const res = {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.body=value?JSON.parse(value):null;}};
  await handler(req,res);
  return res;
};
test('app API rejects cross-origin, unauthorized, invalid, and oversized requests',async()=>{
  const handler = makeHandler({env:{APP_ORIGIN:origin},database:{configured:true},billing:{enabled:false}});
  assert.equal((await request(handler,'feed',{headers:{origin:'https://evil.example'}})).statusCode,403);
  assert.equal((await request(handler,'feed')).statusCode,401);
  assert.equal((await request(handler,'feed',{body:'a'.repeat(17000)})).statusCode,413);
  assert.equal((await request(handler,'feed',{body:[]})).statusCode,400);
  assert.equal((await request(handler,'signup',{body:{email:'abc@example.test',password:'valid-long-password'}})).statusCode,403);
});
test('API sets protected session cookies and keeps tokens out of the response body',async()=>{
  const handler = makeHandler({env:{APP_ORIGIN:origin},database:{configured:true,login:async()=>({
    access_token:'access-fixture',refresh_token:'refresh-fixture',expires_in:3600
  })},billing:{enabled:false}});
  const res = await request(handler,'login',{body:{email:'person@example.test',password:'valid-long-password'}});
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.body,{signedIn:true});
  assert.match(res.headers['set-cookie'][0],/^__Host-nh_access=access-fixture; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/);
  assert.equal(res.headers['cache-control'],'private, no-store');
});
test('one-time vetting fee counts only for a completed, fully paid, undiscounted checkout',()=>{
  const session = {id:'cs_fixture',mode:'payment',status:'complete',payment_status:'paid',currency:'usd',amount_subtotal:25000,amount_total:25000,
    payment_intent:'pi_fixture',customer:'cus_fixture',metadata:{neighborhood_business:'b',neighborhood_checkout:'x'}};
  const state = (change) => paymentState({...session,...change},'now');
  assert.deepEqual(state({}),{business:'b',checkoutKey:'x',payment:'pi_fixture',customer:'cus_fixture',paid:true,observedAt:'now'});
  assert.equal(state({payment_status:'unpaid'}).paid,false);
  assert.equal(state({status:'open'}).paid,false);
  assert.equal(state({mode:'subscription'}).paid,false);
  assert.equal(state({amount_subtotal:10000,amount_total:10000}).paid,false);
  assert.equal(state({amount_total:0}).paid,false);
  assert.equal(state({currency:'eur'}).paid,false);
  assert.equal(state({payment_intent:null}).paid,false);
});
test('photos are served as images only to a signed-in session and uploads have their own size limit',async()=>{
  const calls = [];
  const database = {configured:true,rpc:async(token,op,d)=>{ calls.push([op,d]); return op==='image' ? {mime:'image/png',data:'iVBORw0K\nGgo='} : {id:'x',ok:true}; }};
  const handler = makeHandler({env:{APP_ORIGIN:origin},database,billing:{enabled:false}});
  const id = '00000000-0000-4000-a000-000000000001';
  const get = async (query,cookie) => {
    const res = {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.raw=value;}};
    await handler({method:'GET',url:'/api/core?action=image&id='+query,headers:cookie?{cookie}:{},async *[Symbol.asyncIterator](){}},res);
    return res;
  };
  assert.equal((await get(id)).statusCode,401);
  assert.equal((await get('not-an-id','__Host-nh_access=t')).statusCode,404);
  const ok = await get(id,'__Host-nh_access=t');
  assert.equal(ok.statusCode,200);
  assert.equal(ok.headers['content-type'],'image/png');
  assert.deepEqual([...ok.raw.slice(0,4)],[0x89,0x50,0x4e,0x47]);
  const cookie = {cookie:'__Host-nh_access=t'};
  assert.equal((await request(handler,'upload_image',{headers:cookie,body:{mime:'image/jpeg',data:'a'.repeat(300000)}})).statusCode,200);
  assert.equal((await request(handler,'upload_image',{headers:cookie,body:{mime:'image/jpeg',data:'a'.repeat(430000)}})).statusCode,413);
  assert.equal((await request(handler,'create_post',{headers:cookie,body:{body:'a'.repeat(17000)}})).statusCode,413);
  assert.equal((await request(handler,'billing_portal',{headers:cookie})).statusCode,404);
});
test('Stripe signature verifies raw bytes, rejects stale requests, and rejects tampering',async()=>{
  const bytes = new TextEncoder().encode('{"type":"invoice.paid"}');
  const timestamp = 1000;
  const secret = 'fixture-secret';
  const hash = createHmac('sha256',secret).update(timestamp+'.').update(bytes).digest('hex');
  const signature = 't='+timestamp+',v1='+hash;
  assert.deepEqual(await verifyStripeEvent(bytes,signature,secret,timestamp),{type:'invoice.paid'});
  await assert.rejects(verifyStripeEvent(bytes,signature,secret,1400),/Invalid signature/);
  await assert.rejects(verifyStripeEvent(new TextEncoder().encode('{}'),signature,secret,timestamp),/Invalid signature/);
});

test('public counts are served without a session and may be cached briefly',async()=>{
  const handler = makeHandler({env:{APP_ORIGIN:origin},database:{configured:true,counts:async()=>({areas:{'old-brooklyn':12},total:12,places:1})},billing:{enabled:false}});
  const res = {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.body=JSON.parse(value);}};
  await handler({method:'GET',url:'/api/core?action=counts',headers:{},async *[Symbol.asyncIterator](){}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.headers['cache-control'],'public, max-age=300, s-maxage=300');
  assert.deepEqual(res.body,{areas:{'old-brooklyn':12},total:12,places:1});
});

test('account deletion signs the browser out, and the daily job needs its secret',async()=>{
  const calls = [];
  const database = {configured:true,rpc:async(token,op,d)=>{ calls.push([op,d]); return {deleted:true}; },mail:async(d)=>{ calls.push(['mail',d]); return d.op==='purge' ? {purged:2} : []; }};
  const handler = makeHandler({env:{APP_ORIGIN:origin,CRON_SECRET:'s3cret',SUPABASE_SECRET_KEY:'x'},database,billing:{enabled:false},mailer:{enabled:false}});
  const res = await request(handler,'delete_account',{headers:{cookie:'__Host-nh_access=t'},body:{confirm:'DELETE'}});
  assert.deepEqual(res.body,{deleted:true});
  assert.deepEqual(calls[0],['delete_account',{confirm:'DELETE'}]);
  assert.ok(res.headers['set-cookie'].every((c)=>/Max-Age=0/.test(c)));
  const get = async (headers) => {
    const out = {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(v){this.body=v?JSON.parse(v):null;}};
    await handler({method:'GET',url:'/api/core?action=deliver',headers,async *[Symbol.asyncIterator](){}},out);
    return out;
  };
  assert.equal((await get({})).statusCode,401);
  assert.equal((await get({authorization:'Bearer wrong'})).statusCode,401);
  const ok = await get({authorization:'Bearer s3cret'});
  assert.deepEqual([ok.statusCode,ok.body],[200,{sent:0,failed:0,purged:2}]);
});

test('checkout charges the exact vetting price and labels the card statement NABORA', async () => {
  const { billingAdapter } = await import('../server/billing.js');
  const sent = [];
  const fake = async (url, init) => {
    sent.push({ url, body: init.body ? Object.fromEntries(init.body) : null });
    if (url.endsWith('/prices/price_fixture')) return { ok:true, json:async()=>({ active:true, unit_amount:25000, currency:'usd', type:'one_time', recurring:null }) };
    return { ok:true, json:async()=>({ url:'https://checkout.stripe.com/c/fixture' }) };
  };
  const billing = billingAdapter({ STRIPE_SECRET_KEY:'rk_live_fixture', STRIPE_PRICE_ID:'price_fixture', STRIPE_WEBHOOK_SECRET:'whsec_fixture',
    APP_ORIGIN:'https://nabora.example', SUPABASE_SECRET_KEY:'sb_secret_fixture' }, {}, fake);
  assert.deepEqual(await billing.checkout({ id:'biz', key:'key' }), { url:'https://checkout.stripe.com/c/fixture' });
  const session = sent.find((call) => call.url.endsWith('/checkout/sessions')).body;
  assert.equal(session['payment_intent_data[statement_descriptor_suffix]'], 'NABORA');
  assert.equal(session['line_items[0][price]'], 'price_fixture');
  assert.equal(session.success_url, 'https://nabora.example/#manage');
});

test('a live restricted key (rk_live_) accepts live webhooks and refuses test ones', async () => {
  const { billingAdapter } = await import('../server/billing.js');
  const secret = 'whsec_fixture';
  const synced = [];
  const fake = async () => ({ ok:true, json:async()=>({ id:'cs_live1', mode:'payment', status:'complete', payment_status:'paid', currency:'usd',
    amount_subtotal:25000, amount_total:25000, payment_intent:'pi_live1', customer:'cus_1', metadata:{ neighborhood_business:'biz', neighborhood_checkout:'key' } }) });
  const billing = billingAdapter({ STRIPE_SECRET_KEY:'rk_live_fixture', STRIPE_PRICE_ID:'price_fixture', STRIPE_WEBHOOK_SECRET:secret,
    APP_ORIGIN:'https://nabora.example', SUPABASE_SECRET_KEY:'sb_secret_fixture' }, { syncBilling: async (state) => synced.push(state) }, fake);
  const sign = (event) => {
    const raw = new TextEncoder().encode(JSON.stringify(event));
    const t = Math.floor(Date.now() / 1000);
    return [raw, 't='+t+',v1='+createHmac('sha256', secret).update(t+'.'+JSON.stringify(event)).digest('hex')];
  };
  await billing.webhook(...sign({ livemode:true, type:'checkout.session.completed', data:{ object:{ id:'cs_live1' } } }));
  assert.equal(synced.length, 1);
  assert.equal(synced[0].paid, true);
  await assert.rejects(billing.webhook(...sign({ livemode:false, type:'checkout.session.completed', data:{ object:{ id:'cs_live1' } } })), /mode mismatch/);
});
