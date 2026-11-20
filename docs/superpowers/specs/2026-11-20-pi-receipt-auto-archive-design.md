# Auto-archive closed Pi receipts (issue #21)

Status: approved with changes by the gate-1 review; its five findings are applied below. Scope: `copilot-session-credits` Pi collector and host reader.

## Problem

v0.3.4 refuses new captures at 256 entries in `~/.pi/agent/copilot-session-credits/`. The refusal throws inside `openCapture`, `ensure()` calls `fail()`, and capture stays off for the session until a session change or `/copilot-probe on`. The only recovery is moving the whole root while every Pi process is stopped, after which BB loses the history.

## Outcome

1. Full is recoverable. Copilot calls always run. A full refusal counts a missed call; it does not latch `failed`. The next call retries.
2. The collector moves the oldest **provably closed** receipts into a private sibling archive under `.capture-lock`, leaving headroom.
3. The host reader also reads the archive for the requested sessions only, so totals do not change and do not double.
4. No deletion anywhere.

## Closure proof

A receipt is eligible only when all of these hold. Anything else stays where it is.

- Name `<uuid>.jsonl` in the active root (not `.capture-lock`, not other names).
- `lstat` regular file, not a symlink, `nlink === 1`, owned by the user, mode `& 0o077 === 0`, size ≤ 1 MiB. Opened `O_RDONLY|O_NOFOLLOW`; `fstat` dev/ino equal the `lstat`.
- The file ends with `\n`. Every line parses as JSON, `schema === 3`, `seq === index + 1`, the same `epoch`, `providerSession` and `nativeSessionHash` on every row.
- Row 1 is `capture_started`, `epoch + ".jsonl" === name`, 64-hex `nativeSessionHash`, `providerSession` is `null` or a valid `pi_<uuid>` / `thr_<id>` name.
- The **last** row is `capture_stopped` or `capture_truncated`, and no earlier row is either of those.

Why this proves closure for every schema-3 writer in the new root (v0.3.0–v0.3.4, unchanged in this release):

- `stop()` writes `capture_stopped` and closes the fd in the same synchronous step, then drops the capture object. Late `call_finished` callbacks find `fd === undefined` and only count `dropped`.
- After `capture_truncated` the `truncated` latch makes every later `write` a no-op, including `capture_stopped`.
- Each file has exactly one writer (`O_CREAT|O_EXCL` with a random epoch).

Ineligible on purpose: live captures, files ending in `capture_checkpoint` / `capture_status` / `call_*` / `observation` (crash leftovers or live), torn last line, any parse or sequence error, foreign names, unsafe modes or links. Age and mtime are only used for ordering, never as proof.

## Archive layout

```
~/.pi/agent/copilot-session-credits-archive/        0700, canonical, owned, same device as the active root
  <shard>/                                         0700
    <epoch>.jsonl                                  same inode as before the move (mode, owner kept)
```

`<shard>` is the receipt's `providerSession` (`pi_<uuid>` or `thr_<id>`), or `h_<nativeSessionHash>` when `providerSession` is `null`. The reader can then open only the shards it needs.

The archive and shards are created lazily on the first move with `mkdir 0700`, then checked like the active root (not a symlink, canonical path, owned, private). An unsafe or foreign archive stops maintenance; nothing moves. The old manual `copilot-session-credits-archive-<timestamp>` roots are a different name and are not read.

## Move, no overwrite

Per file, under the lock:

1. `link(src, dst)`. `EEXIST` is a collision: leave `src`, count it, move on. Any other error: leave `src`, stop this run.
2. `lstat(dst)` and `lstat(src)` must both show the validated dev/ino with `nlink === 2`.
3. `unlink(src)`.

`rename` is not used because it replaces an existing destination. A crash between steps 1 and 3 leaves two names for one inode. The next run repairs it: an active `<uuid>.jsonl` with `nlink === 2` whose expected archive path has the same dev/ino is unlinked from the active root. Any other `nlink !== 1` file is left alone. `EXDEV` or a filesystem without hard links means nothing moves; the documented manual procedure still applies.

## When maintenance runs

Constants: `maxFiles = 256`, start at `archiveAt = 224`, archive down to `archiveTo = 192`. In general `archiveTo = floor(maxFiles * 3 / 4)` and `archiveAt = max(archiveTo + 1, floor(maxFiles * 7 / 8))`, so `archiveTo < archiveAt <= maxFiles` for every `maxFiles >= 1` (tests use small values).

