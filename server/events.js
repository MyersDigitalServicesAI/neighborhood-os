// Weekly event import. Reads two public calendars, keeps the free community events worth posting and hands them to
// the database, which places each one in its neighborhood. Nothing here invents an event: every post carries the
// organizer's own link.
const library = 'https://cpl.libcal.com/ajax/calendar/list';
const council = 'https://www.clevelandcitycouncil.gov/resources/events';
const pageSize = 48;
// Series that run several times a week would flood the feeds.
const routine = /\b(FamilySpace|Advisory Committee|Scavenger Hunt|Patron Gallery|GED|Aspire|AI Fundamentals|1-on-1|LegalWorks|Homework Hub|Storytime Kits|Career Services|Read to Me|Preschool Storytime|Tech Help 1)/i;
const skipCampus = /^(Main Library|Offsite)/i;
const favored = [/Family Fun/i, /Community Celebrations/i, /Special\/Signature/i, /Used Book Sale/i, /Music, Film & Performance/i,
  /Arts, Crafts/i, /Science, Nature/i, /Games, Strategy/i, /Wellness/i, /Reading, Writing/i];
const branchNames = { 'Martin Luther King, Jr.':'Martin L. King, Jr.', 'Mount Pleasant':'Mt. Pleasant', 'Memorial Nottingham':'Memorial-Nottingham',
  'East 131st Street':'East 131' };
const entities = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', rsquo:'’', lsquo:'‘', rdquo:'”', ldquo:'“', ndash:'–', mdash:'—', hellip:'…' };

export function plain(html = '') {
  return String(html ?? '').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>|<\/p>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi,(all,code)=>code[0]==='#' ? String.fromCodePoint(code[1].toLowerCase()==='x' ? parseInt(code.slice(2),16) : Number(code.slice(1))) : entities[code.toLowerCase()] ?? all)
    .replace(/[ \t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
const clip = (text,max) => text.length > max ? text.slice(0,max - 1).replace(/\s+\S*$/,'')+'…' : text;
// Library times are Cleveland local time; turn them into an exact instant.
export function clevelandTime(local) {
  const [date,time = '00:00:00'] = local.split(' ');
  const guess = new Date(date+'T'+time+'Z');
  const zone = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(guess).find((p)=>p.type==='timeZoneName').value;
  const [,sign,hours,minutes = '0'] = zone.match(/GMT([+-])(\d+)(?::(\d+))?/) ?? [,'-','5'];
  const offset = (sign==='-' ? 1 : -1) * (Number(hours)*60 + Number(minutes));
  return new Date(guess.getTime() + offset*60000).toISOString();
}

export function pickLibrary(results) {
  const seen = new Set();
  return results.filter((e)=>{
    if (seen.has(e.id) || e.all_day || skipCampus.test(e.campus ?? '') || routine.test(e.title ?? '') || /cancel/i.test(e.title+' '+(e.shortdesc ?? ''))) return false;
    seen.add(e.id);
    return true;
  }).map((e)=>{
    const branch = branchNames[e.campus] ?? e.campus;
    const sale = /Used Book Sale/i.test(e.title);
    const rank = favored.findIndex((pattern)=>pattern.test(e.categories ?? ''));
    return {
      rank: rank < 0 ? favored.length : rank,
      source_url: e.url,
      branch,
      title: clip(e.title.trim()+' at the '+branch+' library',120),
      body: clip(plain(e.description || e.shortdesc),900)+'\n\n'+(sale ? 'At' : 'Free at')+' the '+branch+' branch of Cleveland Public Library, '+
        e.start+(e.end ? ' to '+e.end : '')+'. Details and any sign-up: '+e.url,
      place: 'Cleveland Public Library, '+branch+' branch',
      starts_at: clevelandTime(e.startdt)
    };
  }).sort((a,b)=>a.rank - b.rank || a.starts_at.localeCompare(b.starts_at))
    // A sale or series held on several days is posted once, on its first day.
    .filter((e,i,all)=>all.findIndex((x)=>x.title===e.title)===i).map(({rank,...event})=>event);
}

export function pickCouncil(html) {
  const start = html.indexOf('[{"title"');
  if (start < 0) return [];
  let list;
  try { list = JSON.parse(html.slice(start,findEnd(html,start))); } catch { return []; }
  return list.filter((e)=>/Ward \d+/.test(e.title) && /Community Meeting/i.test(e.title) && /\b(\d{1,2}(:\d\d)?\s*(a\.?m|p\.?m))/i.test(plain(e.description)))
    .map((e)=>{
      const ward = Number(e.title.match(/Ward (\d+)/)[1]);
      const link = 'https://www.clevelandcitycouncil.gov'+(e.extendedProps?.url ?? '');
      return { ward, source_url: link, title: clip(e.title.trim(),120),
        body: clip(plain(e.description),1200)+'\n\nSource: Cleveland City Council events calendar, '+link,
        place: 'Ward '+ward, starts_at: clevelandTime(e.start.replace('T',' ')) };
    });
}
function findEnd(text,start) {
  let depth = 0, quoted = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '\\') i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true; else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return text.length;
}

export async function gatherEvents(request = fetch, now = new Date()) {
  const headers = { 'User-Agent':'Nabora community calendar (https://nabora.us)', Accept:'application/json,text/html' };
  const get = async (url,type) => {
    const response = await request(url,{ headers, signal:AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(url+' answered '+response.status);
    return type === 'json' ? response.json() : response.text();
  };
  const week = new Date(now.getTime() + 7*86400000).toISOString().slice(0,10);
  const results = [], failures = [];
  for (const date of ['0000-00-00',week]) {
    for (let page = 1; page <= 8; page++) {
      try {
        const data = await get(library+'?c=8758&date='+date+'&perpage='+pageSize+'&page='+page+'&audience=&cats=&camps=&inc=0','json');
        results.push(...(data.results ?? []));
        if ((data.results ?? []).length < pageSize) break;
      } catch (error) { failures.push('library'); break; }
    }
  }
  let meetings = [];
  try { meetings = pickCouncil(await get(council,'text')); } catch { failures.push('council'); }
  // Council meetings first: there are few of them and they matter most.
  const from = now.toISOString(), to = new Date(now.getTime() + 15*86400000).toISOString();
  const upcoming = (e) => e.starts_at >= from && e.starts_at <= to;
  return { events:[...meetings.filter(upcoming),...pickLibrary(results).filter(upcoming)], failures:[...new Set(failures)] };
}
