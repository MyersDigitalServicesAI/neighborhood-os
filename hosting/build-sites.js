import { readFile, readdir, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { build } from 'vite';

const mime = {
  html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',
  svg:'image/svg+xml',woff2:'font/woff2',png:'image/png',webmanifest:'application/manifest+json',json:'application/json'
};
await build();
const assets = {};
for (const path of await readdir('dist',{recursive:true})) {
  const type = mime[path.split('.').at(-1)];
  if (type) assets['/'+path] = [type,(await readFile('dist/'+path)).toString('base64')];
}
await writeFile('dist/site-assets.mjs','export default '+JSON.stringify(assets)+';');
await build({configFile:false,publicDir:false,build:{target:'es2022',outDir:'dist/server',emptyOutDir:false,
  lib:{entry:'hosting/sites.js',formats:['es'],fileName:()=> 'index.js'}}});
for (const name of ['assets','index.html','mark.svg','icon-192.png','icon-512.png','manifest.webmanifest','map','site-assets.mjs']) await rm('dist/'+name,{recursive:true,force:true});
await mkdir('dist/.openai',{recursive:true});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
