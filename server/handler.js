import { billingAdapter } from './billing.js';
import { Problem, supabaseAdapter } from './supabase.js';

const appOperations = new Set(['bootstrap','join','feed','post','create_post','close_post','reply','directory','my_businesses',
  'business','create_business','update_business','threads','thread','message','block','unblock','submit_review','report_review',
  'my_reviews','appeal','apply_vetting','moderation','decide_review','decide_appeal','decide_vetting','report_content','decide_content',
  'delete_post','delete_reply','react','rsvp','vote','upload_image','notifications','read_notifications','search','profile','update_profile',
  'request_residency','cancel_residency','confirm_residency','decide_residency','map']);
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
  local = false } = {}) {
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
        return reply(res,200,{ configured: database.configured, signups: env.OPEN_SIGNUPS === 'true', billing: billing.enabled, local });
      }
      if (req.method === 'GET' && action === 'callback') {
        const code = url.searchParams.get('code');
        const verifier = saved[prefix+'pkce'];
        const flow = saved[prefix+'flow'];
        try {
          if (!code || !verifier) throw new Error('Missing confirmation');
          session(res,await database.exchange(code,verifier));
          res.setHeader('Location',flow === 'recover' ? '/#reset-password' : '/');
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
        if (!photo?.data || !/^image\/(jpeg|png|webp)$/.test(photo.mime ?? '')) throw new Problem(404,'Photo unavailable.');
        res.statusCode = 200;
        res.setHeader('Content-Type',photo.mime);
        res.setHeader('Cache-Control','private, max-age=86400, immutable');
        res.setHeader('Content-Disposition','inline');
        return res.end(Uint8Array.from(atob(photo.data.replace(/\s/g,'')),(c)=>c.charCodeAt(0)));
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
      if (!appOperations.has(action)) throw new Problem(404,'Action unavailable.');
      return reply(res,200,await database.rpc(access,action,body));
    } catch (error) {
      if (error instanceof Problem) return reply(res,error.status,{ error:error.message });
      console.error('NeighborhoodOS request failed',action,error?.name ?? 'Error');
      return reply(res,502,{ error:'The service is temporarily unavailable.' });
    }
  };
}