- **Before allocation**, inside the existing `.capture-lock` section of `openCapture`: the `readdir` + `lstat` scan always runs. A `<uuid>.jsonl` with `nlink === 2` (crash leftover of a move) is repaired at once, whatever the count. If the count is `>= archiveAt`, the sweep runs, then the count is taken again. Any sweep that moves nothing backs off sweeping for 60 s in this process, at any count (the repair scan and the count still run every call), so space freed by another process or by hand is used at once.
- **Periodically while enabled**: `agent_end` runs the same `readdir` + `lstat` scan without taking the lock. It takes the lock (same `mkdir`; a busy lock is skipped, never stolen or aged out) when it finds a repair, or when the count is `>= archiveAt` and the last periodic sweep was more than 10 minutes ago and no back-off is active. No timers, so reloads cannot leak intervals.
- Never on idle startup, never when disabled, never creates the active root.

Bounds per run: at most 64 moves, at most 16 MiB read. Candidates are sorted oldest first by `lstat` mtime. A 4 KiB tail read rejects files whose last complete row is not terminal, or that do not end in `\n`, before any full read. If the window does not hold the whole last row, the full read decides.

Maintenance errors never reach the provider call and never set `failed`. If the count is still at the cap, the call runs without a capture.

## Full collector behaviour (collector)

- `openCapture` returns `'full'` instead of throwing. `ensure()` increments `missedCalls` and records the last miss reason (`full` or `busy`).
- `/copilot-probe status` reports `collector-full` (warning) next to the existing `capture-contended`.
- The next capture's `capture_started.missedCalls` stays > 0, so the reader keeps flagging *Missing data*. Missed usage is never claimed as recovered.
- Readiness stays `ready`. Real setup errors (unsafe root, write failures) still latch `failed` as today.

## Reader (host)

Order: active root, then archive shards, then the legacy root.

- Active and legacy: unchanged limits (257 names).
- Archive: open only `<archive>/<session>` for each requested session and `<archive>/h_<hash>` for each hash recovered from a bridge header. Same file checks as today. At most 1024 names per shard; more marks the result damaged. The writer never links into a shard that already holds 1024 entries (the receipt stays in the active root), so this only happens by hand. Every shard read belongs to the requested BB thread, so the damage stays scoped to it. The shared 8 MiB budget still applies.
- Each `<epoch>.jsonl` name is counted once across all roots.
- Race with a concurrent move (moves only go active → archive):
  - `ENOENT` in the active root is skipped. If the receipt is ours, its shard is read later.
  - A read error is held per name and becomes `capture-damaged` only if no other root yields that name. This covers the `nlink === 2` window.
- `collector-full` still comes from the active-root count. New text: "Collector full. New captures blocked at 256 entries until closed receipts can be archived." The details action no longer says to stop Pi; it points to the cleanup docs if the state persists.

## Field data (owner's work laptop, 2026-11-20)

Read-only survey, counts only: 256 entries; last rows 254 `capture_stopped`, 2 `capture_checkpoint` (6.5 days untouched, crash leftovers). 254 eligible, no torn, foreign, linked or non-private files. 10.3 MiB total, largest 944 KiB. 207 sessions, at most 16 receipts per session, 16 with `providerSession: null`. Growth about 28 receipts a day (about 1 MiB a day). Legacy root 100 entries, legacy status 89, status root 385 entries (left alone; separate follow-up). Pi 1.5.2. All bounds above hold with room.

## Docs

- `docs/cleanup.md`: automatic archive, layout, eligibility, archive growth (no deletion; each receipt ≤ 1 MiB, typically a few KB), reader limits (1024 per shard, 8 MiB per read), how to check a receipt (`tail -n 1 <file> | jq -r .kind`), what to do with unsealed leftovers when nothing can move (stop all Pi first; then a leftover can no longer grow, so move it with `mv -n` to its shard or leave it), and how to restore old manual archives into shards.
- `docs/receipt-contract.md`: archive section and the closure rule.

## Tests

Collector (new `collector/test/archive-test.mjs`, added to `test:collector`):

1. 256 entries with stopped, truncated, live, checkpoint-only, torn, bad-sequence, wrong-mode, symlink and foreign-name files: only stopped and truncated move (same inode, mode, bytes). The next Copilot call records, the count drops to ≤ 192 + 1, and legacy and status roots are untouched.
2. Only ineligible receipts: the provider call runs, nothing moves, `missedCalls` grows, the status is `collector-full` and not `error`. Seal one receipt or free a slot: the next call records with `missedCalls > 0`, without a restart or `/copilot-probe on`.
3. Busy lock: the call runs, nothing moves, the lock is not removed. Release it and the next call recovers.
4. Archive collision: the destination is unchanged, the source stays, other files still move.
5. Injected `linkSync` / `unlinkSync` failure: nothing lost or duplicated, the call runs, and it recovers after the fault clears.
6. Crash leftover (two links): repaired to one archive link.
7. Unsafe archive (symlink, `0755`, other path): no moves.
8. Periodic: `agent_end` at `archiveAt` moves; a second `agent_end` inside 10 minutes does nothing (injected clock).
9. Two Pi processes (two `node` child processes) on one full directory: every original receipt exists exactly once across active and archive, both calls run, the cap holds and no lock is left behind.

