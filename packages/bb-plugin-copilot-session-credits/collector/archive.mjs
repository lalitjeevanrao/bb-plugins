// Moves provably closed receipts from the capture root into a private sibling archive.
// Callers hold `.capture-lock`. Nothing is deleted or overwritten: a receipt moves with link + unlink,
// keeping its inode, owner and mode. Anything that is not provably closed stays where it is.
import { constants, closeSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const RECEIPT_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.jsonl$/i;
export const SHARD_LIMIT = 1024;
const SESSION = /^(pi_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|thr_[a-zA-Z0-9_-]{1,100})$/i;
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(['capture_stopped', 'capture_truncated']);
const MAX_FILE = 1_048_576, MAX_LINE = 262_144, TAIL = 4096;
const owned = stat => !process.getuid || stat.uid === process.getuid();

export const archivePath = directory => directory + '-archive';
// The archive shard for a receipt: its BB provider session, or its native hash when the session is null.
export const shardName = (providerSession, nativeSessionHash) => providerSession === null ? (HASH.test(nativeSessionHash ?? '') ? 'h_' + nativeSessionHash : null) : SESSION.test(providerSession ?? '') ? providerSession : null;
export const archiveLimits = maxFiles => {
  const archiveTo = Math.floor(maxFiles * 3 / 4);
  return { archiveTo, archiveAt: Math.max(archiveTo + 1, Math.floor(maxFiles * 7 / 8)) };
};

export function privateDirectory(path, device) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path || !owned(stat) || (stat.mode & 0o077) || (device !== undefined && stat.dev !== device)) throw Error('Unsafe archive directory');
  return stat;
}
function ensureDirectory(path, device) {
  try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(path, device);
}
// Counts entries up to `limit + 1` without listing a huge directory.
function countUpTo(path, limit) {
  const dir = opendirSync(path);
  let count = 0;
  try { while (count <= limit && dir.readSync()) count++; } finally { dir.closeSync(); }
  return count;
}
function readAt(fd, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const size = readSync(fd, buffer, offset, length - offset, position + offset);
    if (!size) break;
    offset += size;
  }
  if (offset !== length) throw Error('Receipt changed while reading');
  return buffer;
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Returns false when the last complete row is provably not terminal, true when it is terminal,
// and null when the tail window cannot tell (the full read decides).
function tailIsTerminal(fd, size) {
  const length = Math.min(TAIL, size), text = readAt(fd, length, size - length).toString('utf8');
  if (!text.endsWith('\n')) return false; // Torn or still being written.
  const previous = text.lastIndexOf('\n', text.length - 2);
  if (previous < 0 && length < size) return null;
  try {
    const row = JSON.parse(text.slice(previous + 1, -1));
    return record(row) && TERMINAL.has(row.kind);
  } catch { return null; }
}

// Full schema-3 closure proof. Returns the archive shard, or null when the receipt must stay.
function closedShard(fd, size, name) {
  const text = readAt(fd, size, 0).toString('utf8');
  if (!text.endsWith('\n')) return null;
  const lines = text.slice(0, -1).split('\n');
  let first, terminals = 0;
  for (const [index, line] of lines.entries()) {
    if (Buffer.byteLength(line) > MAX_LINE) return null;
    let row;
    try { row = JSON.parse(line); } catch { return null; }
    if (!record(row) || row.schema !== 3 || row.seq !== index + 1) return null;
    if (index === 0) {
      if (row.kind !== 'capture_started' || row.epoch + '.jsonl' !== name || !HASH.test(row.nativeSessionHash ?? '')) return null;
      first = row;
    } else if (row.epoch !== first.epoch || row.providerSession !== first.providerSession || row.nativeSessionHash !== first.nativeSessionHash) return null;
    if (TERMINAL.has(row.kind)) terminals++;
  }
  const last = JSON.parse(lines.at(-1));
  if (terminals !== 1 || !TERMINAL.has(last.kind)) return null;
  return shardName(first.providerSession, first.nativeSessionHash);
}

