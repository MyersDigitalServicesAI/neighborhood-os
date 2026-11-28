import { billingAdapter } from './billing.js';
import { Problem, supabaseAdapter } from './supabase.js';
import { deliver, mailerAdapter } from './mail.js';
import { unsubscribePage } from './unsubscribe-page.js';
import { deliverPush, pushAdapter, pushHosts } from './push.js';
import { gatherEvents } from './events.js';
import { eventsPage } from './events-page.js';
import { foodPage, foodKinds } from './food-page.js';
import { treesPage } from './trees-page.js';
import { trustPage } from './trust-page.js';
import { emptyPhotoTrash, photoBytes, storageAdapter } from './storage.js';

const appOperations = new Set(['bootstrap','join','feed','post','create_post','close_post','reply','directory','my_businesses',
  'business','create_business','update_business','threads','thread','message','block','unblock','submit_review','report_review',
  'my_reviews','appeal','apply_vetting','moderation','decide_review','decide_appeal','decide_vetting','report_content','decide_content',
  'delete_post','delete_reply','react','rsvp','vote','upload_image','notifications','read_notifications','search','profile','update_profile',
  'request_residency','cancel_residency','confirm_residency','decide_residency','map',
  'invite_info','set_email_notices','admin','admit','create_invite','revoke_invite','set_role',
  'vouch','unvouch','checkin_info','checkin','create_checkin','checkins','checkin_host','end_checkin','undo_checkin','set_host','waive_fee','set_vetter','pinned','pin_post','unpin_post','guide','save_guide_item','hide_guide_item','events',
  'claim_food','save_food','decide_food_claim','save_push','remove_push','flyers','create_flyer','revoke_flyer','set_digest','roster','invite_role','answer_role','cancel_role_invite','team_message','ask_question','team_questions','team_question','close_question','answer_question','send_feedback','feedback','resolve_feedback']);
// Operations that can queue an email; the queue is drained right after them, so mail goes out in seconds rather than
// waiting for the daily job.
const mailOperations = new Set(['reply','message','create_post','admit','create_invite','join','team_message','ask_question',
  'invite_role','send_feedback']);
// Operations that can queue a phone notification; those are sent right after them too.
const pushOperations = new Set(['reply','message','create_post','rsvp']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxBytes = 16000;
const maxUpload = 420000;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const utf8 = new TextEncoder();
const decode = new TextDecoder();
function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

async function bytes(req, limit) {
  const chunks = [];
  let count = 0;
  for await (const chunk of req) {
    const data = typeof chunk === 'string' ? utf8.encode(chunk) : chunk;
    count += data.length;
    if (count > limit) throw new Problem(413, 'Request is too large.');
    chunks.push(data);
  }
  const result = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk,offset);
    offset += chunk.length;
  }
  return result;
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie ?? '').split(';').map((pair) => pair.trim().split('=')));
}

