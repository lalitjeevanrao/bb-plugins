# Pi receipt archive and cleanup

| Kind | New writes | Automatic archive | Legacy read-only compatibility |
| --- | --- | --- | --- |
| Usage receipts | `~/.pi/agent/copilot-session-credits/` | `~/.pi/agent/copilot-session-credits-archive/<shard>/` | `~/.pi/agent/session-credits/` |
| Startup status | `~/.pi/agent/copilot-session-credits-status/` | none | `~/.pi/agent/session-credits-status/` |

## Automatic archive

The collector keeps at most 256 entries in its receipt folder. When the folder reaches 224 entries, it moves the oldest **closed** receipts to a private archive next to it, until 192 entries remain. It does this before allocating a new receipt and, while capture is enabled, after a Pi turn ends (at most every 10 minutes). It works under the same `.capture-lock` as allocation, skips a busy lock and never removes one. A run moves at most 64 receipts and reads at most 16 MiB. It rejects most ineligible receipts from their first and last 4 KiB, and remembers its checks of unchanged receipts, so large ineligible files cannot block the rest.

Two kinds of receipt can move. Every line must be a valid schema-3 row with contiguous `seq` and one identity, and the first row must be `capture_started` for the file's own epoch.

- **Closed:** the **last** row is `capture_stopped` or `capture_truncated`, and no earlier row is. Every writer of the receipt folder (v0.3.0 and later) stops writing to a receipt after either row.
- **Left over by an exited process:** the receipt has no such row, its `capture_started` names the writing process (receipts from this release on), that process provably no longer runs, and the file has not changed for 10 minutes. "Provably" means the same machine, and either an earlier boot, or the same boot and PID namespace with no process of that ID. A reused process ID only makes the writer look alive, so the receipt waits. A receipt from another machine never moves this way. Even a wrong verdict loses nothing: the move keeps the same file, so a running writer would keep appending to it in the archive.

Age only chooses the oldest receipts first; it never proves closure. Live receipts, older leftovers without a writer identity, torn or malformed files, non-private files, symlinks, extra hard links and foreign names never move. The legacy folders are never touched.

Archive layout:

- `<shard>` is the receipt's BB provider session (`pi_<uuid>` or `thr_<id>`), or `h_<nativeSessionHash>` when the receipt has `providerSession: null`.
- The archive and each shard are owner-only `0700` directories on the same file system. A receipt keeps its inode, owner and `0600` mode.
- The move is a hard link into the shard, then removal of the old name. An existing archive file is never replaced. If Pi stops between the two steps, the next run finishes the move.
- An unsafe archive path (a symlink, a non-private directory, a file, another device) stops maintenance. Nothing moves until you fix it.

BB reads the capture folder, then only the shards of the requested sessions, then the legacy folder. Each receipt file counts once, so totals stay the same after a move. BB keeps the parsed contents of unchanged receipts in memory (up to 64 MiB), so a refresh only reads new or changed files.

## Abandoned allocation lock

A collector holding `.capture-lock` records itself in `.capture-lock/owner.json`. If that process crashes while holding the lock, the next collector proves it exited (as above) and moves the whole lock to `copilot-session-credits-archive/.broken-locks/<instance>`, then continues. Those small folders are kept as a record. If a collector fails to release its own lock because of a transient I/O error, it keeps retrying on later attempts until the lock is released or provably gone. A lock without a readable owner, for example one held by an older collector, is never moved: wait for it, or stop all Pi processes and remove it.

## When the folder is full

Copilot requests still run. BB shows **Collector full**, and `/copilot-probe status` reports `collector-full`. Each Copilot call retries: as soon as a slot frees, a new receipt starts. You do not need to restart Pi or toggle the probe. Calls made while the folder was full are not recorded, and the next receipt marks them as missed, so BB keeps showing **Missing data**. Missed usage cannot be recovered.

If the folder stays full, it holds no closed receipts. To see why, list the last row kind of each receipt:

