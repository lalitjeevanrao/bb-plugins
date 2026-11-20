# Pi receipt archive and cleanup

| Kind | New writes | Automatic archive | Legacy read-only compatibility |
| --- | --- | --- | --- |
| Usage receipts | `~/.pi/agent/copilot-session-credits/` | `~/.pi/agent/copilot-session-credits-archive/<shard>/` | `~/.pi/agent/session-credits/` |
| Startup status | `~/.pi/agent/copilot-session-credits-status/` | none | `~/.pi/agent/session-credits-status/` |

## Automatic archive

The collector keeps at most 256 entries in its receipt folder. When the folder reaches 224 entries, it moves the oldest **closed** receipts to a private archive next to it, until 192 entries remain. It does this before allocating a new receipt and, while capture is enabled, after a Pi turn ends (at most every 10 minutes). It works under the same `.capture-lock` as allocation, skips a busy lock and never removes one. A run moves at most 64 receipts and reads at most 16 MiB.

A receipt is **closed** only when every line is a valid schema-3 row with contiguous `seq` and one identity, the first row is `capture_started` for the file's own epoch, and the **last** row is `capture_stopped` or `capture_truncated` (and no earlier row is). Every writer of the receipt folder (v0.3.0 and later) stops writing to a receipt after either row. Age is used only to choose the oldest closed receipts first; it never proves closure. Live receipts, receipts that end in `capture_checkpoint` or any other row, torn or malformed files, non-private files, symlinks, extra hard links and foreign names never move. Legacy and status folders are never touched.

Archive layout:

- `<shard>` is the receipt's BB provider session (`pi_<uuid>` or `thr_<id>`), or `h_<nativeSessionHash>` when the receipt has `providerSession: null`.
- The archive and each shard are owner-only `0700` directories on the same file system. A receipt keeps its inode, owner and `0600` mode.
- The move is a hard link into the shard, then removal of the old name. An existing archive file is never replaced. If Pi stops between the two steps, the next run finishes the move.
- An unsafe archive path (a symlink, a non-private directory, a file, another device) stops maintenance. Nothing moves until you fix it.

BB reads the capture folder, then only the shards of the requested sessions, then the legacy folder. Each receipt file counts once, so totals stay the same after a move.

## When the folder is full

Copilot requests still run. BB shows **Collector full**, and `/copilot-probe status` reports `collector-full`. Each Copilot call retries: as soon as a slot frees, a new receipt starts. You do not need to restart Pi or toggle the probe. Calls made while the folder was full are not recorded, and the next receipt marks them as missed, so BB keeps showing **Missing data**. Missed usage cannot be recovered.

If the folder stays full, it holds no closed receipts. To see why, list the last row kind of each receipt:

```sh
cd "$HOME/.pi/agent/copilot-session-credits"
for f in *.jsonl; do printf '%s %s\n' "$(tail -n 1 "$f" | jq -r .kind 2>/dev/null || echo unreadable)" "$f"; done | sort | cut -d' ' -f1 | uniq -c
```

`capture_stopped` and `capture_truncated` receipts are eligible and move automatically unless something is wrong with the archive path. Everything else is a live receipt or an **unsealed leftover** from a Pi process that crashed or was killed before it could stop cleanly.

To handle unsealed leftovers:

1. Stop **all** Pi processes, including BB-launched sessions. Only then can no process still be writing to a leftover.
2. For each leftover you want to move, read its shard from the first row (`head -n 1 <file> | jq -r '.providerSession // ("h_" + .nativeSessionHash)'`).
3. Move it without overwriting: `mkdir -m 700 -p "$archive/$shard" && mv -n "$file" "$archive/$shard/"`, with `archive="$HOME/.pi/agent/copilot-session-credits-archive"`. Check the file is gone from the source afterwards: `mv -n` leaves it in place on a name collision.

BB keeps counting moved leftovers. Their unfinished calls stay marked as missing.

## Growth and limits

Nothing deletes archived receipts. Each receipt is at most 1 MiB, and most are a few KiB to a few dozen KiB. A heavy user writes about 25–30 receipts a day, which adds roughly 1 MiB a day. To reclaim space, stop all Pi processes and move or remove whole shards you no longer need; BB then stops counting them.

BB reads at most 1024 entries per shard and 8 MiB of matching receipts per thread. The collector never moves a receipt into a shard that already has 1024 entries: such receipts stay in the capture folder. A thread over either limit shows **Missing data** instead of a partial total.

## Old manual archives

Before automatic archiving, the advice was to move the whole receipt folder to `copilot-session-credits-archive-<timestamp>`. BB does not read those folders. To bring their history back, stop all Pi processes and move each receipt into its shard with `mv -n`, as for unsealed leftovers. Do not merge the legacy `session-credits` folder; BB already reads it in place.

## Startup-status leftovers

Normal shutdown removes only the instance's own status file. Crashes can leave small records and empty session directories. The reader checks both status roots, ignores dead processes and refuses unsafe, excessive or ambiguous records. PID liveness is only best-effort startup telemetry.

If leftovers prevent confirmation, stop all Pi processes and move the affected status root to a fresh private sibling:

```sh
source="$HOME/.pi/agent/copilot-session-credits-status"
archive="${source}-old-$(date -u +%Y%m%dT%H%M%SZ)"
test ! -e "$archive" && mv "$source" "$archive"
```

Restarting configured Pi recreates status under the new root. Moving status does not remove credit receipts or recover missing usage. Updates and removals never archive or delete status automatically.
