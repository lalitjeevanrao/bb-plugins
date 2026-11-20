import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, opendirSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { processIdentity, validIdentity, writerExited } from './identity.mjs';

const SESSION = /^(pi_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|thr_[a-zA-Z0-9_-]{1,100})$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATES = new Set(['ready', 'unsupported', 'error', 'disabled']);
const owned = stat => !process.getuid || stat.uid === process.getuid();
const INSTANCES = '.instances', QUIET_MS = 600_000, SWEEP_MS = 600_000, SWEEP_DIRECTORIES = 256, SWEEP_FILES = 1024, FOLDER_FILES = 64, FOLDER_SCAN = 1_000_000;
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
function readPrivateJson(path) {
  safeDirectory(dirname(path));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || !owned(stat) || (stat.mode & 0o077) || stat.size < 1 || stat.size > 2048) throw Error('Unsafe readiness file');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) { const size = readSync(fd, buffer, offset, buffer.length - offset, offset); if (!size) break; offset += size; }
    return { value: JSON.parse(buffer.subarray(0, offset).toString()), stat };
  } finally { closeSync(fd); }
}
// `.instances/<instance>.json` holds the writer identity that lets a sweep prove a marker's process exited.
function readInstance(directory, instance) {
  const { value } = readPrivateJson(join(directory, INSTANCES, instance + '.json'));
  if (value?.schema !== 1 || value.instance !== instance || !validIdentity(value.writer) || Object.keys(value).sort().join(',') !== 'instance,schema,writer') throw Error('Invalid instance record');
  return value;
}
function readMarker(path, providerSession) {
  const { value, stat } = readPrivateJson(path);
  if (value.schema !== 1 || value.providerSession !== providerSession || !SESSION.test(value.providerSession) || !Number.isSafeInteger(value.pid) || value.pid < 1 || value.pid > 2147483647 || typeof value.instance !== 'string' || !UUID.test(value.instance) || basename(path) !== value.instance + '.json' || typeof value.runtimeVersion !== 'string' || !/^[0-9][0-9A-Za-z.+-]{0,63}$/.test(value.runtimeVersion) || !STATES.has(value.state) || Object.keys(value).sort().join(',') !== 'instance,pid,providerSession,runtimeVersion,schema,state') throw Error('Invalid readiness record');
  return { value, stat };
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
export function createReadiness(directory, runtimeVersion, { now = Date.now, random = Math.random, exited = writer => writerExited(writer), writerIdentity = processIdentity } = {}) {
  const instance = randomUUID(), instancePath = join(directory, INSTANCES, instance + '.json');
  let providerSession, state = 'ready', sweepAfter = 0;
  const path = () => join(directory, providerSession, instance + '.json');
  const removeInstance = () => {
    try { const { stat } = readPrivateJson(instancePath), current = lstatSync(instancePath); if (stat.dev === current.dev && stat.ino === current.ino) unlinkSync(instancePath); } catch {}
  };
  const remove = () => {
    if (!providerSession) return;
    try {
      const previous = readMarker(path(), providerSession);
      const current = lstatSync(path());
      if (previous.value.instance === instance && previous.stat.dev === current.dev && previous.stat.ino === current.ino) unlinkSync(path());
    } catch {}
    removeInstance();
    providerSession = undefined;
  };
  // Identity first, so a sweep can always prove this marker's process exited after a crash.
  const writeInstance = () => {
    const writer = writerIdentity();
    if (!writer) return;
    ensureDirectory(join(directory, INSTANCES));
    try { readInstance(directory, instance); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temp = join(directory, INSTANCES, `.ready-${instance}-${randomUUID()}`);
    try { writeFileSync(temp, JSON.stringify({ schema: 1, instance, writer }), { flag: 'wx', mode: 0o600 }); renameSync(temp, instancePath); }
    finally { try { unlinkSync(temp); } catch {} }
  };
  const write = () => {
    if (!providerSession) return;
    // A concurrent sweep may remove an empty session directory between ensure and rename: retry once.
    for (let attempt = 0; attempt < 2; attempt++) {
      let temp;
      try {
        ensureDirectory(directory);
        try { writeInstance(); } catch {}
        ensureDirectory(join(directory, providerSession));
        try { readMarker(path(), providerSession); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        temp = join(directory, providerSession, `.ready-${instance}-${randomUUID()}`);
        writeFileSync(temp, JSON.stringify({ schema: 1, providerSession, pid: process.pid, instance, runtimeVersion, state }), { flag: 'wx', mode: 0o600 });
        renameSync(temp, path());
        return;
      } catch (error) {
        if (error.code === 'ENOENT' && attempt === 0) continue;
        process.stderr.write('Copilot session credits: readiness could not be written safely.\n');
        return;
      } finally { if (temp) { try { unlinkSync(temp); } catch {} } }
    }
  };
  // Removes status leftovers of processes that provably exited: markers with an identity record, abandoned
  // `.ready-*` temp files and empty session directories, all unchanged for 10 minutes where age applies.
  // Bounded per run; starts at a random directory so repeated short runs still reach every directory.
  const sweep = () => {
    const time = now();
    if (time < sweepAfter) return;
    sweepAfter = time + SWEEP_MS;
    try { safeDirectory(directory); } catch { return; }
    const sessions = readdirSync(directory).filter(name => SESSION.test(name)).sort();
    const start = Math.floor(random() * sessions.length);
    let files = 0;
    for (let index = 0; index < Math.min(SWEEP_DIRECTORIES, sessions.length) && files < SWEEP_FILES; index++) {
      const session = sessions[(start + index) % sessions.length], folder = join(directory, session);
      try {
        const folderStat = lstatSync(folder);
        safeDirectory(folder);
        // Only marker and temp names are candidates; foreign names cost one directory read each and nothing else.
        // A uniform random sample (reservoir) of at most 64 candidates means no position in the folder can starve.
        const names = [], dir = opendirSync(folder);
        let candidates = 0;
        try {
          let entry, scanned = 0;
          while (scanned++ < FOLDER_SCAN && (entry = dir.readSync())) {
            const name = entry.name;
            if (!((name.endsWith('.json') && UUID.test(name.slice(0, -5))) || name.startsWith('.ready-'))) continue;
            candidates++;
            if (names.length < FOLDER_FILES) names.push(name);
            else { const slot = Math.floor(random() * candidates); if (slot < FOLDER_FILES) names[slot] = name; }
          }
        } finally { dir.closeSync(); }
        for (const name of names) {
          if (++files > SWEEP_FILES) break;
          const file = join(folder, name);
          try {
            if (name.endsWith('.json') && UUID.test(name.slice(0, -5)) && name !== instance + '.json') {
              const { value, stat } = readMarker(file, session);
              const record = readInstance(directory, value.instance);
              if (record.writer.pid !== value.pid || !exited(record.writer)) continue;
              const current = lstatSync(file);
              if (current.dev !== stat.dev || current.ino !== stat.ino) continue;
              unlinkSync(file);
              unlinkSync(join(directory, INSTANCES, value.instance + '.json')); // Validated above; owned by the exited writer.
            } else if (name.startsWith('.ready-')) {
              const stat = lstatSync(file);
              if (stat.isFile() && !stat.isSymbolicLink() && owned(stat) && time - stat.mtimeMs >= QUIET_MS) unlinkSync(file);
            }
          } catch {} // Invalid, unsafe or ambiguous entries stay.
        }
        if (time - folderStat.mtimeMs >= QUIET_MS && readdirSync(folder).length === 0) rmdirSync(folder);
      } catch {}
    }
  };
  return {
    start(ctx) {
      remove();
      const file = ctx.sessionManager.getSessionFile(), id = ctx.sessionManager.getSessionId();
      const name = typeof file === 'string' ? basename(file) : '';
      if (!UUID.test(id ?? '') || !name.endsWith('.jsonl') || !SESSION.test(name.slice(0, -6))) return;
      providerSession = name.slice(0, -6); write();
      try { sweep(); } catch {}
    },
    update(next) { if (STATES.has(next)) { state = next; write(); } },
    maintain() { try { sweep(); } catch {} },
    stop: remove,
  };
}
