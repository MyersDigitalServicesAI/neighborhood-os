// Draws a QR code as an inline SVG, so no image request and nothing leaves the page.
import qrcode from 'qrcode-generator';

const NS = 'http://www.w3.org/2000/svg';
export function qrModules(text) {
  const code = qrcode(0,'M');
  code.addData(text);
  code.make();
  return code;
}
export function drawQr(root,text,label = 'QR code that opens this check-in') {
  const code = qrcode(0,'M');
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  const quiet = 4;
  let d = '';
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (code.isDark(row,col)) d += 'M'+(col+quiet)+' '+(row+quiet)+'h1v1h-1z';
  }
  const svg = document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox','0 0 '+(size+quiet*2)+' '+(size+quiet*2));
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label',label);
  svg.setAttribute('shape-rendering','crispEdges');
  const ground = document.createElementNS(NS,'rect');
  ground.setAttribute('width','100%');
  ground.setAttribute('height','100%');
  ground.setAttribute('fill','#fff');
  const marks = document.createElementNS(NS,'path');
  marks.setAttribute('d',d);
  marks.setAttribute('fill','#000');
  svg.append(ground,marks);
  root.replaceChildren(svg);
}
