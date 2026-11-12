import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/dm-sans/wght.css';
import './style.css';
import * as view from './views.js';
import { action, blank, esc, form, button, typeInfo } from './ui.js';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const authRoutes = new Set(['login','signup','recover','link-expired','reset-password']);
const guarded = new Set(['feed','requests','new','post','directory','business','business-new','business-edit','inbox','thread',
  'compose','account','manage','my-reviews','moderation','market','notifications','search','neighbor']);
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
  if (key === 'reset-password' || key === 'link-expired' || (!signedIn && authRoutes.has(key))) {
    app.innerHTML = view.authView(key,config);
    return;
  }
  if (!signedIn) {
    app.innerHTML = guarded.has(key) ? view.authView('login',config) : view.landing(config);
    return;
  }
  if (!context.member) {
    app.innerHTML = view.joinView(context.areas,context.canJoin);
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
        const [items,alerts] = await Promise.all([rpc('feed',{kind,scope}),kind ? [] : rpc('feed',{kind:'alert',fresh:'1',scope})]);
        content = view.feedView(items,area,page,kind,alerts.slice(0,3),reach,context.nearby,member.name);
        aside = view.feedAside(area,context.member);
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
        content = view.postView(post,member.id,businesses);
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
  for (const node of app.querySelectorAll('form[data-action="decide_vetting"]')) setEvidence(node);
}

const messages = {
  delete_reply:'Reply deleted.',update_profile:'Profile saved.',request_residency:'Postcard requested.',cancel_residency:'Verification withdrawn and address deleted.',
  confirm_residency:'Address verified. Your address record has been deleted.',decide_residency:'Recorded. The address has been erased.',vote:'Vote recorded.',
  decide_content:'Content decision recorded.',report_content:'Report sent to staff.',close_post:'Post updated.', reply:'Reply posted.', apply_vetting:'Application sent to staff.',
  submit_review:'Review sent for human moderation.', report_review:'Report sent to staff.', appeal:'Appeal submitted.',
  decide_review:'Review decision recorded.', decide_appeal:'Appeal decision recorded.', decide_vetting:'Vetting decision recorded.',
  update_business:'Business profile saved.', block:'Messages blocked.', unblock:'Messages unblocked.'
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
  if (operation === 'logout') {
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
      await sync();
      return go('feed');
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
async function start() {
  app.innerHTML = view.landing(config);
  try {
    config = await raw('config');
    if (config.configured) await sync().catch(()=>{ context = null; });
  } catch { /* The public introduction is available while account access recovers. */ }
  await render();
}
start();
