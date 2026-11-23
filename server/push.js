// Sends queued phone and desktop notifications with Web Push. Turned on by VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// APP_ORIGIN; without them, nothing is queued for sending and the app hides the notification switch.
import webpush from 'web-push';

// Push addresses the browser gave us must belong to a real push service, so the server never posts anywhere else.
export const pushHosts = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;

export function notice(item) {
  const p = item.payload ?? {};
  const who = p.actor ?? 'A neighbor';
  const about = p.title ? '“'+p.title+'”' : '';
  const templates = {
    reply:() => [who+' replied', about ? 'On '+about : 'Tap to read the reply.', 'post/'+p.post],
    message:() => [who+' sent you a message', 'Open Nabora to read it.', 'thread/'+p.thread],
    alert:() => ['Safety alert'+(p.area ? ' in '+p.area : ''), p.title ?? 'A neighbor posted a safety alert.', 'post/'+p.post],
    rsvp:() => [who+' is going', about ? 'To your event '+about : 'To your event.', 'post/'+p.post]
  };
  const build = templates[item.kind];
  if (!build) return null;
  const [title,body,path] = build();
  // The tag groups notices about the same post or conversation, so a busy thread replaces instead of piling up.
  return { title:title.slice(0,80), body:body.slice(0,160), url:'/#'+path, tag:item.kind+':'+(p.post ?? p.thread ?? '') };
}

export function pushAdapter(env, sender = webpush) {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, APP_ORIGIN: origin } = env;
  const enabled = !!(publicKey && privateKey && origin && env.SUPABASE_SECRET_KEY);
  const options = enabled ? { vapidDetails:{ subject:origin, publicKey, privateKey }, TTL:86400, urgency:'normal', timeout:6000 } : null;
  return {
    enabled,
    publicKey: enabled ? publicKey : '',
    // Returns 'sent', 'gone' (the device unsubscribed or was reset; forget it) or 'failed' (try again later).
    async send(device,message) {
      if (!pushHosts.test(device.endpoint)) return 'gone';
      try {
        await sender.sendNotification({ endpoint:device.endpoint, keys:{ p256dh:device.p256dh, auth:device.auth } },
          JSON.stringify(message),{ ...options, urgency:message.tag.startsWith('alert') ? 'high' : 'normal' });
        return 'sent';
      } catch (error) {
        return error?.statusCode === 404 || error?.statusCode === 410 ? 'gone' : 'failed';
      }
    }
  };
}

export async function deliverPush(database,pusher,{ budget = 4000,limit = 20 } = {}) {
  if (!pusher.enabled) return { pushed:0,pushFailed:0 };
  const started = Date.now();
  let pushed = 0;
  let pushFailed = 0;
  while (Date.now()-started < budget) {
    const batch = await database.push({ op:'claim',limit });
    if (!batch?.length) break;
    await Promise.all(batch.map(async (item) => {
      const message = notice(item);
      const results = message ? await Promise.all((item.devices ?? []).map(async (device) => [device.endpoint,await pusher.send(device,message)])) : [];
      const gone = results.filter(([,r]) => r === 'gone').map(([e]) => e);
      const sent = results.filter(([,r]) => r === 'sent').map(([e]) => e);
      // Done when at least one device got it, or nothing is left to try.
      const ok = !message || sent.length > 0 || results.every(([,r]) => r === 'gone');
      await database.push({ op:'done',id:item.id,ok,gone,sent });
      if (sent.length) pushed++; else if (!ok) pushFailed++;
    }));
    if (batch.length < limit) break;
  }
  return { pushed,pushFailed };
}
