// The public holiday tree guide at /trees: tree lots and cut-your-own farms around Cleveland, plus help for families.
// The list comes from public sources and changes each season, so it is kept here in code (no database change) and
// says plainly when it was checked. Built on the server like /events and /food, so search engines can read it.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const treesChecked = 'November 24, 2026';
export const treeGroups = [
  ['city','In the city','Pre-cut trees, no long drive.',[
    { name:'CLE Trees', address:'3615 Carnegie Ave', city:'Cleveland', phone:'(216) 738-9456', note:'Pre-cut lot. Trees started around $80 last season.' }
  ]],
  ['cuyahoga','Cut your own in Cuyahoga County','The closest farm to the city.',[
    { name:'Swan Farm', address:'11721 Tinkers Creek Rd', city:'Valley View', phone:'(216) 254-5501', note:'Cut your own.' }
  ]],
  ['medina','Cut your own in Medina County','About 25–35 minutes south. Kall and Medina Christmas Tree Farms are close enough to visit both in one trip.',[
    { name:'Kall Christmas Tree Farm', address:'3605 Foskett Rd', city:'Medina', note:'Cut your own and pre-cut trees.' },
    { name:'Medina Christmas Tree Farms', address:'Hamilton Rd', city:'Medina', note:'Two family farms (Hamilton Road and Foskett Road). Last season: $70 for any size or variety.' },
    { name:'Timber Valley Christmas Tree Farm', address:'4250 Bagdad Rd', city:'Medina', note:'You choose, you cut.' },
    { name:'Hastings Tree Farm', address:'5664 Windfall Rd', city:'Medina', note:'Saws provided, trees tied for you.' }
  ]],
  ['east','Cut your own east of Cleveland','Geauga, Lake and Portage counties, about 25–45 minutes out.',[
    { name:'Sugar Pines Farm', address:'9500 Mulberry Rd', city:'Chesterland', phone:'(440) 729-1019', url:'https://www.sugarpinesfarm.com/', note:'100 acres. Opens the day after Thanksgiving. No tagging trees ahead of time.' },
    { name:'Howling Pines Farm & Market', city:'Chagrin Falls', note:'Cut your own.' },
    { name:'Rogish Farm', city:'Chesterland', note:'Cut your own.' },
    { name:'Soubusta Farms', city:'Chardon', note:'Cut your own.' },
    { name:'Ransom Sage Farm', city:'Chardon', note:'Cut your own.' },
    { name:'Mountain Creek Tree Farm', city:'Painesville', note:'Cut your own.' },
    { name:'McKosky Tree Farm', city:'Thompson', note:'Cut your own.' },
    { name:'Wintergreen Tree Farm', city:'Mantua', note:'Cut your own.' }
  ]]
];

const directions = (t) => 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent([t.name,t.address,t.city,'OH'].filter(Boolean).join(', '));

export function treesPage(origin) {
  const all = treeGroups.flatMap(([,,,list])=>list);
  const card = (t) => '<article class="listing"><h3>'+esc(t.name)+'</h3><p class="place">'+esc([t.address,t.city].filter(Boolean).join(', '))+'</p>'+
    (t.note?'<p class="detail">'+esc(t.note)+'</p>':'')+
    '<p class="actions">'+(t.url?'<a href="'+esc(t.url)+'" rel="noopener">Website</a>':'')+'<a href="'+esc(directions(t))+'" rel="noopener">Directions</a>'+
    (t.phone?'<a href="tel:'+esc(t.phone.replace(/[^0-9+]/g,''))+'">'+esc(t.phone)+'</a>':'')+'</p></article>';
  const sections = treeGroups.map(([id,title,note,list])=>'<section id="'+id+'"><h2>'+esc(title)+' <small>'+list.length+'</small></h2><p class="note">'+esc(note)+'</p>'+list.map(card).join('')+'</section>').join('');
  const title = 'Where to get a Christmas tree in Cleveland';
  const description = 'Christmas tree lots and '+(all.length-1)+' cut-your-own farms around Cleveland, with addresses, phone numbers and tips, plus holiday help for families. Checked '+treesChecked+'.';
  const structured = { '@context':'https://schema.org', '@type':'ItemList', name:title, itemListElement: all.map((t,i)=>({ '@type':'ListItem', position:i+1,
    item:{ '@type':'LocalBusiness', name:t.name, ...(t.url?{ url:t.url }:{}), ...(t.phone?{ telephone:t.phone }:{}),
      address:{ '@type':'PostalAddress', ...(t.address?{ streetAddress:t.address }:{}), addressLocality:t.city, addressRegion:'OH', addressCountry:'US' } } })) };
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>'+esc(title)+' · Nabora</title><meta name="description" content="'+esc(description)+'">'+
    '<link rel="canonical" href="'+esc(origin)+'/trees"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon-32.png" type="image/png">'+
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/events.css">'+
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Nabora"><meta property="og:title" content="'+esc(title)+'">'+
    '<meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(origin)+'/trees"><meta property="og:image" content="'+esc(origin)+'/og.jpg">'+
    '<meta name="twitter:card" content="summary_large_image">'+
    '<script type="application/ld+json">'+JSON.stringify(structured).replace(/</g,'\\u003c')+'</script></head><body>'+
    '<header class="top"><a class="brand" href="/"><img src="/logo-mark.png" alt="" width="34" height="31">Nabora</a><nav><a href="/events">Events</a><a href="/#login">Sign in</a><a class="join" href="/#signup">Join free</a></nav></header>'+
    '<main><p class="eyebrow">HOLIDAYS AROUND HERE</p><h1>'+esc(title)+'</h1>'+
    '<p class="lede">Tree lots and cut-your-own farms around Cleveland. Most farms open the weekend after Thanksgiving. Hours, prices and whether they take cards change every year, so call before you drive out.</p>'+
    '<nav class="spans" aria-label="Jump to">'+treeGroups.map(([id,t])=>'<a href="#'+id+'">'+esc(t)+'</a>').join('')+'<a href="#help">Help for families</a></nav>'+
    sections+
    '<section id="tips"><h2>Tips</h2><ul class="tips"><li>Go opening weekend for the best choice.</li><li>Bring cash, gloves, rope and an old blanket for the car roof.</li>'+
      '<li>Ask the farm to shake and net the tree. It saves needles and makes it easier to carry.</li><li>Cut an inch off the trunk at home and keep the stand full of water.</li></ul></section>'+
    '<section id="help"><h2>Help for families</h2><p class="note">The Salvation Army gives holiday gifts to children 12 and younger. This year’s sign-up closed November 6, with pickup December 14–18. '+
      'If you missed it, call <a href="tel:2168618185">(216) 861-8185</a> to ask about a waiting list. They also help with holiday food and winter coats.</p></section>'+
    '<aside class="cta"><h2>Know a scout or church tree lot?</h2><p>The neighborhood lots run by scout troops, churches and schools rarely show up online. Post yours on Nabora so neighbors can find it, and support the group selling the trees.</p><a class="join" href="/#signup">Join free and share it</a></aside>'+
    '<p class="sources">Checked '+esc(treesChecked)+' from public listings, including PickYourOwnChristmasTree.org, PickingFarms, The Cleveland Bucket List and the farms’ own websites. Some details are from last season. Nabora isn’t paid by any farm or lot listed here.</p>'+
    '</main><footer><a href="/">Nabora</a> · <a href="/events">Events</a> · <a href="/food">Local food</a> · <a href="/#standards">Community standards</a> · <a href="/#privacy">Privacy</a></footer></body></html>';
}
