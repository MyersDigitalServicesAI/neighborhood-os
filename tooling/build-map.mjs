// Builds the app's bundled map from public open data. Run it by hand when boundaries or roads change:
//   node tooling/build-map.mjs
// It writes public/map/base.json (areas, water, main roads), public/map/t/*.json (local streets in tiles)
// and supabase/migrations/20261114090000_map_areas.sql (suburbs, real centres, true neighbours).
// Sources: City of Cleveland open data (statistical planning areas) and US Census Bureau TIGER/Line
// and cartographic boundary files. All are public domain or open data.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { unzipSync } from 'fflate';
import * as shapefile from 'shapefile';

const cache = process.env.MAP_CACHE || '.cache/map';
const sources = {
  'spa.geojson': 'https://www.clevelandgis.org/arcgis/rest/services/ReferenceLayers/SPA/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  'cb_2023_39_cousub_500k.zip': 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_39_cousub_500k.zip',
  'tl_2023_39035_roads.zip': 'https://www2.census.gov/geo/tiger/TIGER2023/ROADS/tl_2023_39035_roads.zip',
  'tl_2023_39035_areawater.zip': 'https://www2.census.gov/geo/tiger/TIGER2023/AREAWATER/tl_2023_39035_areawater.zip'
};
await mkdir(cache,{recursive:true});
for (const [name,url] of Object.entries(sources)) {
  if (existsSync(cache+'/'+name)) continue;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not download '+name);
  await writeFile(cache+'/'+name,new Uint8Array(await response.arrayBuffer()));
}
async function shapes(zip) {
  const files = unzipSync(new Uint8Array(await readFile(cache+'/'+zip)));
  const pick = (ext) => Object.entries(files).find(([name]) => name.endsWith(ext))[1];
  return (await shapefile.read(pick('.shp').buffer.slice(pick('.shp').byteOffset,pick('.shp').byteOffset+pick('.shp').byteLength),
    pick('.dbf').buffer.slice(pick('.dbf').byteOffset,pick('.dbf').byteOffset+pick('.dbf').byteLength))).features;
}

// Local flat projection in metres. The county is small enough that this stays accurate to a few metres.
const origin = { lat:41.62, lng:-81.98 };
const scale = 111320;
const kx = Math.cos(41.45*Math.PI/180)*scale;
const project = ([lng,lat]) => [Math.round((lng-origin.lng)*kx),Math.round((origin.lat-lat)*scale)];
const unproject = ([x,y]) => [origin.lng+x/kx,origin.lat-y/scale];

function simplify(points,tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length-1] = 1;
  const stack = [[0,points.length-1]];
  while (stack.length) {
    const [a,b] = stack.pop();
    const [ax,ay] = points[a];
    const [bx,by] = points[b];
    const dx = bx-ax;
    const dy = by-ay;
    const len = dx*dx+dy*dy;
    let worst = 0;
    let index = -1;
    for (let i = a+1; i < b; i++) {
      const [px,py] = points[i];
      const t = len ? Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len)) : 0;
      const d = (px-ax-t*dx)**2+(py-ay-t*dy)**2;
      if (d > worst) { worst = d; index = i; }
    }
    if (worst > tolerance*tolerance) { keep[index] = 1; stack.push([a,index],[index,b]); }
  }
  return points.filter((_,i)=>keep[i]);
}
const dedupe = (points) => points.filter((p,i)=>i===0 || p[0]!==points[i-1][0] || p[1]!==points[i-1][1]);
const polygons = (geometry) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
const lines = (geometry) => geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
const ringArea = (ring) => { let sum = 0; for (let i = 0; i < ring.length-1; i++) sum += ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1]; return sum/2; };
// Delta-encoded flat list: x0,y0,dx1,dy1,...
const pack = (points) => points.flatMap(([x,y],i)=>i ? [x-points[i-1][0],y-points[i-1][1]] : [x,y]);
const slug = (name) => name.toLowerCase().replaceAll("'",'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function rings(geometry,tolerance,minArea) {
  return polygons(geometry).flatMap((polygon)=>polygon.map((ring)=>dedupe(simplify(ring.map(project),tolerance))))
    .filter((ring)=>ring.length > 3 && Math.abs(ringArea(ring)) >= minArea);
}
function inside(point,ringList) {
  let hit = false;
  for (const ring of ringList) for (let i = 0, j = ring.length-1; i < ring.length; j = i++) {
    const [xi,yi] = ring[i];
    const [xj,yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj-xi)*(point[1]-yi)/(yj-yi)+xi) hit = !hit;
  }
  return hit;
}
// A label point that is always inside the shape: the centre of the widest horizontal run through the middle band.
function labelPoint(ringList) {
  const big = ringList.reduce((a,b)=>Math.abs(ringArea(a)) > Math.abs(ringArea(b)) ? a : b);
  const ys = big.map((p)=>p[1]);
  const [top,bottom] = [Math.min(...ys),Math.max(...ys)];
  let best = null;
  for (let step = 1; step < 12; step++) {
    const y = top+(bottom-top)*step/12+.5;
    const cuts = [];
    for (let i = 0; i < big.length-1; i++) {
      const [x1,y1] = big[i];
      const [x2,y2] = big[i+1];
      if ((y1 > y) !== (y2 > y)) cuts.push(x1+(x2-x1)*(y-y1)/(y2-y1));
    }
    cuts.sort((a,b)=>a-b);
    for (let i = 0; i+1 < cuts.length; i += 2) {
      const width = cuts[i+1]-cuts[i];
      const centred = width*(1-Math.abs(step-6)/14);
      if (!best || centred > best.score) best = { score:centred,point:[Math.round((cuts[i]+cuts[i+1])/2),Math.round(y)] };
    }
  }
  return best.point;
}

