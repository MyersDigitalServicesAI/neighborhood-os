// Sends queued email through Resend's HTTP API. Turned on by RESEND_API_KEY, EMAIL_FROM and APP_ORIGIN;
// without them, mail stays queued in the database and nothing is sent.
const esc = (value = '') => String(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function compose(item,origin) {
  const p = item.payload ?? {};
  const greeting = item.name ? 'Hi '+item.name.split(' ')[0]+',' : 'Hi,';
  const link = (path) => origin+'/#'+path;
  const templates = {
    reply:() => [(p.actor ?? 'A neighbor')+' replied to '+(p.title ? '“'+p.title+'”' : 'your post'),
      (p.actor ?? 'A neighbor')+' replied to '+(p.title ? 'your post “'+p.title+'”' : 'a conversation you are in')+'.','Read the reply',link('post/'+p.post)],
    message:() => [(p.actor ?? 'A neighbor')+' sent you a message',
      (p.actor ?? 'A neighbor')+' sent you a private message. For your privacy the message itself is only shown in the app.','Open your messages',link('thread/'+p.thread)],
    alert:() => ['Safety alert'+(p.area ? ' in '+p.area : '')+': '+(p.title ?? ''),
      (p.actor ?? 'A neighbor')+' posted a safety alert'+(p.area ? ' in '+p.area : '')+': '+(p.title ?? '')+'.','See the alert',link('post/'+p.post)],
    admitted:() => ['You’re in. Welcome to NeighborhoodOS',
      'Your account has been admitted. Sign in and choose your neighborhood to start.','Choose my neighborhood',link('login')],
    invite:() => [(p.inviter ?? 'A neighbor')+' invited you to NeighborhoodOS',
      (p.inviter ?? 'A neighbor')+' invited you to join your neighbors on NeighborhoodOS'+(p.area ? ' in '+p.area : '')+'. Open the link in the browser you will use, create an account, and you will be let straight in.',
      'Accept the invite',link('invite/'+p.code)]
  };
  const build = templates[item.kind];
  if (!build) return null;
  const [subject,line,button,url] = build();
  const footer = item.kind === 'invite' ? 'If you were not expecting this, you can ignore it.' :
    'You get these emails because you have a NeighborhoodOS account. Turn them off under Account in the app: '+link('account');
  const text = greeting+'\n\n'+line+'\n\n'+button+': '+url+'\n\n'+footer+'\n';
  const html = '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#182b23;max-width:520px">'+
    '<p>'+esc(greeting)+'</p><p>'+esc(line)+'</p><p><a href="'+esc(url)+'" style="display:inline-block;background:#194633;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">'+esc(button)+'</a></p>'+
    '<p style="font-size:13px;color:#53635a">'+esc(footer)+'</p></div>';
  return { subject,text,html };
}

export function mailerAdapter(env, request = fetch) {
  const { RESEND_API_KEY: key, EMAIL_FROM: from, APP_ORIGIN: origin } = env;
  const enabled = !!(key && from && origin && env.SUPABASE_SECRET_KEY);
  return {
    enabled,
    async send(item) {
      const message = compose(item,origin);
      if (!message || !item.email) return false;
      const response = await request('https://api.resend.com/emails',{
        method:'POST',
        headers:{ Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'outbox-'+item.id },
        body:JSON.stringify({ from,to:[item.email],subject:message.subject,text:message.text,html:message.html }),
        signal:AbortSignal.timeout(6000)
      });
      return response.ok;
    }
  };
}

// Sends what is queued, a small batch at a time, within a time budget. Failures are recorded and retried later.
export async function deliver(database,mailer,{ budget = 4000,limit = 10 } = {}) {
  if (!mailer.enabled) return { sent:0,failed:0 };
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  while (Date.now()-started < budget) {
    const batch = await database.mail({ op:'claim',limit });
    if (!batch?.length) break;
    for (const item of batch) {
      let ok = false;
      try { ok = await mailer.send(item); } catch { ok = false; }
      await database.mail({ op:'done',id:item.id,ok });
      if (ok) sent++; else failed++;
    }
    if (batch.length < limit) break;
  }
  return { sent,failed };
}
