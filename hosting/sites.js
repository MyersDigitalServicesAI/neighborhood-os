import assets from '../dist/site-assets.mjs';
import { makeHandler } from '../server/handler.js';

const security = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Robots-Tag': 'noindex, nofollow'
};

function serveApi(request,env) {
  return new Promise((resolve,reject)=>{
    const url = new URL(request.url);
    const incoming = {
      method:request.method, url:url.pathname + url.search, headers:Object.fromEntries(request.headers),
      async *[Symbol.asyncIterator]() {
        if (!request.body) return;
        const reader = request.body.getReader();
        try {
          for (;;) {
            const {done,value} = await reader.read();
            if (done) break;
            yield value;
          }
        } finally { reader.releaseLock(); }
      }
    };
    const headers = new Headers(security);
    const outgoing = {
      statusCode:200,
      setHeader(key,value) {
        headers.delete(key);
        for (const v of Array.isArray(value)?value:[value]) headers.append(key,v);
      },
      end(body) { resolve(new Response(body,{status:this.statusCode,headers})); }
    };
    makeHandler({env})(incoming,outgoing).catch(reject);
  });
}

export default {
  async fetch(request,env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/core') return serveApi(request,env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed',{status:405,headers:security});
    const path = pathname==='/' ? '/index.html' : pathname;
    if (!Object.hasOwn(assets,path)) return new Response('Not found',{status:404,headers:security});
    const [type,encoded] = assets[path];
    const body = request.method==='HEAD' ? null : Uint8Array.from(atob(encoded),(c)=>c.charCodeAt(0));
    return new Response(body,{headers:{...security,'Content-Type':type,'Cache-Control':
      path.startsWith('/assets/')?'public, max-age=31536000, immutable':'private, no-store'}});
  }
};
