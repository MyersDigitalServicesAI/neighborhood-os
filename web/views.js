import { action, avatar, back, blank, brand, button, categories, check, chip, date, esc, field, form, heading, hidden, icon,
  illustration, ref, select, stars, typeInfo, url, verified, areas } from './ui.js';

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
    feature('chat','The neighborhood feed','Ask a question, share local news, or plan something together.')+
    feature('brief','Local service requests','Ask for help and get recommendations. Neighbors and businesses can reply for free.')+
    feature('shield','Trust you can see','Reviews receive a human decision. A paid badge also requires documented business vetting.')+
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
    ['What your neighbors see','Your display name and the neighborhood you choose appear with local activity. Your account email is private. NeighborhoodOS does not ask for a home address.'],
    ['Messages and moderation','Direct messages are visible in the app only to conversation participants. They are stored to deliver the service and are not end-to-end encrypted. Review text, risk signals, reports and appeals are available to assigned staff through the moderation console.'],
    ['Vetting and payments','Vetting references and moderator notes are restricted to authorized staff. Submit public business references, never identity documents or payment details. Stripe handles card details when billing is enabled.'],
    ['Your choices','You can block private messages from an account. For an account-data or deletion request, contact the pilot organizer who gave you access.']
  ] : [
    ['Be a good neighbor','Keep it local and civil. Harassment, threats, impersonation, scams, discrimination, and sharing someone else’s private information are prohibited.'],
    ['Recommendations are free','Neighbors can suggest a service provider or answer a request using their personal account. Businesses can reply and list a profile for free. Disclose employment, ownership, or any other relevant affiliation when you reply.'],
    ['Reviews need firsthand experience','Describe the work you actually experienced. Disclose relevant relationships. Fake reviews, incentives tied to sentiment, promotional copy, and private information are prohibited. Staff make publication and removal decisions. Authors can appeal removals for an independent decision.'],
    ['What the badge means','A current badge means staff documented business identity, control of a public business contact, and applicable license or insurance checks, and the $100/month subscription is current. Vetting is reviewed annually. The badge carries no workmanship guarantee.']
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
  ['feed','Neighborhood','home'],['requests','Service requests','brief'],['directory','Businesses','shop'],['inbox','Messages','inbox'],['account','Account','user']
];
export function shell(context,selected,body,aside = '') {
  const area = context.areas.find((a)=>a.id===context.member.area_id)?.name ?? 'Your neighborhood';
  function nav(items,cls) {
    return '<nav class="'+cls+'" aria-label="Workspace">'+items.map(([route,label,image])=>'<a href="#'+route+'"'+(selected===route?' class="active" aria-current="page"':'')+'>'+icon(image,20)+'<span>'+esc(label)+'</span></a>').join('')+'</nav>';
  }
  return '<header class="app-header"><div class="app-header-inner"><a href="#feed" aria-label="NeighborhoodOS home">'+brand+'</a><span class="head-area">'+icon('pin',16)+esc(area)+'</span><a class="profile-link" href="#account" aria-label="Account">'+avatar(context.member.name)+'</a></div></header>'+
    '<div class="workspace '+(aside?'has-aside':'')+'"><aside class="sidebar"><p class="eyebrow">YOUR NEIGHBORHOOD</p>'+nav(context.staff?[...navigation,['moderation','Moderation','shield']]:navigation,'side-nav')+
    '<div class="side-help"><a href="#standards">Community standards</a><a href="#privacy">Privacy</a></div></aside>'+
    '<main id="content" tabindex="-1" class="app-main">'+body+'</main>'+
    (aside?'<aside class="rightbar">'+aside+'</aside>':'')+'</div>'+
    nav(navigation.map(([r,l,i])=>[r,({feed:'Feed',requests:'Requests'})[r]??l,i]),'bottom-nav');
}
export function feedAside(area) {
  return '<section class="side-card neighborhood-card"><span class="feature-icon">'+icon('pin',22)+'</span><p class="eyebrow">YOUR LOCAL CIRCLE</p><h2>'+esc(area)+'</h2><p>Conversations and requests from people in your neighborhood.</p></section>'+
    '<section class="side-card"><span class="feature-icon pale">'+icon('shield',21)+'</span><h2>Trust starts here.</h2><p>Share firsthand experiences and disclose business affiliations. You can recommend or reply for free.</p><a class="text-link" href="#standards">Community standards '+icon('arrow',15)+'</a></section>';
}
export function feedView(posts, area, selected, filter) {
  const requests = selected === 'requests';
  return (requests ?
    heading('ASK A NEIGHBOR','Service requests','Ask for help or recommend someone you’ve worked with.',action('Request a service','new/request','primary','plus')) :
    '<header class="feed-banner"><p class="eyebrow">'+icon('pin',15)+esc(area)+' · NORTHEAST OHIO</p><h1>Your neighborhood</h1><p>Good things happen when neighbors talk.</p></header>'+
    '<div class="feed-controls"><nav class="tabs" aria-label="Filter feed">'+[['','All posts'],['discussion','Discussions'],['event','Events']].map(([k,label])=>'<a href="#feed'+(k?'/'+k:'')+'" '+(filter===k?'aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav>'+action('New post','new/discussion','primary','plus')+'</div>')+
    (posts.length ? '<div class="cards" id="feed-results">'+posts.map(postCard).join('')+'</div>' : blank(requests?'brief':'chat',requests?'No requests yet':'Say hello to your neighbors',requests?'Post the first service request for your neighborhood.':'Start a discussion, share an event, or ask for a recommendation.',
      action(requests?'Create a request':'Create a post',requests?'new/request':'new/discussion','outline','plus')))+
    (posts.length === 25 ? pager('feed-more',posts.at(-1)):'');
}
export function pager(name,item,fields = '') {
  return form(name,hidden('before',item.created_at ?? item.updated_at ?? '')+hidden('cursor',item.id)+fields+button('Load more','outline'));
}
export function postCard(post) {
  const [label,image] = typeInfo[post.kind] ?? typeInfo.discussion;
  return '<article class="card feed-card"><div class="post-meta">'+avatar(post.author)+'<div><strong>'+esc(post.author)+'</strong><span>'+esc(date(post.created_at))+'</span></div><span class="spacer"></span>'+chip(label,image,post.kind)+'</div>'+
    '<h2><a href="#post/'+ref(post.id)+'">'+esc(post.title)+'</a></h2><p class="post-text clamp">'+esc(post.body)+'</p>'+
    '<div class="post-foot"><a class="text-link" href="#post/'+ref(post.id)+'">'+icon('chat',17)+esc(post.replies)+' '+(post.replies===1?'reply':'replies')+'</a>'+
    (post.closed?chip('Closed','','muted'):'')+'</div></article>';
}
export function composer(type) {
  return back('Back to feed','feed')+heading('START A CONVERSATION',type==='request'?'Request a local service':'Create a post','Your post will be visible to members of your selected neighborhood.')+
    '<section class="card panel">'+form('create_post',select('Post type','kind',[['discussion','Discussion'],['request','Service request'],['event','Local event']],type)+
    field('Title','title',{min:3,max:120,placeholder:'What would you like neighbors to know?'})+
    field('Details','body',{type:'textarea',min:3,max:2400,hint:'Keep exact addresses, phone numbers, and personal information out of your post.'})+button('Publish post','primary','arrow'))+'</section>';
}
function reportContent(id,kind) {
  return '<details><summary>'+icon('flag',14)+' Report '+kind+'</summary>'+form('report_content',hidden('id',id)+hidden('kind',kind)+
    field('Why should staff review this?','reason',{type:'textarea',min:12,max:700})+button('Send report','outline'))+'</details>';
}
export function postView(post,me,businesses) {
  const [label,image] = typeInfo[post.kind];
  return back('Back to '+(post.kind==='request'?'requests':'feed'),post.kind==='request'?'requests':'feed')+
    '<article class="card panel detail"><div class="post-meta">'+avatar(post.author)+'<div><strong>'+esc(post.author)+'</strong><span>'+esc(date(post.created_at))+'</span></div><span class="spacer"></span>'+chip(label,image,post.kind)+'</div>'+
    '<h1>'+esc(post.title)+'</h1><p class="post-text">'+esc(post.body)+'</p><div class="inline-actions">'+
    (post.author_id!==me ? action('Message '+post.author,'compose/'+ref(post.author_id),'outline','inbox') :
      post.kind==='request'&&!post.closed ? form('close_post',hidden('id',post.id)+button('Close request','outline')) : '')+
    (post.closed?chip('Request closed','','muted'):'')+'</div>'+(post.author_id!==me?reportContent(post.id,'post'):'')+'</article>'+
    '<section class="detail-section"><h2>Replies</h2><div class="cards">'+(post.replies.length ? post.replies.map((r)=>
      '<article class="card reply"><div class="post-meta">'+avatar(r.author)+'<div><strong>'+esc(r.author)+'</strong><span>'+esc(date(r.created_at))+'</span></div>'+
      (r.affiliated?chip('Business affiliation','brief','request'):'')+'</div>'+
      (r.business?'<a class="text-link" href="#business/'+ref(r.business_id)+'">'+esc(r.business)+'</a>':'')+
      '<p class="post-text">'+esc(r.body)+'</p>'+(r.author_id!==me?reportContent(r.id,'reply'):'')+'</article>').join(''):'<p class="quiet">No replies yet.</p>')+'</div></section>'+
    (post.closed?'':'<section class="card panel"><h2>Write a reply</h2><p class="quiet">Neighbor recommendations and business replies are free.</p>'+form('reply',hidden('id',post.id)+
      field('Your reply','body',{type:'textarea',min:2,max:1600})+
      (businesses.length?select('Reply as','business',[['','Personal account'],...businesses.map((b)=>[b.id,b.name])]):'')+
      check('I have a business affiliation relevant to this reply.','affiliated')+button('Post reply','primary','arrow'))+'</section>');
}
export function directoryView(list,query,category) {
  return heading('SHOP AND HIRE LOCAL','Local businesses','Explore businesses serving your neighborhood.',action('Add a free profile','business-new','primary','plus'))+
    '<section class="card panel search-panel">'+form('search_directory',field('Search businesses','q',{required:false,max:80,value:query,placeholder:'Search by name or trade'})+
    select('Category','category',[['','All categories'],...categories],category)+button('Search','outline','search'))+'</section>'+
    (list.length?'<div class="business-grid" id="directory-results">'+list.map(businessCard).join('')+'</div>':
      blank('shop','No businesses found','Try a different search or create a free local business profile.'))+
    (list.length===25 ? pager('directory-more',list.at(-1),hidden('afterName',list.at(-1).name)) : '');
}
export function businessCard(b) {
  return '<article class="card business-card"><span class="feature-icon">'+icon('shop',23)+'</span><div><p class="eyebrow">'+esc(b.category)+'</p><h2><a href="#business/'+ref(b.id)+'">'+esc(b.name)+'</a></h2></div>'+
    (b.verified?verified():'')+'<p class="clamp">'+esc(b.description)+'</p><a class="text-link" href="#business/'+ref(b.id)+'">View profile '+icon('arrow',16)+'</a></article>';
}
export function businessForm(b) {
  return back('Back to businesses',b?'manage':'directory')+heading('FREE BUSINESS PROFILE',b?'Edit business profile':'Add a local business',
    'Introduce your business and participate in your local community.')+'<section class="card panel">'+
    form(b?'update_business':'create_business',(b?hidden('id',b.id):field('Business name','name',{min:2,max:80}))+
    select('Category','category',categories,b?.category)+field('About the business','description',{type:'textarea',min:10,max:1000,value:b?.description})+
    field('Business website (optional)','website',{type:'url',max:250,value:b?.website,required:false,placeholder:'https://'})+button(b?'Save profile':'Create profile','primary','arrow'))+'</section>';
}
export function businessView(b,me) {
  const owner = me===b.owner_id;
  const site = url(b.website);
  return back('Back to businesses','directory')+'<section class="card panel detail"><span class="feature-icon">'+icon('shop',23)+'</span>'+
    '<p class="eyebrow">'+esc(b.category)+'</p><h1>'+esc(b.name)+'</h1>'+(b.verified?verified():'')+'<p class="post-text">'+esc(b.description)+'</p>'+
    '<div class="inline-actions">'+(owner?action('Manage business','manage','outline','brief'):action('Message business','compose/'+ref(b.owner_id),'primary','inbox'))+
    (site?'<a class="button outline" href="'+site+'" target="_blank" rel="noopener noreferrer">'+icon('external',17)+'Website</a>':'')+'</div></section>'+
    '<section class="detail-section"><h2>Neighbor reviews</h2><p class="quiet">Reviews describe firsthand experiences. A moderator decides what is published.</p>'+
    '<div class="cards" id="review-results">'+(b.reviews.length?b.reviews.map(reviewCard).join(''):'<p class="quiet">No published reviews yet.</p>')+'</div>'+
    (b.reviews.length===25?pager('reviews-more',b.reviews.at(-1),hidden('id',b.id)):'')+'</section>'+
    (!owner&&!b.ownReview?'<section class="card panel"><h2>Share your experience</h2>'+form('submit_review',hidden('id',b.id)+
      select('Rating','rating',[[5,'5 stars'],[4,'4 stars'],[3,'3 stars'],[2,'2 stars'],[1,'1 star']],'','Select a rating')+
      field('Your review','body',{type:'textarea',min:20,max:1600,hint:'Describe your firsthand experience. Leave out names, numbers, and addresses that are private.'})+
      check('I have a relationship with this business that readers should know about.','affiliated')+
      check('I am describing my own firsthand experience.','attest',true)+button('Submit for review','primary','arrow'))+'</section>':
      b.ownReview?action('See my review status','my-reviews','outline'):'');
}
export function reviewCard(r) {
  return '<article class="card reply"><div class="post-meta">'+avatar(r.author)+'<div><strong>'+esc(r.author)+'</strong><span>'+esc(date(r.created_at))+'</span></div><span class="spacer"></span>'+stars(r.rating)+'</div>'+
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
export function accountView(context) {
  return heading('YOUR PROFILE','Account','Manage your local activity and business profiles.')+
    '<section class="card panel account-panel">'+avatar(context.member.name)+'<div><h2>'+esc(context.member.name)+'</h2><p class="quiet">'+esc(context.areas.find((a)=>a.id===context.member.area_id)?.name)+'</p></div></section>'+
    '<section class="card panel"><h2>Your activity</h2><div class="inline-actions">'+action('My business profiles','manage','outline','shop')+
    action('My reviews and appeals','my-reviews','outline','star')+(context.staff?action('Moderation queue','moderation','outline','shield'):'')+'</div></section>'+
    '<section class="card panel"><h2>Account access</h2>'+form('logout',button('Sign out','outline'))+'</section>';
}
export function manageView(list,billing) {
  return back('Back to account','account')+heading('LOCAL BUSINESS','Manage business profiles','Free profiles let you show up locally and reply to service requests.',action('Add a profile','business-new','primary','plus'))+
    '<section class="card panel program"><span class="feature-icon">'+icon('shield',23)+'</span><div><p class="eyebrow">OPTIONAL VERIFICATION</p><h2>Verified Business</h2><p>Staff independently verify identity, public contact control, and applicable credentials before billing can begin.</p></div><p class="price"><strong>$100</strong><span> / month</span></p></section>'+
    (!billing?'<p class="notice-box">Paid subscriptions are unavailable during this pilot. You can use a free business profile and submit a vetting application.</p>':'')+
    (list.length?list.map((b)=>{
      const current = b.vetting==='approved' && new Date(b.vettingExpires).getTime()>Date.now();
      return '<section class="card panel"><div class="split"><h2>'+esc(b.name)+'</h2>'+(b.verified?verified():'')+'</div>'+
        '<p class="quiet">'+esc(b.vetting==='pending'?'Vetting application under review':current?'Vetting approved until '+date(b.vettingExpires):
          b.vetting==='approved'?'Vetting expired':b.vetting==='declined'?'Vetting declined':b.vetting==='revoked'?'Vetting revoked':'Vetting application available')+'</p>'+
        (b.vettingReason?'<p class="post-text">'+esc(b.vettingReason)+'</p>':'')+
        '<div class="inline-actions">'+action('View profile','business/'+ref(b.id),'outline')+action('Edit','business-edit/'+ref(b.id),'outline')+
        (current&&billing&&!b.hasSubscription?form('checkout',hidden('id',b.id)+button('Subscribe for $100/month')):'')+
        (billing&&b.hasCustomer?form('billing_portal',hidden('id',b.id)+button('Manage billing','outline')):'')+'</div>'+
        (!current && b.vetting!=='pending'?'<details><summary>Apply for vetting</summary>'+form('apply_vetting',hidden('id',b.id)+
          field('Legal business name','legal',{min:2,max:150})+
          field('Public business registration or directory reference','registration',{min:3,max:180,hint:'For example, an Ohio registration number or an official registry link.'})+
          field('Public contact reference','contact',{min:3,max:180,hint:'A business website or public business number. Keep personal documents out of this form.'})+
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
    (queue.vetting.length?queue.vetting.map(vettingCard).join(''):blank('shop','No vetting cases','New applications appear here.'))+'</section>';
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
