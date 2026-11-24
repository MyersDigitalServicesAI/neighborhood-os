// The public Local Food page at /food: farmers markets, farm stands, farm shares, urban farms and community gardens
// across Cuyahoga County. Plain HTML built on the server, like /events, so it loads fast and search engines can read it.
// It never shows who manages a listing, only that the grower keeps it up to date.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const foodKinds = [
  ['market','Farmers markets','Markets and Fresh Stops. Many take SNAP/EBT, and Produce Perks doubles it on fruits and vegetables, up to $25.'],
  ['stand','Farm stands & local grocers','Buy straight from the farm, or from shops that stock local growers.'],
  ['csa','Farm shares (CSAs)','Pay for a season or week by week, and pick up a box of whatever is fresh.'],
  ['farm','Urban & nearby farms','Cleveland’s urban farms, and the working farms in Cuyahoga Valley National Park.'],
  ['garden','Community gardens','Shared plots where neighbors grow their own. Ask about a plot or lend a hand.']
];
const singular = { market:'Farmers market', stand:'Farm stand', csa:'Farm share', farm:'Farm', garden:'Community garden' };
const regions = { 'Cleveland':'In Cleveland', 'Cuyahoga County':'Around Cuyahoga County', 'Cuyahoga Valley':'Nearby: Cuyahoga Valley' };

export const directions = (f) => f.address
  ? 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(f.address+', '+(f.city || 'Cleveland')+', OH')
  : f.lat && f.lng ? 'https://www.google.com/maps/search/?api=1&query='+f.lat+','+f.lng : null;

