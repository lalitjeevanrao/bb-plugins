# Archive Pi receipts and startup status

Stop **all** Pi processes, including BB-launched sessions, before archiving files. There is no automatic prune or migration command. Version 0.3.0 writes only to the new roots; BB continues reading the legacy roots as compatibility inputs.

| Kind | New writes | Legacy read-only compatibility |
| --- | --- | --- |
| Usage receipts | `~/.pi/agent/copilot-session-credits/` | `~/.pi/agent/session-credits/` |
| Startup status | `~/.pi/agent/copilot-session-credits-status/` | `~/.pi/agent/session-credits-status/` |

To archive one receipt root, choose its exact path and move it to a fresh private sibling directory. For example:

```sh
source="$HOME/.pi/agent/copilot-session-credits"
archive="${source}-archive-$(date -u +%Y%m%dT%H%M%SZ)"
test ! -e "$archive" && mv "$source" "$archive"
```

For legacy receipt cleanup, use `source="$HOME/.pi/agent/session-credits"` instead. Treat the roots independently; do not merge, copy or move legacy receipts into the new capture folder. The reader already discovers both roots. Each folder has bounded reads; the current writer stops at 256 entries in its new receipt folder.

The move preserves data and permissions. Keep archives private and outside both reader roots. **Archived sessions lose their visible meter history.** Resuming one records only its new part; missing data cannot be reconstructed or merged automatically. Restart Pi after archival; the collector creates its new private receipt folder lazily when recording.

## Startup-status leftovers

Normal shutdown removes only the instance's own status file. Crashes can leave small records and empty session directories. The reader checks both status roots, ignores dead processes and refuses unsafe, excessive or ambiguous records. PID liveness is only best-effort startup telemetry.

If leftovers prevent confirmation, stop all Pi processes and archive the affected new or legacy status root using the same private-sibling procedure. Restarting configured Pi recreates status under the new root. Archiving status does not remove credit receipts or recover missing usage. Updates/removals never archive or delete either root automatically.
