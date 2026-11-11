export const icons = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  brief:'<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18m-11 0v2h4v-2"/>',
  shop:'<path d="M4 11v9h16v-9M3 11l2-7h14l2 7M3 11a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-5h6v5"/>',
  chat:'<path d="M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-3.6-.8L4 20.5l1.3-4.3a8.5 8.5 0 1 1 15.2-4.7z"/>',
  inbox:'<path d="M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-5l-2 2-2-2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9h10m-10 4h7"/>',
  user:'<circle cx="12" cy="8" r="3.3"/><path d="M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
  pin:'<path d="M20 10c0 6-8 11-8 11s-8-5-8-11a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  external:'<path d="M13 5h6v6m0-6-9 9M19 14v5H5V5h5"/>',
  back:'<path d="M20 12H5m6-6-6 6 6 6"/>',
  shield:'<path d="m12 22 2-1.2c4-2.4 6-5.2 6-9.8V5l-8-3-8 3v6c0 4.6 2 7.4 6 9.8L12 22z"/><path d="m8.8 11.7 2.1 2.1 4.3-4.3"/>',
  calendar:'<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v6m8-6v6M4 11h16m-11 4h6"/>',
  leaf:'<path d="M6 19C3 14 5 7 12 6c4-.6 6-1 8-3 1 8-3 15-9 15H7m-3 3 9-9"/>',
  search:'<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  flag:'<path d="M5 22V3m0 1c6-5 8 5 14 0v11c-6 5-8-5-14 0"/>',
  star:'<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.3 6.1-.9z"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>'
};
export const icon = (name, size = 20) => '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icons[name] ?? '')+'</svg>';
export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const url = (value) => {
  try { const link = new URL(value); return link.protocol === 'https:' && !link.username && !link.password ? esc(link.href) : ''; }
  catch { return ''; }
};
export const ref = (value) => encodeURIComponent(value ?? '');
export const areas = ['Old Brooklyn','Parma','Brook Park','Lakewood'];
export const categories = ['Home services','Food & drink','Retail','Health & wellness','Professional services','Other'];
export const typeInfo = { discussion:['Discussion','chat'], request:['Service request','brief'], event:['Local event','calendar'] };
export const mark = '<img src="/mark.svg" alt="" width="37" height="37">';
export const brand = '<span class="brand">'+mark+'<span>Neighborhood<span class="brand-os">OS</span></span></span>';
export const chip = (text, name, variant = '') => '<span class="chip '+variant+'">'+(name ? icon(name,15) : '')+esc(text)+'</span>';
export const action = (text, route, variant = 'primary', image = '') => '<a class="button '+variant+'" href="#'+esc(route)+'">'+(image ? icon(image,17) : '')+esc(text)+'</a>';
export const button = (text, variant = 'primary', image = '') => '<button class="button '+variant+'" type="submit">'+(image ? icon(image,17) : '')+esc(text)+'</button>';
export const field = (label,name,options = {}) => {
  const { type = 'text', required = true, min = 0, max = 100, value = '', hint = '', placeholder = '', autocomplete = '' } = options;
  const attrs = ' name="'+esc(name)+'" '+(required?'required ':'')+(min?'minlength="'+min+'" ':'')+'maxlength="'+max+'" placeholder="'+esc(placeholder)+'" ';
  const input = type === 'textarea' ? '<textarea'+attrs+'rows="4">'+esc(value)+'</textarea>' :
    '<input'+attrs+'type="'+esc(type)+'" value="'+esc(value)+'" '+(autocomplete?'autocomplete="'+esc(autocomplete)+'"':'')+'>';
  return '<label class="field"><span>'+esc(label)+'</span>'+input+(hint?'<small>'+esc(hint)+'</small>':'')+'</label>';
};
export const select = (label,name,options,selected='',empty='') => '<label class="field"><span>'+esc(label)+'</span><select name="'+esc(name)+'"'+(options.some((entry)=>Array.isArray(entry)&&entry[0]==='')?'':' required')+'>'+
  (empty ? '<option value="">'+esc(empty)+'</option>' : '')+options.map((entry) => {
    const [value,text] = Array.isArray(entry) ? entry : [entry,entry];
    return '<option value="'+esc(value)+'"'+(selected===value?' selected':'')+'>'+esc(text)+'</option>';
  }).join('')+'</select></label>';
