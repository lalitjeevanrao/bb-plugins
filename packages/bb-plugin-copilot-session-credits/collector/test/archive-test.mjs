// Automatic archive of closed receipts (issue #21). Offline: synthetic receipts, no credentials or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { createProbe } from '../probe.mjs';

const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'pi-probe-archive-')));
const results = [];
const check = async (name, run) => {
  try { await run(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', message: error.stack }); }
};
const SESSION = 'pi_11111111-1111-4111-8111-111111111111';
const context = { sessionManager: { getSessionId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', getSessionFile: () => `/fixture/${SESSION}.jsonl` }, ui: { notify() {} } };
const model = { provider: 'github-copilot', api: 'anthropic-messages', id: 'fixture' };
const day = 86_400_000;

// A schema-3 receipt as the collector writes it. `tail` is the last row kind (null: none after call_finished).
function receipt(directory, { session = SESSION, hash = 'a'.repeat(64), tail = 'capture_stopped', age = 1, mode = 0o600, edit } = {}) {
  const epoch = randomUUID(), callId = randomUUID(), name = epoch + '.jsonl';
  const kinds = [['capture_started', { missedCalls: 0 }], ['call_started', { callId }], ['observation', { callId, billing: [{ path: 'copilot_usage.total_nano_aiu', nanoAiu: '1000', valueType: 'string' }] }], ['call_finished', { callId, outcome: 'stop' }]];
  if (tail) kinds.push([tail, { inFlight: 0, dropped: 0 }]);
  const rows = kinds.map(([kind, fields], index) => ({ schema: 3, seq: index + 1, kind, at: '2026-11-01T00:00:00.000Z', epoch, nativeSessionHash: hash, providerSession: session, coverage: 'provider-wrapper-partial', ...fields }));
  let text = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  if (edit) text = edit(text, rows);
  const path = join(directory, name);
  fs.writeFileSync(path, text, { mode }); fs.chmodSync(path, mode);
  const time = new Date(Date.now() - age * day); fs.utimesSync(path, time, time);
  return { name, path, text, shard: session === null ? 'h_' + hash : session, ino: fs.statSync(path).ino };
}
const privateDir = path => { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); fs.chmodSync(path, 0o700); return path; };
const seal = file => { // Append the terminal row a clean shutdown writes.
  const rows = fs.readFileSync(file.path, 'utf8').trim().split('\n').map(JSON.parse), last = rows.at(-1);
  fs.appendFileSync(file.path, JSON.stringify({ ...last, seq: last.seq + 1, kind: 'capture_stopped', inFlight: 0, dropped: 0 }) + '\n');
};
const archived = (directory, file) => join(directory + '-archive', file.shard, file.name);
const receiptsIn = directory => fs.readdirSync(directory).filter(name => name.endsWith('.jsonl'));
const parse = path => { try { return fs.readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line)); } catch { return []; } };
const captures = directory => receiptsIn(directory).map(name => parse(join(directory, name))).filter(rows => rows[0]?.kind === 'capture_started' && rows[0].at !== '2026-11-01T00:00:00.000Z');

function harness(directory, options = {}) {
  const hooks = new Map(), commands = new Map(), statuses = [];
  let wrapped, calls = 0, clock = Date.now();
  const invoke = () => { calls++; return { result: () => Promise.resolve({ stopReason: 'stop' }) }; };
  const provider = { id: 'github-copilot', stream: invoke, streamSimple: invoke };
  createProbe({ directory, provider, autoStart: true, now: () => clock, onStatus: state => statuses.push(state), ...options })({ on: (name, run) => hooks.set(name, run), registerCommand: (name, value) => commands.set(name, value), registerProvider: value => { wrapped = value; } });
  hooks.get('session_start')({ reason: 'startup' }, context);
  return {
    call: () => wrapped.streamSimple(model, {}, {}).result(),
    calls: () => calls, statuses,
    advance: ms => { clock += ms; },
    agentEnd: () => hooks.get('agent_end')({}, context),
    stop: () => hooks.get('session_shutdown')({ reason: 'quit' }),
    status: async () => { let message; await commands.get('copilot-probe').handler('status', { ...context, ui: { notify: text => { message = text; } } }); return message; },
  };
}
const fill = (directory, count, options = {}) => Array.from({ length: count }, (_, index) => receipt(directory, { age: 100 + index, ...options }));

try {
  await check('256 entries: only provably closed receipts move, oldest first; the next call records', async () => {
    const directory = privateDir(join(root, 'mixed')), outside = privateDir(join(root, 'mixed-outside'));
    const legacy = privateDir(join(root, 'session-credits')), status = privateDir(join(root, 'mixed-status'));
    const legacyFile = receipt(legacy), statusFile = join(status, 'marker.json'); fs.writeFileSync(statusFile, '{}', { mode: 0o600 });
    // Ineligible receipts are the OLDEST: age never proves closure.
    const old = { age: 5000 };
    const ineligible = [
      ...Array.from({ length: 4 }, () => receipt(directory, { ...old, tail: null })), // live: last row call_finished
      ...Array.from({ length: 4 }, () => receipt(directory, { ...old, tail: 'capture_checkpoint' })), // crash leftover
      receipt(directory, { ...old, tail: 'capture_status' }),
      receipt(directory, { ...old, edit: text => text.slice(0, -1) }), // torn last line
      receipt(directory, { ...old, edit: text => text.replace('"seq":2', '"seq":7') }), // sequence gap
      receipt(directory, { ...old, edit: text => text.replace(/"epoch":"[^"]+"/, '"epoch":"other"') }), // identity mismatch
      receipt(directory, { ...old, edit: (text, rows) => text + JSON.stringify({ ...rows.at(-1), seq: rows.length + 1, kind: 'capture_truncated' }) + '\n' }), // two terminal rows
      receipt(directory, { ...old, mode: 0o644 }), // not private
      receipt(directory, { ...old, session: 'standalone' }), // no valid shard
      receipt(directory, { ...old, edit: text => text + 'not json\n' }),
    ];
    const linked = receipt(directory, old); fs.linkSync(linked.path, join(outside, linked.name)); ineligible.push(linked); // extra hard link
    const target = receipt(outside, old), symlink = join(directory, randomUUID() + '.jsonl'); fs.symlinkSync(target.path, symlink);
    fs.writeFileSync(join(directory, 'notes.txt'), 'foreign');
    const eligible = [
      ...fill(directory, 20, { tail: 'capture_truncated' }),
      ...fill(directory, 16, { session: null, hash: 'b'.repeat(64) }),
      ...fill(directory, 256 - 20 - 16 - ineligible.length - 2),
    ];
    assert.equal(fs.readdirSync(directory).length, 256);
    const h = harness(directory);
    await h.call();
    assert.equal(h.calls(), 1);
    const moved = eligible.filter(file => !fs.existsSync(file.path));
    assert.equal(moved.length, 64, 'archive down to 192 then allocate');
    assert.equal(fs.readdirSync(directory).length, 193);
    const byAge = [...eligible].sort((a, b) => fs.statSync(fs.existsSync(a.path) ? a.path : archived(directory, a)).mtimeMs - fs.statSync(fs.existsSync(b.path) ? b.path : archived(directory, b)).mtimeMs);
    assert.deepEqual(new Set(moved.map(file => file.name)), new Set(byAge.slice(0, 64).map(file => file.name)), 'oldest closed receipts first');
    for (const file of moved) {
      const stat = fs.lstatSync(archived(directory, file));
      assert.equal(stat.ino, file.ino); assert.equal(stat.nlink, 1); assert.equal(stat.mode & 0o777, 0o600);
      assert.equal(fs.readFileSync(archived(directory, file), 'utf8'), file.text);
    }
    for (const file of ineligible) assert.equal(fs.readFileSync(file.path, 'utf8'), file.text, 'ineligible receipt untouched');
    assert(fs.lstatSync(symlink).isSymbolicLink()); assert.equal(fs.readFileSync(join(directory, 'notes.txt'), 'utf8'), 'foreign');
    assert.equal(fs.statSync(directory + '-archive').mode & 0o777, 0o700);
    for (const shard of fs.readdirSync(directory + '-archive')) assert.equal(fs.statSync(join(directory + '-archive', shard)).mode & 0o777, 0o700);
    assert.equal(fs.readFileSync(legacyFile.path, 'utf8'), legacyFile.text); assert.deepEqual(fs.readdirSync(legacy), [legacyFile.name]);
    assert.deepEqual(fs.readdirSync(status), ['marker.json']);
    const [capture] = captures(directory);
    assert.equal(capture[0].missedCalls, 0); assert(capture.some(row => row.kind === 'call_started'));
    assert(!fs.existsSync(join(directory, '.capture-lock')));
    assert.match(await h.status(), /: on;/);
  });

  await check('only ineligible receipts: calls still run, collector-full is reported, capture resumes once a slot is safe', async () => {
    const directory = privateDir(join(root, 'stuck'));
    const files = fill(directory, 4, { tail: 'capture_checkpoint' });
    const h = harness(directory, { maxFiles: 4 });
    await h.call(); await h.call();
    assert.equal(h.calls(), 2);
    assert.deepEqual(receiptsIn(directory).sort(), files.map(file => file.name).sort(), 'nothing moved or added');
    assert(!fs.existsSync(directory + '-archive'));
    assert.match(await h.status(), /collector-full; .*missedCalls=2/);
    assert(!h.statuses.includes('error'), 'full is not a capture error');
    seal(files[0]); // The owning Pi stopped cleanly after all.
    await h.call(); // Inside the 60 s back-off: still full, nothing swept.
    assert(fs.existsSync(files[0].path)); assert.equal(h.calls(), 3);
    h.advance(61_000);
    await h.call();
    assert.equal(h.calls(), 4); assert(!fs.existsSync(files[0].path)); assert(fs.existsSync(archived(directory, files[0])));
    const [capture] = captures(directory);
    assert.equal(capture[0].missedCalls, 3, 'missed calls stay recorded as missing, never recovered');
    assert.match(await h.status(), /: on;/);
  });

  await check('a slot freed by hand is used on the next call without waiting for the back-off', async () => {
    const directory = privateDir(join(root, 'freed'));
    const files = fill(directory, 4, { tail: 'capture_checkpoint' });
    const h = harness(directory, { maxFiles: 4 });
    await h.call();
    const elsewhere = privateDir(join(root, 'freed-manual')); fs.renameSync(files[0].path, join(elsewhere, files[0].name));
    await h.call();
    assert.equal(captures(directory).length, 1); assert.equal(captures(directory)[0][0].missedCalls, 1);
  });

  await check('busy lock: call runs, nothing moves, the lock is never stolen; recovers when released', async () => {
    const directory = privateDir(join(root, 'busy')), files = fill(directory, 4);
    const lock = privateDir(join(directory, '.capture-lock')), past = new Date(Date.now() - day); fs.utimesSync(lock, past, past);
    const h = harness(directory, { maxFiles: 4 });
    await h.call(); h.agentEnd();
    assert.equal(h.calls(), 1); assert(fs.existsSync(lock)); assert(files.every(file => fs.existsSync(file.path)));
    assert.match(await h.status(), /capture-contended/);
    fs.rmdirSync(lock);
    await h.call();
    assert.equal(files.filter(file => !fs.existsSync(file.path)).length, 1);
    assert.equal(captures(directory)[0][0].missedCalls, 1); assert(!fs.existsSync(lock));
  });

  await check('archive collision: existing archive file is never overwritten; other receipts still move', async () => {
    const directory = privateDir(join(root, 'collision')), files = fill(directory, 4);
    const oldest = files.at(-1); privateDir(join(directory + '-archive', oldest.shard));
    fs.writeFileSync(archived(directory, oldest), 'ALREADY ARCHIVED', { mode: 0o600 });
    const h = harness(directory, { maxFiles: 4 });
    await h.call();
    assert.equal(fs.readFileSync(archived(directory, oldest), 'utf8'), 'ALREADY ARCHIVED');
    assert.equal(fs.readFileSync(oldest.path, 'utf8'), oldest.text, 'colliding source stays');
    assert.equal(files.filter(file => !fs.existsSync(file.path)).length, 1);
    assert.equal(captures(directory).length, 1);
  });

  await check('injected link failure: nothing lost or duplicated, call runs, recovers after the fault clears', async () => {
    const directory = privateDir(join(root, 'link-failure')), files = fill(directory, 4), original = fs.linkSync;
    const h = harness(directory, { maxFiles: 4 });
    try {
      fs.linkSync = () => { const error = new Error('injected'); error.code = 'EIO'; throw error; }; syncBuiltinESMExports();
      await h.call();
    } finally { fs.linkSync = original; syncBuiltinESMExports(); }
    assert.equal(h.calls(), 1); assert(files.every(file => fs.readFileSync(file.path, 'utf8') === file.text));
    assert.deepEqual(fs.existsSync(directory + '-archive') ? fs.readdirSync(directory + '-archive').flatMap(shard => fs.readdirSync(join(directory + '-archive', shard))) : [], []);
    h.advance(61_000); await h.call();
    assert.equal(files.filter(file => !fs.existsSync(file.path)).length, 1); assert.equal(captures(directory).length, 1);
  });

  await check('injected unlink failure leaves one inode under two names; the next call finishes the move', async () => {
    const directory = privateDir(join(root, 'unlink-failure')), files = fill(directory, 4), original = fs.unlinkSync;
    const h = harness(directory, { maxFiles: 4 });
    try {
      fs.unlinkSync = () => { const error = new Error('injected'); error.code = 'EIO'; throw error; }; syncBuiltinESMExports();
      await h.call();
    } finally { fs.unlinkSync = original; syncBuiltinESMExports(); }
    const half = files.find(file => fs.existsSync(archived(directory, file)));
    assert(half); assert.equal(fs.statSync(half.path).nlink, 2); assert.equal(captures(directory).length, 0);
    await h.call(); // Repair runs at once, even inside the sweep back-off.
    assert(!fs.existsSync(half.path)); assert.equal(fs.statSync(archived(directory, half)).nlink, 1);
    assert.equal(fs.readFileSync(archived(directory, half), 'utf8'), half.text);
    assert.equal(captures(directory).length, 1);
  });

  await check('a half-finished move is repaired by agent_end below the archive threshold', async () => {
    const directory = privateDir(join(root, 'repair-periodic')), [file] = fill(directory, 1);
    privateDir(join(directory + '-archive', file.shard)); fs.linkSync(file.path, archived(directory, file));
    const h = harness(directory, { maxFiles: 8 });
    h.agentEnd();
    assert(!fs.existsSync(file.path)); assert.equal(fs.statSync(archived(directory, file)).nlink, 1);
  });

  await check('unsafe archive paths stop maintenance; calls still run', async () => {
    for (const [label, prepare] of [
      ['symlink', directory => fs.symlinkSync(privateDir(join(root, 'decoy-' + randomUUID())), directory + '-archive')],
      ['public', directory => { fs.mkdirSync(directory + '-archive', { mode: 0o755 }); fs.chmodSync(directory + '-archive', 0o755); }],
      ['file', directory => fs.writeFileSync(directory + '-archive', 'x')],
    ]) {
      const directory = privateDir(join(root, 'unsafe-' + label)), files = fill(directory, 4);
      prepare(directory);
      const h = harness(directory, { maxFiles: 4 });
      await h.call();
      assert.equal(h.calls(), 1, label); assert(files.every(file => fs.existsSync(file.path)), label);
      assert.equal(captures(directory).length, 0, label);
    }
  });

  await check('periodic maintenance runs on agent_end at the threshold, at most every 10 minutes, only while enabled', async () => {
    const directory = privateDir(join(root, 'periodic')), files = fill(directory, 7);
    const h = harness(directory, { maxFiles: 8 }); // archiveAt 7, archiveTo 6
    h.agentEnd();
    assert.equal(files.filter(file => !fs.existsSync(file.path)).length, 1);
    receipt(directory);
    h.advance(60_000); h.agentEnd();
    assert.equal(receiptsIn(directory).length, 7, 'inside the interval');
    h.advance(10 * 60_000); h.agentEnd();
    assert.equal(receiptsIn(directory).length, 6);
    const missing = join(root, 'periodic-missing'), idle = harness(missing, { maxFiles: 8 });
    idle.agentEnd(); assert(!fs.existsSync(missing), 'never creates the capture root');
    const off = privateDir(join(root, 'periodic-off')); fill(off, 7);
    const disabled = harness(off, { maxFiles: 8, autoStart: false }); disabled.agentEnd();
    assert.equal(receiptsIn(off).length, 7);
  });

  await check('two Pi processes on one full directory: both calls run and every receipt survives exactly once', async () => {
    const directory = privateDir(join(root, 'shared'));
    const files = [...fill(directory, 250), ...fill(directory, 6, { tail: 'capture_checkpoint' })];
    const script = `
      import { createProbe } from ${JSON.stringify(new URL('../probe.mjs', import.meta.url).href)};
      const [directory, session] = process.argv.slice(1);
      const hooks = new Map(); let wrapped, calls = 0;
      const invoke = () => { calls++; return { result: () => Promise.resolve({ stopReason: 'stop' }) }; };
      createProbe({ directory, autoStart: true, provider: { id: 'github-copilot', stream: invoke, streamSimple: invoke } })({ on: (name, run) => hooks.set(name, run), registerCommand() {}, registerProvider: value => { wrapped = value; } });
      hooks.get('session_start')({ reason: 'startup' }, { sessionManager: { getSessionId: () => session, getSessionFile: () => null } });
      for (let i = 0; i < 40; i++) { await new Promise(resolve => setTimeout(resolve, 2)); await wrapped.streamSimple({ provider: 'github-copilot', api: 'anthropic-messages', id: 'fixture' }, {}, {}).result(); hooks.get('agent_end')({}); }
      hooks.get('session_shutdown')({ reason: 'quit' });
      console.log(JSON.stringify({ calls }));`;
    const run = session => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, directory, session], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
      child.on('exit', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    });
    const outcomes = await Promise.all([run('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), run('dddddddd-dddd-4ddd-8ddd-dddddddddddd')]);
    assert.deepEqual(outcomes.map(outcome => outcome.calls), [40, 40]);
    for (const file of files) {
      const places = [file.path, archived(directory, file)].filter(path => fs.existsSync(path));
      assert.equal(places.length, 1, 'exactly one copy of ' + file.name);
      assert.equal(fs.readFileSync(places[0], 'utf8'), file.text); assert.equal(fs.statSync(places[0]).nlink, 1);
    }
    const archive = directory + '-archive', fresh = [...captures(directory), ...fs.readdirSync(archive).flatMap(shard => captures(join(archive, shard)))];
    assert.equal(new Set(fresh.map(rows => rows[0].nativeSessionHash)).size, 2, 'both processes recorded');
    assert(fs.readdirSync(directory).length <= 256); assert(!fs.existsSync(join(directory, '.capture-lock')));
    assert(files.slice(250).every(file => fs.existsSync(file.path)), 'checkpoint-only receipts stay');
  });
  console.log(JSON.stringify(results, null, 2));
  if (results.some(row => row.status === 'failed')) process.exitCode = 1;
} finally { fs.rmSync(root, { recursive: true, force: true }); }
