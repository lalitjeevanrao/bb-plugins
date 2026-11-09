import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, mkdirSync, symlinkSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProbe, observeBilling } from '../probe.mjs';

const results = [];
const check = async (name, run) => { await run(); results.push({ name, status: 'passed' }); };
const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-credit-probe-test-')));
const ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TWO = '22222222-2222-4222-8222-222222222222';
const ctx = id => ({ sessionManager: { getSessionId: () => id, getSessionFile: () => '/private/pi_11111111-1111-4111-8111-111111111111.jsonl' }, ui: { notify() {} } });
function harness(directory, options = {}) {
  const hooks = new Map(), commands = new Map();
  let wrapped;
  const invoke = (model, context, options) => {
    const done = Promise.resolve(options?.onProviderStreamEvent?.(context.data, model)).then(() => ({ stopReason: 'stop' }));
    return { result: () => done };
  };
  const provider = { id: 'github-copilot', stream: invoke, streamSimple: invoke };
  createProbe({ directory, provider, ...options })({ on: (name, run) => hooks.set(name, run), registerCommand: (name, value) => commands.set(name, value), registerProvider: value => { wrapped = value; } });
  return { emit: (name, event = {}, context = ctx(ONE)) => name === 'provider_stream_event' ? wrapped.streamSimple({ provider: event.provider, api: event.api, id: event.model }, { data: event.data }) : hooks.get(name)?.(event, context), command: (args, context = ctx(ONE)) => commands.get('copilot-probe').handler(args, context) };
}
const rows = directory => readdirSync(directory).flatMap(name => readFileSync(join(directory, name), 'utf8').trim().split('\n').map(JSON.parse));
const event = data => ({ provider: 'github-copilot', api: 'openai-responses', model: 'gpt-fixture', data });
try {
  await check('zero, exact strings, safe integers and explicit paths', () => {
    assert.deepEqual(observeBilling({ copilot_usage: { total_nano_aiu: 0 } }), [{ path: 'copilot_usage.total_nano_aiu', nanoAiu: '0', valueType: 'number' }]);
    assert.equal(observeBilling({ response: { copilot_usage: { total_nano_aiu: '9007199254740993123' } } })[0].nanoAiu, '9007199254740993123');
    assert.equal(observeBilling({ copilot_usage: { total_nano_aiu: '007' } })[0].nanoAiu, '7');
    assert.equal(observeBilling({ copilot_usage: { total_nano_aiu: '7' } })[0].valueType, 'string');
    assert.deepEqual(observeBilling({ copilot_usage: {} }), [{ path: 'copilot_usage.total_nano_aiu', missingAmount: true }]);
    for (const value of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1.2', '-1', 'secret']) assert.equal(observeBilling({ copilot_usage: { total_nano_aiu: value } })[0].invalid, true);
    assert.deepEqual(observeBilling({ usage: { total_tokens: 100 }, text: 'copilot_usage' }), []);
  });
  await check('disabled by default; local on/off; no prompt/header/text leaks', async () => {
    const directory = join(root, 'private'), h = harness(directory);
    h.emit('session_start'); assert.equal(readdirSync(root).length, 0);
    await h.command('on');
    h.emit('provider_stream_event', event({ type: 'response.completed', copilot_usage: { total_nano_aiu: '123', token: 'SECRET' }, text: 'SECRET', response: { id: 'SECRET', output: [{ text: 'SECRET' }] }, authorization: 'SECRET' }));
    h.emit('after_provider_response', { headers: { authorization: 'SECRET', 'x-request-id': 'SECRET' }, status: 200 });
    h.emit('agent_end', { messages: ['SECRET'] });
    await h.command('off');
    const before = rows(directory).length; h.emit('provider_stream_event', event({ copilot_usage: { total_nano_aiu: '999' } }));
    assert.equal(rows(directory).length, before);
    assert(!JSON.stringify(rows(directory)).includes('SECRET'));
    assert.equal(rows(directory).filter(r => r.kind === 'observation').length, 1);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    for (const name of readdirSync(directory)) assert.equal(statSync(join(directory, name)).mode & 0o777, 0o600);
  });
  await check('Chat billing phases require supported final shapes; unknown shapes never become final', async () => {
    const directory = join(root, 'chat-phases'), h = harness(directory, { autoStart: true }); h.emit('session_start');
    const choice = finish_reason => [{ index: 0, finish_reason }];
    const cases = [
      [choice(null), undefined, 'interim'], [choice('stop'), undefined, 'final'], [choice('length'), undefined, 'final'],
      [choice('tool_calls'), undefined, 'final'], [choice('function_call'), undefined, 'final'], [[], {}, 'final'],
      [[], undefined, 'unknown'], [choice('content_filter'), undefined, 'unknown'], [choice('other'), undefined, 'unknown'],
      [[{ index: 1, finish_reason: 'stop' }], undefined, 'unknown'], [[...choice('stop'), { index: 1, finish_reason: 'stop' }], undefined, 'unknown'],
      [null, undefined, 'unknown'], [[null], undefined, 'unknown']
    ];
    for (const [choices, usage] of cases) await h.emit('provider_stream_event', { provider: 'github-copilot', api: 'openai-completions', model: 'fixture', data: { object: 'chat.completion.chunk', id: 'SECRET', choices, usage, copilot_usage: { total_nano_aiu: '0' } } }).result();
    h.emit('session_shutdown'); const observations = rows(directory).filter(row => row.kind === 'observation');
    assert.deepEqual(observations.map(row => row.billingPhase), cases.map(row => row[2]));
    assert(observations.every(row => /^[a-f0-9]{64}$/.test(row.responseHash))); assert(!JSON.stringify(observations).includes('SECRET'));
  });
  await check('Markerless Chat chunks normalize only valid shapes; explicit conflicting markers stay unknown', async () => {
    const directory = join(root, 'markerless'), h = harness(directory, { autoStart: true }); h.emit('session_start');
    const cases = [
      [{}, [{ index: 0 }], {}, 'interim'], [{}, [{ index: 0, finish_reason: 'tool_calls' }], {}, 'final'], [{}, [], {}, 'final'],
      [{}, [], undefined, 'unknown'], [{}, [{ index: 1, finish_reason: 'stop' }], {}, 'unknown'], [{}, [null], {}, 'unknown'],
      [{ object: null }, [{ index: 0 }], {}, 'unknown'], [{ object: '' }, [{ index: 0 }], {}, 'unknown'],
      [{ object: 'other' }, [{ index: 0 }], {}, 'unknown'], [{ type: 'other' }, [{ index: 0 }], {}, 'unknown'],
      [{ object: 'chat.completion.chunk', type: 'other' }, [{ index: 0 }], {}, 'unknown'],
      [{ type: 'chat.completion.chunk', object: 'other' }, [{ index: 0 }], {}, 'unknown']
    ];
    for (const [markers, choices, usage] of cases) await h.emit('provider_stream_event', { provider: 'github-copilot', api: 'openai-completions', model: 'fixture', data: { ...markers, id: 'SECRET', choices, usage, copilot_usage: { total_nano_aiu: '0' } } }).result();
    h.emit('session_shutdown'); const observations = rows(directory).filter(row => row.kind === 'observation');
    assert.deepEqual(observations.map(row => row.billingPhase), cases.map(row => row[3]));
    assert(observations.filter(row => row.billingPhase !== 'unknown').every(row => row.eventType === 'chat.completion.chunk'));
    assert(!JSON.stringify(observations).includes('SECRET'));
  });
  await check('duplicate snapshots stay observations, never a fake total', () => {
    const directory = join(root, 'duplicates'), h = harness(directory, { autoStart: true }); h.emit('session_start');
    for (let i = 0; i < 2; i++) h.emit('provider_stream_event', event({ type: 'response.completed', copilot_usage: { total_nano_aiu: 5 } }));
    h.emit('session_shutdown'); const data = rows(directory);
    assert.equal(data.filter(r => r.kind === 'observation').length, 2);
    assert(!JSON.stringify(data).includes('totalCredits'));
    assert(data.every(r => r.coverage === 'provider-wrapper-partial'));
  });
  await check('terminal errors and lifecycle paths stay scalar-only; sequence increases', () => {
    const directory = join(root, 'errors'), h = harness(directory, { autoStart: true });
    h.emit('session_start', { reason: 'resume', previousSessionFile: 'SECRET_PATH' });
    h.emit('provider_stream_event', event({ type: 'error', error: { message: 'SECRET' } }));
    h.emit('session_shutdown', { reason: 'quit', targetSessionFile: 'SECRET_PATH' });
    const data = rows(directory);
    assert(data.some(row => row.eventType === 'error' && !row.billing.length));
    assert.equal(data[0].previousSession, true); assert(!JSON.stringify(data).includes('SECRET'));
    assert.deepEqual(data.map(row => row.seq), data.map((_, i) => i + 1));
  });
  await check('native session changes separate capture files and hashed identity', () => {
    const directory = join(root, 'sessions'), h = harness(directory, { autoStart: true });
    h.emit('session_start'); h.emit('provider_stream_event', event({ type: 'response.completed' })); h.emit('session_start', {}, ctx(TWO)); h.emit('provider_stream_event', event({ type: 'response.completed' })); h.emit('session_shutdown', {}, ctx(TWO));
    const starts = rows(directory).filter(r => r.kind === 'capture_started');
    assert.equal(starts.length, 2); assert.notEqual(starts[0].nativeSessionHash, starts[1].nativeSessionHash);
    assert(!JSON.stringify(rows(directory)).includes('session-one'));
  });
  await check('size ceiling and write failures never throw into model hooks', () => {
    const directory = join(root, 'bounded'), h = harness(directory, { autoStart: true, maxBytes: 1200, maxRecords: 3 }); h.emit('session_start');
    for (let i = 0; i < 100; i++) h.emit('provider_stream_event', event({ type: 'response.completed', copilot_usage: { total_nano_aiu: 1 } }));
    assert(rows(directory).some(row => row.kind === 'capture_truncated'), 'ceiling must leave explicit incomplete marker');
    h.emit('session_shutdown'); for (const name of readdirSync(directory)) assert(statSync(join(directory, name)).size <= 1200);
    const bad = harness('/dev/null/forbidden', { autoStart: true }); assert.doesNotThrow(() => bad.emit('session_start')); assert.doesNotThrow(() => bad.emit('agent_end'));
  });
  await check('symlink and public output directory rejected', () => {
    const target = join(root, 'target'); mkdirSync(target, { mode: 0o700 }); const link = join(root, 'link'); symlinkSync(target, link);
    const linked = harness(link, { autoStart: true }); linked.emit('session_start'); linked.emit('provider_stream_event', event({ type: 'message_stop' })); assert.equal(readdirSync(target).length, 0);
    const publicDir = join(root, 'public'); mkdirSync(publicDir, { mode: 0o755 }); const exposed = harness(publicDir, { autoStart: true }); exposed.emit('session_start'); exposed.emit('provider_stream_event', event({ type: 'message_stop' })); assert.equal(readdirSync(publicDir).length, 0);
  });
  await check('trailing-slash and parent symlinks rejected; capture count bounded', () => {
    const target = join(root, 'target'), link = join(root, 'link');
    const slash = harness(link + '/', { autoStart: true }); slash.emit('session_start'); slash.emit('provider_stream_event', event({ type: 'message_stop' }));
    const parent = harness(join(link, 'child'), { autoStart: true }); parent.emit('session_start'); parent.emit('provider_stream_event', event({ type: 'message_stop' }));
    assert.equal(readdirSync(target).filter(name => name.endsWith('.jsonl')).length, 0);
    const directory = join(root, 'full'); mkdirSync(directory, { mode: 0o700 });
    for (let i = 0; i < 256; i++) writeFileSync(join(directory, `${i}.jsonl`), '');
    const full = harness(directory, { autoStart: true }); full.emit('session_start'); full.emit('provider_stream_event', event({ type: 'message_stop' })); assert.equal(readdirSync(directory).length, 256);
  });
  await check('native identity stable across runtime reload and local controls', async () => {
    const directory = join(root, 'reload'), a = harness(directory, { autoStart: true });
    a.emit('session_start', { reason: 'startup' }); a.emit('provider_stream_event', event({ type: 'message_stop' })); a.emit('session_shutdown', { reason: 'reload' });
    const b = harness(directory, { autoStart: true }); b.emit('session_start', { reason: 'reload' }); b.emit('provider_stream_event', event({ type: 'message_stop' }));
    await b.command('off'); await b.command('on'); b.emit('provider_stream_event', event({ type: 'message_stop' })); b.emit('session_shutdown', { reason: 'quit' });
    const data = rows(directory), starts = data.filter(row => row.kind === 'capture_started');
    assert.equal(starts.length, 3); assert.equal(new Set(starts.map(row => row.nativeSessionHash)).size, 1);
    assert(starts.some(row => row.reason === 'reload')); assert(data.some(row => row.kind === 'capture_stopped' && row.reason === 'quit'));
    assert(!JSON.stringify(data).includes(ONE));
  });
  console.log(JSON.stringify(results, null, 2));
} finally { rmSync(root, { recursive: true, force: true }); }
