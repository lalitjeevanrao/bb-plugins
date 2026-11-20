import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { constants } from "node:fs";
import { open, lstat, realpath, readdir, opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hostContract, emptyUsage, readinessSchema, isPiSession, type Usage } from "./contract";
import { readReadiness } from "./collector/readiness.mjs";
import { piUsage, cliUsage, slimRows } from "./accounting.mjs";

const defaultPiRoots = [
  join(homedir(), ".pi", "agent", "copilot-session-credits"),
  join(homedir(), ".pi", "agent", "session-credits"), // Read-only compatibility with pre-0.3 receipts.
];
const defaultStatusRoots = [
  join(homedir(), ".pi", "agent", "copilot-session-credits-status"),
  join(homedir(), ".pi", "agent", "session-credits-status"), // Read-only compatibility with pre-0.3 startup status.
];
const uuidFile = /^[a-f0-9-]{36}\.jsonl$/i;
type FileStat = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number; mode: number; nlink: number; uid: number };
const statKey = (stat: FileStat) => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode, stat.nlink, stat.uid].join(":");
async function safeFile(path: string, limit: number, { tail = false, head = false, privateMode = false, onStat }: { tail?: boolean; head?: boolean; privateMode?: boolean; onStat?: (stat: FileStat) => void } = {}) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    onStat?.(stat);
    if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) throw Error("unsafe-file");
    if (privateMode && (stat.mode & 0o077)) throw Error("non-private-file");
    if (!tail && !head && stat.size > limit) throw Error("read-limit");
    const start = tail ? Math.max(0, stat.size - limit) : 0;
    const buffer = Buffer.alloc(Math.min(limit, stat.size));
    let offset = 0;
    while (offset < buffer.length) {
      const read = await file.read(buffer, offset, buffer.length - offset, start + offset);
      if (!read.bytesRead) break; offset += read.bytesRead;
    }
    const parts = buffer.subarray(0, offset).toString("utf8").split("\n");
    if (start) parts.shift(); parts.pop(); // Never parse a torn last record.
    return parts.filter(line => Buffer.byteLength(line) <= 262144);
  } finally { await file.close(); }
}
async function privateDirectory(path: string, privateMode = false) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path || (process.getuid && stat.uid !== process.getuid())) throw Error("unsafe-directory");
  if (privateMode && (stat.mode & 0o077)) throw Error("non-private-directory");
}
const defaultBridgeDir = () => { const custom = process.env.BB_PI_BRIDGE_SESSION_DIR?.trim(); return custom ? resolve(custom) : join(homedir(), ".bb", "pi-bridge-sessions"); };
const nativeHash = (id: string) => createHash("sha256").update("pi-session-v2\0" + id.toLowerCase()).digest("hex");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Receipts written before 0.3.4 carry `providerSession: null` for `thr_<id>` sessions. Recover them only by the
// native session hash of that exact BB bridge file header; prompts and messages are never read (4 KiB head only).
async function bridgeHash(bridgeDir: string | null, session: string) {
  if (!bridgeDir || !session.startsWith("thr_")) return null;
  try {
    await privateDirectory(bridgeDir);
    const [line] = await safeFile(join(bridgeDir, session + ".jsonl"), 4096, { head: true });
    const header = JSON.parse(line ?? "null");
    return header?.type === "session" && typeof header.id === "string" && UUID.test(header.id) ? nativeHash(header.id) : null;
  } catch { return null; }
}
const shardLimit = 4096;
// Parsed receipts, reused while the file's lstat is unchanged (archived receipts never change). Bounded by the
// source bytes they stand for; least recently used first out.
type Receipt = { key: string; bytes: number; first: any; full?: { rows: any[]; damaged: boolean } };
export class ReceiptCache {
  private entries = new Map<string, Receipt>();
  private bytes = 0;
  constructor(private limit = 64 * 1048576) {}
  get(path: string, key: string) {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    this.entries.delete(path);
    if (entry.key !== key) { this.bytes -= entry.bytes; return undefined; }
    this.entries.set(path, entry);
    return entry;
  }
  set(path: string, entry: Receipt) {
    const previous = this.entries.get(path);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(path); }
    if (entry.bytes > this.limit) return;
    this.entries.set(path, entry); this.bytes += entry.bytes;
    for (const [oldest, value] of this.entries) { if (this.bytes <= this.limit) break; this.entries.delete(oldest); this.bytes -= value.bytes; }
  }
  get size() { return this.bytes; }
  clear() { this.entries.clear(); this.bytes = 0; }
}
// Lists at most `limit + 1` names so an oversized archive shard is detected without reading it all.
async function listUpTo(path: string, limit: number) {
  const names: string[] = [], dir = await opendir(path);
  try { for await (const entry of dir) { names.push(entry.name); if (names.length > limit) break; } }
  finally { try { await dir.close(); } catch {} }
  return names;
}
// Roots are read in this order: the capture root, then the archive shards of the requested sessions, then the
// legacy roots. The collector only moves receipts from the capture root into the archive, so a receipt that moves
// while BB reads is found in its shard later. Each `<epoch>.jsonl` name counts once.
async function readPi(sessions: string[], piRoots: string[], bridgeDir: string | null, archiveRoot: string | null, cache: ReceiptCache) {
  const records: any[] = [];
  let damaged = false, budget = 8388608;
  const health: string[] = [];
  const issues: Usage["issues"] = [];
  const wanted = new Set(sessions), hashes = new Map<string, Set<string>>(), recover = new Map<string, string>();
  const seen = new Set<string>(), unreadable = new Set<string>();
  for (const session of sessions) { const value = await bridgeHash(bridgeDir, session); if (value) recover.set(value, session); }
  // The read budget counts only bytes read from disk in this refresh. Cached receipts cost one lstat. When the
  // budget runs out, the result is marked damaged for this refresh and later refreshes read the rest.
  const readReceipt = async (path: string, name: string) => {
    if (seen.has(name)) return;
    try {
      const link = await lstat(path);
      if (!link.isFile() || link.nlink !== 1 || (process.getuid && link.uid !== process.getuid()) || (link.mode & 0o077)) throw Error("unsafe-file");
      let entry = cache.get(path, statKey(link));
      if (!entry) {
        let key = "";
        const head = await safeFile(path, 4096, { head: true, privateMode: true, onStat: stat => { key = statKey(stat); } });
        entry = { key, bytes: 4096, first: head.length ? JSON.parse(head[0]) : null };
        cache.set(path, entry);
      }
      const first = entry.first;
      if (!first || first.schema !== 3 || first.kind !== "capture_started" || first.epoch + ".jsonl" !== name || !/^[a-f0-9]{64}$/.test(first.nativeSessionHash)) { seen.add(name); return; }
      const owner = first.providerSession === null ? recover.get(first.nativeSessionHash) : wanted.has(first.providerSession) ? first.providerSession : undefined;
      if (!owner) { seen.add(name); return; }
      if (!hashes.has(owner)) hashes.set(owner, new Set());
      hashes.get(owner)!.add(first.nativeSessionHash);
      if (!entry.full) {
        if (budget <= 0) { damaged = true; return; }
        let key = "", size = 0;
        const lines = await safeFile(path, 1048576, { privateMode: true, onStat: stat => { key = statKey(stat); size = stat.size; } });
        budget -= lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);
        const rows = [];
        let rowsDamaged = false;
        for (const line of lines) {
          const row = JSON.parse(line);
          if (row.schema !== 3 || row.providerSession !== first.providerSession || row.nativeSessionHash !== first.nativeSessionHash || row.epoch !== first.epoch || row.seq !== rows.length + 1) throw Error("invalid-capture");
          if (row.kind === "capture_truncated" || row.dropped > 0 || row.missedCalls > 0 || (row.kind === "capture_stopped" && row.inFlight > 0)) rowsDamaged = true;
          rows.push(row);
        }
        entry = { key, bytes: Math.max(size, 4096), first: rows[0] ?? first, full: { rows: slimRows(rows), damaged: rowsDamaged } };
        cache.set(path, entry);
      }
      if (entry.full!.damaged) damaged = true;
      seen.add(name);
      records.push(...entry.full!.rows);
    } catch (error: any) {
      // Gone: moved into the archive (read later) or removed. Unreadable here: damaged only if no other root has it.
      if (error.code !== "ENOENT") unreadable.add(name);
    }
  };
  const readArchive = async () => {
    if (!archiveRoot) return;
    try { await privateDirectory(archiveRoot, true); } catch (error: any) { if (error.code !== "ENOENT") damaged = true; return; }
    const shards = [...new Set([...sessions, ...[...recover.keys()].map(hash => "h_" + hash)])];
    for (const shard of shards) {
      const path = join(archiveRoot, shard);
      let names: string[];
      try { await privateDirectory(path, true); names = await listUpTo(path, shardLimit); }
      catch (error: any) { if (error.code !== "ENOENT") damaged = true; continue; }
      if (names.length > shardLimit) { damaged = true; continue; }
      for (const name of names.filter(name => uuidFile.test(name))) await readReceipt(join(path, name), name);
    }
  };
  for (const root of piRoots) {
    try {
      await privateDirectory(root, true);
      const names = await readdir(root);
      if (root === piRoots[0]) {
        if (names.filter(name => name !== ".capture-lock").length >= 256) {
          issues.push("collector-full");
          health.push("Collector full. New captures blocked at 256 entries until closed receipts can be archived.");
        }
        if (names.includes(".capture-lock")) {
          try {
            const lock = await lstat(join(root, ".capture-lock"));
            const stale = Date.now() - lock.mtimeMs > 60000;
            issues.push(stale ? "stale-lock" : "allocation-busy");
            health.push(stale ? "Capture allocation lock is over 60 seconds old." : "Capture allocation is busy.");
          } catch (error: any) { if (error.code !== "ENOENT") throw error; }
        }
      }
      if (names.length > 257) damaged = true;
      else for (const name of names.filter(name => uuidFile.test(name))) await readReceipt(join(root, name), name);
    } catch (error: any) { if (error.code !== "ENOENT") damaged = true; }
    if (root === piRoots[0]) await readArchive();
  }
  if ([...unreadable].some(name => !seen.has(name))) damaged = true;
  // A `pi_<uuid>` file maps to one native session. A `thr_<id>` file is re-forked on every edit, so it may
  // legitimately span several native sessions of the same BB thread.
  if ([...hashes].some(([session, set]) => set.size > 1 && !session.startsWith("thr_"))) return emptyUsage("Multiple native Pi identities for this provider session; refusing ambiguous total");
  const result = piUsage(records);
  result.captureIssue = damaged || health.length > 0;
  if (damaged) {
    issues.push("capture-damaged");
    health.push("Some receipts are unreadable, invalid or incomplete.");
  }
  if (health.length) result.reason = health.join(" ");
  return { ...result, issues };
}
async function readCli(sessionId: string, root: string) {
  const dir = join(root, sessionId);
  await privateDirectory(root); await privateDirectory(dir);
  const lines = await safeFile(join(dir, "events.jsonl"), 8388608, { tail: true });
  let latest = null;
  for (const line of lines) {
    if (!line.includes('"session.usage_checkpoint"')) continue;
    try { const row = JSON.parse(line); if (row.type === "session.usage_checkpoint") latest = { data: { totalNanoAiu: row.data?.totalNanoAiu, accountingSnapshot: { aiCreditsStatus: row.data?.accountingSnapshot?.aiCreditsStatus } }, timestamp: row.timestamp }; } catch {}
  }
  return cliUsage(latest);
}
// The collector's archive is a sibling of the capture root (`piRoots[0]`); see docs/cleanup.md.
export function createHostEntry(piRoots = defaultPiRoots, cliRoot = join(homedir(), ".copilot", "session-state"), statusRoot: string | string[] = defaultStatusRoots, bridgeDir: string | null = defaultBridgeDir(), archiveRoot: string | null = piRoots[0] ? piRoots[0] + "-archive" : null) {
const cache = new Map<string, { at: number; value: Promise<any> }>(), receipts = new ReceiptCache();
return experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    read: async ({ provider, sessionId, sessionIds = [] }) => {
      if ((provider === "pi") !== isPiSession(sessionId)) return emptyUsage("Invalid provider session identity");
      // Every Pi session that ever backed this BB thread (start, resume, edit forks); the latest one sets readiness.
      const sessions = provider === "pi" ? [...new Set([...sessionIds.filter(isPiSession), sessionId])] : [sessionId];
      const key = provider + ":" + sessions.join(","), previous = cache.get(key);
      const readiness = provider === "pi" ? readinessSchema.parse(readReadiness(statusRoot, sessionId)) : undefined;
      if (previous && Date.now() - previous.at < 3000) return { ...await previous.value, ...(readiness ? { readiness } : {}) };
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      const value = (provider === "pi" ? readPi(sessions, piRoots, bridgeDir, archiveRoot, receipts) : readCli(sessionId, cliRoot)).catch(() => emptyUsage("Host telemetry unavailable.", ["host-unavailable"]));
      cache.set(key, { at: Date.now(), value }); return { ...await value, ...(readiness ? { readiness } : {}) };
    },
  },
  dispose: () => { cache.clear(); receipts.clear(); },
});
}
export default createHostEntry();