const names = { "Kamm's":"Kamm's Corners",'University':'University Circle','Goodrich-Kirtland Pk':'Goodrich-Kirtland Park','St.Clair-Superior':'St. Clair-Superior' };
const areas = [];
for (const feature of JSON.parse(await readFile(cache+'/spa.geojson','utf8')).features) {
  const name = names[feature.properties.SPANM] ?? feature.properties.SPANM;
  areas.push({ id:slug(name),name,region:'Cleveland',rings:rings(feature.geometry,6,40000) });
}
for (const feature of await shapes('cb_2023_39_cousub_500k.zip')) {
  const p = feature.properties;
  if (p.COUNTYFP !== '035' || p.NAME === 'Cleveland' || !p.ALAND) continue;
  const name = p.NAMELSAD.endsWith('township') && p.NAME === 'Olmsted' ? 'Olmsted Township' : p.NAME === 'Mayfield' ? 'Mayfield Village' : p.NAME;
  areas.push({ id:slug(name),name,region:'Cuyahoga County',rings:rings(feature.geometry,6,40000) });
}
if (areas.length !== 91 || new Set(areas.map((a)=>a.id)).size !== 91) throw new Error('Expected 34 neighbourhoods and 57 suburbs, found '+areas.length);
for (const area of areas) {
  area.c = labelPoint(area.rings);
  [area.lng,area.lat] = unproject(area.c).map((v)=>Math.round(v*1e5)/1e5);
}
areas.sort((a,b)=>(a.region==='Cleveland'?0:1)-(b.region==='Cleveland'?0:1) || a.name.localeCompare(b.name));

// Two areas are neighbours when a stretch of one outline runs within 160 m of the other.
const cell = 160;
const owners = new Map();
areas.forEach((area,index)=>{
  for (const ring of area.rings) for (let i = 0; i < ring.length-1; i++) {
    const [x1,y1] = ring[i];
    const [x2,y2] = ring[i+1];
    const steps = Math.max(1,Math.ceil(Math.hypot(x2-x1,y2-y1)/60));
    for (let s = 0; s <= steps; s++) {
      const key = Math.floor((x1+(x2-x1)*s/steps)/cell)+':'+Math.floor((y1+(y2-y1)*s/steps)/cell);
      if (!owners.has(key)) owners.set(key,new Set());
      owners.get(key).add(index);
    }
  }
});
const touching = new Map();
for (const [key,set] of owners) {
  const [cx,cy] = key.split(':').map(Number);
  for (const a of set) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const b of owners.get((cx+dx)+':'+(cy+dy)) ?? []) if (a < b) touching.set(a+':'+b,(touching.get(a+':'+b) ?? 0)+1);
  }
}
const links = [...touching].filter(([,count])=>count >= 12).map(([key])=>key.split(':').map(Number));
for (const area of areas) area.near = [];
for (const [a,b] of links) { areas[a].near.push(areas[b].id); areas[b].near.push(areas[a].id); }
const alone = areas.filter((a)=>!a.near.length).map((a)=>a.name);
if (alone.length) throw new Error('No neighbours found for '+alone.join(', '));

