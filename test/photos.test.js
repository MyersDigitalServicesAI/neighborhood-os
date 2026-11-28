import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors, photos, fixtureAdapter } from './db.js';
import { makeHandler } from '../server/handler.js';
import { photoBytes, storageAdapter, emptyPhotoTrash } from '../server/storage.js';
import { movePhotos } from '../tooling/move-photos.mjs';

let db;
const call = (who,op,data) => rpc(db,actors[who],op,data);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const jpeg = Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(120,7)]).toString('base64');
const origin = 'https://neighborhood.example';
before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

// An in-memory bucket standing in for Supabase Storage.
function memoryBucket() {
  const files = new Map();
  return { files,enabled:true,
    async put(path,bytes,mime,{ upsert = false } = {}) {
      if (files.has(path) && !upsert) throw new Error('exists');
      files.set(path,{ bytes,mime });
    },
    async sign(path,seconds) { return 'https://storage.example/'+path+'?expires='+seconds; },
    async remove(paths) { for (const path of paths) files.delete(path); }
  };
}

test('a reserved photo has a bucket path, cannot be attached until stored, then is served by path',async()=>{
  const reserved = await call('ava','reserve_image',{mime:'image/jpeg'});
  assert.equal(reserved.path,actors.ava+'/'+reserved.id+'.jpg');
  await assert.rejects(call('ava','reserve_image',{mime:'image/svg+xml'}),/JPEG, PNG or WebP/);
  await assert.rejects(call('unconfirmed','reserve_image',{mime:'image/jpeg'}),/confirmed email/);
  await assert.rejects(call('ava','create_post',{kind:'lost',title:'Lost scarf',body:'Red wool.',image:reserved.id}),/still uploading/);
  assert.equal((await call('jamal','image',{id:reserved.id})).data,null);
  // Only the server's key can mark a photo stored.
  await assert.rejects(rpc(db,actors.ava,'stored',{id:reserved.id}));
  await assert.rejects(db.transaction(async(tx)=>{ await tx.exec('set local role authenticated');
    await tx.query("select public.neighborhood_photos('{\"op\":\"status\"}')"); }),/permission denied/);
  await photos(db,{op:'stored',id:reserved.id});
  assert.deepEqual(await call('jamal','image',{id:reserved.id}),{mime:'image/jpeg',path:reserved.path});
  assert.equal(await call('taylor','image',{id:reserved.id}),null);
  const post = await call('ava','create_post',{kind:'lost',title:'Lost scarf',body:'Red wool.',image:reserved.id});
  assert.equal((await call('jamal','post',{id:post.id})).image_id,reserved.id);
});

test('old photos move to the bucket with a dry run first, and deleted photos are queued for removal',async()=>{
  const old = await call('jamal','upload_image',{mime:'image/png',data:png});
  const bucket = memoryBucket();
  const database = { photos:(d)=>photos(db,d) };
  const lines = [];
  const dry = await movePhotos({database,storage:bucket,log:(line)=>lines.push(line)});
  assert.equal(dry.moved,0);
  assert.equal(bucket.files.size,0);
  assert.ok(lines.some((line)=>line.includes('Would move '+old.id)));
  const done = await movePhotos({database,storage:bucket,run:true,log:()=>{}});
  assert.equal(done.failed,0);
  assert.equal(done.after.table_only,0);
  const path = actors.jamal+'/'+old.id+'.png';
  assert.deepEqual([...bucket.files.get(path).bytes.slice(0,4)],[0x89,0x50,0x4e,0x47]);
  assert.deepEqual(await call('ava','image',{id:old.id}),{mime:'image/png',path});
  assert.equal((await movePhotos({database,storage:bucket,run:true,log:()=>{}})).moved,0);
  await assert.rejects(photos(db,{op:'moved',id:old.id,path:actors.ava+'/'+old.id+'.png'}),/unavailable|does not match/);

  // A reservation nobody finished is swept after a day; a deleted photo's file is queued and then removed.
  const stale = await call('ava','reserve_image',{mime:'image/webp'});
  await db.query("update neighborhood.images set created_at = now() - interval '2 days' where id = $1",[stale.id]);
  await db.query('delete from neighborhood.images where id = $1',[old.id]);
  const trash = await photos(db,{op:'trash'});
  assert.ok(trash.includes(path) && trash.includes(stale.path));
  const removed = await emptyPhotoTrash(database,bucket);
  assert.ok(removed.photosRemoved >= 2);
  assert.equal(bucket.files.has(path),false);
  assert.deepEqual(await photos(db,{op:'trash'}),[]);
});