Host (`test/integration-test.mjs`):

- Archived receipts in a session shard count. A null-session shard is recovered by bridge hash. Totals before and after a real `probe.mjs` maintenance run are equal, and `collector-full` clears.
- One name in both the active root and the archive is counted once.
- A shard over 1024 entries is damaged and bounded. Unrelated shards are never opened.

## Addendum: hands-off operation (owner, 2026-11-20)

The owner wants maintenance that never needs a person. Three gaps remained, and the owner added all three to this PR. They override the issue's "leave status roots untouched" for the new status root only. The legacy roots stay untouched.

### A. Leftovers whose writer has exited

A crashed or killed Pi leaves a receipt with no terminal row. It holds a slot forever (the field data showed about one every 4–5 days).

- The writer adds two optional fields to `capture_started`: `writerPid` (its `process.pid`) and `writerHost`, the SHA-256 hex of `"pi-host-v1" + NUL + os.hostname()`. These are backward-compatible schema-3 extensions, and older readers ignore them.
- A receipt with no terminal row is still eligible when every other closure check passes, its `capture_started` carries both fields, `writerHost` equals this host's hash, `writerPid !== process.pid`, `process.kill(writerPid, 0)` fails with `ESRCH`, and the file has not changed for 10 minutes (`mtime`).
- PID reuse only makes a dead writer look alive, which is the safe direction: the file waits until the reusing process exits. `EPERM` counts as alive. A receipt from another host (`writerHost` differs) never moves on this rule.
- Defence in depth: a move keeps the inode. Even a writer wrongly judged dead would keep appending to the same file, now in its shard, so the bytes stay readable and nothing is lost.
- Receipts written before this change have no `writerPid`. They stay manual, as documented.
- A torn last line is still ineligible.

### B. Host cache for archived and unchanged receipts

The reader's 8 MiB budget is a per-refresh read cost. A long thread could exceed it and show *Missing data* on every refresh.

- The host keeps a per-process cache keyed by path. A hit requires the same `lstat` dev, ino, size, mtime, ctime, mode, nlink and uid. The `lstat` runs every time (no symlink is followed) and the safety checks are the same as `safeFile`. A changed file is read again.
- The cached value is the validated file in slim form: its identity, its damage flags, the largest `at`, and only the fields `piUsage` reads from call rows (`kind`, `callId`, `outcome`, `api`, `eventType`, `billingPhase`, `responseHash`, `billing` scalars).
- The 8 MiB budget counts only bytes actually read in a refresh. A cold read over budget reports *Missing data* for that refresh, keeps what it read, and finishes on later refreshes (each about 3 s apart).
- Cache size: at most 64 MiB of source bytes, least recently used first. A thread whose receipts exceed 64 MiB keeps reporting *Missing data*. That is documented and far beyond the field data.
- Shard limit raised from 1024 to 4096 entries for both reader and writer. Cached entries cost one `lstat` each. At the field rate of 16 receipts per thread in 9 days, that is years.

### C. Startup-status leftovers (new status root only)

Status markers already carry `pid`. Crashes leave markers and empty session directories (385 entries in the field data).

- On `session_start`, at most once every 10 minutes per process, the readiness writer sweeps `copilot-session-credits-status/`. It handles at most 256 session directories and 1024 files per run, continuing from where the last run stopped.
- It removes a marker only when the marker passes `readMarker` validation, is not this process's own instance, and `process.kill(pid, 0)` fails with `ESRCH`. It re-checks dev/ino before `unlink`. Invalid, unsafe or ambiguous files stay.
- It removes `.ready-*` temp files older than 10 minutes (a temp file lives only between write and rename). It removes empty session directories with `rmdir`, which cannot remove a non-empty one, only when unchanged for 10 minutes.
- Race: another process may create its marker in a directory just removed. `write()` re-creates the directory and retries once on `ENOENT`.
- The legacy `session-credits-status/` root is never touched.

### Tests for the addendum

- A leftover with a dead `writerPid` on this host and older than 10 minutes moves. A live pid, another host, a recent mtime, no `writerPid` or a torn last line stays.
- Host cache: a second read of an unchanged archived receipt reads no bytes (a spy on `open`). An appended or replaced file is read again. A thread over 8 MiB converges to the full total within a few refreshes. The LRU cap holds.
- Status sweep: dead markers and old temp files are removed. Live, invalid and own markers stay. Empty old directories are removed, recent or non-empty ones stay, and the legacy root is untouched. A concurrent `write()` after an `rmdir` still lands.

