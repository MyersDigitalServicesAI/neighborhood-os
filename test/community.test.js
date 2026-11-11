import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, fixtures, rpc, actors } from './db.js';

let db;
let business;
const call = (who,op,data) => rpc(db,actors[who],op,data);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
before(async()=>{ db = await initDatabase(); business = await fixtures(db); });
after(async()=>{ await db?.close(); });

test('marketplace, events, polls, lost and found, and business updates carry their own rules',async()=>{
  await assert.rejects(call('ava','create_post',{kind:'event',title:'Porch concert',body:'Bring a chair.'}),/when the event starts/);
  await assert.rejects(call('ava','create_post',{kind:'poll',title:'One choice',body:'Not enough.',option1:'Only'}),/two choices/);
  await assert.rejects(call('ava','create_post',{kind:'offer',business,title:'Not my shop',body:'Should fail.'}),/own business/);
  await assert.rejects(call('ava','create_post',{kind:'sale',title:'Bad price',body:'Negative.',price:'-4'}));
  const sale = await call('ava','create_post',{kind:'sale',title:'Kids bike',body:'Sixteen inch wheels.',price:'25.50'});
  const market = await call('jamal','feed',{kind:'sale'});
  assert.equal(market.find((x)=>x.id===sale.id).price_cents,2550);
  assert.ok(market.every((x)=>x.kind==='sale'));
  assert.equal((await call('taylor','feed',{kind:'sale'})).length,0);
  await assert.rejects(call('jamal','close_post',{id:sale.id}),/unavailable/);
  await call('ava','close_post',{id:sale.id});
  assert.equal((await call('jamal','post',{id:sale.id})).closed,true);

  const event = (await call('ava','feed',{kind:'event'}))[0];
  await call('ava','rsvp',{id:event.id});
  assert.deepEqual([(await call('ava','post',{id:event.id})).going,(await call('ava','post',{id:event.id})).attending],[1,true]);
  await call('ava','rsvp',{id:event.id});
  assert.equal((await call('ava','post',{id:event.id})).going,0);
  await assert.rejects(call('ava','rsvp',{id:sale.id}),/unavailable/);

  const poll = (await call('ava','feed',{kind:'poll'}))[0];
  const {options} = await call('ava','post',{id:poll.id});
  assert.deepEqual(options.map((o)=>o.label),['Tuesday','Thursday','Saturday afternoon']);
  await call('ava','vote',{id:poll.id,option:options[0].id});
  await call('ava','vote',{id:poll.id,option:options[1].id});
  await call('jamal','vote',{id:poll.id,option:options[1].id});
  const voted = await call('ava','post',{id:poll.id});
  assert.deepEqual(voted.options.map((o)=>o.votes),[0,2,0]);
  assert.equal(voted.vote,options[1].id);
  await assert.rejects(call('taylor','vote',{id:poll.id,option:options[0].id}),/unavailable/);

  const offers = await call('ava','feed',{kind:'offer'});
  assert.equal(offers[0].business,'Juniper Home Repair');
  await call('luis','create_post',{kind:'offer',business,title:'Second update',body:'Still within the weekly allowance.'});
  await assert.rejects(call('luis','create_post',{kind:'offer',business,title:'Third update',body:'Over the allowance.'}),/two updates a week/);
  assert.equal((await call('ava','business',{id:business})).updates.length,2);
});

