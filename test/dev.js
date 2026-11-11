import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { makeHandler } from '../server/handler.js';
import { supabaseAdapter } from '../server/supabase.js';
import { initDatabase, fixtures, fixtureAdapter, actors } from './db.js';

const port = Number(process.env.PORT || 4173);
const env = { ...process.env, APP_ORIGIN:process.env.APP_ORIGIN || 'http://127.0.0.1:' + port };
const fixture = process.env.LOCAL_FIXTURES !== 'false';
let database = supabaseAdapter(env);
if (fixture) {
  const db = await initDatabase();
  await fixtures(db);
  env.OPEN_SIGNUPS = 'false';
  database = fixtureAdapter(db,Object.fromEntries(Object.entries(actors).map(([key,id]) => [key+'@neighborhood.test',id])));
}
const vite = await createVite({ server:{ middlewareMode:true, hmr:false }, appType:'spa' });
const handler = makeHandler({ env,database,local:true });
createServer((req,res) => {
  if (req.url?.split('?')[0] === '/api/core') return handler(req,res);
  vite.middlewares(req,res);
}).listen(port,'127.0.0.1',() => console.log('NeighborhoodOS listening on ' + env.APP_ORIGIN));
