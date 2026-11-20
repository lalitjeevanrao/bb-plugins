// Hands-off maintenance (issue #21 addendum): leftovers of exited writers, abandoned locks, status leftovers.
// Offline: synthetic identities and receipts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createProbe } from '../probe.mjs';
import { createReadiness, readReadiness } from '../readiness.mjs';
import { validIdentity, writerExited } from '../identity.mjs';

const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'pi-maintenance-')));
const results = [];
const check = async (name, run) => {
  try { await run(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', message: error.stack }); }
};
const hex = digit => digit.repeat(64);
const self = { pid: process.pid, machine: hex('1'), boot: hex('2'), pidns: hex('3') };
const DEAD = 999_001, ALIVE = 999_002;
const writer = (pid, overrides = {}) => ({ ...self, pid, ...overrides });
// Exited when the pid is DEAD on this machine and boot; mirrors writerExited with a fake process table.
const exited = value => writerExited(value, self, pid => pid !== DEAD);
const SESSION = 'pi_11111111-1111-4111-8111-111111111111';
const context = { sessionManager: { getSessionId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', getSessionFile: () => `/fixture/${SESSION}.jsonl` }, ui: { notify() {} } };
const model = { provider: 'github-copilot', api: 'anthropic-messages', id: 'fixture' };
const privateDir = path => { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); fs.chmodSync(path, 0o700); return path; };
const minutes = 60_000;

function receipt(directory, { tail = 'capture_stopped', ageMs = 60 * minutes, owner, edit } = {}) {
  const epoch = randomUUID(), callId = randomUUID(), name = epoch + '.jsonl';
  const kinds = [['capture_started', { missedCalls: 0, ...(owner ? { writer: owner } : {}) }], ['call_started', { callId }], ['observation', { callId, billing: [{ path: 'copilot_usage.total_nano_aiu', nanoAiu: '1000', valueType: 'string' }] }]];
  if (tail) kinds.push([tail, { inFlight: 1, dropped: 0 }]);
  let text = kinds.map(([kind, fields], index) => JSON.stringify({ schema: 3, seq: index + 1, kind, at: '2026-11-01T00:00:00.000Z', epoch, nativeSessionHash: hex('a'), providerSession: SESSION, coverage: 'provider-wrapper-partial', ...fields })).join('\n') + '\n';
  if (edit) text = edit(text);
  const path = join(directory, name);
  fs.writeFileSync(path, text, { mode: 0o600 });
  const time = new Date(Date.now() - ageMs); fs.utimesSync(path, time, time);
  return { name, path, text, archived: join(directory + '-archive', SESSION, name) };
}
function harness(directory, options = {}) {
  const hooks = new Map(), commands = new Map();
  let wrapped, calls = 0;
  const invoke = () => { calls++; return { result: () => Promise.resolve({ stopReason: 'stop' }) }; };
  createProbe({ directory, autoStart: true, provider: { id: 'github-copilot', stream: invoke, streamSimple: invoke }, exited, writerIdentity: () => self, ...options })({ on: (name, run) => hooks.set(name, run), registerCommand: (name, value) => commands.set(name, value), registerProvider: value => { wrapped = value; } });
  hooks.get('session_start')({ reason: 'startup' }, context);
  return { call: () => wrapped.streamSimple(model, {}, {}).result(), calls: () => calls, agentEnd: () => hooks.get('agent_end')({}, context) };
}
const fresh = directory => fs.readdirSync(directory).filter(name => name.endsWith('.jsonl')).map(name => fs.readFileSync(join(directory, name), 'utf8').split('\n')[0]).filter(line => !line.includes('2026-11-01T00:00:00.000Z')).map(line => JSON.parse(line));

try {
  await check('writerExited proves exit only on the same machine: earlier boot, or same boot and namespace with no process', () => {
    assert.equal(writerExited(writer(DEAD), self, () => false), true);
    assert.equal(writerExited(writer(ALIVE, { boot: hex('9') }), self, () => true), true, 'earlier boot of this machine has ended');
    assert.equal(writerExited(writer(DEAD), self, () => true), false, 'pid reused or EPERM: alive');
    assert.equal(writerExited(writer(DEAD, { machine: hex('8') }), self, () => false), false, 'other machine');
    assert.equal(writerExited(writer(DEAD, { machine: hex('8'), boot: hex('9') }), self, () => false), false, 'other machine, other boot');
    assert.equal(writerExited(writer(DEAD, { pidns: hex('7') }), self, () => false), false, 'other PID namespace');
    assert.equal(writerExited(writer(process.pid), self, () => false), false, 'never this process');
    assert.equal(writerExited(writer(DEAD), null, () => false), false, 'no identity here');
    for (const bad of [undefined, null, {}, { ...writer(DEAD), machine: 'short' }, { ...writer(DEAD), pid: 0 }, { ...writer(DEAD), pid: 1.5 }]) assert.equal(writerExited(bad, self, () => false), false);
    assert.equal(validIdentity(self), true);
  });

  await check('new receipts carry the writer identity in capture_started', async () => {
    const directory = privateDir(join(root, 'identity')), h = harness(directory);
    await h.call();
    assert.deepEqual(fresh(directory)[0].writer, self);
    const none = privateDir(join(root, 'identity-none')), n = harness(none, { writerIdentity: () => null });
    await n.call();
    assert(!Object.hasOwn(fresh(none)[0], 'writer'));
  });

  await check('leftovers move only when their writer exited and they were unchanged for 10 minutes', async () => {
    const directory = privateDir(join(root, 'leftovers'));
    const dead = receipt(directory, { tail: 'capture_checkpoint', owner: writer(DEAD), ageMs: 3 * 24 * 60 * minutes });
    const deadNoTail = receipt(directory, { tail: null, owner: writer(DEAD), ageMs: 3 * 24 * 60 * minutes + 1 });
    const keep = [
      receipt(directory, { tail: 'capture_checkpoint', owner: writer(ALIVE), ageMs: 4 * 24 * 60 * minutes }), // live writer
      receipt(directory, { tail: 'capture_checkpoint', owner: writer(DEAD), ageMs: 5 * minutes }), // recent
      receipt(directory, { tail: 'capture_checkpoint', ageMs: 4 * 24 * 60 * minutes }), // pre-change: no writer
      receipt(directory, { tail: 'capture_checkpoint', owner: writer(DEAD, { machine: hex('8') }), ageMs: 4 * 24 * 60 * minutes }), // other machine
      receipt(directory, { tail: 'capture_checkpoint', owner: writer(DEAD), ageMs: 4 * 24 * 60 * minutes, edit: text => text.slice(0, -1) }), // torn
      receipt(directory, { tail: 'capture_checkpoint', owner: writer(DEAD), ageMs: 4 * 24 * 60 * minutes, edit: text => text.replace('"seq":2', '"seq":5') }), // malformed
    ];
    const h = harness(directory, { maxFiles: 8 }); // archive from 7 down to 6: up to 2 moves
    await h.call();
    for (const file of [dead, deadNoTail]) { assert(!fs.existsSync(file.path), file.name); assert.equal(fs.readFileSync(file.archived, 'utf8'), file.text); }
    for (const file of keep) assert.equal(fs.readFileSync(file.path, 'utf8'), file.text);
    assert.equal(fresh(directory).length, 1);
    // When the only candidate is a recent leftover of an exited writer, it still waits.
    const quiet = privateDir(join(root, 'leftovers-recent'));
    const recent = receipt(quiet, { tail: 'capture_checkpoint', owner: writer(DEAD), ageMs: 9 * minutes });
    const live = [1, 2, 3].map(() => receipt(quiet, { tail: 'capture_checkpoint', owner: writer(ALIVE), ageMs: 3 * 24 * 60 * minutes }));
    const q = harness(quiet, { maxFiles: 4 });
    await q.call();
    assert.equal(fs.readFileSync(recent.path, 'utf8'), recent.text); assert(live.every(file => fs.existsSync(file.path)));
    assert.equal(fresh(quiet).length, 0); assert.equal(q.calls(), 1);
  });

  await check('a lock whose owner exited is moved aside and capture resumes; live, unknown and unprovable owners stay', async () => {
    const lockOf = directory => join(directory, '.capture-lock');
    const withOwner = (directory, owner, extra = {}) => { privateDir(lockOf(directory)); const instance = randomUUID(); fs.writeFileSync(join(lockOf(directory), 'owner.json'), JSON.stringify({ schema: 1, instance, writer: owner }), { mode: 0o600, ...extra }); return instance; };
    const directory = privateDir(join(root, 'lock-dead')), instance = withOwner(directory, writer(DEAD));
    const h = harness(directory);
    await h.call();
    assert(!fs.existsSync(lockOf(directory)), 'lock released after recovery');
    assert(fs.existsSync(join(directory + '-archive', '.broken-locks', instance, 'owner.json')), 'abandoned lock kept as evidence');
    assert.equal(fresh(directory).length, 1);
    for (const [label, prepare] of [
      ['live owner', directory => withOwner(directory, writer(ALIVE))],
      ['other machine', directory => withOwner(directory, writer(DEAD, { machine: hex('8') }))],
      ['no owner file', directory => privateDir(lockOf(directory))],
      ['public owner file', directory => { const id = withOwner(directory, writer(DEAD)); fs.chmodSync(join(lockOf(directory), 'owner.json'), 0o644); return id; }],
      ['symlinked owner file', directory => { privateDir(lockOf(directory)); const target = join(root, 'owner-' + randomUUID()); fs.writeFileSync(target, JSON.stringify({ schema: 1, instance: randomUUID(), writer: writer(DEAD) }), { mode: 0o600 }); fs.symlinkSync(target, join(lockOf(directory), 'owner.json')); }],
      ['invalid owner', directory => { privateDir(lockOf(directory)); fs.writeFileSync(join(lockOf(directory), 'owner.json'), '{"schema":1}', { mode: 0o600 }); }],
    ]) {
      const directory = privateDir(join(root, 'lock-' + label.replaceAll(' ', '-')));
      prepare(directory);
      const before = fs.readdirSync(lockOf(directory)).sort(), h = harness(directory);
      await h.call(); h.agentEnd();
      assert.equal(h.calls(), 1, label); assert.deepEqual(fs.readdirSync(lockOf(directory)).sort(), before, label); assert.equal(fresh(directory).length, 0, label);
    }
  });

  await check('a late breaker cannot move a fresh lock onto an earlier abandoned one', async () => {
    const directory = privateDir(join(root, 'lock-late')), instance = randomUUID();
    privateDir(join(directory + '-archive', '.broken-locks', instance)); fs.writeFileSync(join(directory + '-archive', '.broken-locks', instance, 'owner.json'), '{}', { mode: 0o600 });
    privateDir(join(directory, '.capture-lock')); fs.writeFileSync(join(directory, '.capture-lock', 'owner.json'), JSON.stringify({ schema: 1, instance, writer: writer(DEAD) }), { mode: 0o600 });
    const h = harness(directory);
    await h.call();
    assert(fs.existsSync(join(directory, '.capture-lock', 'owner.json')), 'rename onto a non-empty target fails; the lock stays');
    assert.equal(fresh(directory).length, 0); assert.equal(h.calls(), 1);
  });

  await check('a holder records itself in owner.json while it holds the lock, and removes it on release', async () => {
    const directory = privateDir(join(root, 'lock-owner'));
    receipt(directory, { tail: 'capture_checkpoint', owner: writer(DEAD), ageMs: 3 * 24 * 60 * minutes });
    let seen;
    const spy = value => { seen ??= JSON.parse(fs.readFileSync(join(directory, '.capture-lock', 'owner.json'), 'utf8')); return exited(value); };
    const h = harness(directory, { maxFiles: 1, exited: spy });
    await h.call();
    assert.equal(seen.schema, 1); assert.deepEqual(seen.writer, self); assert.match(seen.instance, /^[a-f0-9-]{36}$/);
    assert(!fs.existsSync(join(directory, '.capture-lock')));
  });

  // Status sweep.
  const status = join(root, 'status'), marker = (session, instance, pid, owner) => {
    const folder = privateDir(join(status, session)); privateDir(join(status, '.instances'));
    fs.writeFileSync(join(folder, instance + '.json'), JSON.stringify({ schema: 1, providerSession: session, pid, instance, runtimeVersion: '1.5.2', state: 'ready' }), { mode: 0o600 });
    if (owner) fs.writeFileSync(join(status, '.instances', instance + '.json'), JSON.stringify({ schema: 1, instance, writer: owner }), { mode: 0o600 });
    return join(folder, instance + '.json');
  };
  const old = path => { const time = new Date(Date.now() - 60 * minutes); fs.utimesSync(path, time, time); };
  const sessionCtx = session => ({ sessionManager: { getSessionId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', getSessionFile: () => `/fixture/${session}.jsonl` }, ui: { notify() {} } });

  await check('status sweep removes dead markers, old temp files and old empty folders; keeps everything ambiguous', () => {
    const s = n => 'pi_' + String(n).repeat(8) + '-1111-4111-8111-111111111111';
    const dead = marker(s(2), randomUUID(), DEAD, writer(DEAD));
    const live = marker(s(3), randomUUID(), ALIVE, writer(ALIVE));
    const legacy = marker(s(4), randomUUID(), DEAD); // pre-change marker: no identity record
    const mismatch = marker(s(5), randomUUID(), ALIVE, writer(DEAD)); // record pid differs from marker pid
    const temp = join(privateDir(join(status, s(6))), '.ready-x-y'); fs.writeFileSync(temp, '{}', { mode: 0o600 }); old(temp);
    const recentTemp = join(privateDir(join(status, s(7))), '.ready-x-z'); fs.writeFileSync(recentTemp, '{}', { mode: 0o600 });
    const emptyOld = privateDir(join(status, s(8))); old(emptyOld);
    const emptyRecent = privateDir(join(status, s(9)));
    fs.writeFileSync(join(status, s(2), 'notes.txt'), 'foreign', { mode: 0o600 });
    const legacyRoot = privateDir(join(root, 'session-credits-status')); fs.writeFileSync(join(legacyRoot, 'x'), 'legacy');
    const readiness = createReadiness(status, '1.5.2', { exited, writerIdentity: () => self, random: () => 0 });
    readiness.start(sessionCtx('pi_00000000-0000-4000-8000-000000000000'));
    assert(!fs.existsSync(dead)); assert(!fs.existsSync(join(status, '.instances', dead.split('/').at(-1))), 'its identity record goes with it');
    assert(fs.existsSync(live)); assert(fs.existsSync(legacy)); assert(fs.existsSync(mismatch));
    assert(!fs.existsSync(temp)); assert(fs.existsSync(recentTemp));
    assert(!fs.existsSync(emptyOld)); assert(fs.existsSync(emptyRecent));
    assert(fs.existsSync(join(status, s(2), 'notes.txt')));
    assert.deepEqual(fs.readdirSync(legacyRoot), ['x']);
    assert.equal(readReadiness(status, 'pi_00000000-0000-4000-8000-000000000000').state, 'ready', 'own marker untouched');
    const own = fs.readdirSync(join(status, '.instances'));
    assert(own.length >= 1);
    readiness.stop();
    assert.equal(fs.readdirSync(join(status, '.instances')).length, own.length - 1, 'own identity record removed on stop');
  });

  await check('status sweep is bounded, runs at most every 10 minutes, and reaches every folder across restarts', () => {
    const many = join(root, 'status-many'), ids = Array.from({ length: 600 }, (_, n) => 'thr_fixture' + String(n).padStart(4, '0'));
    const markers = ids.map(session => { const folder = privateDir(join(many, session)), instance = randomUUID(); privateDir(join(many, '.instances')); fs.writeFileSync(join(folder, instance + '.json'), JSON.stringify({ schema: 1, providerSession: session, pid: DEAD, instance, runtimeVersion: '1.5.2', state: 'ready' }), { mode: 0o600 }); fs.writeFileSync(join(many, '.instances', instance + '.json'), JSON.stringify({ schema: 1, instance, writer: writer(DEAD) }), { mode: 0o600 }); return join(folder, instance + '.json'); });
    const remaining = () => markers.filter(path => fs.existsSync(path)).length;
    let clock = Date.now(), offset = 0;
    const first = createReadiness(many, '1.5.2', { exited, writerIdentity: () => self, now: () => clock, random: () => offset });
    first.start(sessionCtx('thr_ownfixture'));
    assert.equal(remaining(), 600 - 256, 'at most 256 folders per run');
    first.maintain(); assert.equal(remaining(), 600 - 256, 'inside 10 minutes');
    clock += 11 * minutes; offset = 0.5; first.maintain(); assert(remaining() < 600 - 256, 'agent_end sweeps again later');
    for (const value of [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9]) { offset = value; const next = createReadiness(many, '1.5.2', { exited, writerIdentity: () => self, now: () => clock, random: () => offset }); next.start(sessionCtx('thr_ownfixture')); next.stop(); }
    assert.equal(remaining(), 0, 'restarts at other offsets reach every folder');
    first.stop();
  });

  await check('a marker write survives a sweep removing its session folder between ensure and rename', () => {
    const dir = join(root, 'status-race'), session = 'pi_12121212-1212-4121-8121-121212121212';
    const readiness = createReadiness(dir, '1.5.2', { exited, writerIdentity: () => self });
    const original = fs.renameSync; let raced = false;
    fs.renameSync = (from, to) => { if (!raced && to.includes(session)) { raced = true; fs.rmSync(join(dir, session), { recursive: true }); } return original(from, to); };
    syncBuiltinESMExports();
    try { readiness.start(sessionCtx(session)); } finally { fs.renameSync = original; syncBuiltinESMExports(); }
    assert(raced); assert.equal(readReadiness(dir, session).state, 'ready');
    readiness.stop();
  });

  console.log(JSON.stringify(results, null, 2));
  if (results.some(row => row.status === 'failed')) process.exitCode = 1;
} finally { fs.rmSync(root, { recursive: true, force: true }); }
