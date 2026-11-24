import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treesPage, treeGroups, treesChecked } from '../server/trees-page.js';
import { makeHandler } from '../server/handler.js';

test('the holiday tree page lists every lot and farm with directions, says when it was checked, and is cacheable',async()=>{
  const html = treesPage('https://nabora.us');
  assert.match(html,/<title>Where to get a Christmas tree in Cleveland · Nabora<\/title>/);
  for (const [,,,list] of treeGroups) for (const t of list) assert.ok(html.includes(t.name.replace(/&/g,'&amp;')),t.name);
  assert.match(html,/"@type":"LocalBusiness"/);
  assert.ok(html.includes('Checked '+treesChecked));
  assert.match(html,/tel:2167389456/);
  assert.match(html,/Know a scout or church tree lot\?/);
  assert.doesNotMatch(html,/<script>(?!.*ld\+json)/);
  const res = { headers:{},setHeader(k,v){ this.headers[k]=v; },end(v){ this.body = v; } };
  await makeHandler({ env:{ APP_ORIGIN:'https://nabora.us' },billing:{ enabled:false },database:{ configured:true } })(
    { method:'GET',url:'/api/core?action=trees-page',headers:{},async *[Symbol.asyncIterator](){} },res);
  assert.equal(res.statusCode,200);
  assert.match(res.headers['Content-Type'],/text\/html/);
  assert.match(res.headers['Cache-Control'],/public/);
  assert.match(res.body,/<link rel="canonical" href="https:\/\/nabora.us\/trees">/);
});
