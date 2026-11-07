import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { constants } from "node:fs";
import { open, lstat, realpath, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hostContract, emptyUsage, readinessSchema, type Usage } from "./contract";
import { readReadiness } from "./collector/readiness.mjs";
import { piUsage, cliUsage } from "./accounting.mjs";

const defaultPiRoots = [
  join(homedir(), ".pi", "agent", "copilot-session-credits"),
  join(homedir(), ".pi", "agent", "session-credits"), // Read-only compatibility with pre-0.3 receipts.
];
const defaultStatusRoots = [
  join(homedir(), ".pi", "agent", "copilot-session-credits-status"),
  join(homedir(), ".pi", "agent", "session-credits-status"), // Read-only compatibility with pre-0.3 startup status.
];
const uuidFile = /^[a-f0-9-]{36}\.jsonl$/i;
async function safeFile(path: string, limit: number, { tail = false, head = false, privateMode = false }: { tail?: boolean; head?: boolean; privateMode?: boolean } = {}) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
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
async function readPi(sessionId: string, piRoots: string[]) {
  const records: any[] = [];
  let damaged = false, budget = 8388608;
  const health: string[] = [];
  const issues: Usage["issues"] = [];
  const hashes = new Set<string>();
  for (const root of piRoots) {
    try {
      await privateDirectory(root, true);
      const names = await readdir(root);
      if (root === piRoots[0]) {
        if (names.filter(name => name !== ".capture-lock").length >= 256) {
          issues.push("collector-full");
          health.push("Collector full. New captures blocked at 256 entries. Stop Pi before archiving receipts.");
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
      if (names.length > 257) { damaged = true; continue; }
      for (const name of names.filter(name => uuidFile.test(name))) {
        try {
          const path = join(root, name), head = await safeFile(path, 4096, { head: true, privateMode: true });
          if (!head.length) continue;
          const first = JSON.parse(head[0]);
          if (first.schema !== 3 || first.kind !== "capture_started" || first.providerSession !== sessionId || first.epoch + ".jsonl" !== name || !/^[a-f0-9]{64}$/.test(first.nativeSessionHash)) continue;
          hashes.add(first.nativeSessionHash);
          const lines = await safeFile(path, 1048576, { privateMode: true });
          budget -= lines.reduce((size, line) => size + Buffer.byteLength(line) + 1, 0);
          if (budget < 0) { damaged = true; break; }
          const rows = [];
          for (const line of lines) {
            const row = JSON.parse(line);
            if (row.schema !== 3 || row.providerSession !== sessionId || row.nativeSessionHash !== first.nativeSessionHash || row.epoch !== first.epoch || row.seq !== rows.length + 1) throw Error("invalid-capture");
            if (row.kind === "capture_truncated" || row.dropped > 0 || row.missedCalls > 0 || (row.kind === "capture_stopped" && row.inFlight > 0)) damaged = true;
            rows.push(row);
          }
          records.push(...rows);
        } catch { damaged = true; }
      }
    } catch (error: any) { if (error.code !== "ENOENT") damaged = true; }
  }
  if (hashes.size > 1) return emptyUsage("Multiple native Pi identities for this provider session; refusing ambiguous total");
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
export function createHostEntry(piRoots = defaultPiRoots, cliRoot = join(homedir(), ".copilot", "session-state"), statusRoot: string | string[] = defaultStatusRoots) {
const cache = new Map<string, { at: number; value: Promise<any> }>();
return experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    read: async ({ provider, sessionId }) => {
      if ((provider === "pi") !== sessionId.startsWith("pi_")) return emptyUsage("Invalid provider session identity");
      const key = provider + ":" + sessionId, previous = cache.get(key);
      const readiness = provider === "pi" ? readinessSchema.parse(readReadiness(statusRoot, sessionId)) : undefined;
      if (previous && Date.now() - previous.at < 3000) return { ...await previous.value, ...(readiness ? { readiness } : {}) };
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      const value = (provider === "pi" ? readPi(sessionId, piRoots) : readCli(sessionId, cliRoot)).catch(() => emptyUsage("Host telemetry unavailable.", ["host-unavailable"]));
      cache.set(key, { at: Date.now(), value }); return { ...await value, ...(readiness ? { readiness } : {}) };
    },
  },
  dispose: () => { cache.clear(); },
});
}
export default createHostEntry();
