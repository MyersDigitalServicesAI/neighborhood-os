import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustPage, trustUpdated } from '../server/trust-page.js';
import { makeHandler } from '../server/handler.js';
import { scamRisk } from '../web/views.js';

test('the public trust page explains verification, review rules, the paid badge, the pledge and fraud controls',async()=>{
  const html = trustPage('https://nabora.us');
  for (const id of ['neighbors','reviews','vetting','businesses','fraud','safety']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/never remove a review for being negative/);
  assert.match(html,/paid check/);
  assert.match(html,/16 CFR Part 465/);
  assert.ok(html.includes('Updated '+trustUpdated));
  const res = { headers:{},setHeader(k,v){ this.headers[k]=v; },end(v){ this.body = v; } };
  await makeHandler({ env:{ APP_ORIGIN:'https://nabora.us' },billing:{ enabled:false },database:{ configured:true } })(
    { method:'GET',url:'/api/core?action=trust-page',headers:{},async *[Symbol.asyncIterator](){} },res);
  assert.equal(res.statusCode,200);
  assert.match(res.body,/<link rel="canonical" href="https:\/\/nabora.us\/trust">/);
});

test('messages that ask for gift cards, wires or phone codes trigger the scam warning; ordinary ones do not',()=>{
  assert.equal(scamRisk([{ body:'Can you pay with a gift card? I am out of town.' }]),true);
  assert.equal(scamRisk([{ body:'Just send me the verification code you got.' }]),true);
  assert.equal(scamRisk([{ body:'I can mail a cashier\'s check for more than the price.' }]),true);
  assert.equal(scamRisk([{ body:'Is the bookshelf still available? I can pick it up Saturday.' }]),false);
  assert.equal(scamRisk([{ body:'Thanks for the recommendation!' },{}]),false);
});
