# Release checklist

The current release is v0.3.0 (breaking canonical plugin ID rename). The implementation uses released BB APIs and requires no BB core feature approval. Copilot CLI works from the BB installation; Pi requires its separately installed companion and an authenticated Pi 1.5.0+ runtime.

## Validate the source

1. Run `npm --prefix packages/bb-plugin-copilot-session-credits ci` and `npm test` from a clean source snapshot. The suite builds the actual BB package and tests real Pi package installation/loading with synthetic transport.
2. Install the candidate in BB 0.48.1+, inspect setup/usage details and verify copied commands. Exercise readiness, history preservation, host failures, supported/unsupported runtime and removal behavior. Do not claim a live billing audit or untested platforms/hosts.
3. Capture real installed UI in a clean demo thread. Keep private conversations, identifiers, usage and machine paths out of public images. Never substitute drawn mockups or fabricated billing totals.
4. Review manifests, immutable install commands, MIT notices and author Lalit Rao. Derive `copilot-session-credits` from the BB package name using BB Guide's helper.

## Publish the Git release

Destination: public `lalitjeevanrao/copilot-session-credits`; root Pi package and `packages/bb-plugin-copilot-session-credits` share v0.3.0. Leave npm `private: true`; no npm/PyPI publication is needed.

Release from `main`, which contains the public history. Never merge or push the private `implementation/monorepo` branch: it contains historical screenshots excluded from publication. Exclude dependencies, build output and local review artifacts.

Before a future release mutation, show the exact authenticated account, destination, release SHA, package/version, immutable tag and remote commands as required by BB Guide's submit-a-plugin release checkpoint. Publish only the reviewed source; never retag a release. Enable private vulnerability reporting.

After publication, verify public access, CI and fresh installation from both commands in README. A pinned source does not follow new versions automatically.

## Submit to BB Community

Read the current `get-bb/marketplace` README, v2 schema, categories, icon rules and representative entries before submission. Check id availability and reserved ids.

Prepare:

- `entries/copilot-session-credits.json`: Copilot session credits; author Lalit Rao / lalitjeevanrao; category token-usage-and-limits; public Git source, subdir `packages/bb-plugin-copilot-session-credits`, range `^0.3.0`.
- A square theme-aware coin icon under `icons/`, <=256 KB, named with the first eight SHA256 characters.
- `overview/copilot-session-credits.md`, copied from PLUGIN_OVERVIEW.md, under 4000 characters with permitted Markdown and absolute HTTPS links.
- Two or three actual installed-UI screenshots under `screenshots/copilot-session-credits/`, each >=1200 px wide and <=2 MiB. Reference every included image.

The listing must disclose authenticated Copilot access, Pi's separate companion installation, Pi 1.5.0+, tested platform and partial coverage.

Run `npm ci --ignore-scripts`, `npm run build`, `npm test`, `npm run gate:v1`, and `npm run check`. The final check resolves public sources and therefore needs the release to exist. Commit only entry/icon/overview/referenced screenshots. Open the marketplace PR with source/range, validation, requirements, screenshot descriptions and overview provenance. Report the PR URL and state accurately; submission is complete when opened and validated, while listing availability requires maintainer merge.

Use PR title **Add plugin entry: copilot-session-credits**. Include the immutable v0.3.0 tag and its exact released commit once known; do not submit invented provenance. The listing hook is **Track reported GitHub Copilot credit usage for each BB thread.** Keep the Pi partial-coverage caveat. Open the overview with source/coverage differences rather than repeating this hook.

The PR body must disclose that BB plugins run with full trust/user permissions and state the factual data boundary: thread/provider identity, Copilot CLI usage checkpoints and Pi usage receipts/status; no prompt, response or credential collection and no analytics endpoint. Disclose the bounded local CLI log-tail read described in SECURITY.md. Validate against the current marketplace schema and range `^0.3.0` after the tag is published.