export function foodPage(data, origin) {
  const { listings = [], kinds = {}, areas = [], kind = null, area = null, snap = false } = data ?? {};
  const place = areas.find((a)=>a.id===area)?.name;
  const kindTitle = foodKinds.find(([k])=>k===kind)?.[1];
  const heading = (kindTitle ?? 'Local food')+(place ? ' in '+place : ' in Cleveland & Cuyahoga County');
  const query = (k,a,s) => { const q = new URLSearchParams({...(k?{kind:k}:{}),...(a?{area:a}:{}),...(s?{snap:'1'}:{})}).toString(); return '/food'+(q?'?'+q:''); };
  const canonical = origin+query(kind,area,snap);
  const total = Object.values(kinds).reduce((sum,n)=>sum+n,0);
  const description = 'Find '+(kinds.market ?? 0)+' farmers markets, '+(kinds.farm ?? 0)+' urban and nearby farms, farm shares and '+(kinds.garden ?? 0)+
    ' community gardens across Cleveland and Cuyahoga County. See hours, seasons and which take SNAP/EBT and Produce Perks.';
  const card = (f) => {
    const map = directions(f);
    const where = [f.address, f.area || (f.city && f.city !== 'Cleveland' ? f.city : null)].filter(Boolean).join(' · ');
    return '<article class="listing" id="'+esc(f.slug)+'"><p class="kind">'+esc(singular[f.kind])+(f.claimed?' <span class="kept">Updated by the grower</span>':'')+'</p>'+
      '<h3>'+esc(f.name)+'</h3>'+(where?'<p class="place">'+esc(where)+'</p>':'')+
      (f.schedule||f.season?'<p class="when">'+esc([f.schedule,f.season].filter(Boolean).join(' · '))+'</p>':'')+
      (f.snap||f.perks?'<p class="badges">'+(f.snap?'<span class="badge">SNAP/EBT</span>':'')+(f.perks?'<span class="badge">Produce Perks</span>':'')+'</p>':'')+
      (f.fresh_now?'<p class="fresh"><strong>Fresh now:</strong> '+esc(f.fresh_now)+'</p>':'')+
      (f.detail?'<p class="detail">'+esc(f.detail)+'</p>':'')+
      '<p class="actions">'+(f.url?'<a href="'+esc(f.url)+'" rel="noopener">Website</a>':'')+(map?'<a href="'+esc(map)+'" rel="noopener">Directions</a>':'')+
      (f.phone?'<a href="tel:'+esc(f.phone.replace(/[^0-9+]/g,''))+'">'+esc(f.phone)+'</a>':'')+'</p></article>';
  };
  const groups = foodKinds.filter(([k])=>!kind || k===kind).map(([k,title,note])=>{
    const list = listings.filter((f)=>f.kind===k);
    if (!list.length) return '';
    const byRegion = Object.keys(regions).map((r)=>[r,list.filter((f)=>f.region===r)]).filter(([,l])=>l.length);
    return '<section id="'+k+'"><h2>'+esc(title)+' <small>'+list.length+'</small></h2><p class="note">'+esc(note)+'</p>'+
      byRegion.map(([r,l])=>(byRegion.length>1||r!=='Cleveland'?'<h4>'+esc(regions[r])+'</h4>':'')+l.map(card).join('')).join('')+'</section>';
  }).join('');
  const structured = { '@context':'https://schema.org', '@type':'ItemList', itemListElement: listings.filter((f)=>f.kind!=='garden').slice(0,60).map((f,i)=>({
    '@type':'ListItem', position:i+1, item:{ '@type':'LocalBusiness', name:f.name, description:String(f.detail ?? '').slice(0,300), url:origin+'/food#'+f.slug,
      ...(f.url ? { sameAs:f.url } : {}), ...(f.phone ? { telephone:f.phone } : {}),
      ...(f.address ? { address:{ '@type':'PostalAddress', streetAddress:f.address, addressLocality:f.city || 'Cleveland', addressRegion:'OH', addressCountry:'US' } } : {}),
      ...(f.lat && f.lng ? { geo:{ '@type':'GeoCoordinates', latitude:Number(f.lat), longitude:Number(f.lng) } } : {}) } })) };
  const tabs = '<nav class="spans" aria-label="Kind">'+[['','All ('+total+')'],...foodKinds.map(([k,t])=>[k,t+' ('+(kinds[k] ?? 0)+')'])]
    .map(([k,label])=>'<a href="'+esc(query(k,area,snap))+'"'+((kind ?? '')===k?' aria-current="page"':'')+'>'+esc(label)+'</a>').join('')+'</nav>';
  const picker = '<form class="filter" method="get" action="/food">'+(kind?'<input type="hidden" name="kind" value="'+esc(kind)+'">':'')+
    '<label>Cleveland neighborhood <select name="area"><option value="">All of Cuyahoga County</option>'+areas.map((a)=>'<option value="'+esc(a.id)+'"'+(a.id===area?' selected':'')+'>'+esc(a.name)+' ('+a.count+')</option>').join('')+'</select></label>'+
    '<label class="check"><input type="checkbox" name="snap" value="1"'+(snap?' checked':'')+'> Takes SNAP/EBT</label><button type="submit">Show</button></form>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>'+esc(heading)+' · Nabora</title><meta name="description" content="'+esc(description)+'">'+
    '<link rel="canonical" href="'+esc(canonical)+'"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon-32.png" type="image/png">'+
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/events.css">'+
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Nabora"><meta property="og:title" content="'+esc(heading)+'">'+
    '<meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(canonical)+'"><meta property="og:image" content="'+esc(origin)+'/og.jpg">'+
    '<meta name="twitter:card" content="summary_large_image">'+
    '<script type="application/ld+json">'+JSON.stringify(structured).replace(/</g,'\\u003c')+'</script></head><body>'+
    '<header class="top"><a class="brand" href="/"><img src="/logo-mark.png" alt="" width="34" height="31">Nabora</a><nav><a href="/events">Events</a><a href="/#login">Sign in</a><a class="join" href="/#signup">Join free</a></nav></header>'+
    '<main><p class="eyebrow">GROWN AROUND HERE</p><h1>'+esc(heading)+'</h1>'+
    '<p class="lede">Every dollar spent at a market stand or farm share stays with a grower down the road. Find the farmers markets, urban farms, farm shares and community gardens near you.</p>'+
    tabs+picker+
    (groups || '<p class="empty">Nothing matches yet. Try “All”, or another neighborhood.</p>')+
    '<aside class="cta"><h2>Do you grow or sell local food?</h2><p>Claim your free listing on Nabora to post your market days, what’s fresh this week, and how to reach you. Neighbors in your area see it in their neighborhood guide.</p><a class="join" href="/#signup">Join and claim your listing</a></aside>'+
    '<p class="sources">Listings come from the Ohio Department of Job and Family Services 2026 Farmers’ Market Directory, Signal Cleveland, the City of Cleveland and OSU Extension’s Cleveland Food System Map, and the National Park Service. Hours change with the seasons, so check before you go.</p>'+
    '</main><footer><a href="/">Nabora</a> · <a href="/events">Events</a> · <a href="/trees">Holiday trees</a> · <a href="/#standards">Community standards</a> · <a href="/#privacy">Privacy</a></footer></body></html>';
}
