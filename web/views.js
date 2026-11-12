import { action, ago, avatar, back, blank, brand, button, categories, check, chip, date, esc, field, form, heading, hidden, icon,
  illustration, money, person, photo, quick, ref, select, stars, tick, typeInfo, upload, url, verified, when, areas } from './ui.js';

export function landing(config) {
  return '<header class="landing-header wrap"><a href="#" aria-label="NeighborhoodOS home">'+brand+'</a><nav aria-label="Main navigation"><a class="desktop-link" href="#standards">Community standards</a>'+
    action('Sign in','login','outline')+'</nav></header><main id="content" class="wrap landing">'+
    '<section class="hero"><div class="hero-copy">'+chip('Northeast Ohio pilot','pin','location')+
    '<h1>Good things happen <em>close to home.</em></h1>'+
    '<p>Meet the people around you, find a local recommendation, and keep up with what’s happening in your neighborhood.</p>'+
    '<div class="hero-actions">'+action(config.signups ? 'Join your neighborhood' : 'Pilot sign in',config.signups ? 'signup' : 'login','primary','arrow')+
    action('How it works','standards','ghost')+'</div><small>Free for neighbors and local businesses.</small></div>'+
    '<div class="hero-art">'+illustration+'<div class="art-tag">'+icon('pin',16)+' <span>Rooted in Northeast Ohio</span></div></div></section>'+
    '<div class="area-strip"><span>STARTING IN</span>'+areas.map((a) => '<span>'+icon('pin',16)+esc(a)+'</span>').join('')+'</div>'+
    '<section class="intro"><p class="eyebrow">MADE FOR NEARBY</p><h2>A better way to be neighbors.</h2><div class="features">'+
    feature('chat','The neighborhood feed','Ask a question, share local news, run a poll, or plan an event together.')+
    feature('tag','Marketplace and lost & found','Sell or give away what you no longer need, and help a lost pet get home.')+
    feature('alert','Safety alerts','Urgent local news reaches everyone in the neighborhood right away.')+
    feature('brief','Local businesses','Free profiles, service requests, and reviews that a person checks before they are published.')+
    feature('shield','Vetted businesses','A one-time vetting confirms a business is who it says it is. The badge is earned, never rented.')+
    feature('lock','Verified without a file on you','Confirm your address by postcard. We delete it as soon as the card is mailed.')+
    '</div></section></main><footer class="landing-footer wrap">'+brand+'<div><a href="#standards">Community standards</a><a href="#privacy">Privacy</a></div></footer>';
}
function feature(image,title,description) {
  return '<article><span class="feature-icon">'+icon(image,22)+'</span><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p></article>';
}

export function authView(mode,config) {
  const signup = mode === 'signup';
  const recovery = mode === 'recover';
  const reset = mode === 'reset-password';
  const title = signup ? 'Join your neighborhood' : recovery ? 'Reset your password' : reset ? 'Choose a new password' : 'Welcome back, neighbor.';
  const body = reset ? 'Save a new password for this account.' : recovery ? 'We’ll email a reset link. Open it in the browser you use here.' :
    signup ? 'Confirm your email, then choose your Northeast Ohio neighborhood.' : 'Sign in to get back to your neighborhood.';
  const credential = (signup || reset) ? {min:12,autocomplete:'new-password',hint:'At least 12 characters.'} : {autocomplete:'current-password'};
  const fields = (reset ? '' : field('Email address','email',{type:'email',max:254,autocomplete:'email'}))+
    (recovery ? '' : field('Password','password',{type:'password',max:72,...credential}));
  return '<main id="content" class="auth-wrap"><a href="#" aria-label="NeighborhoodOS home">'+brand+'</a><section class="auth-card">'+
    heading('NORTHEAST OHIO',title,body)+
    (config.local ? '<p class="notice-box">Local fixtures only. Sign in with ava@neighborhood.test and local-fixture-pass.</p>' : '')+
    (mode === 'link-expired' ? '<p class="notice-box">This link is expired or was opened in a different browser. Request a new link.</p>' : '')+
    (!config.configured ? '<p class="notice-box">Account access is being configured.</p>' : '')+
    (signup && !config.signups ? '<p class="notice-box">Public registration is closed during the pilot.</p>' :
      form(reset ? 'reset-password' : recovery ? 'recover' : signup ? 'signup' : 'login',fields+
        (signup ? '<p class="small">By joining you agree to the <a href="#standards">community standards</a>. See how we handle your data in the <a href="#privacy">privacy notice</a>.</p>' : '')+
        button(reset ? 'Save new password' : recovery ? 'Send reset link' : signup ? 'Create account' : 'Sign in','primary','arrow')))+
    '<div class="auth-links">'+(mode === 'login' || mode === 'link-expired' ? '<a href="#recover">Forgot your password?</a>' : '<a href="#login">Back to sign in</a>')+
    (config.signups && !signup ? '<a href="#signup">Create an account</a>' : '')+'</div></section></main>';
}

export function information(route,signedIn) {
  const isPrivacy = route === 'privacy';
  const copy = isPrivacy ? [
    ['What your neighbors see','Your display name, the short introduction you write, and the neighborhood you choose appear with your activity. Your account email is private.'],
    ['How far a post travels','When you post you choose who can see it: your neighborhood only, your neighborhood and nearby ones, or all of Northeast Ohio. People who can see a post can reply to it, see your profile, and message you.'],
    ['Address verification','Verification is optional. If you ask for it, we keep your mailing address only until a postcard with a one-time code is sent. Marking the postcard as mailed erases the address and the code, and entering the code deletes the rest of the record. Afterwards we keep only the fact and date that you verified. Staff who post the card see the address while it is waiting. Requests that are never completed are deleted after 45 days, and you can withdraw one at any time.'],
    ['Photos','Photos are resized on your device and are visible to members of your neighborhood. Avoid photos that show house numbers, licence plates, or people who have not agreed.'],
    ['Messages and moderation','Direct messages are visible in the app only to conversation participants. They are stored to deliver the service and are not end-to-end encrypted. Review text, risk signals, reports and appeals are available to assigned staff through the moderation console.'],
    ['Vetting and payments','Vetting references and moderator notes are restricted to authorized staff. Submit public business references, never identity documents or payment details. Stripe handles card details when payments are enabled.'],
    ['Your choices','You can block private messages from an account. For an account-data or deletion request, contact the pilot organizer who gave you access.']
  ] : [
    ['Be a good neighbor','Keep it local and civil. Harassment, threats, impersonation, scams, discrimination, and sharing someone else’s private information are prohibited.'],
    ['Recommendations are free','Neighbors can suggest a service provider or answer a request using their personal account. Businesses can reply and list a profile for free. Disclose employment, ownership, or any other relevant affiliation when you reply.'],
    ['Reviews need firsthand experience','Describe the work you actually experienced. Disclose relevant relationships. Fake reviews, incentives tied to sentiment, promotional copy, and private information are prohibited. Staff make publication and removal decisions. Authors can appeal removals for an independent decision.'],
    ['What the badge means','A Vetted Business badge means staff documented business identity, control of a public business contact, and applicable license or insurance checks, and the business paid the one-time $250 vetting fee. Vetting is rechecked every year at no further charge and ends if the business changes its contact details or category. The badge carries no workmanship guarantee.'],
    ['Selling and safety alerts','List only items you own and may legally sell. Meet in a public place. Safety alerts are for urgent, firsthand local information. Describe what happened, never who you think someone is.']
  ];
  return '<main id="content" class="auth-wrap policy"><a href="'+(signedIn?'#feed':'#')+'" aria-label="NeighborhoodOS home">'+brand+'</a><section class="auth-card">'+
    heading('NEIGHBORHOODOS',isPrivacy?'Privacy notice':'Community standards',isPrivacy?'How information is used during the pilot.':'The ground rules for a useful local community.')+
    copy.map(([title,body])=>'<section><h2>'+esc(title)+'</h2><p>'+esc(body)+'</p></section>').join('')+
    action('Back',signedIn?'feed':'','outline','back')+'</section></main>';
}

