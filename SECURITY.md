# Security

This candidate has not been publicly released. This is local usage telemetry, not a billing security boundary.

Report vulnerabilities privately through this repository's **Security → Report a vulnerability**. Do not post exploit details or personal session data in a public issue. Private reporting must be enabled before public release.

Include the version, OS, expected behaviour and a minimal synthetic reproduction. Never attach raw session logs, receipts, chat content, tokens or unredacted IDs.

## Trust boundaries

- Installing this BB plugin runs code with your user's permissions. Review the source.
- Pi receipts must be owned, canonical, private (0700/0600), regular single-link files; symlinks are refused.
- Native CLI logs use their provider's modes. The reader bounds reads, checks ownership/links and returns usage fields only. Raw log-tail bytes may contain transcript content in local memory.
- Scalar usage and session identity travel over BB's existing connection. No transcript is returned by the reader; there is no separate analytics endpoint.
- Same-user processes can alter local telemetry. This is not tamper-proof or invoice-reconciled evidence.
- No package command deletes receipts. Manual archival requires all Pi processes stopped; keep archives private.

Pi startup-readiness records live separately under `~/.pi/agent/session-credits-status/`, grouped by provider session and uniquely named per instance. They use the same ownership, private-mode and symlink checks as receipts, with bounded reads. Process liveness is best-effort: readiness is not a heartbeat or protection against same-user tampering/PID reuse. Each instance removes only its own status file on normal shutdown. Crash leftovers do not count when their processes are no longer alive.

The companion is separately installed executable code. The initializer guards ordinary setup failures and reports diagnostics without a model call. Static module/import errors still follow Pi's normal extension-load behavior and can prevent startup. BB itself never silently installs or removes the Pi package.