const bounds = areas.flatMap((a)=>a.rings.flat()).reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[1e9,1e9,-1e9,-1e9]);
const pad = 1500;
const box = [bounds[0]-pad,bounds[1]-pad,bounds[2]+pad,bounds[3]+pad];
const within = (points) => points.some(([x,y])=>x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]);

const water = [];
for (const feature of await shapes('tl_2023_39035_areawater.zip')) {
  if (!feature.geometry || feature.properties.AWATER < 30000) continue;
  for (const ring of rings(feature.geometry,8,20000)) water.push(pack(ring));
}
const major = { 1:[],2:[] };
const tiles = new Map();
const tile = 2500;
let local = 0;
for (const feature of await shapes('tl_2023_39035_roads.zip')) {
  const kind = feature.properties.MTFCC;
  const rank = kind === 'S1100' ? 1 : kind === 'S1200' ? 2 : ['S1400','S1630','S1640'].includes(kind) ? 3 : 0;
  if (!rank || !feature.geometry) continue;
  for (const line of lines(feature.geometry)) {
    const points = dedupe(simplify(line.map(project),rank === 3 ? 5 : 4));
    if (points.length < 2 || !within(points)) continue;
    if (rank < 3) { major[rank].push(pack(points)); continue; }
    const mid = points[Math.floor(points.length/2)];
    const key = Math.floor((mid[0]-box[0])/tile)+'_'+Math.floor((mid[1]-box[1])/tile);
    if (!tiles.has(key)) tiles.set(key,[]);
    tiles.get(key).push(pack(points));
    local++;
  }
}

await rm('public/map',{recursive:true,force:true});
await mkdir('public/map/t',{recursive:true});
const base = {
  version:new Date().toISOString().slice(0,10),
  sources:'City of Cleveland open data; US Census Bureau TIGER/Line 2023',
  box,tile,tiles:[...tiles.keys()].sort(),
  areas:areas.map((a)=>({ id:a.id,name:a.name,region:a.region,c:a.c,near:a.near.sort(),rings:a.rings.map(pack) })),
  water,roads:major
};
await writeFile('public/map/base.json',JSON.stringify(base));
for (const [key,list] of tiles) await writeFile('public/map/t/'+key+'.json',JSON.stringify(list));

const quote = (text) => "'"+text.replaceAll("'","''")+"'";
const sql = `-- Generated by tooling/build-map.mjs from City of Cleveland and US Census Bureau open data. Do not edit by hand.
begin;
insert into neighborhood.areas(id,name,region,sort,lat,lng) values
${areas.map((a,i)=>' ('+[quote(a.id),quote(a.name),quote(a.region),i+1,a.lat,a.lng].join(',')+')').join(',\n')}
on conflict (id) do update set name = excluded.name,region = excluded.region,sort = excluded.sort,lat = excluded.lat,lng = excluded.lng;

-- Nearby now means sharing a border, taken from the real outlines.
delete from neighborhood.area_links;
insert into neighborhood.area_links(area_id,nearby_id) values
${areas.flatMap((a)=>a.near.map((b)=>' ('+quote(a.id)+','+quote(b)+')')).join(',\n')};
commit;
`;
await writeFile('supabase/migrations/20261114090000_map_areas.sql',sql);
console.log(areas.length+' areas, '+links.length+' borders, '+water.length+' water shapes, '+major[1].length+' highway and '+major[2].length+' main road lines, '+
  local+' local streets in '+tiles.size+' tiles');
console.log('Old Brooklyn borders: '+areas.find((a)=>a.id==='old-brooklyn').near.join(', '));