export function joinView(available,canJoin) {
  return '<main id="content" class="auth-wrap"><a href="#">'+brand+'</a><section class="auth-card">'+
    heading('SET UP YOUR PROFILE','Where do you call home?','Choose the pilot neighborhood where you live or operate a local business.')+
    (!canJoin ? '<p class="notice-box">This account has not been admitted to the pilot. Contact the pilot organizer for access.</p>' : form('join',field('Display name','name',{min:2,max:50,hint:'A first name and last initial is enough.'})+
    select('Your neighborhood','area',available.map((a)=>[a.id,a.name+' · '+a.region]),'','Select a neighborhood')+
    check('I live or operate a local business in the selected neighborhood.', 'attest',true)+button('Open my neighborhood','primary','arrow')))+
    form('logout',button('Sign out','ghost'))+'</section></main>';
}

const navigation = [
  ['feed','Neighborhood','home'],['market','Marketplace','tag'],['requests','Service requests','brief'],['directory','Businesses','shop'],
  ['inbox','Messages','inbox'],['notifications','Notifications','bell'],['account','Account','user']
];
const mobileNavigation = [['feed','Feed','home'],['market','Market','tag'],['directory','Businesses','shop'],['inbox','Messages','inbox'],['notifications','Alerts','bell']];
export function shell(context,selected,body,aside = '') {
  const area = context.areas.find((a)=>a.id===context.member.area_id)?.name ?? 'Your neighborhood';
  const unread = Number(context.unread) || 0;
  function nav(items,cls) {
    return '<nav class="'+cls+'" aria-label="Workspace">'+items.map(([route,label,image])=>'<a href="#'+route+'"'+(selected===route?' class="active" aria-current="page"':'')+'>'+
      icon(image,20)+'<span>'+esc(label)+'</span>'+(route==='notifications'&&unread?'<b class="count">'+(unread>99?'99+':unread)+'</b>':'')+'</a>').join('')+'</nav>';
  }
  return '<header class="app-header"><div class="app-header-inner"><a href="#feed" aria-label="NeighborhoodOS home">'+brand+'</a><span class="head-area">'+icon('pin',16)+esc(area)+'</span>'+
    '<span class="head-tools"><a class="icon-link" href="#search" aria-label="Search">'+icon('search',20)+'</a>'+
    '<a class="profile-link" href="#account" aria-label="Account">'+avatar(context.member.name)+'</a></span></div></header>'+
    '<div class="workspace '+(aside?'has-aside':'')+'"><aside class="sidebar"><p class="eyebrow">YOUR NEIGHBORHOOD</p>'+nav(context.staff?[...navigation,['moderation','Moderation','shield']]:navigation,'side-nav')+
    '<div class="side-help"><a href="#standards">Community standards</a><a href="#privacy">Privacy</a></div></aside>'+
    '<main id="content" tabindex="-1" class="app-main">'+body+'</main>'+
    (aside?'<aside class="rightbar">'+aside+'</aside>':'')+'</div>'+nav(mobileNavigation,'bottom-nav');
}
export function feedAside(area,member) {
  return '<section class="side-card neighborhood-card"><span class="feature-icon">'+icon('pin',22)+'</span><p class="eyebrow">YOUR LOCAL CIRCLE</p><h2>'+esc(area)+'</h2><p>Conversations, listings and alerts from people in your neighborhood.</p></section>'+
    (member.verified_at ? '' : '<section class="side-card"><span class="feature-icon pale">'+icon('lock',21)+'</span><h2>Get the verified tick.</h2><p>Confirm your address by postcard. It is deleted as soon as the card is mailed.</p><a class="text-link" href="#account">Verify my address '+icon('arrow',15)+'</a></section>')+
    '<section class="side-card"><span class="feature-icon pale">'+icon('shield',21)+'</span><h2>Trust starts here.</h2><p>Share firsthand experiences and disclose business affiliations. You can recommend or reply for free.</p><a class="text-link" href="#standards">Community standards '+icon('arrow',15)+'</a></section>';
}
const feedTabs = [['feed','','All'],['feed/discussion','discussion','Discussions'],['feed/event','event','Events'],['requests','request','Requests'],
  ['feed/alert','alert','Safety'],['feed/lost','lost','Lost & found'],['feed/poll','poll','Polls'],['feed/offer','offer','Local business']];