### Addendum review changes (GPT-6.1-Sol review)

**Process identity replaces the hostname hash.** `collector/identity.mjs` computes once per process, lazily:

- `machine`: SHA-256 of `"pi-machine-v1" + NUL` + the hardware UUID (macOS `ioreg … IOPlatformUUID`) or `/etc/machine-id` (Linux).
- `boot`: SHA-256 of the boot ID (macOS `sysctl kern.bootsessionuuid`, Linux `/proc/sys/kernel/random/boot_id`).
- `pidns`: SHA-256 of the PID namespace (`/proc/self/ns/pid` link on Linux, the constant `darwin` on macOS).

If any part is unavailable, the process has no identity. Its evidence is then never judged dead, and its leftovers stay manual.

A writer is **dead** only when its identity has the same `machine` as this process, and either its `boot` differs (that boot has ended) or its `boot` and `pidns` are both equal and `kill(pid, 0)` fails with `ESRCH`. Same boot with a different PID namespace means unknown, which counts as alive. A different machine also means unknown. `EPERM` means alive.

`capture_started` carries `writer: { pid, machine, boot, pidns }` (optional schema-3 extension). A leftover moves only when its writer is dead and the file has been unchanged for 10 minutes.

**Crash-held `.capture-lock` recovery.**
- A new holder writes `.capture-lock/owner.json` (its identity, `O_EXCL`, `0600`) right after `mkdir`. It releases by checking the owner is still itself, unlinking `owner.json`, then `rmdir`.
- When the lock is busy and holds a valid `owner.json` whose writer is dead, the process renames the whole `.capture-lock` directory to `<archive>/.broken-locks/<owner instance>`. If a stale lock was ever re-created, that target already exists and is non-empty, so a second rename onto it fails (`ENOTEMPTY`/`EEXIST`). A fresh lock taken by a live process can therefore never be renamed by a late breaker.
- Then it retries `mkdir` once.
- A lock with no `owner.json` (an older collector, or a crash in the microseconds between `mkdir` and the owner write) is never broken.
- Age never decides.

**Status sweep fairness and evidence.**
- Each readiness instance writes its identity once to `copilot-session-credits-status/.instances/<instance>.json`. Readers only open `<providerSession>` directories, so older readers never see it.
- A marker is removed only when its instance has a valid identity record with the same `pid` and that writer is dead. The identity record is removed after its marker.
- Markers without an identity record (all pre-change markers) stay. The reader already ignores them when their process is dead.
- Empty session directories and `.ready-*` temp files unchanged for 10 minutes are removed.
- The sweep runs on `session_start` and `agent_end`, at most every 10 minutes per process. It starts at a random offset in the sorted directory list and wraps around, so restarts cover all directories over time without stored state. The bounds stay at 256 directories and 1024 files per run.

### Gate-2 review changes (GPT-6.1-Sol)

The review rejected ec408f6 for three reproduced stalls. All three are fixed, each with a regression test that fails without the fix.

1. **Sweep starvation by large ineligible receipts.** A quiet leftover is now rejected from its head row's `writer` (4 KiB) before any full read. Full validations are remembered per process, keyed by name, dev, ino, size, mtime and ctime, and pruned to the files present in the root. A later sweep therefore reaches the remaining candidates.
2. **Failed lock release.** The holder records the inode of the lock directory and of its own `owner.json`, and retries the release once at once. If both tries fail, it remembers the lock and finishes the release on its next attempt, after checking the lock directory still has the same inode. A half-written `owner.json` is removed by inode as well.
3. **Status starvation inside a folder.** The folder listing is bounded to 4096 names. Only marker and temp names are candidates, at most 64 per folder per run, starting at a random candidate.

The surviving mutant "status timer ignored" is now caught: the test changes the start offset inside the 10-minute window.

Re-review of 4cb7aa4 (same reviewer): the three stalls recover. Two follow-ups are fixed:

- A pending release is forgotten only when `lstat` shows the lock is gone (`ENOENT`) or replaced (different inode). Any other error keeps it pending.
- The status sweep lists each folder in full (up to 1,000,000 entries) and keeps a uniform reservoir sample of at most 64 candidates. No position can starve, even behind persistent live markers.
Final re-review of f81193b: approved, no findings.

Ponytail review of dd6bf84: verdict Ship, with one should-fix. A crash between writing an identity record and its marker, or before the record's rename, left files in `.instances/` that no sweep visited.

- Fix: identity records now also store `providerSession`.
- The sweep samples up to 64 names in `.instances/`. It removes a record when its marker (`<providerSession>/<instance>.json`) is absent and its writer provably exited. It also removes `.ready-*` files there that are older than 10 minutes.
- A record whose marker exists stays, because the marker pass needs it as proof.
