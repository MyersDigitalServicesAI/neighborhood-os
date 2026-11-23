// Nabora service worker: shows notifications, opens the right page when one is tapped, and keeps the app usable on
// a bad connection. It never caches account data: anything under /api always goes to the network.
const shell = 'nabora-shell-v1';
const assets = 'nabora-assets-v1';
const offline = '/offline.html';

self.addEventListener('install',(event)=>{
  event.waitUntil(caches.open(shell).then((cache)=>cache.addAll([offline,'/events.css','/icon-192.png','/badge-96.png'])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',(event)=>{
  event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((k)=>k!==shell && k!==assets).map((k)=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

self.addEventListener('fetch',(event)=>{
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    // Pages always come fresh from the network; the offline page only stands in when there is no connection.
    event.respondWith(fetch(request).catch(()=>caches.match(offline)));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Built files have a content hash in their name, so a cached copy is always correct.
    event.respondWith(caches.open(assets).then(async (cache)=>{
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) cache.put(request,response.clone());
      return response;
    }));
  }
});

self.addEventListener('push',(event)=>{
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/#notifications';
  event.waitUntil(self.registration.showNotification(data.title || 'Nabora',{
    body:data.body || 'Something new in your neighborhood.',
    icon:'/icon-192.png',
    badge:'/badge-96.png',
    tag:data.tag || undefined,
    renotify:!!data.tag,
    data:{ url }
  }));
});

self.addEventListener('notificationclick',(event)=>{
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#notifications',location.origin).href;
  event.waitUntil(self.clients.matchAll({ type:'window',includeUncontrolled:true }).then(async (windows)=>{
    const open = windows.find((w)=>new URL(w.url).origin === location.origin);
    if (open) {
      await open.focus();
      return open.navigate ? open.navigate(target).catch(()=>open.postMessage({ open:target })) : open.postMessage({ open:target });
    }
    return self.clients.openWindow(target);
  }));
});

// The browser can replace a push subscription (for example after a reset). Ask the open app to save the new one.
self.addEventListener('pushsubscriptionchange',(event)=>{
  event.waitUntil(self.clients.matchAll({ type:'window' }).then((windows)=>windows.forEach((w)=>w.postMessage({ resubscribe:true }))));
});
