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