// Opens a receipt by name and checks it is the inode `expected` describes. `links` is the accepted nlink.
function inspect(directory, name, expected, links, budget) {
  const fd = openSync(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino || stat.nlink !== links || !owned(stat) || (stat.mode & 0o077) || stat.size < 1 || stat.size > MAX_FILE) return { shard: null, stat };
    const tail = tailIsTerminal(fd, stat.size);
    budget.bytes -= Math.min(TAIL, stat.size);
    if (tail === false) return { shard: null, stat };
    budget.bytes -= stat.size;
    return { shard: closedShard(fd, stat.size, name), stat };
  } finally { closeSync(fd); }
}

const sameInode = (a, b) => a.dev === b.dev && a.ino === b.ino;

// Lists capture-root receipts (lstat only) and whether any is a half-finished move.
export function scanReceipts(directory) {
  const names = readdirSync(directory), receipts = [];
  for (const name of names) {
    if (!RECEIPT_NAME.test(name)) continue;
    try {
      const stat = lstatSync(join(directory, name));
      if (stat.isFile() && !stat.isSymbolicLink()) receipts.push({ name, stat });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { count: names.filter(name => name !== '.capture-lock').length, receipts, needsRepair: receipts.some(receipt => receipt.stat.nlink === 2) };
}

/**
 * Archive closed receipts until the root holds at most `target` entries. The caller holds `.capture-lock`
 * and has checked `directory` (its lstat is `root`). Bounded by `maxMoves` and `maxBytes` per run.
 * Returns counts; throws only on unexpected errors, which the caller ignores.
 */
export function archiveClosedReceipts({ directory, root, target, sweep = true, maxMoves = 64, maxBytes = 16 * MAX_FILE }) {
  const result = { moved: 0, repaired: 0, collisions: 0, kept: 0 };
  const { count, receipts } = scanReceipts(directory);
  let entries = count, archive, archiveStat;
  const budget = { bytes: maxBytes };
  const shardDirectory = shard => {
    if (!archive) { archive = archivePath(directory); archiveStat = ensureDirectory(archive, root.dev); }
    const path = join(archive, shard);
    ensureDirectory(path, archiveStat.dev);
    return path;
  };
  // Finish moves a crash interrupted between link and unlink: both names share one inode.
  for (const { name, stat } of receipts.filter(receipt => receipt.stat.nlink === 2)) {
    if (budget.bytes <= 0) break;
    let finish = false;
    try {
      const { shard } = inspect(directory, name, stat, 2, budget);
      if (shard) {
        privateDirectory(archivePath(directory), root.dev); privateDirectory(join(archivePath(directory), shard), root.dev);
        finish = sameInode(lstatSync(join(archivePath(directory), shard, name)), stat) && sameInode(lstatSync(join(directory, name)), stat);
      }
    } catch {}
    if (!finish) { result.kept++; continue; }
    unlinkSync(join(directory, name));
    result.repaired++; entries--;
  }
  if (!sweep) return result;
  const candidates = receipts.filter(receipt => receipt.stat.nlink === 1).sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs || (a.name < b.name ? -1 : 1));
  for (const { name, stat } of candidates) {
    if (entries <= target || result.moved >= maxMoves || budget.bytes <= 0) break;
    let shard;
    try { ({ shard } = inspect(directory, name, stat, 1, budget)); } catch { shard = null; } // Vanished, swapped or unreadable: keep.
    if (!shard) { result.kept++; continue; }
    const shardPath = shardDirectory(shard);
    if (countUpTo(shardPath, SHARD_LIMIT) >= SHARD_LIMIT) { result.kept++; continue; } // Keep every shard readable by BB.
    const source = join(directory, name), destination = join(shardPath, name);
    try { linkSync(source, destination); }
    catch (error) { if (error.code === 'EEXIST') { result.collisions++; continue; } throw error; }
    const linked = lstatSync(destination), current = lstatSync(source);
    if (!sameInode(linked, stat) || !sameInode(current, stat) || linked.nlink !== 2) throw Error('Archive link changed');
    unlinkSync(source);
    result.moved++; entries--;
  }
  return result;
}
