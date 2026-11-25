import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { makeHandler } from '../server/handler.js';
import { supabaseAdapter } from '../server/supabase.js';
import { initDatabase, fixtures, fixtureAdapter, actors } from './db.js';
import { pushAdapter } from '../server/push.js';
import webpush from 'web-push';

const port = Number(process.env.PORT || 4173);
const env = { ...process.env, APP_ORIGIN:process.env.APP_ORIGIN || 'http://127.0.0.1:' + port };
const fixture = process.env.LOCAL_FIXTURES !== 'false';
let database = supabaseAdapter(env);
let pusher = pushAdapter(env);
if (fixture) {
  const db = await initDatabase();
  await fixtures(db);
  env.OPEN_SIGNUPS = 'false';
  database = fixtureAdapter(db,Object.fromEntries(Object.entries(actors).map(([key,id]) => [key+'@neighborhood.test',id])));
  // Local push: a real key so browsers can subscribe, and notices are logged instead of sent.
  const keys = webpush.generateVAPIDKeys();
  pusher = { enabled:true, publicKey:keys.publicKey, async send(device,message) { console.log('push',message.title); return 'sent'; } };
}
const vite = await createVite({ server:{ middlewareMode:true, hmr:false }, appType:'spa' });
const handler = makeHandler({ env,database,local:true,pusher });
createServer((req,res) => {
  if (['/events','/food','/trees','/trust'].includes(req.url?.split('?')[0])) {
    // Mirrors the /events, /food, /trees and /trust rewrites in vercel.json.
    req.url = '/api/core?action='+req.url.split('?')[0].slice(1)+'-page'+(req.url.includes('?') ? '&'+req.url.split('?')[1] : '');
    return handler(req,res);
  }
  const short = req.url?.match(/^\/(j|p)\/([^/?]+)$/);
  if (short) {
    // Mirrors the /j/ (flyer) and /p/ (shared post) rewrites in vercel.json.
    req.url = '/api/core?action=short&'+short[1]+'='+encodeURIComponent(short[2]);
    return handler(req,res);
  }
  if (req.url?.split('?')[0] === '/api/core') return handler(req,res);
  vite.middlewares(req,res);
}).listen(port,'127.0.0.1',() => console.log('Nabora listening on ' + env.APP_ORIGIN));
