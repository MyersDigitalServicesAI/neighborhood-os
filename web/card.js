// Makes a square share card (1080×1080 PNG) for a post, for Facebook, Instagram or a group chat. It is drawn in the
// browser, so the post never passes through another service. On phones it opens the share sheet; elsewhere it downloads.
import { qrModules } from './qr.js';

const size = 1080;
const green = '#194633';
const cream = '#f6f5ee';

function wrap(ctx,text,width,maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line+' '+word : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else { lines.push(line); line = word; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines-1];
    while (last && ctx.measureText(last+'…').width > width) last = last.slice(0,-1);
    lines[maxLines-1] = last.trimEnd()+'…';
  }
  return lines;
}
function image(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function drawCard(post,origin) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  await document.fonts?.ready;
  const font = (weight,px) => weight+' '+px+'px "Manrope Variable","DM Sans Variable",system-ui,sans-serif';

  ctx.fillStyle = green;
  ctx.fillRect(0,0,size,size);
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.roundRect(60,60,size-120,size-120,44);
  ctx.fill();

  const logo = await image('/logo-mark.png');
  if (logo) ctx.drawImage(logo,120,118,64,59);
  ctx.fillStyle = green;
  ctx.font = font(800,44);
  ctx.textBaseline = 'middle';
  ctx.fillText('Nabora',200,150);

  ctx.textBaseline = 'alphabetic';
  ctx.font = font(800,30);
  ctx.fillStyle = '#3e7d6a';
  ctx.fillText((post.kind+' · '+post.area).toUpperCase(),120,280);

  // The QR code and link open the post on Nabora.
  const link = origin+'/p/'+post.id;
  const code = qrModules(link);
  const count = code.getModuleCount();
  const box = 230;
  const cell = Math.floor(box/(count+4));
  const qrSize = cell*(count+4);
  const qx = size-120-qrSize;
  const qy = size-120-qrSize;
  ctx.fillStyle = '#fff';
  ctx.fillRect(qx,qy,qrSize,qrSize);
  ctx.fillStyle = '#000';
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (code.isDark(r,c)) ctx.fillRect(qx+(c+2)*cell,qy+(r+2)*cell,cell,cell);

  // Title and details sit above the QR code; anything lower is kept to its left so nothing overlaps.
  const narrow = qx - 120 - 40;
  ctx.fillStyle = '#17251d';
  ctx.font = font(800,72);
  const lines = wrap(ctx,post.title,size-240,3);
  lines.forEach((line,i)=>ctx.fillText(line,120,370+i*86));
  if (post.line) {
    ctx.font = font(650,34);
    ctx.fillStyle = '#4d5d52';
    const top = 370 + lines.length*86 + 4;
    wrap(ctx,post.line,top + 46 > qy ? narrow : size-240,2).forEach((line,i)=>ctx.fillText(line,120,top+i*46));
  }

  ctx.fillStyle = green;
  ctx.font = font(800,40);
  ctx.fillText('See it on Nabora',120,size-200);
  ctx.font = font(600,30);
  ctx.fillStyle = '#4d5d52';
  ctx.fillText('Your Cleveland neighborhood, online.',120,size-155);
  ctx.fillText(origin.replace(/^https?:\/\//,''),120,size-115);
  return canvas;
}

export async function shareCard(post,origin) {
  const canvas = await drawCard(post,origin);
  const blob = await new Promise((resolve)=>canvas.toBlob(resolve,'image/png'));
  const name = 'nabora-'+String(post.title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'.png';
  const file = new File([blob],name,{ type:'image/png' });
  const link = origin+'/p/'+post.id;
  if (navigator.canShare?.({ files:[file] })) {
    await navigator.share({ files:[file], title:post.title, text:post.title+' · '+link });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'),{ href:url, download:name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  return 'downloaded';
}
