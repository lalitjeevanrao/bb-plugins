import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostEntry } from '../dist/host.js';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../dist/server.js';
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
  for(const provider of ['acp-copilot','acp-gh-copilot','acp-github-copilot-cli']){
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
await test('Unsupported harness never queries identity or billing host',async()=>{const {bb,harness}=createFakePluginHost({pluginId:'copilot-session-credits',sdk:{threads:{get:async()=>makeThreadResponse({providerId:'acp-claude'})}}});plugin(bb);const r=await harness.behavior.callRpc('usage',{threadId:'thr_fixture'});assert.equal(r.provider,'acp-claude');assert.equal(r.aic,null);assert.equal(harness.inspection.sdk.callsTo('threads.events.list').length,0);await harness.lifecycle.dispose();});
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
}finally{rmSync(root,{recursive:true,force:true});}
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;
