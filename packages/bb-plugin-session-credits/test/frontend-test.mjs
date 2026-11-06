import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as accounting from '../accounting.mjs';
import * as copy from '../details-copy.mjs';
import * as setupCopy from '../setup-copy.mjs';
const require = createRequire(import.meta.url), context = {}, registrations = [];
const module = { exports: {} }, runtime = require('react/jsx-runtime');
const wrap = render => (type, props, key) => { if (type === 'button') context.buttons.push(props); return render(type, props, key); };
const popover = {
  Root: props => { context.rootProps=props; return props.children; },
  Trigger: props => { context.triggerAsChild=props.asChild; const child=React.cloneElement(props.children,{onClick:()=>{context.popOpen=!context.popOpen;}}); context.buttons[context.buttons.indexOf(props.children.props)]=child.props; return child; },
  Portal: props => { context.portalProps=props; return context.popOpen ? props.children : null; },
  Content: props => { context.contentProps=props; return React.createElement('div',{role:'dialog','aria-labelledby':props['aria-labelledby']},props.children); },
  Close: props => { const child=React.cloneElement(props.children,{onClick:()=>{context.popOpen=false;context.closed++;}}); context.buttons[context.buttons.indexOf(props.children.props)]=child.props; return child; },
};
const code = ts.transpileModule(readFileSync(new URL('../app.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
runInNewContext(code, { exports: module.exports, module, require: name => {
  if (name === 'react') return { ...React, useEffect(effect) { context.effects?.push(effect); }, useState: initial => [initial === undefined ? context.target : initial === false ? context.failed : typeof initial === 'string' ? initial : initial === 0 ? 0 : context.snapshot, value => { if (typeof initial === 'string') context.copyMessage = value; if (initial === 0) context.retries = (context.retries ?? 0) + 1; }] };
  if (name === '@radix-ui/react-popover') return popover;
  if (name === 'react-dom') return { createPortal: children => children };
  if (name === 'react/jsx-runtime') return { ...runtime, jsx: wrap(runtime.jsx), jsxs: wrap(runtime.jsxs) };
  if (name === './accounting.mjs') return accounting;
  if (name === './details-copy.mjs') return copy;
  if (name === './setup-copy.mjs') return setupCopy;
  if (name === './footer-placement.mjs') return require('../footer-placement.mjs');
  if (name.endsWith('.css')) return {};
  if (name === '@get-bb/plugin-sdk/app') return {
    definePluginApp: register => { register({ composer: { customize: spec => registrations.push(spec) } }); return register; },
    useComposer: () => context.view, useRpc: () => { context.rpcHooks++; return {}; }, useRealtimeConnectionState: () => context.connection,
  };
  return require(name);
} });
const spec = registrations[0], results = [];
const reset = ({ sessionId = 'pi_fixture', provider = 'pi', layout = 'expanded', selection = { providerId: 'pi' }, usage = {}, connection = 'connected', failed = false, threadId = 'thr_fixture', snapshotThread = threadId, target = {} } = {}) => {
  context.effects = []; context.popOpen = false; context.rpcHooks=0;
  context.target = target; context.buttons = []; context.opened = []; context.closed = 0; context.connection = connection; context.failed = failed;
  context.view = { scope: { kind: 'thread', threadId }, layout, selection, experimental_openPopup: id => { context.opened.push(id); return true; }, experimental_closePopup: () => { context.closed++; return true; } };
  context.snapshot = { threadId: snapshotThread, provider, sessionId, usage: { provider, source: 'pi-receipts', aic: '1.25', coverage: 'partial', reported: 1, observed: 1, inFlight: 0, missing: 0, conflicting: 0, captureIssue: false, readiness: {state:'ready',runtimeVersion:'1.5.0',reason:'Ready'}, reason: 'Synthetic test only', ...usage } };
};
const render = region => {
  if(region==='panel'){context.popOpen=true;region=context.view.layout==='compact'?'banners':'actions';}
  return renderToStaticMarkup(React.createElement(spec[region][0].component));
};
for (const [name, check] of [
  ['Portaled nonmodal popover anchors to the actual control with one polling hook', () => {
    reset();let html=render('actions');assert(!context.popOpen);assert.equal(context.rootProps.modal,false);assert(context.triggerAsChild);assert.doesNotMatch(html,/role="dialog"/);context.buttons[0].onClick();assert(context.popOpen);
    context.rpcHooks=0;html=render('actions');assert.equal(context.rpcHooks,1);assert.equal(context.contentProps.side,'top');assert.equal(context.contentProps.align,'end');assert.equal(context.contentProps.sideOffset,8);assert.equal(context.contentProps.collisionPadding,12);assert.equal(context.contentProps['data-bb-plugin'],'session-credits');assert.equal(context.contentProps['data-bb-plugin-root'],'');
    assert.equal(context.portalProps.container,undefined);let stopped=false;context.contentProps.onMouseDown({stopPropagation(){stopped=true;},preventDefault(){throw Error('Native summary default must remain enabled');}});assert(stopped);assert.equal(context.contentProps.onEscapeKeyDown,undefined);assert.equal(context.contentProps.onPointerDownOutside,undefined);assert.equal(context.contentProps.onCloseAutoFocus,undefined);assert.doesNotMatch(html,/<dialog|backdrop/);assert.equal(spec.experimental_popups,undefined);
    const title=html.match(/<h3 id="([^"]+)"/)[1];assert(html.includes(`aria-labelledby="${title}"`));context.buttons.find(button=>button['aria-label']==='Close credit details').onClick();assert(!context.popOpen);
  }],
  ['Unconfirmed Pi has clickable setup, pinned selectable command, retry and history', () => { reset({usage:{aic:null,readiness:{state:'unconfirmed',reason:'No marker',runtimeVersion:null}}}); let html=render('actions'); assert.match(html,/Set up credits/); assert.doesNotMatch(html,/disabled/); context.buttons[0].onClick(); assert(context.popOpen); html=render('panel'); assert.match(html,/Set up Pi credits/); assert(html.includes(setupCopy.piInstallCommand)); assert.match(html,/tabindex="0"/); assert.match(html,/execution host/); assert.match(html,/PI_CODING_AGENT_DIR/); context.buttons.find(button=>button.children==='Retry check').onClick(); assert(context.retries>0); reset({usage:{readiness:{state:'unconfirmed',reason:'No marker',runtimeVersion:null}}}); assert.match(render('panel'),/1\.2500 AIC/); }],
  ['Pi identity pending still offers setup without claiming a missing installation', () => { reset({sessionId:null,usage:{aic:null,source:'none',readiness:{state:'unconfirmed',reason:'Waiting for provider session identity',runtimeVersion:null}}}); const html=render('panel'); assert.match(html,/Set up Pi credits/); assert.match(html,/identity pending/); assert(html.includes(setupCopy.piInstallCommand)); }],
  ['Ready without amounts awaits usage and never invents zero', () => { reset({usage:{aic:null,reported:0,observed:0}});const html=render('panel');assert.match(html,/Ready — awaiting Copilot usage/);assert.match(html,/— AIC/);assert.doesNotMatch(html,/Set up Pi credits|0\.0000/); }],
  ['Ready never hides unfinished, missing, full or damaged evidence', () => { for (const [usage,label,action] of [[{aic:null,inFlight:1},'Updating','unfinished'],[{aic:null,missing:1,observed:1},'Missing data','without credits'],[{aic:null,captureIssue:true,issues:['collector-full']},'Collector full','private archive'],[{aic:null,captureIssue:true,issues:['capture-damaged']},'Missing data','permissions']]) { reset({usage});const html=render('panel');assert(html.includes(label));assert(html.includes(action));assert.doesNotMatch(html,/Ready — awaiting Copilot usage/); } }],
  ['Unsupported, off and capture error retain historic credits and explain status', () => { for (const [state,label] of [['unsupported','Pi unsupported'],['disabled','Capture off'],['error','Capture error']]) { reset({usage:{readiness:{state,reason:'Reported runtime limitation',runtimeVersion:'0.84.4'}}});const html=render('panel');assert(html.includes(label));assert.match(html,/1\.2500 AIC/); } }],
  ['CLI and disconnected host never receive Pi installation guidance', () => { reset({provider:'acp-copilot',usage:{source:'copilot-checkpoint',readiness:{state:'unconfirmed',reason:'No marker',runtimeVersion:null}}});assert.doesNotMatch(render('panel'),/Pi capture not confirmed|pi install/);reset({usage:{aic:null,source:'none',issues:['host-unavailable'],readiness:{state:'unconfirmed',reason:'Unavailable',runtimeVersion:null}}});assert.doesNotMatch(render('panel'),/pi install/); }],
  ['Toolbar action has one compact fallback and no BB popup', () => { assert.equal(spec.actions?.length, 1); assert.equal(spec.experimental_popups, undefined); assert.equal(spec.scopes.join(','), 'thread'); reset(); assert.equal(render('banners'), ''); }],
  ['Recorded Pi spend stays visible when picker selects unsupported harness', () => { reset({ selection: { providerId: 'acp-claude', model: 'some-model' } }); const html = render('actions'); assert.match(html, /Recorded/); assert.match(html, /1\.2500/); }],
  ['Recorded Pi spend stays visible when picker selects non-Copilot model', () => { reset({ selection: { providerId: 'pi', model: 'anthropic/some-model' } }); assert.match(render('actions'), /1\.2500/); assert.match(render('panel'), /Partial coverage./); }],
  ['Actual unsupported session stays hidden regardless of supported picker', () => { reset({ provider: 'acp-claude', selection: { providerId: 'pi', model: 'github-copilot/test' } }); assert.doesNotMatch(render('actions'), /data-testid="session-credit-meter"/); reset({ provider: 'acp-claude', layout: 'compact' }); assert.doesNotMatch(render('banners'), /data-testid="session-credit-meter"/); }],
  ['Compact layout has one fallback and no action; expanded has action only', () => { reset({ layout: 'compact' }); assert.match(render('banners'), /1\.2500/); assert.equal(render('actions'), ''); reset(); assert.match(render('actions'), /1\.2500/); assert.equal(render('banners'), ''); }],
  ['Context-row portal is used when anchor exists; missing anchor falls back locally', () => { reset(); assert.match(render('actions'), /data-placement="info-row"/); reset({ target: null }); assert.match(render('actions'), /data-placement="toolbar"/); reset({ layout: 'compact', target: null }); assert.match(render('banners'), /data-placement="compact"/); }],
  ['Trigger is an accessible non-submit popover button', () => { reset(); const html = render('actions'); assert.match(html, /type="button"/); assert.match(html, /aria-haspopup="dialog"/); assert.match(html, /aria-label="[^"]*1\.2500 AIC[^"]*Recorded/); context.buttons[0].onClick(); assert(context.popOpen); }],
  ['Popup keeps exact amount in collapsed details, short scope, coverage and popover close', () => { reset({ usage: { aic: '1.250000001', updatedAt: '2026-11-05T00:00:00Z' } }); const html = render('panel'); for (const text of ['1.250000001 AIC', 'Recorded', 'Partial coverage.', 'Other BB threads separate.', 'Pi', '<summary>Details</summary>', 'Not an invoice.']) assert(html.includes(text), text); assert.match(html, /<details[^>]*>.*1\.250000001 AIC/s); assert.doesNotMatch(html, /<details[^>]*open|Badge shows|Recorded =|Parent and child|No token-price/); context.buttons.find(button => button['aria-label'] === 'Close credit details').onClick(); assert.equal(context.closed, 1); }],
  ['Recording state and disconnection remain truthful', () => { for (const [usage, label] of [[{ inFlight: 1 }, 'Updating'], [{ missing: 1 }, 'Missing data'], [{ aic: null }, 'Unavailable']]) { reset({ usage }); assert(render('actions').includes(label)); } reset({ connection: 'reconnecting' }); assert.match(render('actions'), /Disconnected/); }],
  ['Another thread snapshot never appears in new toolbar or popup', () => { reset({ snapshotThread: 'thr_other' }); assert.doesNotMatch(render('actions'), /1\.2500/); assert.doesNotMatch(render('panel'), /1\.25 AIC/); }],
  ['Copilot CLI uses same toolbar and full cumulative checkpoint amount', () => { reset({ provider: 'acp-gh-copilot', usage: { source: 'copilot-checkpoint', aic: '16.08247355', coverage: 'complete' } }); assert.match(render('actions'), /16\.0825/); assert.match(render('panel'), /16\.08247355 AIC/); assert.match(render('panel'), /Copilot CLI/); }],
  ['Unfinished does not claim a running call; warning states retain accepted subtotal', () => {
    reset({ usage: { inFlight: 1 } });let html=render('panel');
    assert.match(html,/1 call unfinished\. Not counted yet\./);assert.match(html,/data-tone="info"/);assert.doesNotMatch(html,/still running/);
    for(const usage of [{missing:1},{conflicting:1},{captureIssue:true,issues:['collector-full']}]){reset({usage});html=render('panel');assert.match(html,/1\.2500 AIC/);assert.match(html,/data-tone="warn"/);}
  }],
  ['Collector full and damaged capture explain the gap and next action without prune', () => {
    reset({usage:{captureIssue:true,issues:['collector-full']}});let html=render('panel');
    assert.match(html,/Collector full/);assert.match(html,/New captures blocked/);assert.match(html,/Stop all Pi/);assert.doesNotMatch(html,/prune/);
    reset({usage:{captureIssue:true,issues:['capture-damaged','collector-full']}});html=render('panel');
    assert.match(html,/data-tone="bad"/);assert.match(html,/could not be read safely/);assert.match(html,/New captures blocked/);
  }],
  ['Missing and unavailable amounts are a dash, never fabricated zero', () => {
    reset({usage:{aic:null,missing:1,reported:0}});let html=render('panel');assert.match(html,/— AIC/);assert.doesNotMatch(html,/0\.0000 AIC/);assert.match(html,/without credits/);
    reset({usage:{aic:null,source:'none',issues:['host-unavailable']}});html=render('panel');assert.match(html,/Unavailable/);assert.match(html,/host connection/);assert.match(html,/data-tone="bad"/);
  }],
  ['CLI partial and unknown coverage remain distinct from recorded completeness', () => {
    for(const [coverage,label] of [['partial','Copilot CLI partial'],['unknown','Coverage unknown']]){reset({provider:'acp-gh-copilot',usage:{source:'copilot-checkpoint',coverage}});const html=render('panel');assert(html.includes(label));assert.match(html,/data-tone="warn"/);assert.match(html,/Includes Copilot CLI subagents/);assert.doesNotMatch(html,/completed calls counted/);}
  }],
  ['Disconnected snapshot keeps the last amount with a stale warning', () => {
    reset({connection:'reconnecting'});const html=render('panel');assert.match(html,/Disconnected/);assert.match(html,/Last value kept/);assert.match(html,/1\.2500 AIC/);assert.match(html,/data-tone="warn"/);
  }],
]) {
  try { check(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', message: error.message }); }
}
console.log(JSON.stringify(results, null, 2));
if (results.some(test => test.status === 'failed')) process.exitCode = 1;

let copied;
assert.equal(await setupCopy.copyPiInstallCommand({writeText:async text=>{copied=text;}}),'Command copied.');assert.equal(copied,setupCopy.piInstallCommand);
assert.match(await setupCopy.copyPiInstallCommand({writeText:async()=>{throw Error('denied');}}),/Select and copy/);
assert.match(await setupCopy.copyPiInstallCommand(null),/Select and copy/);
