# Changelog

## [0.2.0] — 2026-11-06

First public release. Author: Lalit Rao.

- Display GitHub Copilot session credits beside BB’s context indicator, with exact amounts and coverage details.
- Read native Copilot CLI checkpoints directly from the session’s execution host.
- Guide Pi users through a separate companion installation, with a pinned command and copy/retry controls.
- Report session-specific Pi readiness separately from usage. Preserve recorded credits when capture is unavailable.
- Keep receipts local and private, with bounded reads and capture limits.

Requires BB 0.48.1+. Pi capture requires authenticated Pi 1.5.0+ and its companion; coverage is partial. Tested locally on macOS. Missing telemetry is never a zero-credit assertion or a complete invoice total.
