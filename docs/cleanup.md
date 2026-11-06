# Archive Pi receipts

Use this only when capacity is full or you deliberately want to clear meter history. There is no prune command.

1. Stop **all** Pi processes, including BB-launched ones. Do not move files while a collector runs.
2. Move the whole capture folder to a new private sibling directory:

```sh
archive="$HOME/.pi/agent/session-credits-archive-$(date -u +%Y%m%dT%H%M%SZ)"
test ! -e "$archive" &&
  mv "$HOME/.pi/agent/session-credits" "$archive"
```

3. Restart Pi. The collector creates a fresh private capture folder when it records.

The move preserves receipts and their permissions. The archive is outside the reader's fixed folder; do not make it public or put it back while Pi runs.

**Older sessions lose their visible meter history.** Resuming one records only its new part. The meter cannot reconstruct removed history or merge an archive automatically. Missing data is not zero.

## Startup-status leftovers

Readiness files are separate from receipts, under `~/.pi/agent/session-credits-status/`. Normal shutdown removes an instance's own file. Crashes may leave small status records and empty session directories. The reader does not count records whose process is gone, and treats excessive or conflicting records as unconfirmed.

If status remains unconfirmed because of old records, stop all Pi processes and move that status folder to a private archive. Restarting a configured Pi session recreates its status. This does not remove credit receipts or recover missing usage.
