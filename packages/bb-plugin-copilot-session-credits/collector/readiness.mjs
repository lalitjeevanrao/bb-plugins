import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, opendirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const SESSION = /^pi_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATES = new Set(['ready', 'unsupported', 'error', 'disabled']);
const owned = stat => !process.getuid || stat.uid === process.getuid();
function safeDirectory(path, privateMode = true) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path || !owned(stat) || (stat.mode & (privateMode ? 0o077 : 0o022))) throw Error('Unsafe readiness directory');
}
function ensureDirectory(path, privateMode = true) {
  try { safeDirectory(path, privateMode); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ensureDirectory(dirname(path), false);
    try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    safeDirectory(path, privateMode);
  }
}
function readMarker(path, providerSession) {
  safeDirectory(dirname(path));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || !owned(stat) || (stat.mode & 0o077) || stat.size < 1 || stat.size > 2048) throw Error('Unsafe readiness file');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) { const size = readSync(fd, buffer, offset, buffer.length - offset, offset); if (!size) break; offset += size; }
    const value = JSON.parse(buffer.subarray(0, offset).toString());
    if (value.schema !== 1 || value.providerSession !== providerSession || !SESSION.test(value.providerSession) || !Number.isSafeInteger(value.pid) || value.pid < 1 || value.pid > 2147483647 || typeof value.instance !== 'string' || !UUID.test(value.instance) || basename(path) !== value.instance + '.json' || typeof value.runtimeVersion !== 'string' || !/^[0-9][0-9A-Za-z.+-]{0,63}$/.test(value.runtimeVersion) || !STATES.has(value.state) || Object.keys(value).sort().join(',') !== 'instance,pid,providerSession,runtimeVersion,schema,state') throw Error('Invalid readiness record');
    return { value, stat };
  } finally { closeSync(fd); }
}
export function readReadiness(directory, providerSession) {
  const unknown = reason => ({ state: 'unconfirmed', runtimeVersion: null, reason });
  if (!SESSION.test(providerSession)) return unknown('Provider session identity is unavailable.');
  try {
    const live = [];
    let candidateCount = 0;
    for (const root of Array.isArray(directory) ? directory : [directory]) {
      let names;
      const sessionDirectory = join(root, providerSession);
      try {
        safeDirectory(root); safeDirectory(sessionDirectory);
        names = []; const dir = opendirSync(sessionDirectory);
        try { let entry; while (names.length <= 16 && (entry = dir.readSync())) names.push(entry.name); } finally { dir.closeSync(); }
      } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (names.length > 16) return unknown('Too many readiness records; capture is unconfirmed.');
      const candidates = names.filter(name => UUID.test(name.slice(0, -5)) && name.endsWith('.json'));
      candidateCount += candidates.length;
      if (candidateCount > 8) return unknown('Too many readiness instances; capture is unconfirmed.');
      for (const name of candidates) {
        const marker = readMarker(join(sessionDirectory, name), providerSession).value;
        try { process.kill(marker.pid, 0); live.push(marker); } catch {}
      }
    }
    if (live.length !== 1) return unknown(live.length > 1 ? 'Multiple live collector instances; capture is ambiguous.' : 'No live collector startup record for this session.');
    const value = live[0];
    const reasons = { ready: 'Collector initialized for this session.', unsupported: 'This Pi runtime is unsupported. Pi 1.5.0+ is required.', error: 'Collector reported a setup or capture error. Check /copilot-probe status.', disabled: 'Capture is off. Run /copilot-probe on in this Pi session.' };
    return { state: value.state, runtimeVersion: value.runtimeVersion, reason: reasons[value.state] };
  } catch (error) {
    return unknown(error.code === 'ENOENT' ? 'No startup readiness record for this session.' : 'Readiness record could not be read safely.');
  }
}
export function createReadiness(directory, runtimeVersion) {
  const instance = randomUUID();
  let providerSession, state = 'ready';
  const path = () => join(directory, providerSession, instance + '.json');
  const remove = () => {
    if (!providerSession) return;
    try {
      const previous = readMarker(path(), providerSession);
      const current = lstatSync(path());
      if (previous.value.instance === instance && previous.stat.dev === current.dev && previous.stat.ino === current.ino) unlinkSync(path());
    } catch {}
    providerSession = undefined;
  };
  const write = () => {
    if (!providerSession) return;
    let temp;
    try {
      ensureDirectory(directory);
      ensureDirectory(join(directory, providerSession));
      try { readMarker(path(), providerSession); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      temp = join(directory, providerSession, `.ready-${instance}-${randomUUID()}`);
      writeFileSync(temp, JSON.stringify({ schema: 1, providerSession, pid: process.pid, instance, runtimeVersion, state }), { flag: 'wx', mode: 0o600 });
      renameSync(temp, path());
    } catch { process.stderr.write('Copilot session credits: readiness could not be written safely.\n'); }
    finally { if (temp) { try { unlinkSync(temp); } catch {} } }
  };
  return {
    start(ctx) {
      remove();
      const file = ctx.sessionManager.getSessionFile(), id = ctx.sessionManager.getSessionId();
      const name = typeof file === 'string' ? basename(file) : '';
      if (!UUID.test(id ?? '') || !name.endsWith('.jsonl') || !SESSION.test(name.slice(0, -6))) return;
      providerSession = name.slice(0, -6); write();
    },
    update(next) { if (STATES.has(next)) { state = next; write(); } },
    stop: remove,
  };
}
