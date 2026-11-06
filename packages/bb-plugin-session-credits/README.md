# Copilot session credits

GitHub Copilot AI Credits beside BB’s context indicator. Click for usage details or Pi setup instructions.

![Copilot CLI session credits](../../docs/screenshots/copilot-cli.png)

![Pi with GitHub Copilot session credits](../../docs/screenshots/pi-copilot.png)

See the [installation guide](../../README.md) for requirements, setup and updates.

This directory contains the BB plugin and shared collector. The repository root supplies the Pi package entrypoint. Copilot CLI needs only the BB plugin; Pi requires the companion and Pi 1.5.0+.

From the repository root, run `npm test`. Install locally with `bb plugin install . --plugin session-credits`.

[Accounting](docs/accounting.md) · [Receipt contract](docs/receipt-contract.md) · [Architecture](docs/architecture.md) · [MIT](LICENSE)
