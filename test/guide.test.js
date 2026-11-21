import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
const call = (who,op,data) => rpc(db,actors[who] ?? who,op,data);

before(async()=>{
  db = await initDatabase();
  await fixtures(db);
});
after(async()=>{ await db?.close(); });

test('every Cleveland neighborhood has a sourced guide covering civic life, places and help',async()=>{
  const { rows } = await db.query(`select a.id,count(g.id)::int n,count(distinct g.section)::int sections,
      count(*) filter (where g.kind = 'ward')::int wards,count(*) filter (where g.kind = 'police')::int police
    from neighborhood.areas a left join neighborhood.guide_items g on g.area_id = a.id where a.region = 'Cleveland' group by a.id`);
  assert.equal(rows.length,34);
  for (const r of rows) {
    assert.ok(r.n >= 5,r.id+' has a guide');
    assert.ok(r.sections >= 3,r.id+' covers civic life, places or help');
    assert.ok(r.wards >= 1 && r.police >= 1,r.id+' names its ward and police district');
  }
  assert.equal((await db.query("select count(*)::int n from neighborhood.guide_items where source = ''")).rows[0].n,0,'every item names its source');
});

test('neighbors read any guide; their own neighborhood by default',async()=>{
  const mine = await call('ava','guide');
  assert.equal(mine.area.name,'Old Brooklyn');
  const names = mine.items.map((i)=>i.name);
  assert.ok(names.includes('Ward 4 · Council Member Kris Harsh'));
  assert.ok(names.some((n)=>n.includes('South Brooklyn branch')));
  assert.ok(mine.items.some((i)=>i.section==='help' && i.kind==='pantry'));
  assert.deepEqual([...new Set(mine.items.map((i)=>i.section))],['civic','groups','help','places'],'grouped by section');
  const tremont = await call('taylor','guide',{area:'tremont'});
  assert.equal(tremont.area.name,'Tremont');
  assert.deepEqual((await call('taylor','guide')).items,[],'suburb guides are still empty');
  await assert.rejects(call('ava','guide',{area:'atlantis'}),/Neighborhood unavailable/);
});

test('only admins add, correct and remove guide listings, and every change is audited',async()=>{
  assert.equal((await call('rina','bootstrap')).canEditGuide,true);
  assert.equal((await call('devon','bootstrap')).canEditGuide,false);
  const listing = {area:'old-brooklyn',section:'groups',name:'Pearl Road block club',detail:'Meets the first Tuesday of the month.',url:'https://example.org/club'};
  await assert.rejects(call('devon','save_guide_item',listing),/Only admins/);
  await assert.rejects(call('rina','save_guide_item',{...listing,url:'http://example.org'}),/https/);
  await assert.rejects(call('rina','save_guide_item',{...listing,section:'gossip'}),/Choose a section/);
  const { id } = await call('rina','save_guide_item',listing);
  let item = (await call('ava','guide')).items.find((i)=>i.id===id);
  assert.deepEqual([item.name,item.source,item.kind],['Pearl Road block club','Added by Nabora','custom']);

  await call('rina','save_guide_item',{id,name:'Pearl Road Block Club',detail:'Meets the first Tuesday at 7 p.m.',phone:'(216) 555-0100'});
  item = (await call('ava','guide')).items.find((i)=>i.id===id);
  assert.deepEqual([item.name,item.phone,item.url],['Pearl Road Block Club','(216) 555-0100',null]);
  await call('rina','hide_guide_item',{id});
  assert.equal((await call('ava','guide')).items.some((i)=>i.id===id),false);
  await assert.rejects(call('rina','hide_guide_item',{id}),/unavailable/);
  assert.equal((await db.query("select count(*)::int n from neighborhood.audit where action in ('save_guide_item','hide_guide_item')")).rows[0].n,3);
});