test('the server checks photo bytes, stores them in the bucket, and redirects to a signed link',async()=>{
  assert.throws(()=>photoBytes('image/jpeg',png),/not a JPEG/);
  assert.throws(()=>photoBytes('image/png','a'.repeat(20)),/too large/);
  assert.equal(photoBytes('image/png',png)[1],0x50);
  const bucket = memoryBucket();
  const database = fixtureAdapter(db,{'ava@neighborhood.test':actors.ava,'taylor@neighborhood.test':actors.taylor});
  const handler = makeHandler({env:{APP_ORIGIN:origin},database,storage:bucket,billing:{enabled:false},
    mailer:{enabled:false},pusher:{enabled:false}});
  const send = async (action,body,headers={}) => {
    const data = new TextEncoder().encode(JSON.stringify(body));
    const res = {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.raw=value;}};
    await handler({method:'POST',url:'/api/core?action='+action,headers:{origin,'content-type':'application/json',...headers},
      async *[Symbol.asyncIterator](){yield data;}},res);
    return res;
  };
  const token = (await database.login('ava@neighborhood.test','local-fixture-pass')).access_token;
  const cookie = {cookie:'__Host-nh_access='+token};
  assert.equal((await send('upload_image',{mime:'image/jpeg',data:png},cookie)).statusCode,400);
  const ok = await send('upload_image',{mime:'image/jpeg',data:jpeg},cookie);
  assert.equal(ok.statusCode,200);
  const {id} = JSON.parse(ok.raw);
  assert.ok(bucket.files.has(actors.ava+'/'+id+'.jpg'));
  const get = async (cookieValue) => {
    const res = {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.raw=value;}};
    await handler({method:'GET',url:'/api/core?action=image&id='+id,headers:{cookie:cookieValue},async *[Symbol.asyncIterator](){}},res);
    return res;
  };
  const shown = await get(cookie.cookie);
  assert.equal(shown.statusCode,302);
  assert.equal(shown.headers.location,'https://storage.example/'+actors.ava+'/'+id+'.jpg?expires=3600');
  assert.equal(shown.headers['cache-control'],'private, max-age=3000');
  const other = (await database.login('taylor@neighborhood.test','local-fixture-pass')).access_token;
  assert.equal((await get('__Host-nh_access='+other)).statusCode,404);
});

test('the storage adapter talks to the private bucket with the secret key',async()=>{
  const calls = [];
  const fake = async (url,init) => { calls.push([url,init]);
    return { ok:true,status:200,json:async()=>url.includes('/sign/') ? {signedURL:'/object/sign/photos/a?token=t'} : {} }; };
  assert.equal(storageAdapter({SUPABASE_URL:'https://x.supabase.co',SUPABASE_SECRET_KEY:'k'},fake).enabled,false);
  const storage = storageAdapter({SUPABASE_URL:'https://x.supabase.co/',SUPABASE_SECRET_KEY:'k',PHOTO_BUCKET:'photos'},fake);
  const path = actors.ava+'/'+actors.jamal+'.jpg';
  await storage.put(path,new Uint8Array([1]),'image/jpeg');
  assert.equal(calls[0][0],'https://x.supabase.co/storage/v1/object/photos/'+path);
  assert.equal(calls[0][1].headers.apikey,'k');
  assert.equal(calls[0][1].headers['x-upsert'],'false');
  assert.equal(await storage.sign(path,3600),'https://x.supabase.co/storage/v1/object/sign/photos/a?token=t');
  await assert.rejects(storage.sign('../secrets',60),/unavailable/);
  await storage.remove([path]);
  assert.equal(calls[2][1].method,'DELETE');
  assert.deepEqual(JSON.parse(calls[2][1].body),{prefixes:[path]});
});

test('the daily job copies photos still stored in the database into the bucket',async()=>{
  const old = await call('ava','upload_image',{mime:'image/png',data:png});
  const bucket = memoryBucket();
  const database = { ...fixtureAdapter(db,{}),photos:(d)=>photos(db,d),mail:async(d)=>d.op==='purge' ? {purged:0} : {} };
  const handler = makeHandler({env:{APP_ORIGIN:origin,CRON_SECRET:'c',SUPABASE_SECRET_KEY:'k'},database,storage:bucket,
    billing:{enabled:false},mailer:{enabled:false},pusher:{enabled:false}});
  const res = {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.body=JSON.parse(value);}};
  await handler({method:'GET',url:'/api/core?action=deliver',headers:{authorization:'Bearer c'},async *[Symbol.asyncIterator](){}},res);
  assert.equal(res.statusCode,200);
  assert.ok(res.body.photosMoved >= 1);
  assert.equal(res.body.photosNotMoved,0);
  assert.ok(bucket.files.has(actors.ava+'/'+old.id+'.png'));
  assert.equal((await photos(db,{op:'status'})).table_only,0);
});
