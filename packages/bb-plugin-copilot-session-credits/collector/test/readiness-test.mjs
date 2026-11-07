import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadiness, readReadiness } from '../readiness.mjs';
import { initializeCollector } from '../initialize.mjs';
const root=realpathSync(mkdtempSync(join(tmpdir(),'credits-readiness-'))), directory=join(root,'status');
const id='11111111-1111-4111-8111-111111111111', providerSession='pi_'+id;
const ctx={sessionManager:{getSessionId:()=>id,getSessionFile:()=>join(root,providerSession+'.jsonl')},ui:{notify(){}}};
const results=[];const test=(name,run)=>{run();results.push({name,status:'passed'});};
try {
 test('Readiness is separate, lazy until exact provider identity and independently session scoped',()=>{
  const state=createReadiness(directory,'1.5.0');assert(!existsSync(directory));
  state.start({...ctx,sessionManager:{...ctx.sessionManager,getSessionFile:()=>'/tmp/standalone.jsonl'}});assert(!existsSync(directory));
  state.start(ctx);assert.equal(readReadiness(directory,providerSession).state,'ready');assert.equal(readReadiness(directory,'pi_22222222-2222-4222-8222-222222222222').state,'unconfirmed');
  assert(!existsSync(join(root,'receipts')));state.update('disabled');assert.equal(readReadiness(directory,providerSession).state,'disabled');state.update('ready');assert.equal(readReadiness(directory,providerSession).state,'ready');state.stop();assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');
 });
 test('Old instance shutdown cannot remove replacement file; ambiguous live instances are unconfirmed',()=>{
  const old=createReadiness(directory,'1.5.0'), next=createReadiness(directory,'1.5.0');old.start(ctx);next.start(ctx);assert.equal(readdirSync(join(directory,providerSession)).length,2);assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');old.stop();assert.equal(readReadiness(directory,providerSession).state,'ready');assert.equal(readdirSync(join(directory,providerSession)).length,1);next.stop();
 });
 test('Dead, malformed, oversized, wrong-identity and unsafe markers never confirm capture',()=>{
  const marker=createReadiness(directory,'1.5.0');marker.start(ctx);const dir=join(directory,providerSession),file=join(dir,readdirSync(dir)[0]),original=readFileSync(file);
  const dead=spawnSync(process.execPath,['-e','']);assert.equal(dead.status,0);
  for(const patch of [{pid:dead.pid},{providerSession:'pi_22222222-2222-4222-8222-222222222222'},{state:'invented'}]){writeFileSync(file,JSON.stringify({...JSON.parse(original),...patch}));assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');}
  for(const text of ['invalid JSON','x'.repeat(2049)]){writeFileSync(file,text);assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');}
  writeFileSync(file,original);chmodSync(file,0o644);assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');chmodSync(file,0o600);
  rmSync(file);const target=join(root,'target');writeFileSync(target,original,{mode:0o600});symlinkSync(target,file);assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');marker.stop();assert.equal(readFileSync(target).toString(),original.toString());rmSync(file);
  chmodSync(directory,0o755);assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');chmodSync(directory,0o700);
 });
 test('Supported init/off/on and unsupported/error leave exact-session diagnostics without receipts',()=>{
  for(const kind of ['ready','unsupported','error']){
   const hooks=new Map(),commands=new Map();const pi={on:(name,handler)=>{const list=hooks.get(name)??[];list.push(handler);hooks.set(name,list);},registerCommand:(name,command)=>commands.set(name,command),registerProvider(){}};
   const receipts=join(root,'receipts-'+kind);
   initializeCollector(pi,{version:kind==='unsupported'?'0.84.4':'1.5.0',directory:receipts,statusDirectory:directory,builtinProviders:()=>{if(kind==='error')throw Error('synthetic lookup failure');return[{id:'github-copilot',stream(){throw Error('must not call');},streamSimple(){throw Error('must not call');}}];}});
   for(const handler of hooks.get('session_start'))handler({reason:'startup'},ctx);assert.equal(readReadiness(directory,providerSession).state,kind);assert(!existsSync(receipts));
   if(kind==='ready'){commands.get('copilot-probe').handler('off',ctx);assert.equal(readReadiness(directory,providerSession).state,'disabled');commands.get('copilot-probe').handler('on',ctx);assert.equal(readReadiness(directory,providerSession).state,'ready');}
   for(const handler of hooks.get('session_shutdown'))handler({reason:'quit'},ctx);assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');
  }
 });
 test('Bounded candidates and directory symlinks remain unconfirmed',()=>{
  const markers=Array.from({length:9},()=>createReadiness(directory,'1.5.0'));for(const marker of markers)marker.start(ctx);assert.equal(readReadiness(directory,providerSession).state,'unconfirmed');for(const marker of markers)marker.stop();
  const alias=join(root,'status-alias');symlinkSync(directory,alias);assert.equal(readReadiness(alias,providerSession).state,'unconfirmed');
 });
 test('New and explicit legacy status roots are checked together without hiding live ambiguity',()=>{
  const current=join(root,'copilot-session-credits-status'),legacy=join(root,'session-credits-status'); // Read-only pre-0.3 compatibility fixture.
  const old=createReadiness(legacy,'1.5.0');old.start(ctx);assert.equal(readReadiness([current,legacy],providerSession).state,'ready');
  const next=createReadiness(current,'1.5.0');next.start(ctx);assert.equal(readReadiness([current,legacy],providerSession).state,'unconfirmed');old.stop();assert.equal(readReadiness([current,legacy],providerSession).state,'ready');next.stop();
 });
 test('Throwing hook or provider registration stays fail-open with no receipts',()=>{
  for(const hookFailure of [true,false]){
   const directory=join(root,'failed-registration');let diagnostics=0;
   const pi={on(){if(hookFailure)throw Error('hook failed');diagnostics++;},registerCommand(){diagnostics++;},registerProvider(){throw Error('registration failed');}};
   assert.doesNotThrow(()=>initializeCollector(pi,{builtinProviders:()=>[{id:'github-copilot',stream(){},streamSimple(){}}],version:'1.5.0',directory,statusDirectory:join(root,'failed-status')}));assert(diagnostics>0);assert(!existsSync(directory));
  }
 });
 console.log(JSON.stringify(results,null,2));
} finally {rmSync(root,{recursive:true,force:true});}