test('likes, threaded replies and safety alerts create notifications; blocks hide posts',async()=>{
  const post = await call('ava','create_post',{kind:'discussion',title:'Street tree planting',body:'Who wants one on their tree lawn?'});
  await call('jamal','react',{id:post.id});
  await call('jamal','reply',{id:post.id,body:'Count me in for one.'});
  const first = (await call('ava','post',{id:post.id})).replies[0];
  await call('ava','reply',{id:post.id,body:'Great, I will add you.',parent:first.id});
  const nested = (await call('ava','post',{id:post.id})).replies[1];
  await call('jamal','reply',{id:post.id,body:'Thank you.',parent:nested.id});
  const thread = (await call('ava','post',{id:post.id})).replies;
  assert.deepEqual(thread.map((x)=>x.parent_id),[null,first.id,first.id]);
  assert.deepEqual([(await call('ava','post',{id:post.id})).likes,(await call('jamal','post',{id:post.id})).liked],[1,true]);

  const mine = await call('ava','notifications');
  assert.deepEqual(mine.filter((n)=>n.post_id===post.id).map((n)=>n.kind).sort(),['like','reply']);
  assert.ok(mine.some((n)=>n.kind==='alert' && n.actor==='Jamal R.'),'the fixture safety alert reached a neighbor');
  assert.ok(!(await call('taylor','notifications')).some((n)=>n.kind==='alert'),'alerts stay inside the neighborhood');
  assert.ok((await call('ava','bootstrap')).unread >= 3);
  await call('ava','read_notifications');
  assert.equal((await call('ava','bootstrap')).unread,0);
  await call('jamal','react',{id:post.id});
  assert.equal((await call('ava','post',{id:post.id})).likes,0);

  await assert.rejects(call('jamal','delete_reply',{id:nested.id}),/unavailable/);
  await call('ava','delete_reply',{id:nested.id});
  assert.equal((await call('ava','post',{id:post.id})).replies.length,2);
  await assert.rejects(call('jamal','delete_post',{id:post.id}),/unavailable/);

  assert.ok((await call('devon','feed',{})).some((x)=>x.author==='Jamal R.'));
  await call('devon','block',{peer:actors.jamal});
  assert.ok(!(await call('devon','feed',{})).some((x)=>x.author==='Jamal R.'));
  assert.ok(!(await call('devon','search',{q:'trail'})).posts.length);
  await call('devon','unblock',{peer:actors.jamal});
  await call('ava','delete_post',{id:post.id});
  await assert.rejects(call('jamal','post',{id:post.id}),/unavailable/);
});

test('search and profiles stay inside the neighborhood',async()=>{
  const found = await call('ava','search',{q:'juniper'});
  assert.equal(found.businesses[0].name,'Juniper Home Repair');
  assert.equal((await call('ava','search',{q:'bookshelf'})).posts[0].kind,'sale');
  assert.deepEqual((await call('ava','search',{q:'luis'})).neighbors.map((n)=>n.name),['Luis G.']);
  assert.deepEqual(await call('taylor','search',{q:'juniper'}),{posts:[],businesses:[],neighbors:[]});
  await assert.rejects(call('ava','search',{q:'a'}),/two characters/);
  await call('ava','update_profile',{name:'Ava M.',bio:'Gardener on the west side.'});
  const profile = await call('jamal','profile',{id:actors.ava});
  assert.deepEqual([profile.name,profile.bio,profile.verified],['Ava M.','Gardener on the west side.',false]);
  assert.equal((await call('ava','profile',{id:actors.luis})).businesses[0].name,'Juniper Home Repair');
  assert.equal(await call('taylor','profile',{id:actors.ava}),null);
  await assert.rejects(call('ava','update_profile',{name:'A',bio:''}));
});

test('photos are owned, size-limited, and visible only within the neighborhood',async()=>{
  const {id} = await call('ava','upload_image',{mime:'image/png',data:png});
  await assert.rejects(call('ava','upload_image',{mime:'image/svg+xml',data:png}));
  await assert.rejects(call('ava','upload_image',{mime:'image/png',data:'a'.repeat(420000)}),/too large/);
  assert.equal((await call('jamal','image',{id})).data,png);
  assert.equal(await call('taylor','image',{id}),null);
  await assert.rejects(call('jamal','create_post',{kind:'discussion',title:'Borrowed photo',body:'Not mine.',image:id}),/Photo unavailable/);
  const post = await call('ava','create_post',{kind:'lost',title:'Lost house keys',body:'Green lanyard.',image:id});
  assert.equal((await call('jamal','post',{id:post.id})).image_id,id);
});

