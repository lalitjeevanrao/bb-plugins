// Offline regressions for the two review findings. No credentials or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProbe } from '../probe.mjs';

const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'pi-probe-regression-')));
const results = [];
const check = async (name, run) => {
  try { await run(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', message: error.message }); }
};
const context = { sessionManager: { getSessionId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', getSessionFile: () => null }, ui: { notify() {} } };
const model = { provider: 'github-copilot', api: 'anthropic-messages', id: 'fixture' };
const rows = directory => fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.jsonl')).flatMap(name => fs.readFileSync(join(directory, name), 'utf8').trim().split('\n').map(JSON.parse)) : [];
function harness(directory, options = {}) {
  const hooks = new Map(), commands = new Map(), pending = []; let wrapped;
  const invoke = (_model, _context, options) => {
    let finish; const done = new Promise(resolve => { finish = resolve; });
    pending.push({ emit: data => options.onProviderStreamEvent?.(data, _model), finish });
    return { result: () => done };
  };
  const provider = { id: 'github-copilot', stream: invoke, streamSimple: invoke };
  createProbe({ directory, autoStart: true, provider, ...options })({ on: (name, run) => hooks.set(name, run), registerCommand: (name, value) => commands.set(name, value), registerProvider: value => { wrapped = value; } });
  hooks.get('session_start')?.({ reason: 'startup' }, context);
  return { hooks, commands, pending, wrapped, start: method => wrapped[method](model, {}, {}) };
}
try {
  await check('idle Pi startups allocate no capture files', () => {
    const directory = join(root, 'idle');
    for (let i = 0; i < 80; i++) harness(directory);
    assert.equal(rows(directory).length, 0, 'idle startup must not allocate a capture');
    assert(!fs.existsSync(directory) || fs.readdirSync(directory).length === 0);
  });
  await check('ID-less duplicate and interleaved events bind to the exact provider call', async () => {
    const directory = join(root, 'calls'), h = harness(directory);
    assert(h.wrapped, 'must wrap native provider instead of guessing call boundaries');
    h.start('stream'); h.start('streamSimple');
    await h.pending[0].emit({ type: 'message_delta', copilot_usage: { total_nano_aiu: '5' } });
    await h.pending[1].emit({ type: 'copilot_usage', total_nano_aiu: '8' });
    await h.pending[0].emit({ type: 'copilot_usage', total_nano_aiu: '5' });
    await h.pending[1].emit({ type: 'message_stop' });
    h.pending.forEach(call => call.finish({ stopReason: 'stop' }));
    await Promise.resolve();
    const data = rows(directory), observations = data.filter(row => row.kind === 'observation');
    assert(observations.every(row => typeof row.callId === 'string' && row.callId));
    assert.equal(observations[0].callId, observations[2].callId);
    assert.equal(observations[1].callId, observations[3].callId);
    assert.notEqual(observations[0].callId, observations[1].callId);
    assert.equal(data.filter(row => row.kind === 'call_started').length, 2);
    assert.equal(data.filter(row => row.kind === 'call_finished').length, 2);
    assert(!data.some(row => Object.hasOwn(row, 'totalAic')));
  });
  await check('parallel processes cannot exceed the directory file budget', async () => {
    const { Worker } = await import('node:worker_threads');
    const directory = join(root, 'parallel'), probe = new URL('../probe.mjs', import.meta.url).href;
    const code = `const { workerData, parentPort } = require('node:worker_threads'); (async () => {
      const fs = require('node:fs'), { syncBuiltinESMExports } = require('node:module');
      const original = fs.readdirSync;
      fs.readdirSync = (...args) => { const result = original(...args); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); return result; };
      syncBuiltinESMExports();
      const { createProbe } = await import(workerData.probe);
      let wrapped; const hooks = new Map(), invoke = () => ({ result: () => Promise.resolve({ stopReason: 'stop' }) });
      const provider = { id: 'github-copilot', stream: invoke, streamSimple: invoke };
      createProbe({ directory: workerData.directory, autoStart: true, maxFiles: 2, provider })({ on: (name, run) => hooks.set(name, run), registerProvider: value => { wrapped = value; }, registerCommand() {} });
      hooks.get('session_start')({}, { sessionManager: { getSessionId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', getSessionFile: () => null } });
      await wrapped.streamSimple({ provider: 'github-copilot', api: 'anthropic-messages', id: 'fixture' }, {}, {}).result();
      hooks.get('session_shutdown')({ reason: 'quit' }); parentPort.postMessage('ok');
    })().catch(error => { throw error; });`;
    await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const worker = new Worker(code, { eval: true, workerData: { directory, probe } });
      let message; worker.on('message', value => { message = value; }); worker.on('error', reject);
      worker.on('exit', code => code === 0 && message === 'ok' ? resolve() : reject(new Error('Worker failed')));
    })));
    const files = fs.readdirSync(directory);
    assert(files.length >= 1 && files.length <= 2); assert(!files.includes('.capture-lock'));
    for (let i = 0; i < 5; i++) { const h = harness(directory, { maxFiles: 2 }); const stream = h.start('stream'); h.pending[0].finish({ stopReason: 'stop' }); await stream.result(); h.hooks.get('session_shutdown')({ reason: 'quit' }); }
    assert.equal(fs.readdirSync(directory).length, 2);
    assert(fs.readdirSync(directory).every(name => fs.statSync(join(directory, name)).size <= 1_048_576));
  });
  await check('failed post-open validation removes only its newly created file', async () => {
    const { syncBuiltinESMExports } = await import('node:module');
    const directory = join(root, 'failed-open'), original = fs.fstatSync;
    try {
      fs.fstatSync = (...args) => ({ ...original(...args), nlink: 2 }); syncBuiltinESMExports();
      const h = harness(directory); h.start('stream');
      assert.deepEqual(fs.readdirSync(directory), []);
    } finally { fs.fstatSync = original; syncBuiltinESMExports(); }
  });
  await check('contended allocation retries next call without stealing an abandoned lock', async () => {
    const directory = join(root, 'contended'); fs.mkdirSync(directory, { mode: 0o700 });
    const lock = join(directory, '.capture-lock'); fs.mkdirSync(lock, { mode: 0o700 });
    const h = harness(directory);
    h.start('stream'); h.pending[0].finish({ stopReason: 'stop' }); await Promise.resolve();
    assert.deepEqual(fs.readdirSync(directory), ['.capture-lock']);
    h.start('stream'); h.pending[1].finish({ stopReason: 'stop' }); await Promise.resolve();
    assert.deepEqual(fs.readdirSync(directory), ['.capture-lock'], 'never steal or age out a lock');
    const notices = [], ui = { notify: (message, tone) => notices.push({ message, tone }) };
    await h.commands.get('copilot-probe').handler('status', { ...context, ui });
    assert.equal(notices.at(-1).tone, 'warning'); assert(notices.at(-1).message.includes('capture-contended'));
    fs.rmdirSync(lock);
    const stream = h.start('stream'); h.pending[2].finish({ stopReason: 'stop' }); await stream.result();
    h.hooks.get('session_shutdown')({ reason: 'quit' });
    const data = rows(directory);
    assert.equal(data.filter(row => row.kind === 'capture_started').length, 1, 'contention must not disable later calls');
    assert.equal(data.find(row => row.kind === 'capture_started').missedCalls, 2);
    assert(!fs.existsSync(lock));
  });
  await check('failed validation never removes a substituted file inode', async () => {
    const { syncBuiltinESMExports } = await import('node:module');
    const directory = join(root, 'swapped-open'), original = fs.fstatSync;
    try {
      fs.fstatSync = (...args) => { const stat = original(...args); return { ...stat, nlink: 2, ino: stat.ino + 1 }; }; syncBuiltinESMExports();
      const h = harness(directory); h.start('stream');
      const names = fs.readdirSync(directory);
      assert.equal(names.length, 1); assert(names[0].endsWith('.jsonl'));
      assert.equal(fs.statSync(join(directory, names[0])).size, 0, 'unrecognized inode must survive cleanup');
    } finally { fs.fstatSync = original; syncBuiltinESMExports(); }
  });
  await check('late callbacks cannot cross a native session switch', async () => {
    const directory = join(root, 'late'), h = harness(directory);
    h.start('stream'); await h.pending[0].emit({ type: 'copilot_usage', total_nano_aiu: '5' });
    h.hooks.get('session_start')({ reason: 'new' }, { ...context, sessionManager: { getSessionId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', getSessionFile: () => null } });
    h.start('stream'); await h.pending[1].emit({ type: 'copilot_usage', total_nano_aiu: '8' });
    await h.pending[0].emit({ type: 'copilot_usage', total_nano_aiu: '999' });
    h.pending.forEach(call => call.finish({ stopReason: 'stop' })); await Promise.resolve();
    h.hooks.get('session_shutdown')({ reason: 'quit' });
    const data = rows(directory), observations = data.filter(row => row.kind === 'observation');
    assert.equal(observations.length, 2); assert.notEqual(observations[0].epoch, observations[1].epoch);
    assert.notEqual(observations[0].callId, observations[1].callId);
    assert.deepEqual(observations.flatMap(row => row.billing.map(value => value.nanoAiu)).sort(), ['5', '8']);
    const stopped = data.filter(row => row.kind === 'capture_stopped');
    assert.equal(stopped.find(row => row.epoch === observations.find(row => row.billing.some(value => value.nanoAiu === '5')).epoch).inFlight, 1);
    assert.equal(stopped.find(row => row.epoch === observations.find(row => row.billing.some(value => value.nanoAiu === '8')).epoch).inFlight, 0);
  });
  await check('provider stream identity, this, options, callbacks and thrown errors are preserved', async () => {
    const directory = join(root, 'contract'), hooks = new Map(); let wrapped, received, seenModel, seenContext;
    const done = Promise.resolve({ stopReason: 'stop' }), stream = { result: () => done };
    const failure = new Error('SYNTHETIC-ERROR-SECRET'), signal = new AbortController().signal, fetch = () => {};
    const provider = { id: 'github-copilot', auth: {}, getModels: () => [], stream(chosen, input, options) { assert.equal(this, provider); received = options; seenModel = chosen; seenContext = input; return stream; }, streamSimple() { throw failure; } };
    createProbe({ directory, provider, autoStart: true })({ on: (name, run) => hooks.set(name, run), registerCommand() {}, registerProvider: value => { wrapped = value; } });
    hooks.get('session_start')({}, context);
    const input = {}, onResponse = () => {}, sentinel = {}, data = { type: 'message_stop' };
    const options = { signal, fetch, onResponse, onProviderStreamEvent: (event, chosen) => { assert.equal(event, data); assert.equal(chosen, model); return sentinel; } };
    assert.equal(wrapped.stream(model, input, options), stream); assert.equal(seenModel, model); assert.equal(seenContext, input);
    assert.equal(wrapped.auth, provider.auth); assert.equal(wrapped.getModels, provider.getModels);
    assert.equal(received.signal, signal); assert.equal(received.fetch, fetch); assert.equal(received.onResponse, onResponse);
    assert.equal(await received.onProviderStreamEvent(data, model), sentinel);
    wrapped.stream(model, input, { onProviderStreamEvent: () => { throw failure; } });
    await assert.rejects(received.onProviderStreamEvent(data, model), error => error === failure);
    assert.throws(() => wrapped.streamSimple(model, input, options), error => error === failure);
    await Promise.resolve(); hooks.get('session_shutdown')({ reason: 'quit' });
    assert(!JSON.stringify(rows(directory)).includes('SYNTHETIC-ERROR-SECRET'));
  });
  console.log(JSON.stringify(results, null, 2));
  if (results.some(row => row.status === 'failed')) process.exitCode = 1;
} finally { fs.rmSync(root, { recursive: true, force: true }); }
