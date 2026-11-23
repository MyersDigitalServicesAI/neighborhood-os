import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/dm-sans/wght.css';
import './style.css';
import * as view from './views.js';
import { action, blank, esc, form, button, typeInfo } from './ui.js';
import * as push from './push.js';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const authRoutes = new Set(['login','signup','recover','link-expired','reset-password']);
const guarded = new Set(['feed','requests','new','post','directory','business','business-new','business-edit','inbox','thread',
  'compose','account','manage','my-reviews','moderation','market','notifications','search','neighbor','map','admin','host','host-session','guide','events','flyers','flyer']);
const feedKinds = new Set(['discussion','event','alert','lost','poll','offer']);
let config = {configured:false,signups:false,billing:false,local:false};
let context = null;
let version = 0;
let refreshing;
let noticeTimer;
let synced = 0;
const endpoint = '/api/core?action=';

class ApiError extends Error {
  constructor(status,message) { super(message); this.status = status; }
}

async function raw(operation,data) {
  const response = await fetch(endpoint + encodeURIComponent(operation),data === undefined ? {} : {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
  });
  const payload = await response.json().catch(()=>null);
  if (!response.ok || payload === null) throw new ApiError(response.status,payload?.error ?? 'Could not load this. Try again.');
  return payload;
}

async function rpc(operation,data = {}) {
  try { return await raw(operation,data); }
  catch (error) {
    if (error.status !== 401) throw error;
    refreshing ??= raw('refresh',{}).finally(()=> { refreshing = null; });
    await refreshing;
    return raw(operation,data);
  }
}
function route() {
  const [path,params] = location.hash.slice(1).split('?');
  const [key,arg = ''] = path.split('/');
  return { key,arg,params:new URLSearchParams(params) };
}
function go(target) {
  if (location.hash.slice(1)===target) return render();
  location.hash = target;
}
function show(message) {
  notice.textContent = message;
  notice.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(()=>notice.classList.remove('visible'),4700);
}
// The map is a separate chunk so the feed never pays for it.
async function showMap(options) {
  const root = document.querySelector('#map-root');
  if (!root) return null;
  try { return await (await import('./map.js')).mount(root,options); }
  catch { root.innerHTML = '<p class="notice-box">The map could not be loaded. You can still use the list.</p>'; return null; }
}
const inviteKey = 'nh_invite';
let createdInvite = null;
function storedInvite() {
  try { return localStorage.getItem(inviteKey) ?? ''; } catch { return ''; }
}
function storeInvite(code) {
  try { if (code) localStorage.setItem(inviteKey,code); else localStorage.removeItem(inviteKey); } catch { /* Private browsing: the code stays in the address only. */ }
}
const checkinKey = 'nh_checkin';
function storedCheckin() {
  try { return localStorage.getItem(checkinKey) ?? ''; } catch { return ''; }
}
function storeCheckin(code) {
  try { if (code) localStorage.setItem(checkinKey,code); else localStorage.removeItem(checkinKey); } catch { /* Private browsing: the code stays in the address only. */ }
}
let hostTimer;
let countsPromise;
async function showLandingMap(current) {
  countsPromise ??= raw('counts').catch(()=>{ countsPromise = null; return null; });
  const counts = await countsPromise;
  if (current !== version || !document.querySelector('#map-root')) return;
  const values = counts?.areas ?? {};
  const levels = Object.fromEntries(Object.entries(values).map(([id,value])=>[id,typeof value === 'number' ? 3 : 2]));
  const total = document.querySelector('#map-total');
  if (counts && total) {
    total.textContent = counts.total === 'few' || !counts.places ? 'We are just getting started. Tap your neighborhood and be one of the first to join.' :
      counts.total+' neighbors have joined across '+counts.places+' '+(counts.places===1?'neighborhood':'neighborhoods and suburbs')+'. Tap yours to see who is there.';
  }
  await showMap({levels,onPick:(picked)=>{
    const panel = document.querySelector('#map-panel');
    if (!panel) return;
    panel.innerHTML = picked ? view.landingPanel(picked,values[picked.id],config) :
      '<p class="quiet">That spot is outside the areas we cover. Tap a neighborhood or suburb.</p>';
  }});
}
async function sync() {
  context = await rpc('bootstrap');
  synced = Date.now();
}
function encode(blob) {
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror = ()=>reject(new ApiError(400,'That photo could not be read.'));
    reader.readAsDataURL(blob);
  });
}
// Photos are scaled down in the browser so only a small JPEG ever leaves the device.
async function shrink(file) {
  let picture;
  try { picture = await createImageBitmap(file); }
  catch { throw new ApiError(400,'That file is not a photo this browser can open.'); }
  for (const [edge,quality] of [[1280,.82],[1280,.66],[960,.7],[720,.62],[560,.5]]) {
    const scale = Math.min(1,edge/Math.max(picture.width,picture.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(picture.width*scale));
    canvas.height = Math.max(1,Math.round(picture.height*scale));
    canvas.getContext('2d').drawImage(picture,0,0,canvas.width,canvas.height);
    const blob = await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',quality));
    if (blob && blob.size <= 290000) return { mime:'image/jpeg',data:await encode(blob) };
  }
  throw new ApiError(400,'That photo is too detailed to send. Try a different one.');
}
function setEvidence(formNode) {
  const container = formNode.querySelector('.evidence-fields');
  if (!container) return;
  const enabled = formNode.elements.action.value === 'approved';
  container.hidden = !enabled;
  for (const field of container.querySelectorAll('input')) field.disabled = !enabled;
}

async function render() {
  const current = ++version;
  const {key,arg,params} = route();
  const signedIn = !!context;
  let content;
  let page = key;
  let aside;
  if (key === 'content') return;
  if (key === 'standards' || key === 'privacy') {
    app.innerHTML = view.information(key,signedIn);
    return;
  }
  clearTimeout(hostTimer);
  if (key === 'checkin') {
    if (/^[A-Za-z2-9]{8}$/.test(arg)) storeCheckin(arg.toUpperCase());
    if (!signedIn) return go(config.signups ? 'signup' : 'login');
    if (!context.member) return go('join');
  }
  if (key === 'invite') {
    if (/^[A-Za-z0-9]{10}$/.test(arg)) storeInvite(arg.toUpperCase());
    return go(!signedIn ? (config.signups ? 'signup' : 'login') : context.member ? 'feed' : 'join');
  }
  if (key === 'reset-password' || key === 'link-expired' || (!signedIn && authRoutes.has(key))) {
    app.innerHTML = view.authView(key,{...config,invite:!!storedInvite() || !!storedCheckin()});
    return;
  }
  if (!signedIn && key === 'events') return location.replace('/events'+(params.toString()?'?'+params:''));
  if (!signedIn) {
    app.innerHTML = guarded.has(key) ? view.authView('login',{...config,invite:!!storedInvite()}) : view.landing(config);
    if (!guarded.has(key)) await showLandingMap(current);
    return;
  }
  if (!context.member) {
    let invite = storedInvite();
    let suggested = '';
    if (invite && !context.canJoin) {
      const info = await rpc('invite_info',{invite}).catch(()=>null);
      if (current !== version) return;
      if (!info?.valid) { storeInvite(''); invite = ''; show('That invite link has expired or been used up. Ask for a new one.'); }
      else suggested = info.area ?? '';
    }
    let checkin = storedCheckin();
    if (checkin && !context.canJoin && !invite) {
      const info = await rpc('checkin_info',{checkin}).catch(()=>null);
      if (current !== version) return;
      if (!info?.valid) { storeCheckin(''); checkin = ''; show('That check-in has ended. Ask the host for the current QR code.'); }
      else suggested = info.area ?? '';
    }
    app.innerHTML = view.joinView(context.areas,context.canJoin,invite,checkin);
    const choice = app.querySelector('select[name="area"]');
    const note = app.querySelector('#map-note');
    if (!choice) return;
    if (suggested) choice.value = suggested;
    const map = await showMap({pin:true,selected:suggested || undefined,onPick:(picked)=>{
      const known = picked && [...choice.options].some((option)=>option.value===picked.id);
      choice.value = known ? picked.id : '';
      note.textContent = known ? 'Pin dropped in '+picked.name+'. Its position is never sent or stored.' :
        'That spot is outside the areas we cover. Tap inside a neighborhood or suburb.';
    }});
    choice.addEventListener('change',()=>map?.select(choice.value));
    return;
  }
  const {member} = context;
  const area = context.areas.find((a)=>a.id===member.area_id)?.name ?? 'Your neighborhood';
  const id = arg;
  const reach = ['nearby','neo'].includes(params.get('in')) ? params.get('in') : '';
  const scope = reach === 'neo' ? 'region' : reach;
  try {
    if (Date.now() - synced > 45000) await sync();
    switch (key) {
      case 'requests':
      case 'feed':
      case '': {
        page = key === 'requests' ? 'requests' : 'feed';
        const kind = page === 'requests' ? 'request' : feedKinds.has(arg) ? arg : '';
        const [items,alerts,pinned] = await Promise.all([rpc('feed',{kind,scope}),kind ? [] : rpc('feed',{kind:'alert',fresh:'1',scope}),
          kind ? [] : rpc('pinned',{scope})]);
        content = view.feedView(items,area,page,kind,alerts.slice(0,3),reach,context.nearby,member.name,pinned);
        aside = view.feedAside(area,context.member,context);
        break;
      }
      case 'map':
        content = view.mapView(area);
        break;
      case 'events': {
        page = 'events';
        const when = ['week','weekend'].includes(params.get('when')) ? params.get('when') : '';
        content = view.eventsView(await rpc('events',{area:params.get('area') ?? '',when}),member.area_id);
        break;
      }
      case 'guide': {
        page = 'guide';
        content = view.guideView(await rpc('guide',{area:arg}),context.areas,member.area_id,context.canEditGuide);
        break;
      }
      case 'market':
        content = view.marketView(await rpc('feed',{kind:'sale',scope}),'sale',reach,area,context.nearby);
        break;
      case 'new':
        page = arg==='request' ? 'requests' : arg==='sale' ? 'market' : 'feed';
        content = view.composer(typeInfo[arg] ? arg : 'discussion',await rpc('my_businesses'),area);
        break;
      case 'notifications': {
        const list = await rpc('notifications');
        content = view.notificationsView(list);
        if (list.some((n)=>!n.read)) {
          await rpc('read_notifications');
          context.unread = 0;
        }
        break;
      }
      case 'search': {
        const q = (params.get('q') ?? '').trim();
        content = view.searchView(q,q.length > 1 ? await rpc('search',{q}) : null);
        break;
      }
      case 'neighbor': {
        const [profile,posts] = await Promise.all([rpc('profile',{id}),rpc('feed',{author:id})]);
        if (!profile) throw new ApiError(404,'Neighbor unavailable.');
        page = id === member.id ? 'account' : 'feed';
        content = view.profileView(profile,posts,member.id);
        break;
      }
      case 'post': {
        const [post,businesses] = await Promise.all([rpc('post',{id}),rpc('my_businesses')]);
        page = post.kind==='request' ? 'requests' : 'feed';
        content = view.postView(post,member.id,businesses,context.canPin);
        break;
      }
      case 'directory': {
        const q = params.get('q') ?? '';
        const category = params.get('category') ?? '';
        const vetted = params.get('vetted') ? '1' : '';
        content = view.directoryView(await rpc('directory',{q,category,vetted}),q,category,vetted);
        break;
      }
      case 'business':
        page = 'directory';
        content = view.businessView(await rpc('business',{id}),member.id);
        break;
      case 'business-new':
        page = 'directory';
        content = view.businessForm();
        break;
      case 'business-edit': {
        page = 'account';
        const owned = (await rpc('my_businesses')).find((b)=>b.id===id);
        if (!owned) throw new ApiError(404,'Business unavailable.');
        content = view.businessForm(owned);
        break;
      }
      case 'inbox':
        content = view.inboxView(await rpc('threads'));
        break;
      case 'compose':
        page = 'inbox';
        content = view.composeMessage(id);
        break;
      case 'thread':
        page = 'inbox';
        content = view.threadView(await rpc('thread',{id}),member.id);
        break;
      case 'account':
        content = view.accountView(context);
        break;
      case 'manage':
        page = 'account';
        content = view.manageView(await rpc('my_businesses'),config.billing);
        break;
      case 'my-reviews':
        page = 'account';
        content = view.myReviewsView(await rpc('my_reviews'));
        break;
      case 'checkin': {
        page = 'account';
        const code = storedCheckin();
        content = view.checkinView(code ? await rpc('checkin_info',{checkin:code}) : null,code,member);
        break;
      }
      case 'host':
        page = 'account';
        if (!context.hostAreas?.length) throw new ApiError(403,'Only check-in hosts can open this page.');
        content = view.hostListView(await rpc('checkins'),context.areas,context.hostAreas);
        break;
      case 'host-session':
        page = 'account';
        content = view.hostSessionView(await rpc('checkin_host',{id}));
        break;
      case 'flyers':
        page = 'account';
        content = view.flyersView((await rpc('flyers')).flyers,context,location.origin);
        break;
      case 'flyer': {
        page = 'account';
        const flyer = (await rpc('flyers')).flyers.find((f)=>f.id===id) ?? (context.staff==='admin' ? (await rpc('admin')).flyers?.find((f)=>f.id===id) : null);
        if (!flyer) throw new ApiError(404,'This flyer was retired or isn’t yours.');
        content = view.flyerSheet(flyer,params.get('f')==='quarter'?'quarter':'half',location.origin);
        break;
      }
      case 'admin': {
        const data = await rpc('admin');
        content = view.adminView(data,context.areas,createdInvite);
        createdInvite = null;
        break;
      }
      case 'moderation':
        content = view.moderationView(await rpc('moderation'));
        break;
      default:
        content = blank('home','Page unavailable','Return to your neighborhood to keep going.',action('Go to feed','feed','outline'));
    }
  } catch (error) {
    if (current !== version) return;
    if (error.status === 401) {
      context = null;
      return go('login');
    }
    content = blank('flag','Couldn’t open this page',error.message,form('retry',button('Try again','outline')));
  }
  if (current !== version) return;
  app.innerHTML = view.shell(context,page,content,aside);
  if (key === 'map') {
    const summary = await rpc('map').catch(()=>({}));
    if (current !== version) return;
    const nearby = new Set();
    const map = await showMap({home:member.area_id,selected:member.area_id,onPick:(picked)=>{
      const panel = document.querySelector('#map-panel');
      if (!panel) return;
      panel.innerHTML = picked ? view.mapPanel(picked,picked.id===member.area_id?'home':nearby.has(picked.id)?'near':'',summary[picked.id]) :
        '<p class="quiet">That spot is outside the areas we cover. Tap a neighborhood or suburb.</p>';
    }});
    const mine = map?.areas.find((entry)=>entry.id===member.area_id);
    for (const id of mine?.near ?? []) nearby.add(id);
    const panel = document.querySelector('#map-panel');
    if (mine && panel) panel.innerHTML = view.mapPanel(mine,'home',summary[mine.id]);
  }
  for (const node of app.querySelectorAll('form[data-action="decide_vetting"]')) setEvidence(node);
  if (key === 'account' || page === 'feed') await showPush(current);
  document.body.classList.toggle('flyer-mode',key === 'flyer');
  if (key === 'flyer') {
    const { drawQr } = await import('./qr.js');
    for (const slot of app.querySelectorAll('.qr-slot')) drawQr(slot,slot.dataset.link,'QR code that opens Nabora sign-up');
  }
  if (key === 'host-session') {
    const root = document.querySelector('#qr-root');
    if (root) (await import('./qr.js')).drawQr(root,root.dataset.link);
    // The attendee list refreshes while the host keeps the page open.
    hostTimer = setTimeout(()=>{ if (route().key === 'host-session' && !document.querySelector('form :focus')) render(); },10000);
  }
}

// Fills the notification switch on Account and, once, a gentle nudge at the top of the feed.
async function showPush(current) {
  const panel = document.querySelector('#push-panel');
  const nudge = document.querySelector('#push-nudge');
  if (!config.push || (!panel && !nudge)) return;
  const state = await push.state().catch(()=>'unsupported');
  if (current !== version) return;
  if (panel) {
    panel.innerHTML = view.pushPanel(state);
    panel.hidden = !panel.innerHTML;
  }
  if (nudge && state === 'off' && Notification.permission === 'default' && !push.snoozed()) nudge.innerHTML = view.pushNudge();
}
async function setPush(choice) {
  if (choice === 'later') {
    push.snooze();
    document.querySelector('#push-nudge')?.replaceChildren();
    return;
  }
  const state = choice === 'on' ? await push.enable(config.push,(d)=>rpc('save_push',d)) : await push.disable((d)=>rpc('remove_push',d));
  push.snooze();
  if (choice === 'on') show(state === 'on' ? 'Notifications are on for this device.' :
    state === 'blocked' ? 'Notifications are blocked. Allow them in your browser’s site settings.' : 'Notifications stay off.');
  else show('Notifications are off for this device.');
  document.querySelector('#push-nudge')?.replaceChildren();
  const panel = document.querySelector('#push-panel');
  if (panel) panel.innerHTML = view.pushPanel(state);
}
const messages = {
  delete_reply:'Reply deleted.',update_profile:'Profile saved.',request_residency:'Postcard requested.',cancel_residency:'Verification withdrawn and address deleted.',
  confirm_residency:'Address verified. Your address record has been deleted.',decide_residency:'Recorded. The address has been erased.',vote:'Vote recorded.',
  decide_content:'Content decision recorded.',report_content:'Report sent to staff.',close_post:'Post updated.', reply:'Reply posted.', apply_vetting:'Application sent to staff.',
  submit_review:'Review sent for human moderation.', report_review:'Report sent to staff.', appeal:'Appeal submitted.',
  decide_review:'Review decision recorded.', decide_appeal:'Appeal decision recorded.', decide_vetting:'Vetting decision recorded.',
  update_business:'Business profile saved.', block:'Messages blocked.', unblock:'Messages unblocked.',
  set_vetter:'Vetting access updated.', waive_fee:'Fee waived. The business still needs a vetting approval from other staff.', unvouch:'Vouch withdrawn.', set_host:'Hosts updated.', pin_post:'Post pinned to the top of the feed.', save_guide_item:'Guide updated.', claim_food:'Claim sent. An admin will check it, usually within a day.', save_food:'Listing updated. Neighbors see it right away.', decide_food_claim:'Claim decision recorded.', hide_guide_item:'Removed from the guide.', unpin_post:'Post unpinned.', end_checkin:'Check-in ended. The code no longer works.', undo_checkin:'Verification undone.'
};
const pages = {
  'feed-more': {op:'feed',target:'feed-results',render:view.postCard,size:25},
  'market-more': {op:'feed',target:'market-results',render:view.marketCard,size:25},
  'directory-more': {op:'directory',target:'directory-results',render:view.businessCard,size:25},
  'reviews-more': {op:'business',target:'review-results',items:'reviews',render:view.reviewCard,size:25},
  'threads-more': {op:'threads',target:'thread-results',render:view.threadRow,size:30},
  'messages-more': {op:'thread',target:'message-results',items:'messages',render:(item)=>view.bubble(item,context.member.id),size:40}
};
async function loadMore(op,data,element) {
  const page = pages[op];
  const result = await rpc(page.op,data);
  const items = page.items ? result[page.items] : result;
  if (!element.isConnected) return;
  const olderMessages = op==='messages-more';
  document.querySelector('#'+page.target)?.insertAdjacentHTML(olderMessages?'afterbegin':'beforeend',items.map(page.render).join(''));
  if (items.length < page.size) return element.remove();
  const next = olderMessages ? items[0] : items.at(-1);
  const carried = {...data,...(op==='directory-more' ? {afterName:next.name} : {})};
  const extra = Object.entries(carried).filter(([name])=>name!=='before'&&name!=='cursor')
    .map(([name,value])=>'<input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'">').join('');
  element.outerHTML = view.pager(op,next,extra);
}
async function submit(operation,data,element) {
  if (operation === 'retry') return render();
  if (pages[operation]) return loadMore(operation,data,element);
  if (operation === 'search_directory') {
    return go('directory?'+new URLSearchParams({q:data.q.trim(),category:data.category,...(data.vetted?{vetted:'1'}:{})}));
  }
  if (operation === 'search') return go('search?'+new URLSearchParams({q:data.q.trim()}));
  if (operation === 'guide_area') return go('guide/'+encodeURIComponent(data.area));
  if (operation === 'events_filter') return go('events?'+new URLSearchParams({...(data.when?{when:data.when}:{}),...(data.area?{area:data.area}:{})}));
  if (operation === 'signup' || operation === 'recover') {
    await raw(operation,data);
    element.reset();
    show('Check your email and open the link in this browser.');
    return;
  }
  if (operation === 'login') {
    await raw('login',data);
    await sync();
    return go('feed');
  }
  if (operation === 'delete_account') {
    await raw('delete_account',data);
    context = null;
    storeInvite('');
    storeCheckin('');
    show('Your account and everything you posted have been deleted.');
    return go('');
  }
  if (operation === 'logout') {
    // A shared phone should stop getting the signed-out person's notices.
    if (config.push) await push.disable((d)=>rpc('remove_push',d)).catch(()=>{});
    await raw('logout',{});
    context = null;
    return go('');
  }
  if (data.photo instanceof File) {
    const file = data.photo;
    delete data.photo;
    if (file.size) data.image = (await rpc('upload_image',await shrink(file))).id;
  }
  if (data.when) {
    const starts = new Date(data.when);
    if (Number.isNaN(starts.getTime())) throw new ApiError(400,'Choose when the event starts.');
    data.when = starts.toISOString();
  }
  if (operation === 'join' && storedCheckin() && !data.invite) data.checkin = storedCheckin();
  const result = await rpc(operation,data);
  if (result?.ok === false) throw new ApiError(400,result.message ?? 'Try again.');
  if (!element.isConnected) return;
  if (messages[operation]) show(messages[operation]);
  switch (operation) {
    case 'react': {
      const control = element.querySelector('button');
      const on = control.getAttribute('aria-pressed') !== 'true';
      const count = Math.max(0,(parseInt(control.textContent,10) || 0) + (on ? 1 : -1));
      control.setAttribute('aria-pressed',String(on));
      control.querySelector('span').textContent = count+' '+(count===1?'thank':'thanks');
      return;
    }
    case 'delete_post':
      show('Post deleted.');
      return go('feed');
    case 'create_invite':
      createdInvite = result;
      return render();
    case 'admit':
      show('Admitted. They can now choose a neighborhood.');
      return render();
    case 'set_role':
      show('Role saved.');
      return render();
    case 'revoke_invite':
      show('Invite revoked.');
      return render();
    case 'set_email_notices':
    case 'update_profile':
    case 'request_residency':
    case 'cancel_residency':
    case 'confirm_residency':
      await sync();
      return render();
    case 'reset-password':
      show('Password saved.');
      return go('feed');
    case 'join':
      storeInvite('');
      await sync();
      return go(storedCheckin() ? 'checkin' : 'feed');
    case 'vouch':
      show(result.verified ? 'Thanks. That was the second vouch, so they’re now verified.' : 'Thanks for vouching. One more verified neighbor will verify them.');
      return render();
    case 'checkin':
      storeCheckin('');
      await sync();
      show(result.already ? 'Checked in. Thanks for coming.' : 'You’re checked in and verified. Welcome!');
      return go('account');
    case 'create_flyer':
      show('Flyer ready. Print it, cut along the dotted lines, and post it.');
      return go('flyer/'+result.id);
    case 'revoke_flyer':
      show('Flyer retired. Its QR code no longer lets people in.');
      return render();
    case 'create_checkin':
      return go('host-session/'+result.id);
    case 'create_post':
      show('Post published.');
      return go('post/'+result.id);
    case 'create_business':
    case 'update_business':
      return go('business/'+result.id);
    case 'message':
      show('Message sent.');
      return go('thread/'+result.id);
    case 'checkout': {
      const destination = new URL(result.url);
      if (destination.protocol!=='https:' || destination.hostname!=='checkout.stripe.com') {
        throw new ApiError(502,'Billing returned an invalid redirect.');
      }
      location.assign(destination);
      return;
    }
    default:
      return render();
  }
}

app.addEventListener('click',async (event)=>{
  if (event.target.closest('[data-print]')) { window.print(); return; }
  const card = event.target.closest('[data-card]');
  if (card) {
    card.disabled = true;
    try { await (await import('./card.js')).shareCard(JSON.parse(card.dataset.card),location.origin); }
    catch (error) { if (error?.name !== 'AbortError') show('The share card couldn’t be made. Try again.'); }
    finally { card.disabled = false; }
    return;
  }
  const toggle = event.target.closest('[data-push]');
  if (toggle) {
    toggle.disabled = true;
    try { await setPush(toggle.dataset.push); }
    catch (error) { show(error?.message && error.status ? error.message : 'Notifications couldn’t be turned on. Try again.'); }
    finally { toggle.disabled = false; }
    return;
  }
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); show(copy.dataset.copied ?? 'Invite link copied.'); }
    catch { show('Copy this link: '+copy.dataset.copy); }
    return;
  }
  const jump = event.target.closest('[data-jump]');
  if (jump) {
    event.preventDefault();
    document.getElementById(jump.dataset.jump)?.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  const control = event.target.closest('[data-share]');
  if (!control) return;
  const link = location.origin+'/#'+control.dataset.share;
  try {
    if (navigator.share) await navigator.share({url:link});
    else {
      await navigator.clipboard.writeText(link);
      show('Link copied. Only people who can see this post can open it.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') show('Copy this link: '+link);
  }
});
app.addEventListener('change',(event)=>{
  const node = event.target.closest('form[data-action="decide_vetting"]');
  if (node && event.target.name==='action') setEvidence(node);
});
app.addEventListener('submit',async (event)=>{
  const node = event.target.closest('form[data-action]');
  if (!node) return;
  event.preventDefault();
  const controls = [...node.querySelectorAll('button')];
  const feedback = node.querySelector('.form-error');
  const data = Object.fromEntries(new FormData(node));
  controls.forEach((control)=>{ control.disabled = true; });
  feedback.hidden = true;
  try { await submit(node.dataset.action,data,node); }
  catch (error) {
    if (error.status===401 && !authRoutes.has(route().key)) {
      context = null;
      return go('login');
    }
    feedback.textContent = error.message || 'Try again.';
    feedback.hidden = false;
  } finally { controls.forEach((control)=>{ control.disabled = false; }); }
});
window.addEventListener('hashchange',()=>{
  if (route().key==='content') return;
  window.scrollTo(0,0);
  render();
});
document.querySelector('.skip').addEventListener('click',(event)=>{
  const content = document.querySelector('#content');
  if (!content) return;
  event.preventDefault();
  content.tabIndex = -1;
  content.focus();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message',async (event)=>{
    const target = event.data?.open;
    if (typeof target === 'string' && target.startsWith(location.origin+'/')) location.assign(target);
    // The browser replaced this device's push address: save the new one.
    if (event.data?.resubscribe && config.push && context?.member) await push.enable(config.push,(d)=>rpc('save_push',d)).catch(()=>{});
  });
}
async function start() {
  app.innerHTML = view.landing(config);
  try {
    config = await raw('config');
    if (config.configured) await sync().catch(()=>{ context = null; });
    if ('serviceWorker' in navigator && !config.local) navigator.serviceWorker.register('/sw.js',{ scope:'/' }).catch(()=>{});
  } catch { /* The public introduction is available while account access recovers. */ }
  await render();
}
start();
