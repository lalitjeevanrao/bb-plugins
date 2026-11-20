# Auto-archive closed Pi receipts (issue #21)

Status: design for review (gate 1). Scope: `copilot-session-credits` Pi collector and host reader.

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

Constants: `maxFiles = 256`, start at `archiveAt = 224`, archive down to `archiveTo = 192`. For other `maxFiles` (tests) both scale by 7/8 and 3/4.

- **Before allocation**, inside the existing `.capture-lock` section of `openCapture`: if the entry count is `>= archiveAt`, run maintenance, then recount. At or above the cap with nothing movable, at-cap maintenance backs off for 60 s per process; the cheap count still runs on every call, so space freed by another process or by hand is used at once.
- **Periodically while enabled**: `agent_end` runs maintenance at most once every 10 minutes when the count is `>= archiveAt`. It takes the lock with the same `mkdir`; a busy lock is skipped, never stolen or aged out. No timers, so reloads cannot leak intervals.
- Never on idle startup, never when disabled, never creates the active root.

Bounds per run: at most 64 moves, at most 16 MiB read. Candidates are sorted oldest first by `lstat` mtime. A 4 KiB tail read rejects files whose last row is not terminal before any full read.

Maintenance errors never reach the provider call and never set `failed`. If the count is still at the cap, the call runs without a capture.

## Full collector behaviour (collector)

- `openCapture` returns `'full'` instead of throwing. `ensure()` increments `missedCalls` and records the last miss reason (`full` or `busy`).
- `/copilot-probe status` reports `collector-full` (warning) next to the existing `capture-contended`.
- The next capture's `capture_started.missedCalls` stays > 0, so the reader keeps flagging *Missing data*. Missed usage is never claimed as recovered.
- Readiness stays `ready`. Real setup errors (unsafe root, write failures) still latch `failed` as today.

## Reader (host)

Order: active root, then archive shards, then the legacy root.

- Active and legacy: unchanged limits (257 names).
- Archive: open only `<archive>/<session>` for each requested session and `<archive>/h_<hash>` for each hash recovered from a bridge header. Same file checks as today. At most 1024 names per shard; more marks the result damaged. The shared 8 MiB budget still applies.
- Each `<epoch>.jsonl` name is counted once across all roots.
- Race with a concurrent move (moves only go active → archive):
  - `ENOENT` in the active root is skipped. If the receipt is ours, its shard is read later.
  - A read error is held per name and becomes `capture-damaged` only if no other root yields that name. This covers the `nlink === 2` window.
- `collector-full` still comes from the active-root count. New text: "Collector full. New captures blocked at 256 entries until closed receipts can be archived." The details action no longer says to stop Pi; it points to the cleanup docs if the state persists.

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