export function makeHandler({ env = globalThis.process?.env ?? {}, database = supabaseAdapter(env), billing = billingAdapter(env,database),
  local = false, mailer = mailerAdapter(env), pusher = pushAdapter(env), gather = () => gatherEvents(),
  storage = storageAdapter(env) } = {}) {
  const prefix = local ? 'nh_' : '__Host-nh_';
  function cookie(name,value,maxAge) {
    return prefix + name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (local ? '' : '; Secure');
  }
  function session(res,data) {
    if (!data?.access_token || !data.refresh_token) throw new Problem(401,'Sign in to continue.');
    res.setHeader('Set-Cookie',[cookie('access',data.access_token,Math.min(data.expires_in ?? 3600,3600)),
      cookie('refresh',data.refresh_token,14*86400),cookie('pkce','',0),cookie('flow','',0)]);
  }
  function clear(res) {
    res.setHeader('Set-Cookie',['access','refresh','pkce','flow'].map((name) => cookie(name,'',0)));
  }
  function reply(res,status,payload) {
    res.statusCode = status;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }
  return async function handle(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const base = env.APP_ORIGIN || (req.headers.host ? (local ? 'http://' : 'https://') + req.headers.host : '');
    try {
      const url = new URL(req.url,base || 'http://invalid');
      const action = url.searchParams.get('action') ?? '';
      const saved = cookies(req);
      const access = saved[prefix+'access'];
      if (req.method === 'GET' && action === 'config') {
        return reply(res,200,{ configured: database.configured, signups: env.OPEN_SIGNUPS === 'true', billing: billing.enabled, email: mailer.enabled, push: pusher.publicKey, local });
      }
      if (req.method === 'GET' && action === 'short') {
        // Short links printed on flyers (/j/CODE) and share cards (/p/POST): send them into the app.
        const code = url.searchParams.get('j') ?? '';
        const post = url.searchParams.get('p') ?? '';
        const target = /^[A-Za-z0-9]{10}$/.test(code) ? '/#invite/'+code.toUpperCase() : idPattern.test(post) ? '/#post/'+post.toLowerCase() : '/';
        res.statusCode = 302;
        res.setHeader('Location',target);
        res.setHeader('Cache-Control','public, max-age=300');
        return res.end();
      }
      if (req.method === 'GET' && action === 'assetlinks') {
        // Digital Asset Links for the Android app: proves nabora.us and the Play Store app belong together, so the app
        // opens full screen without a browser bar. ANDROID_CERT_SHA256 lists the signing key fingerprints, comma-separated.
        const prints = String(env.ANDROID_CERT_SHA256 ?? '').split(',').map((v) => v.trim().toUpperCase())
          .filter((v) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(v));
        res.setHeader('Cache-Control','public, max-age=3600');
        return reply(res,200,prints.length ? [{ relation:['delegate_permission/common.handle_all_urls'],
          target:{ namespace:'android_app', package_name:env.ANDROID_PACKAGE || 'us.nabora.app', sha256_cert_fingerprints:prints } }] : []);
      }
      if (req.method === 'GET' && action === 'counts') {
        const counts = await database.counts();
        res.statusCode = 200;
        res.setHeader('Content-Type','application/json; charset=utf-8');
        res.setHeader('Cache-Control','public, max-age=300, s-maxage=300');
        return res.end(JSON.stringify(counts));
      }
      if (req.method === 'GET' && (action === 'public-events' || action === 'events-page')) {
        // Public: events shared with all of Northeast Ohio, for anyone. Cached briefly at the edge.
        const span = ['week','weekend'].includes(url.searchParams.get('when')) ? url.searchParams.get('when') : '';
        const place = /^[a-z0-9-]{2,40}$/.test(url.searchParams.get('area') ?? '') ? url.searchParams.get('area') : '';
        const data = await database.publicEvents({ when:span,area:place });
        res.statusCode = 200;
        res.setHeader('Cache-Control','public, max-age=300, s-maxage=600');
        if (action === 'public-events') {
          res.setHeader('Content-Type','application/json; charset=utf-8');
          return res.end(JSON.stringify(data));
        }
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end(eventsPage(data,(env.APP_ORIGIN || base).replace(/\/$/,'')));
      }
      if (req.method === 'GET' && action === 'trust-page') {
        res.statusCode = 200;
        res.setHeader('Cache-Control','public, max-age=600, s-maxage=3600');
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end(trustPage((env.APP_ORIGIN || base).replace(/\/$/,'')));
      }
      if (req.method === 'GET' && action === 'trees-page') {
        res.statusCode = 200;
        res.setHeader('Cache-Control','public, max-age=600, s-maxage=3600');
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end(treesPage((env.APP_ORIGIN || base).replace(/\/$/,'')));
      }
      if (req.method === 'GET' && (action === 'public-food' || action === 'food-page')) {
        // Public: local food listings for anyone. Cached briefly at the edge.
        const kind = foodKinds.some(([k])=>k===url.searchParams.get('kind')) ? url.searchParams.get('kind') : '';
        const place = /^[a-z0-9-]{2,40}$/.test(url.searchParams.get('area') ?? '') ? url.searchParams.get('area') : '';
        const data = await database.publicFood({ kind,area:place,snap:url.searchParams.get('snap') === '1' });
        res.statusCode = 200;
        res.setHeader('Cache-Control','public, max-age=300, s-maxage=600');
        if (action === 'public-food') {
          res.setHeader('Content-Type','application/json; charset=utf-8');
          return res.end(JSON.stringify(data));
        }
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end(foodPage(data,(env.APP_ORIGIN || base).replace(/\/$/,'')));
      }
      if (req.method === 'GET' && action === 'deliver') {
        // Daily job: send anything still queued and delete stale address-verification requests.
        if (!env.CRON_SECRET || req.headers.authorization !== 'Bearer '+env.CRON_SECRET) throw new Problem(401,'Not authorized.');
        if (!env.SUPABASE_SECRET_KEY) throw new Problem(503,'The backend key is not configured.');
        const purged = await database.mail({ op:'purge' });
        // Thursday evenings (Cleveland time) also queue the weekly digest. ?digest=1 queues it on another day.
        const thursday = new Intl.DateTimeFormat('en-US',{ weekday:'short',timeZone:'America/New_York' }).format(new Date()) === 'Thu';
        const digests = mailer.enabled && (thursday || url.searchParams.get('digest') === '1') ? await database.mail({ op:'digest' }) : {};
        // Everyone let in 48+ hours ago with a confirmed email who still hasn't chosen a neighborhood gets one reminder.
        const reminders = mailer.enabled ? await database.mail({ op:'remind' }) : {};
        const mail = await deliver(database,mailer,{ budget:thursday ? 45000 : 15000,limit:25 });
        const push = await deliverPush(database,pusher,{ budget:10000,limit:50 });
        // Files in the photo bucket whose photo was deleted (for example with its account) are removed too.
        const photos = await emptyPhotoTrash(database,storage).catch((error) => {
          console.error('Photo cleanup failed',error?.detail ?? error?.name ?? 'Error');
          return { photosRemoved:0,photoCleanupFailed:true };
        });
        return reply(res,200,{ ...mail,...push,...purged,...digests,...reminders,...photos });
      }
      if (req.method === 'GET' && action === 'events') {
        // Daily job, early morning: post upcoming library events and ward community meetings into each neighborhood,
        // then pin one "Today across Cleveland" post listing the day's events.
        if (!env.CRON_SECRET || req.headers.authorization !== 'Bearer '+env.CRON_SECRET) throw new Problem(401,'Not authorized.');
        if (!env.SUPABASE_SECRET_KEY) throw new Problem(503,'The backend key is not configured.');
        const { events: found, failures } = await gather();
        const result = await database.importEvents({ events:found, limit:100 });
        const today = await database.importEvents({ op:'roundup' });
        return reply(res,200,{ ...result,...today,found:found.length,failures });
      }
      if (req.method === 'GET' && action === 'callback') {
        const code = url.searchParams.get('code');
        const verifier = saved[prefix+'pkce'];
        const flow = saved[prefix+'flow'];
        try {
          if (!code || !verifier) throw new Error('Missing confirmation');
          session(res,await database.exchange(code,verifier));
          res.setHeader('Location',flow === 'recover' ? '/#reset-password' : '/');
          // Confirming an email unlocks mail that was waiting for it, such as the welcome; send it now.
          if (mailer.enabled) await deliver(database,mailer,{ budget:4000,limit:5 }).catch(() => {});
        } catch {
          res.setHeader('Location','/#link-expired');
        }
        res.statusCode = 303;
        return res.end();
      }
      if (req.method === 'GET' && action === 'image') {
        const id = url.searchParams.get('id') ?? '';
        if (!access) throw new Problem(401,'Sign in to continue.');
        if (!idPattern.test(id)) throw new Problem(404,'Photo unavailable.');
        const photo = await database.rpc(access,'image',{id});
        if (photo?.path && /^image\/(jpeg|png|webp)$/.test(photo.mime ?? '')) {
          // The photo is in the bucket: send the browser a link to it that works for an hour. The redirect itself is
          // kept for a little less, so a cached redirect never points at an expired link.
          res.statusCode = 302;
          res.setHeader('Location',await storage.sign(photo.path,3600));
          res.setHeader('Cache-Control','private, max-age=3000');
          return res.end();
        }
        if (!photo?.data || !/^image\/(jpeg|png|webp)$/.test(photo.mime ?? '')) throw new Problem(404,'Photo unavailable.');
        res.statusCode = 200;
        res.setHeader('Content-Type',photo.mime);
        res.setHeader('Cache-Control','private, max-age=86400, immutable');
        res.setHeader('Content-Disposition','inline');
        return res.end(Uint8Array.from(atob(photo.data.replace(/\s/g,'')),(c)=>c.charCodeAt(0)));
      }
      if (action === 'unsubscribe') {
        // The digest's one-click unsubscribe. Opening the link shows a button (so link scanners in mail filters can't
        // unsubscribe anyone by just visiting it); the button, or Gmail's one-click POST, turns the digest off.
        const token = url.searchParams.get('t') ?? '';
        res.setHeader('Content-Type','text/html; charset=utf-8');
        if (req.method === 'POST') {
          if (!env.SUPABASE_SECRET_KEY) throw new Problem(503,'The backend key is not configured.');
          const done = await database.mail({ op:'unsubscribe',token });
          res.statusCode = 200;
          return res.end(unsubscribePage(done?.ok ? 'done' : 'invalid',''));
        }
        if (req.method !== 'GET') throw new Problem(405,'Method unavailable.');
        res.statusCode = 200;
        return res.end(unsubscribePage(idPattern.test(token) ? 'ask' : 'invalid',token));
      }
      if (req.method !== 'POST') throw new Problem(405,'Method unavailable.');
      if (action === 'stripe-webhook') {
        await billing.webhook(await bytes(req,192000),req.headers['stripe-signature']);
        return reply(res,200,{ received:true });
      }
      if (!base || req.headers.origin !== base || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
        throw new Problem(403,'Request origin is not permitted.');
      }
      let body;
      try { body = JSON.parse(decode.decode(await bytes(req,action === 'upload_image' ? maxUpload : maxBytes))); }
      catch (error) { if (error instanceof Problem) throw error; throw new Problem(400,'Invalid request.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Problem(400,'Invalid request.');
      if (action === 'login' || action === 'signup' || action === 'recover') {
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        if (email.length > 254 || !emailPattern.test(email)) throw new Problem(400,'Enter a valid email address.');
        if (action !== 'recover' && (typeof body.password !== 'string' || body.password.length < (action === 'signup' ? 12 : 1)
          || utf8.encode(body.password).length > 72)) throw new Problem(400,'Use a valid password of up to 72 bytes. New passwords need 12 characters.');
        if (action === 'login') {
          session(res,await database.login(email,body.password));
          return reply(res,200,{ signedIn:true });
        }
        if (action === 'signup' && env.OPEN_SIGNUPS !== 'true') throw new Problem(403,'Public registration is closed.');
        const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
        const challenge = base64Url(await crypto.subtle.digest('SHA-256',utf8.encode(verifier)));
        const redirect = base + '/api/core?action=callback';
        if (action === 'signup') await database.signup(email,body.password,challenge,redirect);
        else await database.recover(email,challenge,redirect);
        res.setHeader('Set-Cookie',[cookie('pkce',verifier,3600),cookie('flow',action,3600)]);
        return reply(res,200,{ checkEmail:true });
      }
      if (action === 'refresh') {
        if (!saved[prefix+'refresh']) throw new Problem(401,'Sign in to continue.');
        session(res,await database.refresh(saved[prefix+'refresh']));
        return reply(res,200,{ signedIn:true });
      }
      if (action === 'logout') {
        if (access) await database.logout(access).catch(() => {});
        clear(res);
        return reply(res,200,{ signedOut:true });
      }
      if (!access) throw new Problem(401,'Sign in to continue.');
      if (action === 'reset-password') {
        if (typeof body.password !== 'string' || body.password.length < 12 || utf8.encode(body.password).length > 72) {
          throw new Problem(400,'Use at least 12 characters and up to 72 bytes.');
        }
        await database.updatePassword(access,body.password);
        return reply(res,200,{ ok:true });
      }
      if (action === 'checkout') {
        if (!billing.enabled) throw new Problem(503,'Billing is unavailable.');
        return reply(res,200,await billing.checkout(await database.rpc(access,action,{id:body.id})));
      }
      if (action === 'delete_account') {
        const result = await database.rpc(access,'delete_account',{ confirm:body.confirm });
        clear(res);
        return reply(res,200,result);
      }
      if (!appOperations.has(action)) throw new Problem(404,'Action unavailable.');
      if (action === 'save_push') {
        if (!pusher.enabled) throw new Problem(503,'Notifications are not available yet.');
        if (typeof body.endpoint !== 'string' || !pushHosts.test(body.endpoint)) throw new Problem(400,'This browser’s push service isn’t supported.');
      }
      if (action === 'upload_image' && storage.enabled) {
        // Check the bytes are really the photo type claimed, reserve a row (the database applies the limits), put
        // the file in the bucket, then mark the row stored. A reservation that never gets a file is swept daily.
        const bytes = photoBytes(body.mime,body.data);
        const reserved = await database.rpc(access,'reserve_image',{ mime:body.mime });
        await storage.put(reserved.path,bytes,body.mime);
        await database.photos({ op:'stored',id:reserved.id });
        return reply(res,200,{ id:reserved.id,ok:true });
      }
      const result = await database.rpc(access,action,body);
      await Promise.all([mailOperations.has(action) && mailer.enabled ? deliver(database,mailer).catch(() => {}) : null,
        pushOperations.has(action) && pusher.enabled ? deliverPush(database,pusher).catch(() => {}) : null]);
      return reply(res,200,result);
    } catch (error) {
      if (error instanceof Problem) {
        if (error.detail) console.error('Nabora request failed',action,error.detail);
        return reply(res,error.status,{ error:error.message });
      }
      console.error('Nabora request failed',action,error?.name ?? 'Error');
      return reply(res,502,{ error:'The service is temporarily unavailable.' });
    }
  };
}
