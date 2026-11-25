// The public events page at /events: plain HTML built on the server, so it works without JavaScript, loads fast and
// can be read by search engines. It lists only events shared with all of Northeast Ohio, and never who posted them.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const zone = 'America/New_York';
const dayLabel = new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:zone});
const timeLabel = new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:zone});
const dayKey = new Intl.DateTimeFormat('en-CA',{timeZone:zone});
const spans = [['','All upcoming'],['week','Next 7 days'],['weekend','This weekend']];
const titles = { all:'Things to do in Cleveland', week:'Things to do in Cleveland this week', weekend:'Things to do in Cleveland this weekend' };

export function eventsPage(data, origin) {
  const { events = [], areas = [], when = 'all', area = null } = data ?? {};
  const place = areas.find((a)=>a.id===area)?.name;
  const heading = place ? 'Events in '+place : titles[when] ?? titles.all;
  const query = (w,a) => { const q = new URLSearchParams({...(w?{when:w}:{}),...(a?{area:a}:{})}).toString(); return '/events'+(q?'?'+q:''); };
  const canonical = origin+query(when==='all'?'':when,area);
  const description = events.length
    ? events.length+' free and local events across Cleveland neighborhoods: library programs, ward meetings, holiday markets and more. Updated every week.'
    : 'Free and local events across Cleveland neighborhoods, updated every week on Nabora.';
  const days = [];
  for (const e of events) {
    const key = dayKey.format(new Date(e.event_at));
    if (days.at(-1)?.key !== key) days.push({ key,label:dayLabel.format(new Date(e.event_at)),items:[] });
    days.at(-1).items.push(e);
  }
  const card = (e) => '<article class="event" id="e-'+esc(e.id)+'"><p class="time">'+esc(timeLabel.format(new Date(e.event_at)))+'</p><div>'+
    '<h3>'+esc(e.title)+'</h3>'+(e.place?'<p class="place">'+esc(e.place)+'</p>':'')+
    '<p class="tags"><a class="tag" href="'+esc(query(when==='all'?'':when,e.area_id))+'">'+esc(e.area)+'</a>'+(e.going?'<span>'+esc(e.going)+' going</span>':'')+'</p>'+
    '<details><summary>Details</summary><p>'+esc(e.body).replace(/\n/g,'<br>')+'</p></details>'+
    '<p class="actions">'+(e.link?'<a href="'+esc(e.link)+'" rel="noopener">Organizer’s page</a>':'')+'<a href="/#signup">Join Nabora to RSVP</a></p></div></article>';
  const structured = { '@context':'https://schema.org', '@type':'ItemList', itemListElement: events.slice(0,40).map((e,i)=>({
    '@type':'ListItem', position:i+1, item:{ '@type':'Event', name:e.title, startDate:e.event_at, eventStatus:'https://schema.org/EventScheduled',
      eventAttendanceMode:'https://schema.org/OfflineEventAttendanceMode', description:String(e.body ?? '').slice(0,300),
      location:{ '@type':'Place', name:e.place || e.area, address:{ '@type':'PostalAddress', addressLocality:'Cleveland', addressRegion:'OH', addressCountry:'US', streetAddress:e.place || undefined } },
      url:origin+'/events#e-'+e.id, ...(e.link ? { sameAs:e.link } : {}) } })) };
  const picker = '<form class="filter" method="get" action="/events">'+(when!=='all'?'<input type="hidden" name="when" value="'+esc(when)+'">':'')+
    '<label>Neighborhood <select name="area"><option value="">Everywhere</option>'+areas.map((a)=>'<option value="'+esc(a.id)+'"'+(a.id===area?' selected':'')+'>'+esc(a.name)+' ('+a.count+')</option>').join('')+'</select></label>'+
    '<button type="submit">Show</button></form>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>'+esc(heading)+' · Nabora Events</title><meta name="description" content="'+esc(description)+'">'+
    '<link rel="canonical" href="'+esc(canonical)+'"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon-32.png" type="image/png">'+
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/events.css">'+
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Nabora"><meta property="og:title" content="'+esc(heading)+'">'+
    '<meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(canonical)+'"><meta property="og:image" content="'+esc(origin)+'/og.jpg">'+
    '<meta name="twitter:card" content="summary_large_image">'+
    '<script type="application/ld+json">'+JSON.stringify(structured).replace(/</g,'\\u003c')+'</script></head><body>'+
    '<header class="top"><a class="brand" href="/"><img src="/logo-mark.png" alt="" width="34" height="31">Nabora</a><nav><a href="/food">Local food</a><a href="/#login">Sign in</a><a class="join" href="/#signup">Join free</a></nav></header>'+
    '<main><p class="eyebrow">WHAT’S ON ACROSS CLEVELAND</p><h1>'+esc(heading)+'</h1>'+
    '<p class="lede">Library programs, ward meetings, holiday markets and neighbor events from every Cleveland neighborhood. Free to browse, updated every week.</p>'+
    '<nav class="spans" aria-label="When">'+spans.map(([key,label])=>'<a href="'+esc(query(key,area))+'"'+((when==='all'?'':when)===key?' aria-current="page"':'')+'>'+esc(label)+'</a>').join('')+'</nav>'+
    picker+
    (days.length ? days.map((d)=>'<section><h2>'+esc(d.label)+'</h2>'+d.items.map(card).join('')+'</section>').join('')
      : '<p class="empty">Nothing is posted for this yet. Try “All upcoming”, or join Nabora and post the first one.</p>')+
    '<aside class="cta"><h2>Where neighborhoods become neighbors.</h2><p>Join Nabora to RSVP, post your own events, and see what your neighbors recommend. It’s free for neighbors.</p><a class="join" href="/#signup">Find your neighborhood</a></aside>'+
    '</main><footer><a href="/">Nabora</a> · <a href="/food">Local food</a> · <a href="/trees">Holiday trees</a> · <a href="/trust">Trust &amp; safety</a> · <a href="/#standards">Community standards</a> · <a href="/#privacy">Privacy</a></footer></body></html>';
}