test('address verification erases the address when the postcard is mailed and the record on success',async()=>{
  const rows = async () => (await db.query('select member_id,address,code,code_hash,status,attempts from neighborhood.residency_checks')).rows;
  await assert.rejects(call('ava','request_residency',{address:'123 Fixture Lane, Cleveland OH 44109'}),/Confirm how/);
  await call('ava','request_residency',{address:'123 Fixture Lane, Cleveland OH 44109',consent:true});
  await assert.rejects(call('ava','request_residency',{address:'456 Other Street, Cleveland OH',consent:true}),/already in progress/);
  assert.equal((await call('ava','bootstrap')).residency,'pending');
  await assert.rejects(call('jamal','moderation'),/Moderator access/);
  const [waiting] = (await call('rina','moderation')).residency;
  assert.deepEqual([waiting.name,waiting.address],['Ava M.','123 Fixture Lane, Cleveland OH 44109']);
  assert.match(waiting.code,/^[0-9A-F]{6}$/);
  await assert.rejects(call('ava','confirm_residency',{code:waiting.code}),/No postcard code/);
  await assert.rejects(call('jamal','decide_residency',{id:actors.ava,action:'mailed'}),/Moderator access/);
  await assert.rejects(db.query("update neighborhood.residency_checks set status='mailed',mailed_at=now(),code_hash='x'"),/check constraint/);
  await call('rina','decide_residency',{id:actors.ava,action:'mailed'});
  const [mailed] = await rows();
  assert.deepEqual([mailed.address,mailed.code,mailed.status],[null,null,'mailed']);
  assert.ok(!mailed.code_hash.includes(waiting.code));
  assert.equal((await call('rina','moderation')).residency.length,0);
  const audit = await db.query("select details::text from neighborhood.audit where action in ('decide_residency','residency_verified')");
  assert.ok(audit.rows.every((row)=>!/Fixture Lane/.test(row.details)));
  assert.equal((await call('ava','confirm_residency',{code:'ZZZZZZ'})).ok,false);
  assert.equal((await rows())[0].attempts,1);
  assert.equal((await call('ava','confirm_residency',{code:' '+waiting.code.toLowerCase()+' '})).ok,true);
  assert.equal((await rows()).length,0);
  assert.equal((await call('jamal','profile',{id:actors.ava})).verified,true);
  assert.ok((await call('ava','bootstrap')).member.verified_at);
  await assert.rejects(call('ava','request_residency',{address:'123 Fixture Lane, Cleveland OH 44109',consent:true}),/already verified/);

  await call('jamal','request_residency',{address:'9 Withdrawn Road, Cleveland OH',consent:true});
  await call('jamal','cancel_residency');
  assert.equal((await rows()).length,0);
  await call('jamal','request_residency',{address:'9 Declined Road, Cleveland OH',consent:true});
  await call('devon','decide_residency',{id:actors.jamal,action:'declined'});
  assert.equal((await rows()).length,0);
  await call('devon','request_residency',{address:'77 Stale Avenue, Cleveland OH',consent:true});
  await db.query("update neighborhood.residency_checks set created_at = now() - interval '46 days'");
  await call('rina','moderation');
  assert.equal((await rows()).length,0,'stale requests and their addresses are purged');
  for (let i = 0; i < 5; i++) {
    if (i === 0) { await call('luis','request_residency',{address:'5 Guessing Court, Cleveland OH',consent:true}); await call('rina','decide_residency',{id:actors.luis,action:'mailed'}); }
    assert.equal((await call('luis','confirm_residency',{code:'000000'})).ok,false);
  }
  assert.match((await call('luis','confirm_residency',{code:'000000'})).message,/Too many/);
  assert.equal((await rows()).length,0);
});

test('directory shows ratings and can filter to vetted businesses; contact changes revoke vetting',async()=>{
  await call('luis','update_business',{id:business,category:'Home services',description:'Small repairs and finish carpentry.',website:'',phone:'216-555-0100',hours:'Mon to Fri, 8 to 5'});
  const profile = await call('ava','business',{id:business});
  assert.deepEqual([profile.phone,profile.hours,profile.owner,profile.review_count,profile.rating],['216-555-0100','Mon to Fri, 8 to 5','Luis G.',0,null]);
  await assert.rejects(call('luis','update_business',{id:business,category:'Home services',description:'Small repairs and finish carpentry.',website:'',phone:'call me maybe'}));
  assert.equal((await call('ava','directory',{vetted:'1'})).length,0);
  await call('ava','submit_review',{id:business,rating:4,body:'They repaired my porch railing quickly and cleanly.',attest:true});
  const [queued] = (await call('rina','moderation')).reviews;
  await call('rina','decide_review',{id:queued.id,action:'published',reason:'Firsthand account with no concerns.'});
  const [listed] = await call('jamal','directory',{q:'carpentry'});
  assert.deepEqual([Number(listed.rating),listed.reviews],[4,1]);
  assert.ok((await call('ava','notifications')).some((n)=>n.kind==='review'));
});

test('new tables and functions are closed to client roles',async()=>{
  for (const statement of ['select * from neighborhood.residency_checks','select * from neighborhood.images','select * from neighborhood.notifications',
    "select neighborhood.dispatch('feed','{}')","select neighborhood.sync_payment('{}')",'select neighborhood.purge_residency()']) {
    await assert.rejects(db.transaction(async(tx)=>{
      await tx.exec('set local role authenticated');
      await tx.query(statement);
    }),/permission denied/,statement);
  }
});