export const hidden = (name,value) => '<input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'">';
export const check = (label,name,required = false) => '<label class="check"><input name="'+esc(name)+'" type="checkbox"'+(required?' required':'')+' value="true"><span>'+esc(label)+'</span></label>';
export const form = (operation,inside,extra = '') => '<form class="stack" data-action="'+esc(operation)+'" '+extra+'>'+inside+'<p class="form-error" role="alert" hidden></p></form>';
export const avatar = (name) => {
  const value = name || 'Neighbor';
  const initials = value.trim().split(/\s+/).slice(0,2).map((part) => [...part][0]).join('').toUpperCase();
  return '<span class="avatar tone-'+(value.codePointAt(0)%4)+'" aria-hidden="true">'+esc(initials)+'</span>';
};
export const date = (value) => {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '' : new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:time.getFullYear()===new Date().getFullYear()?undefined:'numeric',timeZone:'America/New_York'}).format(time);
};
export const blank = (image,title,text,more = '') => '<section class="empty">'+icon(image,28)+'<h2>'+esc(title)+'</h2><p>'+esc(text)+'</p>'+more+'</section>';
export const heading = (eyebrow,title,description,controls = '') => '<header class="page-heading"><div><p class="eyebrow">'+esc(eyebrow)+'</p><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div>'+controls+'</header>';
export const back = (label,route) => '<a class="back" href="#'+esc(route)+'">'+icon('back',16)+esc(label)+'</a>';
export const stars = (rating) => '<span class="stars" aria-label="'+esc(rating)+' out of 5 stars">'+('★'.repeat(Math.max(0,Math.min(5,Number(rating) || 0))))+'</span>';
export const verified = () => chip('Verified Business','shield','verified');

export const illustration = '<svg viewBox="0 0 596 442" role="img" aria-label="Illustration of neighborhood houses and trees" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="paper" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M0 28V0H28" fill="none" stroke="#dce2be" stroke-width="1"/></pattern><pattern id="dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#3b6446" opacity=".35"/></pattern></defs><rect width="596" height="442" rx="28" fill="#e9edcf"/><rect width="596" height="442" rx="28" fill="url(#paper)"/><path d="M-28 374Q101 287 208 321t233-57 188-8v186H0Z" fill="#c7d7a0"/><path d="M-24 410Q92 304 202 353t211-9q104-72 205-40" fill="none" stroke="#f7f0d6" stroke-width="33"/><path d="M-24 410Q92 304 202 353t211-9q104-72 205-40" fill="none" stroke="#dcc99a" stroke-width="2" stroke-dasharray="5 9"/><circle cx="452" cy="90" r="39" fill="#edb77c"/><path d="M382 109h66m-53 10h62" stroke="#d4985c" stroke-width="1" opacity=".7"/><path d="M57 198c-25-5-21-45 0-49-9-24 5-47 27-47 21 0 34 23 25 43 20 3 28 33 11 48-15 14-43 10-63 5Z" fill="#5b8050"/><path d="M83 128v111m0-55-17-13m17-10 16-12" stroke="#345b3e" stroke-width="3" fill="none"/><path d="M501 231c-18-10-16-35 2-44-7-21 7-45 25-45 22 0 33 23 23 41 18 5 25 35 9 49-13 11-42 11-59-1Z" fill="#759259"/><path d="M528 164v104m0-49-15-10m15-12 13-11" stroke="#466746" stroke-width="3" fill="none"/><path d="M119 214 201 145l85 69v106l-170-3z" fill="#e5a480"/><path d="M109 219 201 139l94 80" fill="none" stroke="#78564a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M145 236h26v31h-26zM231 236h26v31h-26z" fill="#f5dfae" stroke="#775b47" stroke-width="2"/><path d="M158 236v31m86-31v31m-99-15h26m60 0h26" stroke="#775b47" stroke-width="1.5"/><path d="M188 321v-57a13 13 0 0 1 26 0v57" fill="#8f6a58"/><circle cx="208" cy="285" r="2" fill="#efd1a5"/><path d="M282 179 362 107l84 74v129l-163 7z" fill="#f5e6b8"/><path d="M273 185 362 101l95 84" fill="none" stroke="#416747" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/><path d="M304 200h32v38h-32zM393 200h32v38h-32z" fill="#b3c999" stroke="#56734c" stroke-width="2"/><path d="M320 200v38m89-38v38m-105-19h32m57 0h32" stroke="#56734c" stroke-width="1.5"/><path d="M348 317v-67a15 15 0 0 1 30 0v66" fill="#577755"/><circle cx="370" cy="278" r="2" fill="#f4e4b6"/><path d="M274 312h183m-342 6h160" stroke="#456344" stroke-width="2" stroke-linecap="round"/><path d="M49 280h63m-57-13h44m360 18h59m-45 12h56" stroke="#8ea76b" stroke-width="2" stroke-linecap="round"/><path d="M47 419q42-14 90-12m305 14q39-14 85-12" stroke="#aabf80" stroke-width="2" fill="none"/><path d="M94 78q12-12 26 0 12-13 25-2m140-37q9-7 17 0 9-7 17-1" stroke="#668367" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M0 390q117-58 210-12t200-14q104-59 186-21v99H0Z" fill="url(#dots)" opacity=".5"/></svg>';
