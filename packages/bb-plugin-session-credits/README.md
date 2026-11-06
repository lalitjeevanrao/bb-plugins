# Copilot session credits

Display recorded GitHub Copilot session credits beside BB's context indicator. Copilot CLI uses native checkpoints. Pi requires the companion installed through Pi's package manager; the clickable setup indicator explains the second step.

This directory is the complete BB plugin source. The repository root is the separate Pi package entrypoint. Both share release v0.2.0; neither requires npm publication.

Requirements: BB 0.48.1+, Node 22.19+ for local development, and an authenticated provider. Pi capture requires Pi 1.5.0+. Tested on macOS. Pi coverage remains partial; missing usage never becomes zero.

The BB server reads only the current thread's identity and routes to its exact host. The host independently reads scalar usage and private per-session startup readiness. No automatic installer, custom launcher or BB core modification is used. Historic amounts remain visible when capture is unavailable.

From the repository root, run `npm test`. Install a local candidate with `bb plugin install . --plugin session-credits`. For production installation, follow the [root guide](../../README.md).

[Accounting](docs/accounting.md) · [Receipt contract](docs/receipt-contract.md) · [Architecture](docs/architecture.md) · [MIT](LICENSE).