const createFor = { event:'event', alert:'alert', lost:'lost', poll:'poll', request:'request' };
const scopeQuery = (scope) => scope ? '?in='+scope : '';
export function scopeBar(route,scope,area,nearby = []) {
  const options = [['',area],['nearby','Nearby'],['neo','Northeast Ohio']];
  const note = scope==='nearby' ? (nearby.length ? area+' plus '+nearby.join(', ')+'.' : 'No nearby neighborhoods are linked yet.') :
    scope==='neo' ? 'Posts shared with all of Northeast Ohio, plus everything from '+area+' and nearby.' : '';
  return '<div class="scope"><nav class="scope-bar" aria-label="Choose how far to look">'+options.map(([key,label])=>
    '<a href="#'+esc(route+scopeQuery(key))+'" '+(scope===key?'aria-current="page"':'')+'>'+icon(key==='neo'?'home':'pin',15)+esc(label)+'</a>').join('')+'</nav>'+
    (note?'<p class="small">'+esc(note)+'</p>':'')+'</div>';
}
function composePrompt(name,area) {
  const quick = [['event','Event','calendar'],['sale','Sell or give away','tag'],['poll','Poll','poll'],['alert','Safety alert','alert']];
  return '<section class="card compose-prompt"><div class="compose-row">'+avatar(name)+'<a class="compose-input" href="#new/discussion">What’s happening in '+esc(area)+'?</a></div>'+
    '<nav class="compose-quick" aria-label="Start a post">'+quick.map(([kind,label,image])=>'<a href="#new/'+kind+'">'+icon(image,17)+esc(label)+'</a>').join('')+'</nav></section>';
}
export function feedView(posts, area, selected, filter, alerts = [], scope = '', nearby = [], name = '') {
  const requests = selected === 'requests';
  const current = feedTabs.find(([,kind])=>kind===filter)?.[0] ?? 'feed';
  const tabs = '<nav class="tabs" aria-label="Filter feed">'+feedTabs.map(([route,kind,label])=>'<a href="#'+route+scopeQuery(scope)+'" '+(filter===kind?'aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav>';
  const create = 'new/'+(createFor[filter] ?? 'discussion');
  return (requests ?
    heading('ASK A NEIGHBOR','Service requests','Ask for help or recommend someone you’ve worked with.',action('Request a service','new/request','primary','plus'))+scopeBar(current,scope,area,nearby)+'<div class="feed-controls">'+tabs+'</div>' :
    '<header class="feed-top"><h1>Your neighborhood</h1><p class="eyebrow">'+icon('pin',14)+esc(area)+' · NORTHEAST OHIO</p></header>'+composePrompt(name,area)+
    alerts.map((a)=>'<a class="alert-strip" href="#post/'+ref(a.id)+'">'+icon('alert',20)+'<span><strong>'+esc(a.title)+'</strong><small>Safety alert · '+esc(ago(a.created_at))+(a.place?' · '+esc(a.place):'')+'</small></span>'+icon('arrow',17)+'</a>').join('')+
    scopeBar(current,scope,area,nearby)+'<div class="feed-controls">'+tabs+'</div>')+
    (posts.length ? '<div class="cards" id="feed-results">'+posts.map(postCard).join('')+'</div>' : blank(requests?'brief':'chat',requests?'No requests yet':filter?'Nothing here yet':'Say hello to your neighbors',requests?'Post the first service request for your neighborhood.':'Start a discussion, share an event, or ask for a recommendation.',
      action(requests?'Create a request':'Create a post',create,'outline','plus')))+
    (posts.length === 25 ? pager('feed-more',posts.at(-1),hidden('kind',filter)+hidden('scope',scope==='neo'?'region':scope)):'');
}
export function pager(name,item,fields = '') {
  return form(name,hidden('before',item.created_at ?? item.updated_at ?? '')+hidden('cursor',item.id)+fields+button('Load more','outline'));
}
const closedLabel = { sale:'Sold', request:'Closed', lost:'Resolved', alert:'Resolved', poll:'Poll closed' };
const closeAction = { sale:'Mark as sold', request:'Close request', lost:'Mark as resolved', alert:'Mark as resolved', poll:'Close poll' };
const where = (post) => post.area ? ' · '+esc(post.area) : '';
function byline(post) {
  return post.business ?
    avatar(post.business)+'<div><strong><a href="#business/'+ref(post.business_id)+'">'+esc(post.business)+'</a></strong><span>'+esc(ago(post.created_at))+where(post)+' · posted by '+esc(post.author)+'</span></div>' :
    avatar(post.author)+'<div>'+person(post.author,post.author_id,post.author_verified)+'<span>'+esc(ago(post.created_at))+where(post)+'</span></div>';
}
function facts(post) {
  return (post.kind==='sale' ? '<p class="price-line">'+esc(money(post.price_cents))+'</p>' : '')+
    (post.kind==='event' ? '<p class="fact">'+icon('calendar',16)+esc(when(post.event_at))+'</p>' : '')+
    (post.place ? '<p class="fact">'+icon('pin',16)+esc(post.place)+'</p>' : '');
}
function likeButton(post) {
  return quick('react',hidden('id',post.id),post.likes+' '+(post.likes===1?'thank':'thanks'),'heart',post.liked);
}
export function postCard(post) {
  const [label,image] = typeInfo[post.kind] ?? typeInfo.discussion;
  const link = 'post/'+ref(post.id);
  return '<article class="card feed-card kind-'+esc(post.kind)+'"><div class="post-meta">'+byline(post)+'<span class="spacer"></span>'+
    (post.business_verified?verified():'')+(post.closed?chip(closedLabel[post.kind] ?? 'Closed','','muted'):'')+chip(label,image,post.kind)+'</div>'+
    '<h2><a href="#'+link+'">'+esc(post.title)+'</a></h2>'+facts(post)+'<p class="post-text clamp">'+esc(post.body)+'</p>'+
    (post.image_id?'<a class="bleed" href="#'+link+'">'+photo(post.image_id,'Photo for '+post.title)+'</a>':'')+
    '<div class="post-actions">'+likeButton(post)+'<a class="act" href="#'+link+'">'+icon('chat',17)+'<span>'+esc(post.replies)+' '+(post.replies===1?'reply':'replies')+'</span></a>'+
    (post.kind==='event'?'<a class="act" href="#'+link+'">'+icon('user',17)+'<span>'+esc(post.going)+' going</span></a>':'')+
    '<button class="act" type="button" data-share="'+esc(link)+'">'+icon('external',17)+'<span>Share</span></button></div></article>';
}
export function marketView(items,filter,scope = '',area = '',nearby = []) {
  return heading('BUY, SELL, GIVE AWAY','Marketplace','For sale and free items from neighbors, near and a little further out.',action('List an item','new/sale','primary','plus'))+
    scopeBar('market',scope,area,nearby)+
    (items.length ? '<div class="market-grid" id="market-results">'+items.map(marketCard).join('')+'</div>' :
      blank('tag','Nothing listed yet','List something you no longer need. Free items are welcome.',action('List an item','new/sale','outline','plus')))+
    (items.length === 25 ? pager('market-more',items.at(-1),hidden('kind',filter)+hidden('scope',scope==='neo'?'region':scope)):'');
}
export function marketCard(item) {
  return '<a class="card market-card" href="#post/'+ref(item.id)+'">'+(item.image_id?photo(item.image_id,'','market-photo'):'<span class="market-photo placeholder">'+icon('tag',30)+'</span>')+
    '<span class="market-body"><strong class="price-line">'+esc(money(item.price_cents))+'</strong><span class="market-title">'+esc(item.title)+'</span>'+
    '<small>'+esc(item.author)+' · '+esc(ago(item.created_at))+where(item)+'</small>'+(item.closed?chip('Sold','','muted'):'')+'</span></a>';
}
const reachLabel = { area:'your neighborhood only', nearby:'your neighborhood and nearby', region:'all of Northeast Ohio' };
export function composer(type,businesses = [],area = 'My neighborhood') {
  const kinds = ['discussion','event','sale','request','lost','poll','alert',...(businesses.length?['offer']:[])];
  const kind = kinds.includes(type) ? type : 'discussion';
  const titles = { discussion:'Create a post', request:'Request a local service', event:'Share a local event', sale:'List an item', lost:'Report lost or found',
    poll:'Ask a poll', alert:'Send a safety alert', offer:'Share a business update' };
  const hints = { alert:'Alerts notify everyone in your neighborhood. Use them for urgent, firsthand information. Call 911 in an emergency.',
    sale:'Meet in a public place and keep your address out of the listing.', offer:'Each business can share two updates a week.' };
  const extra = kind==='sale' ? field('Price in dollars','price',{max:9,placeholder:'0 for free',extra:'inputmode="decimal" pattern="[0-9]{1,6}([.][0-9]{1,2})?"',hint:'Enter 0 to give it away.'})+
      field('Pickup area (optional)','place',{required:false,min:2,max:120,placeholder:'For example, near the library'}) :
    kind==='event' ? field('Starts','when',{type:'datetime-local',max:30})+field('Where','place',{min:2,max:120,placeholder:'A public place or venue'}) :
    kind==='lost' || kind==='alert' ? field('General location (optional)','place',{required:false,min:2,max:120,placeholder:'A cross street or landmark, never a home address'}) :
    kind==='poll' ? [1,2,3,4].map((n)=>field('Choice '+n+(n>2?' (optional)':''),'option'+n,{required:n<3,min:1,max:80})).join('') :
    kind==='offer' ? select('Post as','business',businesses.map((b)=>[b.id,b.name]),businesses[0]?.id) : '';
  return back('Back to feed',kind==='sale'?'market':'feed')+heading('SHARE WITH NEIGHBORS',titles[kind],'You choose how far your post travels.')+
    '<nav class="tabs kind-tabs" aria-label="Post type">'+kinds.map((k)=>'<a href="#new/'+k+'" '+(k===kind?'aria-current="page"':'')+'>'+icon(typeInfo[k][1],16)+esc(typeInfo[k][0])+'</a>').join('')+'</nav>'+
    (hints[kind]?'<p class="notice-box">'+esc(hints[kind])+'</p>':'')+
    '<section class="card panel">'+form('create_post',hidden('kind',kind)+
    field('Title','title',{min:3,max:120,placeholder:kind==='sale'?'What are you listing?':'What would you like neighbors to know?'})+extra+
    field('Details','body',{type:'textarea',min:3,max:2400,hint:'Keep exact addresses, phone numbers, and personal information out of your post.'})+
    (kind==='poll'?'':upload())+
    select('Who can see this','reach',[['area',area+' only'],['nearby',area+' and nearby neighborhoods'],['region','All of Northeast Ohio']],'nearby')+
    button('Publish post','primary','arrow'))+'</section>';
}
function reportContent(id,kind) {
  return '<details><summary>'+icon('flag',14)+' Report '+kind+'</summary>'+form('report_content',hidden('id',id)+hidden('kind',kind)+
    field('Why should staff review this?','reason',{type:'textarea',min:12,max:700})+button('Send report','outline'))+'</details>';
}
function replyCard(r,post,me,open) {
  return '<article class="card reply'+(r.parent_id?' nested':'')+'"><div class="post-meta">'+avatar(r.author)+'<div>'+person(r.author,r.author_id,r.author_verified)+'<span>'+esc(ago(r.created_at))+'</span></div>'+
    (r.affiliated?chip('Business affiliation','brief','request'):'')+'</div>'+
    (r.business?'<a class="text-link" href="#business/'+ref(r.business_id)+'">'+esc(r.business)+'</a>':'')+
    '<p class="post-text">'+esc(r.body)+'</p><div class="reply-tools">'+
    (open?'<details><summary>'+icon('chat',14)+' Reply</summary>'+form('reply',hidden('id',post.id)+hidden('parent',r.id)+
      field('Reply to '+r.author,'body',{type:'textarea',min:2,max:1600})+button('Send reply','outline'))+'</details>':'')+
    (r.author_id===me?'<details><summary>'+icon('trash',14)+' Delete</summary>'+form('delete_reply',hidden('id',r.id)+button('Delete my reply','outline'))+'</details>':reportContent(r.id,'reply'))+
    '</div></article>';
}
function pollBlock(post) {
  const total = post.options.reduce((sum,o)=>sum+o.votes,0);
  return '<section class="poll-box" aria-label="Poll">'+post.options.map((o)=>{
    const share = total ? Math.round(o.votes*100/total) : 0;
    const row = '<span class="poll-label">'+(post.vote===o.id?icon('check',15):'')+esc(o.label)+'</span><span class="poll-share">'+share+'%</span>';
    return '<div class="poll-row'+(post.vote===o.id?' chosen':'')+'"><meter min="0" max="100" value="'+share+'" aria-hidden="true"></meter>'+
      (post.closed?'<span class="poll-choice">'+row+'</span>':'<form class="quick" data-action="vote">'+hidden('id',post.id)+hidden('option',o.id)+
        '<button class="poll-choice" type="submit" aria-pressed="'+(post.vote===o.id)+'">'+row+'</button><p class="form-error" role="alert" hidden></p></form>')+'</div>';
  }).join('')+'<p class="quiet">'+total+' '+(total===1?'vote':'votes')+(post.closed?' · Poll closed':post.vote?' · You can change your vote':'')+'</p></section>';
}
export function postView(post,me,businesses) {
  const [label,image] = typeInfo[post.kind] ?? typeInfo.discussion;
  const mine = post.author_id===me;
  const open = !(post.closed && ['request','poll'].includes(post.kind));
  const home = post.kind==='request'?'requests':post.kind==='sale'?'market':'feed';
  const top = post.replies.filter((r)=>!r.parent_id);
  return back('Back to '+(home==='market'?'marketplace':home),home)+
    '<article class="card panel detail kind-'+esc(post.kind)+'"><div class="post-meta">'+byline(post)+'<span class="spacer"></span>'+(post.business_verified?verified():'')+chip(label,image,post.kind)+'</div>'+
    '<h1>'+esc(post.title)+'</h1>'+facts(post)+'<p class="post-text">'+esc(post.body)+'</p>'+photo(post.image_id,'Photo for '+post.title,'photo large')+
    '<p class="fact reach">'+icon('pin',16)+esc('Posted in '+post.area+' · shared with '+(post.local?reachLabel[post.reach]:post.reach==='region'?'all of Northeast Ohio':'nearby neighborhoods'))+'</p>'+
    (post.kind==='poll'?pollBlock(post):'')+
    '<div class="inline-actions">'+likeButton(post)+
    (post.kind==='event'?quick('rsvp',hidden('id',post.id),(post.attending?'You’re going':'I’m going')+' · '+post.going,'calendar',post.attending):'')+
    (!mine ? action(post.business?'Message business':'Message '+post.author,'compose/'+ref(post.author_id),'outline','inbox') :
      closeAction[post.kind]&&!post.closed ? form('close_post',hidden('id',post.id)+button(closeAction[post.kind],'outline')) : '')+
    (post.closed?chip(closedLabel[post.kind] ?? 'Closed','','muted'):'')+'</div>'+
    (mine?'<details><summary>'+icon('trash',14)+' Delete post</summary>'+form('delete_post',hidden('id',post.id)+button('Delete this post','outline'))+'</details>':reportContent(post.id,'post'))+'</article>'+
    '<section class="detail-section"><h2>Replies</h2><div class="cards">'+(top.length ? top.map((r)=>replyCard(r,post,me,open)+
      post.replies.filter((c)=>c.parent_id===r.id).map((c)=>replyCard(c,post,me,open)).join('')).join('') : '<p class="quiet">No replies yet.</p>')+'</div></section>'+
    (!open?'':'<section class="card panel"><h2>Write a reply</h2><p class="quiet">Neighbor recommendations and business replies are free.</p>'+form('reply',hidden('id',post.id)+
      field('Your reply','body',{type:'textarea',min:2,max:1600})+
      (businesses.length?select('Reply as','business',[['','Personal account'],...businesses.map((b)=>[b.id,b.name])]):'')+
      check('I have a business affiliation relevant to this reply.','affiliated')+button('Post reply','primary','arrow'))+'</section>');
}
const noticeText = {
  reply:(n)=>[(n.actor ?? 'A neighbor')+' replied','post/'+ref(n.post_id),'chat'],
  like:(n)=>[(n.actor ?? 'A neighbor')+' thanked you','post/'+ref(n.post_id),'heart'],
  rsvp:(n)=>[(n.actor ?? 'A neighbor')+' is going to your event','post/'+ref(n.post_id),'calendar'],
  alert:(n)=>['Safety alert in your neighborhood','post/'+ref(n.post_id),'alert'],
  message:(n)=>[(n.actor ?? 'A neighbor')+' sent you a message','thread/'+ref(n.thread_id),'inbox'],
  review:()=>['A moderator made a decision about your review','my-reviews','star'],
  vetting:()=>['Your vetting application has a decision','manage','shield'],
  payment:()=>['Vetting fee received. Your badge is live.','manage','shield'],
  residency:()=>['Your address verification was updated','account','lock']
};
export function notificationsView(list) {
  return heading('WHAT’S NEW','Notifications','Replies, messages, safety alerts and decisions that involve you.')+
    (list.length ? '<div class="cards">'+list.map((n)=>{
      const [text,route,image] = (noticeText[n.kind] ?? noticeText.reply)(n);
      const about = n.title ?? n.business ?? '';
      return '<a class="card thread-row notice-row'+(n.read?'':' unread')+'" href="#'+route+'"><span class="feature-icon'+(n.kind==='alert'?' pale':'')+'">'+icon(image,20)+'</span>'+
        '<span><strong>'+esc(text)+'</strong>'+(about?'<span class="quiet">'+esc(about)+'</span>':'')+'<small>'+esc(ago(n.created_at))+'</small></span>'+icon('arrow',18)+'</a>';
    }).join('')+'</div>' : blank('bell','You’re all caught up','Replies, messages and safety alerts will appear here.'));
}
export function searchView(query,results) {
  const none = results && !results.posts.length && !results.businesses.length && !results.neighbors.length;
  return heading('FIND IT NEARBY','Search','Look through posts, listings, businesses and neighbors in your neighborhood.')+
    '<section class="card panel search-panel simple">'+form('search',field('Search your neighborhood','q',{min:2,max:80,value:query,placeholder:'Try “fence”, “bike” or a neighbor’s name'})+button('Search','outline','search'))+'</section>'+
    (!results ? '' : none ? blank('search','No matches','Try a different word or a shorter search.') :
      (results.businesses.length?'<section class="detail-section"><h2>Businesses</h2><div class="business-grid">'+results.businesses.map(businessCard).join('')+'</div></section>':'')+
      (results.neighbors.length?'<section class="detail-section"><h2>Neighbors</h2><div class="cards">'+results.neighbors.map((n)=>
        '<a class="card thread-row" href="#neighbor/'+ref(n.id)+'">'+avatar(n.name)+'<span><strong>'+esc(n.name)+tick(n.verified)+'</strong></span>'+icon('arrow',18)+'</a>').join('')+'</div></section>':'')+
      (results.posts.length?'<section class="detail-section"><h2>Posts and listings</h2><div class="cards">'+results.posts.map(postCard).join('')+'</div></section>':''));
}
export function profileView(profile,posts,me) {
  const self = profile.id===me;
  return back('Back to feed','feed')+'<section class="card panel profile-head">'+avatar(profile.name)+'<div><h1>'+esc(profile.name)+tick(profile.verified)+'</h1>'+
    '<p class="quiet">'+esc(profile.area)+' · '+(profile.verified?'Verified neighbor · ':'')+'Joined '+esc(date(profile.joined))+'</p>'+(profile.bio?'<p class="post-text">'+esc(profile.bio)+'</p>':'')+'</div>'+
    '<div class="inline-actions">'+(self?action('Edit my profile','account','outline','user'):action('Message '+profile.name,'compose/'+ref(profile.id),'primary','inbox')+
      form(profile.blocked?'unblock':'block',hidden('peer',profile.id)+button(profile.blocked?'Unblock':'Block','ghost')))+'</div></section>'+
    (profile.businesses.length?'<section class="detail-section"><h2>Businesses</h2><div class="cards">'+profile.businesses.map((b)=>
      '<a class="card thread-row" href="#business/'+ref(b.id)+'"><span class="feature-icon">'+icon('shop',20)+'</span><span><strong>'+esc(b.name)+'</strong><small>'+esc(b.category)+'</small></span>'+(b.verified?verified():'')+icon('arrow',18)+'</a>').join('')+'</div></section>':'')+
    '<section class="detail-section"><h2>Recent posts</h2>'+(posts.length?'<div class="cards" id="feed-results">'+posts.map(postCard).join('')+'</div>':'<p class="quiet">No posts yet.</p>')+
    (posts.length===25?pager('feed-more',posts.at(-1),hidden('author',profile.id)):'')+'</section>';
}
export function directoryView(list,query,category,vetted) {
  const link = (on) => 'directory?'+new URLSearchParams({q:query,category,...(on?{vetted:'1'}:{})});
  return heading('SHOP AND HIRE LOCAL','Local businesses','Explore businesses serving your neighborhood.',action('Add a free profile','business-new','primary','plus'))+
    '<section class="card panel search-panel">'+form('search_directory',field('Search businesses','q',{required:false,max:80,value:query,placeholder:'Search by name or trade'})+
    select('Category','category',[['','All categories'],...categories],category)+hidden('vetted',vetted?'1':'')+button('Search','outline','search'))+'</section>'+
    '<nav class="tabs" aria-label="Filter businesses"><a href="#'+esc(link(false))+'" '+(vetted?'':'aria-current="page"')+'>All businesses</a>'+
    '<a href="#'+esc(link(true))+'" '+(vetted?'aria-current="page"':'')+'>'+icon('shield',15)+'Vetted only</a></nav>'+
    (list.length?'<div class="business-grid" id="directory-results">'+list.map(businessCard).join('')+'</div>':
      blank('shop','No businesses found',vetted?'No vetted businesses match yet. Try all businesses.':'Try a different search or create a free local business profile.'))+
    (list.length===25 ? pager('directory-more',list.at(-1),hidden('afterName',list.at(-1).name)+hidden('q',query)+hidden('category',category)+hidden('vetted',vetted?'1':'')) : '');
}
function rating(value,count) {
  return count ? '<p class="rating">'+stars(Math.round(value))+'<span>'+esc(Number(value).toFixed(1))+' · '+esc(count)+' '+(count===1?'review':'reviews')+'</span></p>' : '';
}
export function businessCard(b) {
  return '<article class="card business-card">'+(b.image_id?photo(b.image_id,'','logo'):'<span class="feature-icon">'+icon('shop',23)+'</span>')+
    '<div><p class="eyebrow">'+esc(b.category)+'</p><h2><a href="#business/'+ref(b.id)+'">'+esc(b.name)+'</a></h2></div>'+
    (b.verified?verified():'')+rating(b.rating,b.reviews)+'<p class="clamp">'+esc(b.description)+'</p><a class="text-link" href="#business/'+ref(b.id)+'">View profile '+icon('arrow',16)+'</a></article>';
}
export function businessForm(b) {
  return back('Back to businesses',b?'manage':'directory')+heading('FREE BUSINESS PROFILE',b?'Edit business profile':'Add a local business',
    'Introduce your business and participate in your local community.')+'<section class="card panel">'+
    form(b?'update_business':'create_business',(b?hidden('id',b.id):field('Business name','name',{min:2,max:80}))+
    select('Category','category',categories,b?.category)+field('About the business','description',{type:'textarea',min:10,max:1000,value:b?.description})+
    field('Business website (optional)','website',{type:'url',max:250,value:b?.website,required:false,placeholder:'https://'})+
    field('Public business phone (optional)','phone',{type:'tel',max:20,value:b?.phone,required:false,placeholder:'216-555-0100',extra:'pattern="[0-9+() .\\-]{7,20}"'})+
    field('Opening hours (optional)','hours',{max:200,value:b?.hours,required:false,placeholder:'Mon to Fri, 8 to 5'})+
    upload(b?.image_id?'Replace the logo or photo (optional)':'Logo or photo (optional)')+
    (b&&(b.vetting==='approved'||b.vetting==='pending')?'<p class="notice-box">Changing the category, website or phone ends the current vetting. You can apply again at no charge.</p>':'')+
    button(b?'Save profile':'Create profile','primary','arrow'))+'</section>';
}
export function businessView(b,me) {
  const owner = me===b.owner_id;
  const site = url(b.website);
  return back('Back to businesses','directory')+'<section class="card panel detail">'+(b.image_id?photo(b.image_id,b.name+' logo','logo big'):'<span class="feature-icon">'+icon('shop',23)+'</span>')+
    '<p class="eyebrow">'+esc(b.category)+' · '+esc(b.area)+'</p><h1>'+esc(b.name)+'</h1>'+(b.verified?verified():'')+rating(b.rating,b.review_count)+'<p class="post-text">'+esc(b.description)+'</p>'+
    (b.hours?'<p class="fact">'+icon('clock',16)+esc(b.hours)+'</p>':'')+
    (b.phone?'<p class="fact">'+icon('phone',16)+'<a href="tel:'+esc(b.phone.replace(/[^0-9+]/g,''))+'">'+esc(b.phone)+'</a></p>':'')+
    '<p class="fact">'+icon('user',16)+'<span>Run by <a class="text-link" href="#neighbor/'+ref(b.owner_id)+'">'+esc(b.owner)+'</a></span></p>'+
    '<div class="inline-actions">'+(owner?action('Manage business','manage','outline','brief'):action('Message business','compose/'+ref(b.owner_id),'primary','inbox'))+
    (site?'<a class="button outline" href="'+site+'" target="_blank" rel="noopener noreferrer">'+icon('external',17)+'Website</a>':'')+'</div>'+
    (b.verified?'<p class="small">Vetted means staff confirmed this business’s identity, public contact and applicable credentials. It is not a guarantee of workmanship.</p>':'')+'</section>'+
    (b.updates.length?'<section class="detail-section"><h2>Latest from this business</h2><div class="cards">'+b.updates.map(postCard).join('')+'</div></section>':'')+
    '<section class="detail-section"><h2>Neighbor reviews</h2><p class="quiet">Reviews describe firsthand experiences. A moderator decides what is published.</p>'+
    '<div class="cards" id="review-results">'+(b.reviews.length?b.reviews.map(reviewCard).join(''):'<p class="quiet">No published reviews yet.</p>')+'</div>'+
    (b.reviews.length===25?pager('reviews-more',b.reviews.at(-1),hidden('id',b.id)):'')+'</section>'+
    (!b.local?'<p class="quiet">Reviews are written by members of '+esc(b.area)+'.</p>':!owner&&!b.ownReview?'<section class="card panel"><h2>Share your experience</h2>'+form('submit_review',hidden('id',b.id)+
      select('Rating','rating',[[5,'5 stars'],[4,'4 stars'],[3,'3 stars'],[2,'2 stars'],[1,'1 star']],'','Select a rating')+
      field('Your review','body',{type:'textarea',min:20,max:1600,hint:'Describe your firsthand experience. Leave out names, numbers, and addresses that are private.'})+
      check('I have a relationship with this business that readers should know about.','affiliated')+
      check('I am describing my own firsthand experience.','attest',true)+button('Submit for review','primary','arrow'))+'</section>':
      b.ownReview?action('See my review status','my-reviews','outline'):'');
}
export function reviewCard(r) {
  return '<article class="card reply"><div class="post-meta">'+avatar(r.author)+'<div>'+person(r.author,'',r.author_verified)+'<span>'+esc(date(r.created_at))+'</span></div><span class="spacer"></span>'+stars(r.rating)+'</div>'+
    (r.affiliated?chip('Affiliation disclosed','brief','request'):'')+'<p class="post-text">'+esc(r.body)+'</p>'+
    (r.reportable?'<details><summary>'+icon('flag',14)+' Report this review</summary>'+form('report_review',hidden('id',r.id)+
      field('Why should staff review this?','reason',{type:'textarea',min:12,max:700})+button('Send report','outline'))+'</details>':'')+'</article>';
}
export function inboxView(threads) {
  return heading('PRIVATE CONVERSATIONS','Messages','Start a conversation from a neighborhood post or a business profile.')+
    (threads.length?'<div class="cards" id="thread-results">'+threads.map(threadRow).join('')+'</div>':
      blank('inbox','Your inbox is empty','When you send or receive a message, the conversation will appear here.'))+
    (threads.length===30?pager('threads-more',threads.at(-1)):'');
}
export function threadRow(t) {
  return '<a class="card thread-row" href="#thread/'+ref(t.id)+'">'+avatar(t.peer)+'<span><strong>'+esc(t.peer)+'</strong><small>'+esc(date(t.updated_at))+'</small></span>'+icon('arrow',18)+'</a>';
}
export function composeMessage(peer) {
  return back('Back to messages','inbox')+heading('DIRECT MESSAGE','Write a message','Your message will appear in a private conversation.')+
    '<section class="card panel">'+form('message',hidden('peer',peer)+field('Your message','body',{type:'textarea',min:1,max:1800})+button('Send message','primary','arrow'))+'</section>';
}
export function threadView(thread,me) {
  return back('Back to messages','inbox')+heading('PRIVATE CONVERSATION',thread.peer,'Messages are shared between the two participants.',
    form(thread.blocked?'unblock':'block',hidden('peer',thread.peer_id)+button(thread.blocked?'Unblock messages':'Block messages','outline')))+
    '<section class="card panel conversation">'+(thread.messages.length===40?pager('messages-more',thread.messages[0],hidden('id',thread.id)):'')+
    '<div class="bubbles" id="message-results">'+thread.messages.map((m)=>bubble(m,me)).join('')+'</div>'+
    (thread.blocked?'<p class="notice-box">You blocked messages from this neighbor.</p>':form('message',hidden('id',thread.id)+
      field('Your message','body',{type:'textarea',min:1,max:1800})+button('Send message','primary','arrow')))+'</section>';
}
export function bubble(m,me) {
  return '<div class="bubble '+(m.sender_id===me?'mine':'')+'"><p class="post-text">'+esc(m.body)+'</p><small>'+esc(date(m.created_at))+'</small></div>';
}
function residencyPanel(context) {
  const state = context.residency;
  const inner = context.member.verified_at ?
    '<p>'+chip('Verified neighbor','check','verified')+'</p><p class="quiet">Verified on '+esc(date(context.member.verified_at))+'. Your address was deleted when your postcard was mailed, and we keep only this date.</p>' :
    state==='pending' ?
      '<p class="notice-box">Your postcard is being prepared. Your address is held only until it is mailed, then erased.</p>'+
      form('cancel_residency',button('Withdraw and delete my address','outline')) :
    state==='mailed' ?
      '<p class="notice-box">Your postcard is on its way and your address has been erased from our records. Enter the six-character code when it arrives.</p>'+
      form('confirm_residency',field('Postcard code','code',{min:6,max:6,autocomplete:'one-time-code',extra:'autocapitalize="characters" spellcheck="false"'})+button('Confirm my address','primary','check'))+
      form('cancel_residency',button('Cancel this verification','ghost')) :
      '<p class="quiet">Optional. We post a card with a one-time code to your address. Your address is erased the moment the card is mailed, and the rest of the record is deleted when you enter the code. Neighbors then see a verified tick next to your name, never your address.</p>'+
      '<details><summary>'+icon('lock',14)+' Verify my address</summary>'+form('request_residency',
        field('Mailing address in your neighborhood','address',{min:8,max:200,autocomplete:'street-address',placeholder:'Street, city, ZIP'})+
        check('Use this address once to post my code, then delete it.','consent',true)+button('Send my postcard','primary','arrow'))+'</details>';
  return '<section class="card panel"><h2>Address verification</h2>'+inner+'</section>';
}
export function accountView(context) {
  const { member } = context;
  return heading('YOUR PROFILE','Account','Manage your profile, verification, local activity and business profiles.')+
    '<section class="card panel account-panel">'+avatar(member.name)+'<div><h2>'+esc(member.name)+tick(member.verified_at)+'</h2><p class="quiet">'+esc(context.areas.find((a)=>a.id===member.area_id)?.name)+'</p>'+
    (member.bio?'<p class="post-text">'+esc(member.bio)+'</p>':'')+'</div></section>'+
    '<section class="card panel"><h2>Profile</h2><details><summary>Edit name and introduction</summary>'+form('update_profile',
      field('Display name','name',{min:2,max:50,value:member.name})+
      field('About you (optional)','bio',{type:'textarea',required:false,max:300,value:member.bio,hint:'A line or two neighbors will see on your profile.'})+button('Save profile','outline'))+'</details>'+
    '<div class="inline-actions">'+action('View my public profile','neighbor/'+ref(member.id),'outline','user')+'</div></section>'+
    residencyPanel(context)+
    '<section class="card panel"><h2>Your activity</h2><div class="inline-actions">'+action('My business profiles','manage','outline','shop')+
    action('My reviews and appeals','my-reviews','outline','star')+(context.staff?action('Moderation queue','moderation','outline','shield'):'')+'</div></section>'+
    '<section class="card panel"><h2>Account access</h2>'+form('logout',button('Sign out','outline'))+'</section>';
}
export function manageView(list,billing) {
  return back('Back to account','account')+heading('LOCAL BUSINESS','Manage business profiles','Free profiles let you show up locally, share updates and reply to service requests.',action('Add a profile','business-new','primary','plus'))+
    '<section class="card panel program"><span class="feature-icon">'+icon('shield',23)+'</span><div><p class="eyebrow">OPTIONAL · BUILD TRUST</p><h2>Vetted Business</h2><p>Staff independently confirm your identity, public contact and applicable credentials. You pay once, after approval, and the badge stays while your vetting is current.</p></div><p class="price"><strong>$250</strong><span> one time</span></p></section>'+
    (!billing?'<p class="notice-box">Payments are switched off during this pilot. You can use a free business profile and submit a vetting application.</p>':'')+
    (list.length?list.map((b)=>{
      const current = b.vetting==='approved' && new Date(b.vettingExpires).getTime()>Date.now();
      return '<section class="card panel"><div class="split"><h2>'+esc(b.name)+'</h2>'+(b.verified?verified():b.paid?chip('Vetting fee paid','check','muted'):'')+'</div>'+
        '<p class="quiet">'+esc(b.vetting==='pending'?'Vetting application under review':current?'Vetting approved until '+date(b.vettingExpires):
          b.vetting==='approved'?'Vetting expired':b.vetting==='declined'?'Vetting declined':b.vetting==='revoked'?'Vetting revoked':'Vetting application available')+
          (current&&!b.paid?' · Pay the one-time fee to show your badge':'')+'</p>'+
        (b.vettingReason?'<p class="post-text">'+esc(b.vettingReason)+'</p>':'')+
        '<div class="inline-actions">'+action('View profile','business/'+ref(b.id),'outline')+action('Edit','business-edit/'+ref(b.id),'outline')+action('Share an update','new/offer','outline','megaphone')+
        (current&&billing&&!b.paid?form('checkout',hidden('id',b.id)+button('Pay the $250 vetting fee','primary','shield')):'')+'</div>'+
        (!current && b.vetting!=='pending'?'<details><summary>Apply for vetting</summary>'+form('apply_vetting',hidden('id',b.id)+
          field('Legal business name','legal',{min:2,max:150})+
          field('Public business registration or directory reference','registration',{min:3,max:180,hint:'For example, an Ohio registration number or an official registry link.'})+
          field('Public contact reference','contact',{min:3,max:180,hint:'A business website or public business number. Keep personal documents out of this form.'})+
          '<p class="small">Applying is free. The $250 fee is requested only if staff approve your application'+(b.paid?', and yours is already paid':'')+'.</p>'+
          button('Send for vetting','primary','arrow'))+'</details>':'')+'</section>';
    }).join(''):blank('shop','You have no business profiles','Create a free profile to get started.'));
}
export function myReviewsView(reviews) {
  return back('Back to account','account')+heading('REVIEW ACTIVITY','My reviews and appeals','See the status of your reviews and request an independent decision on a removal.')+
    (reviews.length?reviews.map((r)=>'<section class="card panel"><div class="split"><h2><a href="#business/'+ref(r.business_id)+'">'+esc(r.business)+'</a></h2>'+chip(r.status==='pending'?'Awaiting moderator':r.status,'','muted')+'</div>'+
      stars(r.rating)+'<p class="post-text">'+esc(r.body)+'</p>'+
      (r.reason?'<p class="notice-box">'+esc(r.reason)+'</p>':'')+
      (r.appeal?'<p class="quiet">Appeal '+esc(r.appeal)+(r.appealReason?' · '+esc(r.appealReason):'')+'</p>':'')+
      (r.status==='removed'&&!r.appeal?'<details><summary>Appeal decision</summary>'+form('appeal',hidden('id',r.id)+
        field('Why should an independent moderator reconsider?','body',{type:'textarea',min:20,max:1200})+button('Submit appeal','outline'))+'</details>':'')+'</section>').join(''):
      blank('star','No reviews yet','Reviews you submit for local businesses will appear here.'));
}
const signalLabels = {affiliation:'Declared affiliation',duplicate:'Matching review text',incentive:'Possible incentive',
  promotion:'Promotional terms',personal:'Possible private information',abuse:'Possible abusive language',repetition:'Repeated characters'};
export function moderationView(queue) {
  return heading('STAFF CONSOLE','Moderation','Human decisions govern publication, removals, appeals, and verification.')+
    '<section class="detail-section"><h2>Review queue <small>'+queue.reviews.length+'</small></h2>'+
    (queue.reviews.length?queue.reviews.map((r)=>'<article class="card panel"><div class="split"><h3>'+esc(r.business)+'</h3>'+chip(r.status==='pending'?(Number(r.score)>=.45?'Priority screening':'Standard screening'):'Reported review','flag','request')+'</div>'+
      stars(r.rating)+'<p class="post-text">'+esc(r.body)+'</p><p class="quiet">'+esc(Object.entries(r.signals).filter(([,v])=>v).map(([k])=>signalLabels[k]??k).join(' · ')||'No configured screening signals')+'</p>'+
      r.reports.map((reason)=>'<p class="notice-box">Report: '+esc(reason)+'</p>').join('')+
      '<details><summary>Record review decision</summary>'+form('decide_review',hidden('id',r.id)+
        select('Decision','action',[['published',r.status==='pending'?'Publish':'Keep published'],['removed','Remove']],'','Choose a decision')+
        field('Reason shown to the author','reason',{type:'textarea',min:12,max:700})+button('Save decision','outline'))+'</details></article>').join(''):
      blank('chat','No reviews in the queue','New reviews and reports appear here.'))+'</section>'+
    '<section class="detail-section"><h2>Independent appeals <small>'+queue.appeals.length+'</small></h2>'+
    (queue.appeals.length?queue.appeals.map((r)=>'<article class="card panel"><h3>'+esc(r.business)+'</h3>'+
      '<p class="post-text">'+esc(r.body)+'</p><p class="notice-box">Original reason: '+esc(r.decision_reason)+'</p><p class="post-text">Appeal: '+esc(r.explanation)+'</p>'+
      form('decide_appeal',hidden('id',r.id)+select('Decision','action',[['restored','Restore publication'],['upheld','Uphold removal']],'','Choose a decision')+
        field('Reason shown to the author','reason',{type:'textarea',min:12,max:700})+button('Save appeal decision','outline'))+'</article>').join(''):
      blank('shield','No appeals available','Only a moderator independent of the original decision can resolve an appeal.'))+'</section>'+
    '<section class="detail-section"><h2>Community reports <small>'+queue.content.length+'</small></h2>'+
    (queue.content.length?queue.content.map((r)=>'<article class="card panel"><h3>'+esc(r.title)+'</h3><p class="post-text">'+esc(r.body)+'</p>'+
      '<p class="notice-box">Report: '+esc(r.reason)+'</p><details><summary>Record content decision</summary>'+form('decide_content',hidden('id',r.id)+
      select('Decision','action',[['keep','Keep content'],['remove','Remove content']],'','Choose a decision')+
      field('Decision reason','reason',{type:'textarea',min:12,max:700})+button('Save content decision','outline'))+'</details></article>').join(''):
      blank('flag','No community reports','Reports about posts and replies appear here.'))+'</section>'+
    '<section class="detail-section"><h2>Business vetting <small>'+queue.vetting.length+'</small></h2>'+
    (queue.vetting.length?queue.vetting.map(vettingCard).join(''):blank('shop','No vetting cases','New applications appear here.'))+'</section>'+
    '<section class="detail-section"><h2>Address postcards <small>'+queue.residency.length+'</small></h2>'+
    '<p class="quiet">Write the code on a postcard to the address shown and post it, then record it as mailed. Recording it erases the address and the code from the database, so finish the card first.</p>'+
    (queue.residency.length?queue.residency.map((v)=>'<article class="card panel"><div class="split"><h3>'+esc(v.name)+'</h3>'+chip(v.area,'pin','muted')+'</div>'+
      '<dl class="evidence"><dt>Mail to</dt><dd>'+esc(v.address)+'</dd><dt>Postcard code</dt><dd><code>'+esc(v.code)+'</code></dd><dt>Requested</dt><dd>'+esc(date(v.created_at))+'</dd></dl>'+
      '<div class="inline-actions">'+form('decide_residency',hidden('id',v.id)+hidden('action','mailed')+button('Postcard mailed, erase address','outline'))+
      form('decide_residency',hidden('id',v.id)+hidden('action','declined')+button('Decline and erase','ghost'))+'</div></article>').join(''):
      blank('lock','No postcards to send','Address verification requests appear here until the postcard is mailed.'))+'</section>';
}
function vettingCard(v) {
  const pending = v.status==='pending';
  return '<article class="card panel"><div class="split"><h3>'+esc(v.business)+'</h3>'+chip(v.status,'','muted')+'</div>'+
    '<dl class="evidence"><dt>Legal name</dt><dd>'+esc(v.legal_name)+'</dd><dt>Registry reference</dt><dd>'+esc(v.registration_ref)+'</dd>'+
    '<dt>Public contact reference</dt><dd>'+esc(v.contact_ref)+'</dd></dl>'+
    '<details><summary>'+ (pending?'Record vetting decision':'Revoke vetting')+'</summary>'+form('decide_vetting',hidden('id',v.id)+
      select('Decision','action',pending?[['approved','Approve after checks'],['declined','Decline']]:[['revoked','Revoke approval']],'','Choose a decision')+
      (pending?'<div class="stack evidence-fields" hidden>'+
        field('Independent identity evidence','identityEvidence',{min:12,max:500,hint:'Record the source, lookup date, and matching registration or equivalent.'})+
        field('Independent control evidence','controlEvidence',{min:12,max:500,hint:'Record the public contact channel, challenge method, and result.'})+
        field('License and insurance check','licenseEvidence',{min:12,max:500,hint:'Record source, dates and checks, or explain which credentials are inapplicable and why.'})+
        check('I personally completed and documented these checks.','attestation',true)+'</div>':'')+
      field('Decision reason shown to the business','reason',{type:'textarea',min:12,max:700})+button('Save vetting decision','outline'))+'</details></article>';
}