```sh
cd "$HOME/.pi/agent/copilot-session-credits"
for f in *.jsonl; do printf '%s %s\n' "$(tail -n 1 "$f" | jq -r .kind 2>/dev/null || echo unreadable)" "$f"; done | sort | cut -d' ' -f1 | uniq -c
```

`capture_stopped` and `capture_truncated` receipts are eligible and move automatically unless something is wrong with the archive path. Everything else is a live receipt or an **unsealed leftover** from a Pi process that crashed or was killed before it could stop cleanly. Leftovers written by this release or later move by themselves once their process has exited. Leftovers from v0.3.4 and earlier carry no writer identity: `head -n 1 <file> | jq .writer` prints `null` for them. They need a one-time manual move.

To handle older unsealed leftovers:

1. Stop **all** Pi processes, including BB-launched sessions. Only then can no process still be writing to a leftover.
2. For each leftover you want to move, read its shard from the first row (`head -n 1 <file> | jq -r '.providerSession // ("h_" + .nativeSessionHash)'`).
3. Move it without overwriting: `mkdir -m 700 -p "$archive/$shard" && mv -n "$file" "$archive/$shard/"`, with `archive="$HOME/.pi/agent/copilot-session-credits-archive"`. Check the file is gone from the source afterwards: `mv -n` leaves it in place on a name collision.

BB keeps counting moved leftovers. Their unfinished calls stay marked as missing.

## Growth and limits

Nothing deletes archived receipts. Each receipt is at most 1 MiB, and most are a few KiB to a few dozen KiB. A heavy user writes about 25–30 receipts a day, which adds roughly 1 MiB a day. To reclaim space, stop all Pi processes and move or remove whole shards you no longer need; BB then stops counting them.

BB reads at most 4096 entries per shard. Each refresh reads at most 8 MiB of receipts that are not already in its memory, which holds up to 64 MiB. A long thread may show **Missing data** for a few refreshes after BB starts, until everything is cached. The collector never moves a receipt into a shard that already has 4096 entries; such receipts stay in the capture folder. A thread whose receipts exceed 64 MiB, or a shard over 4096 entries, keeps showing **Missing data** instead of a partial total.

## Old manual archives

Before automatic archiving, the advice was to move the whole receipt folder to `copilot-session-credits-archive-<timestamp>`. BB does not read those folders. To bring their history back, stop all Pi processes and move each receipt into its shard with `mv -n`, as for unsealed leftovers. Do not merge the legacy `session-credits` folder; BB already reads it in place.

## Startup status

Each Pi process writes a small status file per session, plus `copilot-session-credits-status/.instances/<instance>.json` with its process identity. Normal shutdown removes both. After a crash, the collector cleans up automatically, at most every 10 minutes, when a Pi session starts and after turns:

- It removes a status file once its process provably exited (as for receipts), together with its identity record.
- It removes `.ready-*` temporary files and empty session folders that have not changed for 10 minutes.
- It removes an identity record left without its status file (a crash between the two writes) once its process provably exited, and old temporary files in `.instances/`. A record whose status file still exists stays, because that file needs it as proof.
- It handles at most 256 session folders and 1024 files per run, and at most 64 status or temporary files per folder, picked at random from the whole folder. Other names are skipped without being touched. It starts at a random folder, so everything is reached over time. A single folder is listed up to its first million entries.

Status files written by v0.3.4 and earlier have no identity record. They stay, and BB ignores them once their process is dead. To clear them, stop all Pi processes and move the status root to a fresh private sibling:

```sh
source="$HOME/.pi/agent/copilot-session-credits-status"
archive="${source}-old-$(date -u +%Y%m%dT%H%M%SZ)"
test ! -e "$archive" && mv "$source" "$archive"
```

Restarting Pi recreates the status root. Moving status does not remove credit receipts or recover missing usage. The legacy `session-credits-status` folder is never touched.
