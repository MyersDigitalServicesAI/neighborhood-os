// Sends queued email through Resend's HTTP API. Turned on by RESEND_API_KEY, EMAIL_FROM and APP_ORIGIN;
// without them, mail stays queued in the database and nothing is sent.
const esc = (value = '') => String(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const eventTime = new Intl.DateTimeFormat('en-US',{ weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York' });
export const unsubscribeLink = (origin,token) => origin+'/api/core?action=unsubscribe&t='+encodeURIComponent(token);

// "This week in <neighborhood>": the most-discussed posts and the coming week's events.
function digest(item,origin) {
  const p = item.payload ?? {};
  const area = p.area ?? 'your neighborhood';
  const link = (path) => origin+'/#'+path;
  const posts = (p.posts ?? []).slice(0,5);
  const events = (p.events ?? []).slice(0,6);
  const greeting = item.name ? 'Hi '+item.name.split(' ')[0]+',' : 'Hi,';
  const leave = unsubscribeLink(origin,p.token);
  const subject = events.length && posts.length ? 'This week in '+area+': '+posts[0].title :
    posts.length ? 'This week in '+area+': '+posts[0].title : 'Coming up in '+area+': '+events[0].title;
  const replies = (n) => n ? ' · '+n+(n === 1 ? ' reply' : ' replies') : '';
  const when = (e) => eventTime.format(new Date(e.event_at))+(e.place ? ' · '+e.place : '')+(e.area ? ' · '+e.area : '');
  const text = [greeting,'','Here’s what’s happening in '+area+' this week.',
    ...(posts.length ? ['','TALKED ABOUT THIS WEEK',...posts.map((x)=>'• '+x.title+replies(x.replies)+'\n  '+link('post/'+x.id))] : []),
    ...(events.length ? ['','COMING UP',...events.map((e)=>'• '+e.title+' · '+when(e)+'\n  '+link('post/'+e.id))] : []),
    '','Open Nabora: '+link('feed'),'',
    'You get this weekly digest because you have a Nabora account. Stop the digest: '+leave+'\nOther email settings: '+link('account'),''].join('\n');
  const row = (href,title,sub) => '<tr><td style="padding:10px 0;border-bottom:1px solid #e2e5da"><a href="'+esc(href)+'" style="color:#194633;font-weight:bold;text-decoration:none;font-size:16px">'+esc(title)+'</a>'+
    (sub ? '<div style="color:#53635a;font-size:14px;margin-top:3px">'+esc(sub)+'</div>' : '')+'</td></tr>';
  const section = (heading,rows) => '<p style="margin:22px 0 4px;font-size:12px;letter-spacing:1px;font-weight:bold;color:#3e7d6a">'+heading+'</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'+rows+'</table>';
  const html = '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#182b23;max-width:560px">'+
    '<p style="margin:0 0 4px;font-size:20px;font-weight:bold;color:#194633">This week in '+esc(area)+'</p>'+
    '<p style="margin:0 0 6px">'+esc(greeting)+' here’s what your neighbors are talking about and what’s coming up.</p>'+
    (posts.length ? section('TALKED ABOUT THIS WEEK',posts.map((x)=>row(link('post/'+x.id),x.title,(x.preview ?? '').slice(0,140)+replies(x.replies))).join('')) : '')+
    (events.length ? section('COMING UP',events.map((e)=>row(link('post/'+e.id),e.title,when(e))).join('')) : '')+
    '<p style="margin:24px 0"><a href="'+esc(link('feed'))+'" style="display:inline-block;background:#194633;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open Nabora</a></p>'+
    '<p style="font-size:13px;color:#53635a">You get this weekly digest because you have a Nabora account. <a href="'+esc(leave)+'" style="color:#53635a">Stop the weekly digest</a> · <a href="'+esc(link('account'))+'" style="color:#53635a">Email settings</a></p></div>';
  return { subject:subject.slice(0,120),text,html,unsubscribe:leave };
}

export function compose(item,origin) {
  if (item.kind === 'digest') return digest(item,origin);
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
    admitted:() => ['You’re in. Welcome to Nabora',
      'Your account has been admitted. Sign in and choose your neighborhood to start.','Choose my neighborhood',link('login')],
    invite:() => [(p.inviter ?? 'A neighbor')+' invited you to Nabora',
      (p.inviter ?? 'A neighbor')+' invited you to join your neighbors on Nabora'+(p.area ? ' in '+p.area : '')+'. Open the link in the browser you will use, create an account, and you will be let straight in.',
      'Accept the invite',link('invite/'+p.code)]
  };
  const build = templates[item.kind];
  if (!build) return null;
  const [subject,line,button,url] = build();
  const footer = item.kind === 'invite' ? 'If you were not expecting this, you can ignore it.' :
    'You get these emails because you have a Nabora account. Turn them off under Account in the app: '+link('account');
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
        body:JSON.stringify({ from,to:[item.email],subject:message.subject,text:message.text,html:message.html,
          // One-click unsubscribe (RFC 8058), which Gmail and Yahoo require for bulk mail such as the digest.
          ...(message.unsubscribe ? { headers:{ 'List-Unsubscribe':'<'+message.unsubscribe+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click' } } : {}) }),
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
