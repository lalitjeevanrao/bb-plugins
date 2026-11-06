// Actual package manager and loader. Git HTTPS is rewritten to a local tagged fixture.
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';
import { piRuntime } from './pi-runtime.mjs';
import { piInstallCommand } from '../setup-copy.mjs';

if (!process.argv.includes('--isolated')) {
  const home=realpathSync(mkdtempSync(join(tmpdir(),'credits package with spaces ')));
  try { execFileSync(process.execPath,[import.meta.filename,'--isolated',...process.argv.slice(2)],{env:{...process.env,HOME:home,PI_CODING_AGENT_DIR:join(home,'custom-agent'),BB_THREAD_ID:''},stdio:'inherit'}); }
  finally {rmSync(home,{recursive:true,force:true});}
} else {
  const root=process.env.HOME,agentDir=process.env.PI_CODING_AGENT_DIR,runtime=piRuntime();
  const {DefaultResourceLoader,SettingsManager}=await import(pathToFileURL(join(runtime.root,'dist/index.js')));
  const {parseGitUrl}=await import(pathToFileURL(join(runtime.root,'dist/utils/git.js')));
  const source=piInstallCommand.slice('pi install '.length),parsed=parseGitUrl(source);
  assert.equal(parsed.ref,'v0.2.2');assert.equal(parsed.host,'github.com');
  const fixture=join(root,'git source'),prefix=join(fixture,'packages/bb-plugin-session-credits');mkdirSync(prefix,{recursive:true});
  copyFileSync(new URL('../../../package.json',import.meta.url),join(fixture,'package.json'));
  cpSync(new URL('../collector',import.meta.url),join(prefix,'collector'),{recursive:true});
  const git=(...args)=>execFileSync('git',['-C',fixture,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(root,'empty-config')}});
  git('init','--quiet');git('add','.');git('-c','user.name=Package test','-c','user.email=test@example.invalid','commit','--quiet','--no-verify','-m','synthetic package fixture');git('tag','v0.2.2');
  const config=join(root,'gitconfig');writeFileSync(config,`[url "${pathToFileURL(fixture).href}"]\n  insteadOf = ${parsed.repo}\n[protocol "https"]\n  allow = never\n[protocol "file"]\n  allow = always\n`);
  const env={...process.env,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',npm_config_offline:'true'};
  const cli=join(runtime.root,'dist/cli.js');assert(existsSync(cli));
  const command=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:root,env,encoding:'utf8'});
  globalThis.fetch=async()=>{throw Error('Network forbidden');};
  command('install',source,'--approve');
  assert(command('list').includes('copilot-session-credits'));
  const settings=SettingsManager.create(root,agentDir);
  const load=async bb=>{
    process.env.BB_THREAD_ID=bb;
    const loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noSkills:true,noThemes:true,noPromptTemplates:true,noContextFiles:true});
    await loader.reload();const result=loader.getExtensions();assert.deepEqual(result.errors,[]);return result;
  };
  const standalone=await load('');assert.equal(standalone.runtime.pendingNativeProviderRegistrations.length,0);
  assert(!existsSync(join(root,'.pi/agent/session-credits-status')));assert(!existsSync(join(root,'.pi/agent/session-credits')));
  const loaded=await load('thr_fixture'),extension=loaded.extensions.find(e=>e.path.endsWith('/collector/extension.ts'));assert(extension);
  const id='11111111-1111-4111-8111-111111111111',providerSession='pi_'+id,notices=[];
  const ctx={sessionManager:{getSessionId:()=>id,getSessionFile:()=>join(root,providerSession+'.jsonl')},ui:{notify:text=>notices.push(text)}};
  for(const handler of extension.handlers.get('session_start')??[])await handler({reason:'startup'},ctx);
  const artifact=join(root,'reader-only.mjs');copyFileSync(new URL('../dist/host.js',import.meta.url),artifact);
  const {createHostEntry}=await import(pathToFileURL(artifact));
  const h=experimental_createHostEntryHarness(createHostEntry([join(root,'.pi/agent/session-credits')],join(root,'cli'),join(root,'.pi/agent/session-credits-status')));
  try {
    let usage=await h.experimental_call('read',{provider:'pi',sessionId:providerSession});
    const compatible=runtime.version.split('.')[0]==='1'&&Number(runtime.version.split('.')[1])>=5||Number(runtime.version.split('.')[0])>1;
    if(!compatible){assert(process.argv.includes('--compat-only'),'Pi 1.5.0+ required for capture');assert.equal(usage.readiness.state,'unsupported');assert.equal(loaded.runtime.pendingNativeProviderRegistrations.length,0);assert(notices.some(text=>text.includes('Pi 1.5.0+')));}
    else {
      assert.equal(usage.readiness.state,'ready');assert.equal(usage.aic,null);
      const provider=loaded.runtime.pendingNativeProviderRegistrations[0].provider;let calls=0,raw=0,responses=0;
      const model={id:'synthetic',name:'synthetic',provider:'github-copilot',api:'openai-responses',baseUrl:'http://127.0.0.1:1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:64};
      const stream=provider.stream(model,{messages:[{role:'user',content:'SYNTHETIC_PRIVATE',timestamp:0}]},{apiKey:'SYNTHETIC_NOT_A_KEY',onProviderStreamEvent:()=>{raw++;},onResponse:()=>{responses++;},fetch:async url=>{assert.equal(new URL(String(url)).hostname,'127.0.0.1');calls++;const response={id:'synthetic',status:'completed',output:[],usage:{input_tokens:2,output_tokens:1,total_tokens:3}};const frame=data=>`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;return new Response(frame({type:'response.created',response:{id:response.id}})+frame({type:'response.completed',response,copilot_usage:{total_nano_aiu:'1230000000'}})+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});
      for await(const event of stream)assert.notEqual(event.type,'error');assert.equal((await stream.result()).stopReason,'stop');await Promise.resolve();assert.equal(calls,1);assert(raw>0);assert.equal(responses,1);
      const fresh=experimental_createHostEntryHarness(createHostEntry([join(root,'.pi/agent/session-credits')],join(root,'cli'),join(root,'.pi/agent/session-credits-status')));
      usage=await fresh.experimental_call('read',{provider:'pi',sessionId:providerSession});assert.equal(usage.aic,'1.23');assert.equal(usage.coverage,'partial');await fresh.experimental_dispose();
      await extension.commands.get('copilot-probe').handler('off',ctx);assert.equal((await h.experimental_call('read',{provider:'pi',sessionId:providerSession})).readiness.state,'disabled');
      await extension.commands.get('copilot-probe').handler('on',ctx);assert.equal((await h.experimental_call('read',{provider:'pi',sessionId:providerSession})).readiness.state,'ready');
      const text=readdirSync(join(root,'.pi/agent/session-credits')).map(n=>readFileSync(join(root,'.pi/agent/session-credits',n),'utf8')).join('');assert(!text.includes('SYNTHETIC_PRIVATE'));assert(!text.includes('SYNTHETIC_NOT_A_KEY'));
    }
    for(const handler of extension.handlers.get('session_shutdown')??[])await handler({reason:'quit'},ctx);
    assert.equal((await h.experimental_call('read',{provider:'pi',sessionId:providerSession})).readiness.state,'unconfirmed');
    const retained=join(root,'.pi/agent/session-credits/retain');mkdirSync(join(root,'.pi/agent/session-credits'),{recursive:true,mode:0o700});writeFileSync(retained,'retain',{mode:0o600});
    command('remove',source);assert.equal(readFileSync(retained,'utf8'),'retain');
    assert.equal((await load('thr_fixture')).extensions.filter(e=>e.path.endsWith('/collector/extension.ts')).length,0);
    console.log(JSON.stringify({piVersion:runtime.version,source,gitTransport:'HTTPS rewritten to local file fixture; HTTPS disabled',results:['Actual pinned Git install/list/remove and Pi loader','Standalone companion inert; BB-only exact identity readiness','Supported synthetic usage and host reader, or unsupported runtime diagnostic','Off/on, shutdown and receipt retention']},null,2));
  } finally {await h.experimental_dispose();}
}
