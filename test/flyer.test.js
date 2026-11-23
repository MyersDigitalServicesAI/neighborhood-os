import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);
const verify = (who) => db.query('update neighborhood.members set verified_at = now() where id = $1',[actors[who]]);

before(async()=>{ db = await initDatabase(); await fixtures(db); });
after(async()=>{ await db?.close(); });

test('verified neighbors print flyers for their own neighborhood; admins for any',async()=>{
  assert.equal((await call('ava','bootstrap')).canFlyer,false);
  await assert.rejects(call('ava','create_flyer',{ place:'South Brooklyn library' }),/Verify that you live/);
  await verify('ava');
  assert.equal((await call('ava','bootstrap')).canFlyer,true);
  await assert.rejects(call('ava','create_flyer',{ place:'x' }),/Say where this flyer will go/);
  await assert.rejects(call('ava','create_flyer',{ place:'Parma library',area:'parma' }),/your own neighborhood/);
  const flyer = await call('ava','create_flyer',{ place:'  South Brooklyn   library ' });
  assert.equal(flyer.place,'South Brooklyn library');
  assert.equal(flyer.area,'Old Brooklyn');
  assert.equal(flyer.max_uses,100);
  assert.match(flyer.code,/^[A-Z2-9]{10}$/);
  assert.ok(flyer.active);

  const parma = await call('rina','create_flyer',{ place:'Parma Snow library',area:'parma' });
  assert.equal(parma.area,'Parma');
  assert.equal(parma.max_uses,500);
  assert.equal((await call('rina','bootstrap')).canFlyer,true);

  for (let i = 0; i < 4; i++) await call('ava','create_flyer',{ place:'Spot '+i });
  await assert.rejects(call('ava','create_flyer',{ place:'Sixth spot' }),/5 flyers out/);
  assert.equal((await call('ava','flyers')).flyers.length,5);
});

test('a flyer lets a new neighbor in and counts the sign-up; only its maker or an admin can retire it',async()=>{
  const flyer = (await call('ava','flyers')).flyers.find((f)=>f.place==='South Brooklyn library');
  assert.deepEqual(await call('new','invite_info',{ invite:flyer.code }),{ valid:true,area:'old-brooklyn' });
  await db.exec('update neighborhood.launch_settings set public_enrollment=false');
  await call('new','join',{ name:'Nia T.',attest:true,area:'old-brooklyn',invite:flyer.code });
  await db.exec('update neighborhood.launch_settings set public_enrollment=true');
  assert.equal((await call('ava','flyers')).flyers.find((f)=>f.id===flyer.id).uses,1);

  const admin = await call('rina','admin');
  const row = admin.flyers.find((f)=>f.id===flyer.id);
  assert.equal(row.by,'Ava M.');
  assert.equal(row.uses,1);
  assert.equal(admin.flyers[0].id,flyer.id,'the flyer that brought in the most neighbors is listed first');

  await verify('jamal');
  await assert.rejects(call('jamal','revoke_flyer',{ id:flyer.id }),/unavailable/,'another verified neighbor can’t retire it');
  await call('ava','revoke_flyer',{ id:flyer.id });
  assert.equal((await call('new','invite_info',{ invite:flyer.code })).valid,false);
  await call('ava','create_flyer',{ place:'Now there is room' });
  const other = (await call('ava','flyers')).flyers[0];
  await call('rina','revoke_flyer',{ id:other.id });
  const audit = (await db.query("select count(*)::int n from neighborhood.audit where action in ('create_flyer','revoke_flyer')")).rows[0].n;
  assert.ok(audit >= 8);
});

test('short links from flyers and share cards only ever lead into the app',async()=>{
  const { makeHandler } = await import('../server/handler.js');
  const handler = makeHandler({ env:{ APP_ORIGIN:'https://nabora.us' },billing:{ enabled:false },database:{ configured:true } });
  const go = async (query) => {
    const res = { headers:{},setHeader(k,v){ this.headers[k]=v; },end(){ } };
    await handler({ method:'GET',url:'/api/core?action=short&'+query,headers:{},async *[Symbol.asyncIterator](){} },res);
    return [res.statusCode,res.headers.Location];
  };
  assert.deepEqual(await go('j=abcde12345'),[302,'/#invite/ABCDE12345']);
  assert.deepEqual(await go('p=00000000-0000-4000-A000-000000000001'),[302,'/#post/00000000-0000-4000-a000-000000000001']);
  assert.deepEqual(await go('j=//evil.example'),[302,'/']);
  assert.deepEqual(await go('p=https://evil.example'),[302,'/']);
});
