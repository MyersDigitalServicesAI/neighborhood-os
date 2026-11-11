import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { Problem } from '../server/supabase.js';

export async function initDatabase() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users (id uuid primary key,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  const folder = new URL('../supabase/migrations/',import.meta.url);
  for (const file of (await readdir(folder)).filter((file) => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file,folder),'utf8'));
  }
  return db;
}

export function rpc(db, actor, op, data = {}) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
    return (await tx.query('select public.neighborhood_app($1,$2) as value',[op,JSON.stringify(data)])).rows[0].value;
  });
}

export function sync(db,data) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return (await tx.query('select public.neighborhood_billing($1) as value',[JSON.stringify(data)])).rows[0].value;
  });
}

export function fixtureAdapter(db, accounts) {
  const signedIn = new Map();
  return {
    configured:true,
    async login(email,password) {
      const actor = accounts[email];
      if (!actor || password !== 'local-fixture-pass') throw new Problem(400,'Check your details and try again.');
      const token = crypto.randomUUID();
      signedIn.set(token,actor);
      return { access_token:token,refresh_token:token,expires_in:3600 };
    },
    async logout(token) { signedIn.delete(token); },
    async refresh(token) {
      if (!signedIn.has(token)) throw new Problem(401,'Sign in to continue.');
      return { access_token:token,refresh_token:token,expires_in:3600 };
    },
    async rpc(token, op, data) {
      const actor = signedIn.get(token);
      if (!actor) throw new Problem(401,'Sign in to continue.');
      try { return await rpc(db,actor,op,data); }
      catch (error) {
        if (error.code === '23505') throw new Problem(409,'This already exists.');
        if (error.code === '42501') throw new Problem(403,error.message);
        if (error.code === 'P0001') throw new Problem(400,error.message);
        if (/^22|^23/.test(error.code ?? '')) throw new Problem(400,'Check the form and try again.');
        throw error;
      }
    }
  };
}

export const actors = {
  ava:'00000000-0000-4000-a000-000000000001',
  jamal:'00000000-0000-4000-a000-000000000002',
  luis:'00000000-0000-4000-a000-000000000003',
  taylor:'00000000-0000-4000-a000-000000000004',
  rina:'00000000-0000-4000-a000-000000000005',
  devon:'00000000-0000-4000-a000-000000000006',
  new:'00000000-0000-4000-a000-000000000007',
  unconfirmed:'00000000-0000-4000-a000-000000000008'
};

export async function fixtures(db) {
  await db.exec('update neighborhood.launch_settings set public_enrollment=true');
  const names = { ava:'Ava M.',jamal:'Jamal R.',luis:'Luis G.',taylor:'Taylor K.',rina:'Rina P.',devon:'Devon W.' };
  for (const [key,id] of Object.entries(actors)) {
    await db.query("insert into auth.users values($1,case when $2 then now() end)",[id,key !== 'unconfirmed']);
    if (names[key]) await rpc(db,id,'join',{name:names[key],attest:true,area:key === 'taylor' ? 'parma' : 'old-brooklyn'});
  }
  for (const id of [actors.rina,actors.devon]) await db.query("insert into neighborhood.staff values($1,'moderator')",[id]);
  const business = await rpc(db,actors.luis,'create_business',{
    name:'Juniper Home Repair',category:'Home services',description:'Small repairs and finish carpentry for homes around Cleveland. Fixture business for local testing only.',website:''
  });
  const soon = (days,hour) => { const t = new Date(Date.now()+days*86400000); t.setHours(hour,0,0,0); return t.toISOString(); };
  await rpc(db,actors.jamal,'create_post',{kind:'event',title:'Saturday trail cleanup at Brookside',when:soon(3,9),place:'Brookside trailhead',
    body:'A few of us are meeting at the trailhead at 9. Bring gloves and a water bottle if you want to join.'});
  await rpc(db,actors.ava,'create_post',{kind:'request',title:'Looking for a reliable fence repair',body:'Two panels came loose in the wind. Has anyone worked with a local crew they would recommend?'});
  await rpc(db,actors.jamal,'create_post',{kind:'discussion',title:'What are you growing this season?',body:'I’m swapping a corner of my front yard for native plants. What has done well for you around here?'});
  await rpc(db,actors.rina,'create_post',{kind:'sale',title:'Oak bookshelf, five shelves',price:'45',place:'Porch pickup near the library',
    body:'Solid wood and in good shape. About six feet tall. Cash or card at pickup.'});
  await rpc(db,actors.devon,'create_post',{kind:'sale',title:'Free moving boxes',price:'0',body:'About twenty boxes in mixed sizes, flattened and dry. First to message gets them.'});
  await rpc(db,actors.devon,'create_post',{kind:'lost',title:'Found: grey tabby with a blue collar',place:'Near the Brookside ball fields',
    body:'Friendly and well fed, no tag. We have her safe indoors. Message me if she sounds like yours.'});
  await rpc(db,actors.rina,'create_post',{kind:'poll',title:'Which night works for a block meetup?',body:'Trying to pick one evening this month that suits most people.',
    option1:'Tuesday',option2:'Thursday',option3:'Saturday afternoon'});
  await rpc(db,actors.luis,'create_post',{kind:'offer',business:business.id,title:'Gutter cleaning slots open this month',
    body:'We have a few openings before the leaves finish dropping. Message for a free estimate.'});
  await rpc(db,actors.jamal,'create_post',{kind:'alert',title:'Water main break on the corner by the school',place:'Corner by the elementary school',
    body:'Crews are on site and one lane is closed. Expect low water pressure nearby until this evening.'});
  return business.id;
}
