# Copilot session credits

See GitHub Copilot AI Credits recorded by a session beside BB's context indicator. Open the details for exact amounts, coverage and setup guidance.

Copilot CLI uses its native usage checkpoints. Pi Coding Agent needs the companion extension included in this repository. **Pi coverage is partial; missing usage is a dash, never zero.** This is observed usage, not a quota, price estimate or invoice.

## Requirements

- BB 0.48.1 or newer, with a working authenticated Copilot CLI or Pi provider.
- For Pi capture: Pi 1.5.0+ with GitHub Copilot signed in, plus the companion below. Pi 0.84.4 lacks the required raw usage callbacks.
- Tested locally on macOS. Windows is not claimed. Synthetic tests do not constitute a live billing audit.

## Install in BB

Install **Copilot session credits** from BB Community once listed, or use its public Git release:

```sh
bb plugin install git:https://github.com/lalitjeevanrao/copilot-session-credits.git@v0.2.0 --plugin session-credits
```

Copilot CLI needs no companion installation. Its meter appears when the provider supplies session usage checkpoints.

## Set up Pi credits

The clickable **Set up credits** indicator opens instructions even before the first model call. On the machine running Pi:

```sh
pi install git:https://github.com/lalitjeevanrao/copilot-session-credits.git@v0.2.0
```

Use the same Pi executable and agent directory as BB. For a remote thread, install on that execution host. If you use `PI_CODING_AGENT_DIR` or a custom launcher, run the command with that configuration.

New Pi sessions load the extension normally. For an existing session, stop its loaded runtime and resume the thread after installation; `bb thread stop <thread-id>` stops it without deleting its history. The next message resumes it. The popup's **Retry check** refreshes status; it does not install software or restart Pi.

The companion activates in BB-managed Pi. It adds no Pi TUI meter. `/copilot-probe on`, `/copilot-probe off` and `/copilot-probe status` are local diagnostic commands and do not call a model.

## Understand the display

| State | Meaning |
| --- | --- |
| Set up credits / Capture unconfirmed | Capture has not been confirmed for this session. Check setup, runtime and host; this alone does not prove the extension is absent. |
| Ready — awaiting Copilot usage | The companion reported startup readiness; no call or capture problem has been observed yet. |
| Recorded / Updating / Missing data | Accepted usage, unfinished calls, or incomplete/invalid telemetry. |
| Pi unsupported / Capture off / Capture error | The companion reported a runtime, enablement or capture problem. |
| Collector full | The receipt folder reached its capacity. Accepted history remains visible. |
| Unavailable / Disconnected | Session identity, host access or current usage is unavailable. |

Readiness is separate from receipts. It is checked on the thread's own host using its provider session identity and process liveness. It is best-effort startup evidence, not a heartbeat or a guarantee that every call is captured. Historical credits remain visible when readiness changes. Other providers do not produce Copilot usage.

## Updates and removal

Update both installations to the same reviewed release when you use Pi. A pinned tag stays pinned; install the new immutable tag and restart existing Pi sessions.

```sh
bb plugin remove session-credits
pi remove git:https://github.com/lalitjeevanrao/copilot-session-credits.git@v0.2.0
```

The second command applies only if you installed the Pi companion. Removing the BB display does not uninstall the separately managed Pi package. Running Pi sessions keep loaded code until stopped/restarted. Neither removal deletes usage receipts.

## Privacy and limits

Receipts contain scalar usage, pseudonymous session/call identifiers, model labels and timestamps under `~/.pi/agent/session-credits/`. They do not contain prompts, answers, thinking, tools or credentials. Readiness records live separately under `~/.pi/agent/session-credits-status/`. Both use private directories/files (0700/0600). These paths remain under the execution user's home even when Pi uses a custom agent directory.

The CLI reader examines a bounded local log tail that can contain transcript text in memory, then returns scalar usage only. Data uses BB's existing connection; the plugin adds no analytics endpoint. Local telemetry is not tamper-proof.

Each capture is bounded to 1 MiB and 10,000 rows, with 256 entries in the receipt folder. No automatic pruning. [Archive receipts with Pi stopped](docs/cleanup.md).

Placement uses a private BB composer DOM adapter, with toolbar/compact fallback. BB UI changes may require an adapter update.

## Development

With BB, Node 22.19+ and Pi 1.5.0 installed:

```sh
npm --prefix packages/bb-plugin-session-credits ci
npm test
bb plugin install . --plugin session-credits
```

Tests cover the actual BB build, accounting, host/UI behavior, readiness lifecycle and real Pi package loading with synthetic transport. They do not invoke billed models or alter global Pi settings. Both packages remain private to npm; Git supplies the release.

[Accounting](docs/accounting.md) · [Receipt contract](docs/receipt-contract.md) · [Security](SECURITY.md) · [Release checklist](docs/releasing.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE).

Author: **Lalit Rao**.
