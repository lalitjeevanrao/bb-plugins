import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostEntry, ReceiptCache } from '../dist/host.js';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../dist/server.js';
import { createProbe } from '../collector/probe.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(),'meter-test-'))), pi=join(root,'pi'),cli=join(root,'cli');
mkdirSync(pi,{mode:0o700});mkdirSync(cli,{mode:0o700});
const uuid='11111111-1111-4111-8111-111111111111', providerId='pi_'+uuid, callId='22222222-2222-4222-8222-222222222222', epoch='33333333-3333-4333-8333-333333333333';
const results=[];
async function test(name,f){try{await f();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',message:e.message});}}
const rows=[
 {kind:'capture_started'}, {kind:'call_started',callId}, {kind:'observation',callId,billing:[{nanoAiu:'1234567890'}]}, {kind:'call_finished',callId,outcome:'stop'}
].map((r,i)=>({schema:3,seq:i+1,epoch,providerSession:providerId,nativeSessionHash:'a'.repeat(64),at:'2026-11-05T00:00:00Z',...r}));
const file=join(pi,epoch+'.jsonl');
const save=rows=>writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
const read=async(provider,sessionId)=>{const h=experimental_createHostEntryHarness(createHostEntry([pi],cli));try{return await h.experimental_call('read',{provider,sessionId});}finally{await h.experimental_dispose();}};
try {
await test('Host matches exact Pi provider identity and sums completed receipt only',async()=>{save(rows);assert.equal((await read('pi',providerId)).aic,'1.23456789');assert.equal((await read('pi','pi_44444444-4444-4444-8444-444444444444')).aic,null);});
await test('Legacy and new receipt roots are both read without changing existing evidence',async()=>{
  const current=join(root,'copilot-session-credits'),legacy=join(root,'session-credits'); // Explicit pre-0.3 compatibility fixture.
  for(const dir of [current,legacy])mkdirSync(dir,{mode:0o700});
  const previous=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
  writeFileSync(join(legacy,epoch+'.jsonl'),previous,{mode:0o600});
  const nextEpoch='77777777-7777-4777-8777-777777777777',nextCall='88888888-8888-4888-8888-888888888888';
  const next=rows.map(row=>({...row,epoch:nextEpoch,...row.callId?{callId:nextCall}:{},...row.billing?{billing:[{nanoAiu:'2000000000'}]}:{}}));
  writeFileSync(join(current,nextEpoch+'.jsonl'),next.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});
  const readRoots=async roots=>{const host=experimental_createHostEntryHarness(createHostEntry(roots,cli));try{return await host.experimental_call('read',{provider:'pi',sessionId:providerId});}finally{await host.experimental_dispose();}};
  assert.equal((await readRoots([legacy])).aic,'1.23456789');assert.equal((await readRoots([current])).aic,'2');assert.equal((await readRoots([current,legacy])).aic,'3.23456789');
  assert.equal((await import('node:fs')).readFileSync(join(legacy,epoch+'.jsonl'),'utf8'),previous);
});
await test('Sequence damage, symlink and mixed native identities fail closed',async()=>{save(rows.map((r,i)=>i===2?{...r,seq:99}:r));assert.equal((await read('pi',providerId)).aic,null);rmSync(file);const target=join(root,'target');writeFileSync(target,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');symlinkSync(target,file);assert.equal((await read('pi',providerId)).aic,null);rmSync(file);save(rows);const other='55555555-5555-4555-8555-555555555555';writeFileSync(join(pi,other+'.jsonl'),rows.map(r=>JSON.stringify({...r,epoch:other,nativeSessionHash:'b'.repeat(64)})).join('\n')+'\n',{mode:0o600});assert.equal((await read('pi',providerId)).aic,null);rmSync(join(pi,other+'.jsonl'));});
await test('CLI latest cumulative checkpoint replaces prior and honors partial coverage',async()=>{mkdirSync(join(cli,uuid),{mode:0o700});writeFileSync(join(cli,uuid,'events.jsonl'),[{type:'user.message',data:{content:'PRIVATE_CANARY'}},{type:'session.usage_checkpoint',data:{totalNanoAiu:'1000000000'}},{type:'session.usage_checkpoint',data:{totalNanoAiu:'2000000000',accountingSnapshot:{aiCreditsStatus:'partial'}}}].map(r=>JSON.stringify(r)).join('\n')+'\n');const r=await read('copilot',uuid);assert.equal(r.aic,'2');assert.equal(r.coverage,'partial');assert(!JSON.stringify(r).includes('PRIVATE_CANARY'));});
await test('Host RPC rejects traversal and provider/session mismatch',async()=>{const h=experimental_createHostEntryHarness(createHostEntry([pi],cli));await assert.rejects(h.experimental_call('read',{provider:'pi',sessionId:'../../other'}));await h.experimental_dispose();assert.equal((await read('copilot',providerId)).aic,null);});
await test('CLI provider aliases route exact latest identity to environment host and real checkpoint reader',async()=>{
  const other='99999999-9999-4999-8999-999999999999';
  mkdirSync(join(cli,other),{mode:0o700});
  writeFileSync(join(cli,other,'events.jsonl'),JSON.stringify({type:'session.usage_checkpoint',data:{totalNanoAiu:'99000000000'}})+'\n');
  for(const provider of ['acp-copilot','acp-gh-copilot','acp-github-copilot-cli','acp-copilot-quiet','acp-copilot-fm']){
    const host=experimental_createHostEntryHarness(createHostEntry([pi],cli));
    const calls=[];
    const {bb,harness}=createFakePluginHost({pluginId:'copilot-session-credits',sdk:{threads:{
      get:async()=>({...makeThreadResponse({providerId:provider}),environment:{hostId:'host_cli_fixture'}}),
      events:{list:async()=>[
        {type:'thread/identity',seq:8,data:{providerThreadId:uuid}},
        {type:'thread/identity',seq:7,data:{providerThreadId:other}}
      ]}
    }},experimental_callHostRpc:async args=>{
      calls.push(args);
      assert.equal(args.hostId,'host_cli_fixture');
      assert.equal(args.method,'read');
      assert.deepEqual(args.input,{provider:'copilot',sessionId:uuid});
      return host.experimental_call(args.method,args.input);
    }});
    try{
      plugin(bb);
      const r=await harness.behavior.callRpc('usage',{threadId:'thr_cli_fixture'});
      assert.equal(calls.length,1);
      assert.equal(r.provider,provider);assert.equal(r.sessionId,uuid);
      assert.equal(r.aic,'2');assert.equal(r.source,'copilot-checkpoint');assert.equal(r.coverage,'partial');
      assert(!JSON.stringify(r).includes('PRIVATE_CANARY'));
      const query=harness.inspection.sdk.callsTo('threads.events.list')[0];
      assert(query);
    }finally{await harness.lifecycle.dispose();await host.experimental_dispose();}
  }
});
await test('Server routes identity-only request to exact environment host',async()=>{let target;const {bb,harness}=createFakePluginHost({pluginId:'copilot-session-credits',sdk:{threads:{get:async()=>({...makeThreadResponse({providerId:'pi'}),environment:{hostId:'host_fixture'}}),events:{list:async()=>[{type:'thread/identity',seq:7,data:{providerThreadId:providerId}}]}}},experimental_callHostRpc:async args=>{target=args;return {aic:'1',coverage:'partial',source:'pi-receipts',reported:1,observed:1,inFlight:0,conflicting:0,missing:0,updatedAt:null,reason:'fixture'};}});plugin(bb);const r=await harness.behavior.callRpc('usage',{threadId:'thr_fixture'});assert.equal(r.aic,'1');assert.equal(target.hostId,'host_fixture');assert.equal(target.input.sessionId,providerId);const events=harness.inspection.sdk.callsTo('threads.events.list')[0];assert(events);await harness.lifecycle.dispose();});
await test('Identity pending Pi remains read-only and gives setup context before any call',async()=>{
  let calls=0;
  const {bb,harness}=createFakePluginHost({pluginId:'copilot-session-credits',sdk:{threads:{get:async()=>({...makeThreadResponse({providerId:'pi'}),environment:{hostId:'host_fixture'}}),events:{list:async()=>[]}}},experimental_callHostRpc:async()=>{calls++;throw Error('must not read without identity');}});plugin(bb);
  const result=await harness.behavior.callRpc('usage',{threadId:'thr_pending'});assert.equal(result.provider,'pi');assert.equal(result.sessionId,null);assert.match(result.reason,/identity/);assert.equal(calls,0);await harness.lifecycle.dispose();
});
await test('Collector full reason preserves old subtotal and never recommends reload',async()=>{save(rows);for(let i=0;i<255;i++)writeFileSync(join(pi,'closed-'+i),'');try{const r=await read('pi',providerId);assert.equal(r.aic,'1.23456789');assert.equal(r.captureIssue,true);assert.match(r.reason,/Collector full/);assert(!r.reason.includes('reload'));assert(r.reason.length<=300);}finally{for(let i=0;i<255;i++)rmSync(join(pi,'closed-'+i));}});
await test('Busy and old allocation locks have explicit safe reasons without removing evidence',async()=>{const lock=join(pi,'.capture-lock');mkdirSync(lock,{mode:0o700});try{assert.match((await read('pi',providerId)).reason,/allocation is busy/);const past=new Date(Date.now()-120000);utimesSync(lock,past,past);const r=await read('pi',providerId);assert.match(r.reason,/over 60 seconds old/);assert.equal(r.captureIssue,true);assert(!r.reason.includes('reload'));assert(r.reason.length<=300);}finally{rmSync(lock,{recursive:true});}});
await test('Unsupported harnesses never query identity or billing host',async()=>{
  for(const provider of ['acp-claude','acp','acp-copilot-other','acp-gh-copilot-other','acp-copilot-quiet-other']){
    let calls=0;
    const {bb,harness}=createFakePluginHost({pluginId:'copilot-session-credits',sdk:{threads:{get:async()=>makeThreadResponse({providerId:provider})}},experimental_callHostRpc:async()=>{calls++;throw Error('Unsupported provider must not read host');}});
    try{
      plugin(bb);const r=await harness.behavior.callRpc('usage',{threadId:'thr_fixture'});
      assert.equal(r.provider,provider);assert.equal(r.aic,null);
      assert.equal(harness.inspection.sdk.callsTo('threads.events.list').length,0);assert.equal(calls,0);
    }finally{await harness.lifecycle.dispose();}
  }
});
await test('Truncation and stopped unfinished calls expose recording gaps independently of coverage',async()=>{for(const extra of [{kind:'capture_truncated'},{kind:'capture_stopped',inFlight:1}]){save([...rows,{...rows[0],seq:5,...extra}]);const r=await read('pi',providerId);assert.equal(r.aic,'1.23456789');assert.equal(r.captureIssue,true);assert.equal(r.coverage,'partial');}save(rows);assert.equal((await read('pi',providerId)).captureIssue,false);});
await test('Combined full, stale lock and damaged receipts preserve subtotal and bounded diagnostics',async()=>{
  save(rows);
  const lock=join(pi,'.capture-lock'), bad=join(pi,'66666666-6666-4666-8666-666666666666.jsonl');
  for(let i=0;i<254;i++)writeFileSync(join(pi,'combined-'+i),'');
  writeFileSync(bad,'invalid JSON\n',{mode:0o600});mkdirSync(lock,{mode:0o700});
  const past=new Date(Date.now()-120000);utimesSync(lock,past,past);
  try{
    const r=await read('pi',providerId);
    assert.equal(r.aic,'1.23456789');assert(r.captureIssue);assert(r.reason.length<=300);
    assert.deepEqual(new Set(r.issues),new Set(['collector-full','stale-lock','capture-damaged']));
    assert.match(r.reason,/unreadable|invalid|incomplete/);
    assert(!r.reason.includes('prune'));
  }finally{rmSync(lock,{recursive:true});rmSync(bad);for(let i=0;i<254;i++)rmSync(join(pi,'combined-'+i));}
});
await test('Pi receipt permissions fail closed without imposing private modes on native CLI logs',async()=>{
  save(rows);
  try{
    chmodSync(pi,0o777);let r=await read('pi',providerId);assert.equal(r.aic,null);assert(r.captureIssue);
    chmodSync(pi,0o700);chmodSync(file,0o666);r=await read('pi',providerId);assert.equal(r.aic,null);assert(r.captureIssue);
    chmodSync(file,0o600);assert.equal((await read('pi',providerId)).aic,'1.23456789');
    chmodSync(cli,0o755);chmodSync(join(cli,uuid),0o755);chmodSync(join(cli,uuid,'events.jsonl'),0o644);
    assert.equal((await read('copilot',uuid)).aic,'2');
  }finally{chmodSync(pi,0o700);chmodSync(file,0o600);}
});
await test('Edited Pi thread merges pi_ and thr_ sessions, recovers null-session receipts by bridge header, and server sends identity history',async()=>{
  const dir=join(root,'edit-receipts'),bridge=join(root,'bridge'),status=join(root,'edit-status');mkdirSync(dir,{mode:0o700});mkdirSync(bridge,{mode:0o700});
  const forked='thr_editfixture',nativeId='01a10000-0000-7000-8000-00000000f0f0',{createHash}=await import('node:crypto');
  const forkHash=createHash('sha256').update('pi-session-v2\0'+nativeId).digest('hex');
  const write=(e,c,session,hash,nano)=>writeFileSync(join(dir,e+'.jsonl'),[{kind:'capture_started'},{kind:'call_started',callId:c},{kind:'observation',callId:c,billing:[{nanoAiu:nano}]},{kind:'call_finished',callId:c,outcome:'stop'}].map((r,i)=>JSON.stringify({schema:3,seq:i+1,epoch:e,providerSession:session,nativeSessionHash:hash,at:'2026-11-05T00:00:00Z',...r})).join('\n')+'\n',{mode:0o600});
  write('a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',providerId,'a'.repeat(64),'2000000000');
  write('a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',null,forkHash,'3000000000'); // pre-fix collector
  write('a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',forked,'c'.repeat(64),'4000000000'); // fixed collector, later re-fork
  write('a0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000004',null,'d'.repeat(64),'9000000000'); // unrelated null session
  writeFileSync(join(bridge,forked+'.jsonl'),JSON.stringify({type:'session',version:3,id:nativeId,parentSession:'/fixture/'+providerId+'.jsonl'})+'\n'+JSON.stringify({type:'message',content:'PRIVATE_CANARY'})+'\n');
  const host=experimental_createHostEntryHarness(createHostEntry([dir],cli,status,bridge));
  try{
    assert.equal((await host.experimental_call('read',{provider:'pi',sessionId:forked})).aic,'7');
    assert.equal((await host.experimental_call('read',{provider:'pi',sessionId:providerId})).aic,'2');
    const calls=[];
    const {bb,harness}=createFakePluginHost({pluginId:'copilot-session-credits',sdk:{threads:{get:async()=>({...makeThreadResponse({providerId:'pi'}),environment:{hostId:'host_fixture'}}),events:{list:async q=>{assert.equal(q.limit,'100');return [{type:'thread/identity',seq:2376,data:{providerThreadId:forked}},{type:'thread/identity',seq:2121,data:{providerThreadId:providerId}},{type:'thread/identity',seq:12,data:{providerThreadId:providerId}}];}}}},experimental_callHostRpc:async args=>{calls.push(args.input);return host.experimental_call(args.method,args.input);}});
    try{
      plugin(bb);const r=await harness.behavior.callRpc('usage',{threadId:'thr_editfixture'});
      assert.deepEqual(calls[0],{provider:'pi',sessionId:forked,sessionIds:[providerId,forked]});
      assert.equal(r.sessionId,forked);assert.equal(r.aic,'9');assert.equal(r.reported,3);assert(!JSON.stringify(r).includes('PRIVATE_CANARY'));
    }finally{await harness.lifecycle.dispose();}
  }finally{await host.experimental_dispose();}
});

const receiptRows=(e,c,session,hash,nano)=>[{kind:'capture_started',missedCalls:0},{kind:'call_started',callId:c},{kind:'observation',callId:c,billing:[{nanoAiu:nano}]},{kind:'call_finished',callId:c,outcome:'stop'},{kind:'capture_stopped',inFlight:0,dropped:0}].map((r,i)=>JSON.stringify({schema:3,seq:i+1,epoch:e,providerSession:session,nativeSessionHash:hash,at:'2026-11-05T00:00:00Z',...r})).join('\n')+'\n';
const closed=(dir,session,hash,nano,ageDays=1)=>{const e=globalThis.crypto.randomUUID(),path=join(dir,e+'.jsonl');writeFileSync(path,receiptRows(e,globalThis.crypto.randomUUID(),session,hash,nano),{mode:0o600});const t=new Date(Date.now()-ageDays*86400000);utimesSync(path,t,t);return {name:e+'.jsonl',path};};
await test('Archived receipts keep session totals; automatic maintenance clears collector-full without double counting',async()=>{
  const dir=join(root,'auto-archive'),bridge=join(root,'auto-archive-bridge');mkdirSync(dir,{mode:0o700});mkdirSync(bridge,{mode:0o700});
  const forked='thr_archfixture',nativeId='02b20000-0000-7000-8000-00000000f0f0',{createHash}=await import('node:crypto'),fs=await import('node:fs');
  const forkHash=createHash('sha256').update('pi-session-v2\0'+nativeId).digest('hex');
  writeFileSync(join(bridge,forked+'.jsonl'),JSON.stringify({type:'session',version:3,id:nativeId})+'\n');
  const ours=[closed(dir,providerId,'a'.repeat(64),'2000000000',300),closed(dir,forked,'c'.repeat(64),'3000000000',299),closed(dir,null,forkHash,'4000000000',298)];
  for(let i=0;i<253;i++)closed(dir,'pi_44444444-4444-4444-8444-444444444444','e'.repeat(64),'1',100-i/10);
  const read=async()=>{const host=experimental_createHostEntryHarness(createHostEntry([dir],cli,join(root,'none'),bridge));try{return await host.experimental_call('read',{provider:'pi',sessionId:forked,sessionIds:[providerId,forked]});}finally{await host.experimental_dispose();}};
  const before=await read();
  assert.equal(before.aic,'9');assert(before.issues.includes('collector-full'));
  const hooks=new Map();let wrapped,calls=0;const invoke=()=>{calls++;return {result:()=>Promise.resolve({stopReason:'stop'})};};
  createProbe({directory:dir,autoStart:true,provider:{id:'github-copilot',stream:invoke,streamSimple:invoke}})({on:(n,r)=>hooks.set(n,r),registerCommand(){},registerProvider:v=>{wrapped=v;}});
  hooks.get('session_start')({reason:'startup'},{sessionManager:{getSessionId:()=>'ffffffff-ffff-4fff-8fff-ffffffffffff',getSessionFile:()=>null}});
  await wrapped.streamSimple({provider:'github-copilot',api:'anthropic-messages',id:'fixture'},{},{}).result();
  assert.equal(calls,1);assert(ours.every(file=>!fs.existsSync(file.path)));
  assert(fs.existsSync(join(dir+'-archive',providerId,ours[0].name)));assert(fs.existsSync(join(dir+'-archive',forked,ours[1].name)));assert(fs.existsSync(join(dir+'-archive','h_'+forkHash,ours[2].name)));
  const after=await read();
  assert.equal(after.aic,'9');assert.equal(after.reported,before.reported);assert.deepEqual(after.issues,[]);assert.equal(after.captureIssue,false);
  // A copy left in the capture root (same name, other inode) is counted once.
  fs.copyFileSync(join(dir+'-archive',providerId,ours[0].name),ours[0].path);fs.chmodSync(ours[0].path,0o600);
  assert.equal((await read()).aic,'9');
});
await test('Archive shard reads are bounded and limited to the requested sessions',async()=>{
  const dir=join(root,'shards'),archive=dir+'-archive';mkdirSync(dir,{mode:0o700});mkdirSync(archive,{mode:0o700});
  const mine=join(archive,providerId),other=join(archive,'pi_55555555-5555-4555-8555-555555555555');mkdirSync(mine,{mode:0o700});mkdirSync(other,{mode:0o777});chmodSync(other,0o777);
  closed(mine,providerId,'a'.repeat(64),'1000000000');writeFileSync(join(other,'bad.jsonl'),'x');
  const read=async()=>{const host=experimental_createHostEntryHarness(createHostEntry([dir],cli,join(root,'none'),null));try{return await host.experimental_call('read',{provider:'pi',sessionId:providerId});}finally{await host.experimental_dispose();}};
  let r=await read();assert.equal(r.aic,'1');assert.equal(r.captureIssue,false,'unrelated unsafe shard is never opened');
  for(let i=0;i<4096;i++)writeFileSync(join(mine,'filler-'+i),'');
  r=await read();assert.equal(r.captureIssue,true);assert(r.issues.includes('capture-damaged'));
});

await test('Host cache: unchanged receipts are not read again; changed ones are',async()=>{
  const {createRequire}=await import('node:module'),require=createRequire(import.meta.url),fsp=require('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module'),fs=await import('node:fs');
  const dir=join(root,'cache'),archive=dir+'-archive',shard=join(archive,providerId);mkdirSync(dir,{mode:0o700});mkdirSync(archive,{mode:0o700});mkdirSync(shard,{mode:0o700});
  const a=closed(shard,providerId,'a'.repeat(64),'1000000000'),b=closed(dir,providerId,'a'.repeat(64),'2000000000');
  const host=experimental_createHostEntryHarness(createHostEntry([dir],cli,join(root,'none'),null));
  const opened=[],original=fsp.open;fsp.open=(path,...rest)=>{opened.push(String(path));return original(path,...rest);};syncBuiltinESMExports();
  let n=0;const read=async()=>host.experimental_call('read',{provider:'pi',sessionId:providerId,sessionIds:['thr_cachebust'+(n++)]});
  try{
    assert.equal((await read()).aic,'3');assert.equal(opened.filter(p=>p.endsWith('.jsonl')).length,4,'head and full read of each receipt');
    opened.length=0;assert.equal((await read()).aic,'3');assert.deepEqual(opened.filter(p=>p.endsWith('.jsonl')),[],'cached receipts cost an lstat only');
    // A receipt that changes (a live capture finishing another call) is read again.
    const rows=fs.readFileSync(b.path,'utf8').trim().split('\n').map(JSON.parse),last=rows.at(-1),c='99999999-9999-4999-8999-999999999999';
    rows.pop();for(const row of [{kind:'call_started',callId:c},{kind:'observation',callId:c,billing:[{nanoAiu:'4000000000'}]},{kind:'call_finished',callId:c,outcome:'stop'},{kind:'capture_stopped'}])rows.push({...last,...row,seq:rows.length+1});
    fs.writeFileSync(b.path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
    opened.length=0;assert.equal((await read()).aic,'7');assert(opened.some(p=>p===b.path));assert(!opened.includes(a.path));
  }finally{fsp.open=original;syncBuiltinESMExports();await host.experimental_dispose();}
});
await test('Host cache: a thread over the per-refresh read budget converges to the full total',async()=>{
  const dir=join(root,'budget'),archive=dir+'-archive',shard=join(archive,providerId);mkdirSync(dir,{mode:0o700});mkdirSync(archive,{mode:0o700});mkdirSync(shard,{mode:0o700});
  const pad='x'.repeat(250000);
  for(let i=0;i<16;i++){const e=globalThis.crypto.randomUUID(),c=globalThis.crypto.randomUUID();writeFileSync(join(shard,e+'.jsonl'),[{kind:'capture_started'},{kind:'call_started',callId:c,pad},{kind:'observation',callId:c,billing:[{nanoAiu:'1000000000'}],pad},{kind:'call_finished',callId:c,outcome:'stop',pad},{kind:'capture_stopped'}].map((r,i)=>JSON.stringify({schema:3,seq:i+1,epoch:e,providerSession:providerId,nativeSessionHash:'a'.repeat(64),at:'2026-11-05T00:00:00Z',...r})).join('\n')+'\n',{mode:0o600});}
  const host=experimental_createHostEntryHarness(createHostEntry([dir],cli,join(root,'none'),null));
  let n=0;const read=async()=>host.experimental_call('read',{provider:'pi',sessionId:providerId,sessionIds:['thr_budget'+(n++)]});
  try{
    const first=await read();assert.equal(first.captureIssue,true,'over budget on a cold read');assert(first.issues.includes('capture-damaged'));
    let r=first;for(let i=0;i<4&&r.captureIssue;i++)r=await read();
    assert.equal(r.captureIssue,false);assert.equal(r.aic,'16');
  }finally{await host.experimental_dispose();}
});
await test('Receipt cache evicts least recently used entries by source bytes and drops changed entries',()=>{
  const cache=new ReceiptCache(10),entry=(key,bytes)=>({key,bytes,first:null});
  cache.set('a',entry('1',4));cache.set('b',entry('1',4));assert(cache.get('a','1'));cache.set('c',entry('1',4));
  assert.equal(cache.size,8);assert.equal(cache.get('b','1'),undefined,'least recently used goes first');assert(cache.get('a','1'));assert(cache.get('c','1'));
  assert.equal(cache.get('a','2'),undefined,'changed file');assert.equal(cache.get('a','1'),undefined);assert.equal(cache.size,4);
  cache.set('huge',entry('1',11));assert.equal(cache.get('huge','1'),undefined);assert.equal(cache.size,4);
});
}finally{rmSync(root,{recursive:true,force:true});}
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;
