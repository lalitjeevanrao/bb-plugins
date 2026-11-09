import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { nanoToAic, displayAic, piUsage, cliUsage, meterState } from '../accounting.mjs';
const results = [], test = (name, f) => { try { f(); results.push({ name, status: 'passed' }); } catch(e) { results.push({ name, status:'failed', message:e.message }); } };
const id = n => '11111111-1111-4111-8111-' + String(n).padStart(12,'0');
const start = n => ({kind:'call_started',callId:id(n)});
const obs = (n,v) => ({kind:'observation',callId:id(n),billing:[{nanoAiu:v}]});
const end = n => ({kind:'call_finished',callId:id(n)});
test('Exact nano conversion and safe zero; no floating point',()=>{ assert.equal(nanoToAic('16082473550'),'16.08247355');assert.equal(nanoToAic('0'),'0');assert.equal(nanoToAic(2**54),null);assert.equal(nanoToAic(null),null);assert.equal(nanoToAic('1'),'0.000000001'); });
test('Visible rounding, tiny nonzero and missing are distinct',()=>{assert.equal(displayAic('16.08247355'),'16.0825');assert.equal(displayAic('0.000000001'),'<0.0001');assert.equal(displayAic('0'),'0.0000');assert.equal(displayAic(null),'—');});
test('Duplicate snapshots count once, separate interleaved calls add',()=>{const r=piUsage([start(1),start(2),obs(1,'1000000000'),obs(1,'1000000000'),obs(2,'2000000000'),end(2),end(1)]);assert.equal(r.aic,'3');assert.equal(r.reported,2);assert.equal(r.coverage,'partial');});
test('Conflicting, missing, unfinished and invalid amounts excluded explicitly',()=>{const r=piUsage([start(1),obs(1,'1'),obs(1,'2'),end(1),start(2),end(2),start(3),obs(3,'1'),start(4),obs(4,'-1'),end(4)]);assert.equal(r.aic,null);assert.equal(r.conflicting,2);assert.equal(r.missing,1);assert.equal(r.inFlight,1);});
test('Duplicate call lifecycle is ambiguous, not double counted',()=>{assert.equal(piUsage([start(1),obs(1,'1000000000'),end(1),start(1),end(1)]).aic,null);});
test('Observed true zero distinct from no receipts',()=>{assert.equal(piUsage([]).aic,null);assert.equal(piUsage([start(1),obs(1,'0'),end(1)]).aic,'0');});
const phased = (n, value, billingPhase = 'final', extra = {}) => ({ ...obs(n, value), api: 'openai-completions', eventType: 'chat.completion.chunk', responseHash: 'a'.repeat(64), billingPhase, ...extra });
const finished = (n, outcome = 'stop') => ({ ...end(n), outcome });
test('Chat interim zero then repeated final charge counts once with partial coverage', () => {
  const r = piUsage([start(1), phased(1, '0', 'interim'), phased(1, '0', 'interim'), phased(1, '7566900000'), phased(1, '7566900000'), finished(1)]);
  assert.equal(r.aic, '7.5669'); assert.equal(r.reported, 1); assert.equal(r.conflicting, 0); assert.equal(r.coverage, 'partial');
});
test('Chat final zero is real, but interim-only zero is missing billing', () => {
  assert.equal(piUsage([start(1), phased(1, '0'), finished(1)]).aic, '0');
  const r = piUsage([start(1), phased(1, '0', 'interim'), finished(1)]);
  assert.equal(r.aic, null); assert.equal(r.missing, 1);
});
test('Chat contradictory finals, invalid values and changed response identities stay conflicting', () => {
  for (const extra of [phased(1, '1'), phased(1, '0'), phased(1, '-1'), phased(1, '7', 'interim'), phased(1, '7566900000', 'final', { responseHash: 'b'.repeat(64) }), phased(1, '0', 'interim', { responseHash: null }), phased(1, '0', 'unknown'), obs(1, '0')]) {
    const r = piUsage([start(1), extra, phased(1, '7566900000'), finished(1)]);
    assert.equal(r.aic, null); assert.equal(r.conflicting, 1);
  }
});
test('Chat malformed hash types cannot establish a final charge', () => {
  for (const responseHash of [['a'.repeat(64)], null, 123, {}]) {
    const r = piUsage([start(1), phased(1, '7566900000', 'final', { responseHash }), finished(1)]);
    assert.equal(r.aic, null); assert.equal(r.conflicting, 1);
  }
});
test('Chat unsuccessful or unfinished calls never gain a final subtotal', () => {
  for (const outcome of ['error', 'aborted', 'threw', 'rejected', 'unknown']) {
    const r = piUsage([start(1), phased(1, '0', 'interim'), phased(1, '7566900000'), finished(1, outcome)]);
    assert.equal(r.aic, null); assert.equal(r.missing, 1);
  }
  const r = piUsage([start(1), phased(1, '7566900000')]); assert.equal(r.aic, null); assert.equal(r.inFlight, 1);
});
test('Phase-aware concurrent calls remain separate and legacy zero/final receipts remain uncertain', () => {
  const r = piUsage([start(1), start(2), phased(1, '0', 'interim'), phased(2, '0', 'interim'), phased(1, '7566900000'), phased(2, '1000000000'), finished(2, 'toolUse'), finished(1, 'length')]);
  assert.equal(r.aic, '8.5669'); assert.equal(r.reported, 2);
  const legacy = piUsage([start(1), obs(1, '0'), obs(1, '7566900000'), finished(1)]);
  assert.equal(legacy.aic, null); assert.equal(legacy.conflicting, 1);
});
test('CLI snapshot replaces earlier totals; nested coverage honored',()=>{const c=cliUsage({data:{totalNanoAiu:'16082473550',accountingSnapshot:{aiCreditsStatus:'partial'}}});assert.equal(c.aic,'16.08247355');assert.equal(c.coverage,'partial');});
test('CLI unavailable and legacy zero never imply free, explicit complete zero allowed',()=>{assert.equal(cliUsage({data:{totalNanoAiu:0,accountingSnapshot:{aiCreditsStatus:'unavailable'}}}).aic,null);assert.equal(cliUsage({data:{totalNanoAiu:0}}).aic,null);assert.equal(cliUsage({data:{totalNanoAiu:0,accountingSnapshot:{aiCreditsStatus:'complete'}}}).aic,'0');});
test('Fresh Pi recorded amount clears badge without claiming complete billing coverage',()=>{const r=piUsage([start(1),obs(1,'1000000000'),end(1)]);assert.equal(r.coverage,'partial');assert.equal(meterState(r),'Recorded');});
test('Normal in-flight calls update, then return to Recorded',()=>{assert.equal(meterState(piUsage([start(1)])),'Updating');assert.equal(meterState(piUsage([start(1),obs(1,'0'),end(1)])),'Recorded');});
test('Missing or conflicting calls and capture failures take priority over Updating',()=>{assert.equal(meterState(piUsage([start(1),end(1),start(2)])),'Missing data');assert.equal(meterState(piUsage([start(1),obs(1,'1'),obs(1,'2'),end(1)])),'Missing data');assert.equal(meterState({...piUsage([]),captureIssue:true}),'Missing data');});
test('CLI provider coverage remains truthful and unknown is never complete',()=>{assert.equal(meterState(cliUsage({data:{totalNanoAiu:'1',accountingSnapshot:{aiCreditsStatus:'complete'}}})),'Recorded');assert.equal(meterState(cliUsage({data:{totalNanoAiu:'1',accountingSnapshot:{aiCreditsStatus:'partial'}}})),'Missing data');assert.equal(meterState(cliUsage({data:{totalNanoAiu:'1'}})),'Coverage unknown');assert.equal(meterState(cliUsage(null)),'Unavailable');assert.equal(meterState(null),'Loading');});
const output=JSON.stringify(results,null,2); if(process.argv[2])writeFileSync(process.argv[2],output); console.log(output);if(results.some(r=>r.status==='failed'))process.exitCode=1;
