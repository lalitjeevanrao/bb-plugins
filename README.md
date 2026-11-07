# Copilot session credits

GitHub Copilot AI Credits for the current BB thread, beside the context indicator. Click the indicator to see usage or set up Pi capture.

## In use

**Copilot CLI** — session credits beside the context indicator. No companion installation required.

![Copilot CLI showing 0.8235 AIC for the current BB thread](docs/screenshots/copilot-cli.png)

Click the amount for the latest checkpoint and session scope.

![Copilot CLI usage details showing a recorded checkpoint](docs/screenshots/copilot-cli-details.png)

**Pi with GitHub Copilot** — credits captured by the Pi companion. Pi coverage is partial; earlier calls and hidden retries may be missing.

![Pi with GitHub Copilot showing 2.5768 AIC for the current BB thread](docs/screenshots/pi-copilot.png)

Screenshots from live user QA. Amounts shown belong to those sessions, not a remaining subscription balance.

## Install

Requires **BB 0.48.1+** and authenticated GitHub Copilot access. Tested on macOS.

Install **Copilot session credits** from BB Community when available, or from Git:

```sh
bb plugin install git:https://github.com/lalitjeevanrao/copilot-session-credits.git@v0.3.0 --plugin copilot-session-credits
```

**Copilot CLI:** no extra installation. Credits appear when the CLI reports usage.

**Pi Coding Agent:** requires Pi **1.5.0+**. On the machine running Pi:

```sh
pi install git:https://github.com/lalitjeevanrao/copilot-session-credits.git@v0.3.0
```

Use the same Pi executable and agent directory as BB. For remote threads, install on the remote host. Match any `PI_CODING_AGENT_DIR` or custom launcher configuration.

Start a new session after installation. For an existing thread, stop its runtime with `bb thread stop <thread-id>`, then send your next message to resume it. **Retry check** refreshes the status; it does not restart Pi.

The companion collects usage for BB. It adds no meter to Pi’s TUI.

## What the numbers mean

The indicator shows credits **reported for this session**, not your remaining subscription balance or invoice total. Pi coverage is partial: earlier calls and hidden retries may be missing. A dash means unknown, not zero.

Click the indicator for the exact amount, coverage and capture status. Recorded credits remain visible if capture later stops. **Ready — awaiting Copilot usage** means the Pi extension loaded, but has not recorded usage yet. **Capture unconfirmed** means BB cannot confirm capture; it does not necessarily mean the extension is missing.

## Privacy

The plugin adds no analytics endpoint. Pi receipts store usage amounts, model labels, timestamps and pseudonymous identifiers—not prompts, responses or credentials. They live in private directories under `~/.pi/agent/copilot-session-credits/`; startup status lives in `~/.pi/agent/copilot-session-credits-status/`.

Copilot CLI usage is read from a bounded local log tail. Only usage fields are returned to BB. [Security details](SECURITY.md) · [Accounting and coverage](docs/accounting.md).

## Update from 0.2.x or remove

Version 0.3.0 changes the BB plugin ID to `copilot-session-credits`. Remove the old BB ID before installing the renamed plugin so both displays do not load:

```sh
bb plugin remove session-credits
bb plugin install git:https://github.com/lalitjeevanrao/copilot-session-credits.git@v0.3.0 --plugin copilot-session-credits
```

Refresh BB after updating. To replace a later pinned release, remove `copilot-session-credits` before installing the newer source.

**Update the Pi companion too.** Use `pi list` with the same runtime and agent directory as BB, remove the exact currently installed source with `pi remove`, then install the v0.3.0 source shown above. Do not add a second Pi source alongside the old one. Stop/restart existing Pi sessions after the update; Retry check does not restart them. The Git repository URL is unchanged.

New receipt writes use `~/.pi/agent/copilot-session-credits/`; startup status uses `~/.pi/agent/copilot-session-credits-status/`. The BB reader also reads the legacy `~/.pi/agent/session-credits/` and `~/.pi/agent/session-credits-status/` as compatibility inputs. Existing data remains visible without moving or copying it. Both status roots are checked together: multiple live instances are unconfirmed rather than silently selecting one. No update or removal command deletes or moves receipts.

Uninstall the display with `bb plugin remove copilot-session-credits`. Remove the companion using its exact installed source from `pi list`. [Cleanup guidance covers both new and legacy roots](docs/cleanup.md).

## Development

Requires Node 22.19+, BB and Pi 1.5.0+:

```sh
npm --prefix packages/bb-plugin-copilot-session-credits ci
npm test
bb plugin install . --plugin copilot-session-credits
```

Tests use synthetic transport and make no paid model calls. Composer placement follows BB’s DOM and may need adjustment after BB UI changes.

[Changelog](CHANGELOG.md) · [Release checklist](docs/releasing.md) · [MIT license](LICENSE)

Author: **Lalit Rao**
