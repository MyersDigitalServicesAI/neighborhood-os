import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/dm-sans/wght.css';
import './style.css';
import * as view from './views.js';
import { action, blank, esc, form, button, typeInfo } from './ui.js';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const authRoutes = new Set(['login','signup','recover','link-expired','reset-password']);
const guarded = new Set(['feed','requests','new','post','directory','business','business-new','business-edit','inbox','thread',
  'compose','account','manage','my-reviews','moderation']);
let config = {configured:false,signups:false,billing:false,local:false};
let context = null;
let version = 0;
let refreshing;
let noticeTimer;
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
  try {
    switch (key) {
      case 'requests':
      case 'feed':
      case '': {
        page = key === 'requests' ? 'requests' : 'feed';
        const kind = page === 'requests' ? 'request' : ['discussion','event'].includes(arg) ? arg : '';
        const items = await rpc('feed',{kind});
        content = view.feedView(items,area,page,kind);
        aside = view.feedAside(area);
        break;
      }
      case 'new':
        page = arg==='request' ? 'requests' : 'feed';
        content = view.composer(typeInfo[arg] ? arg : 'discussion');
        break;
      case 'post': {
        const [post,businesses] = await Promise.all([rpc('post',{id}),rpc('my_businesses')]);
        page = post.kind==='request' ? 'requests' : 'feed';
        content = view.postView(post,member.id,businesses);
        break;
      }
      case 'directory': {
        const q = params.get('q') ?? '';
        const category = params.get('category') ?? '';
        content = view.directoryView(await rpc('directory',{q,category}),q,category);
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
  decide_content:'Content decision recorded.',report_content:'Report sent to staff.',close_post:'Request closed.', reply:'Reply posted.', apply_vetting:'Application sent to staff.',
  submit_review:'Review sent for human moderation.', report_review:'Report sent to staff.', appeal:'Appeal submitted.',
  decide_review:'Review decision recorded.', decide_appeal:'Appeal decision recorded.', decide_vetting:'Vetting decision recorded.',
  update_business:'Business profile saved.', block:'Messages blocked.', unblock:'Messages unblocked.'
};
const pages = {
  'feed-more': {op:'feed',target:'feed-results',render:view.postCard,size:25},
  'directory-more': {op:'directory',target:'directory-results',render:view.businessCard,size:25},
  'reviews-more': {op:'business',target:'review-results',items:'reviews',render:view.reviewCard,size:25},
  'threads-more': {op:'threads',target:'thread-results',render:view.threadRow,size:30},
  'messages-more': {op:'thread',target:'message-results',items:'messages',render:(item)=>view.bubble(item,context.member.id),size:40}
};
async function loadMore(op,data,element) {
  const page = pages[op];
  const {key,arg,params} = route();
  const filters = op==='feed-more' ? {kind:key==='requests'?'request':arg} :
    op==='directory-more' ? {q:params.get('q'),category:params.get('category')} : {};
  const result = await rpc(page.op,{...data,...filters});
  const items = page.items ? result[page.items] : result;
  if (!element.isConnected) return;
  const olderMessages = op==='messages-more';
  document.querySelector('#'+page.target)?.insertAdjacentHTML(olderMessages?'afterbegin':'beforeend',items.map(page.render).join(''));
  if (items.length < page.size) return element.remove();
  const next = olderMessages ? items[0] : items.at(-1);
  const extra = data.id ? '<input type="hidden" name="id" value="'+esc(data.id)+'">' :
    next.name ? '<input type="hidden" name="afterName" value="'+esc(next.name)+'">' : '';
  element.outerHTML = view.pager(op,next,extra);
}
async function submit(operation,data,element) {
  if (operation === 'retry') return render();
  if (pages[operation]) return loadMore(operation,data,element);
  if (operation === 'search_directory') {
    return go('directory?'+new URLSearchParams({q:data.q.trim(),category:data.category}));
  }
  if (operation === 'signup' || operation === 'recover') {
    await raw(operation,data);
    element.reset();
    show('Check your email and open the link in this browser.');
    return;
  }
  if (operation === 'login') {
    await raw('login',data);
    context = await rpc('bootstrap');
    return go('feed');
  }
  if (operation === 'logout') {
    await raw('logout',{});
    context = null;
    return go('');
  }
  const result = await rpc(operation,data);
  if (!element.isConnected) return;
  if (messages[operation]) show(messages[operation]);
  switch (operation) {
    case 'reset-password':
      show('Password saved.');
      return go('feed');
    case 'join':
      context = await rpc('bootstrap');
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
    case 'checkout':
    case 'billing_portal': {
      const destination = new URL(result.url);
      if (destination.protocol!=='https:' || !['checkout.stripe.com','billing.stripe.com'].includes(destination.hostname)) {
        throw new ApiError(502,'Billing returned an invalid redirect.');
      }
      location.assign(destination);
      return;
    }
    default:
      return render();
  }
}

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
    if (config.configured) context = await rpc('bootstrap').catch(()=>null);
  } catch { /* The public introduction is available while account access recovers. */ }
  await render();
}
start();
