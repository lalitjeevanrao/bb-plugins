# Changelog

## [0.3.0] — 2026-11-07

- Breaking: rename the BB plugin ID/package to `copilot-session-credits`; display name remains Copilot session credits.
- New Pi writes use the renamed receipt/status roots. Continue reading legacy roots without moving or deleting user data.
- Document removing the old BB ID and replacing the existing Pi companion source to avoid duplicate installations.
- Clarify reported usage, source-specific coverage, full-trust permissions and data boundaries.

## [0.2.2] — 2026-11-06

- Keep setup and recorded credits in the composer footer before context usage is available.
- Fix disclosure interaction in the anchored details panel.
- Replace setup-only screenshots with live Copilot CLI and Pi usage examples.

## [0.2.1] — 2026-11-06

- Open credit details beside the indicator, without a centered modal or backdrop.
- Add real BB screenshots to the repository and README.
- Shorten installation instructions and marketplace copy.

## [0.2.0] — 2026-11-06

First public release. Author: Lalit Rao.

- Display GitHub Copilot session credits beside BB’s context indicator, with exact amounts and coverage details.
- Read native Copilot CLI checkpoints directly from the session’s execution host.
- Guide Pi users through a separate companion installation, with a pinned command and copy/retry controls.
- Report session-specific Pi readiness separately from usage. Preserve recorded credits when capture is unavailable.
- Keep receipts local and private, with bounded reads and capture limits.

Requires BB 0.48.1+. Pi capture requires authenticated Pi 1.5.0+ and its companion; coverage is partial. Tested locally on macOS. Missing telemetry is never a zero-credit assertion or a complete invoice total.
