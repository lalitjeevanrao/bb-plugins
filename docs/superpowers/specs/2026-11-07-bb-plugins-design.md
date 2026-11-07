# Public BB plugin collection

Status: approved direction, incorporating owner feedback from the ended Lavish review on 2026-11-07. Owner explicitly requested this spec, implementation plan, a DeepSeek Thinking worker, source-repo PR push/merge, and installation commands. Parent only plans, orchestrates and reviews; the worker executes.

## Outcome

Rename the existing public GitHub repository `lalitjeevanrao/copilot-session-credits` to `lalitjeevanrao/bb-plugins` and its local checkout to `$NEW_CHECKOUT`. Retain history and immutable credits releases. Publish three independently installable BB plugins in this repository:

- `copilot-session-credits`: existing path `packages/bb-plugin-copilot-session-credits` and existing identity.
- `home-hero`: new path `packages/bb-plugin-home-hero`, imported from `$LEGACY_HOME_HERO` after sanitizing private branding.
- `composer-autocollapse`: new path `packages/bb-plugin-composer-autocollapse`, imported from `$LEGACY_AUTOCOLLAPSE`.

Path placeholders in this document and the plan keep private machine layout out of the public repository:

| Placeholder | Meaning |
| --- | --- |
| `$CHECKOUT` | this repository's current local checkout |
| `$NEW_CHECKOUT` | this repository's local checkout after the planned directory rename |
| `$LEGACY_HOME_HERO` | the owner's pre-collection Home Hero source folder |
| `$LEGACY_AUTOCOLLAPSE` | the owner's pre-collection Composer Auto-collapse source folder |

Use a lightweight collection, not npm workspaces or a shared runtime package. Each package owns its dependencies, lockfile, manifest, compatibility requirements, documentation, tests, and version. Root scripts coordinate checks. No plugin may require a sibling package or root node_modules to install.

## Publication boundaries

The repository is already public. Direct Git installation is the sharing mechanism. Do not publish to npm or create a new marketplace. Do not modify, merge, close, or open any marketplace PR in this job. Existing get-bb/marketplace PR #873 must merge before either new plugin is submitted in a separate future marketplace PR. This replaces the initial brainstorm's suggestion to update the existing marketplace PR during the rename.

The owner authorizes a source-repository issue, branch, PR, push and merge for this work. Establish a concise repo AGENTS.md recording the agreed flow and these boundaries. No project-specific role file currently exists. Use the available Pi model `deepseek/deepseek-flash`, displayed as DeepSeek V4.1 Flash, with reasoning level `high` as the thinking worker; do not substitute another worker model silently.

## Release compatibility

Preserve `v0.3.0`, `v0.3.1`, the credits package path, plugin ID, root Pi extension path and existing receipt compatibility. Keep credits releases in the existing unprefixed vX.Y.Z namespace. Root package version continues to describe the credits Pi companion; unrelated plugin releases do not bump it.

New plugin releases use `home-hero/v0.1.0` and `composer-autocollapse/v0.1.0`, with package versions 0.1.0. Keep future version changes independent. Users may select a pinned tag with `--plugin`, or a semver range with the matching `--tag-prefix`. The root collection manifest lists all three names and package paths, and its collection name becomes `bb-plugins`.

Verify old credits Git source URLs and new source URLs resolve existing release refs to the same commits after rename. Do not rewrite immutable tags or historical release commits. If old-source resolution fails, report and resolve the migration problem within the source-repo scope; do not change marketplace state without new owner instructions.

## Home Hero public behavior

The owner's violet Mobius artwork is PRIVATE. Do not copy its SVG, geometry, derived icon, screenshots or embedded data into any public commit, test fixture, documentation, release, or Git object pushed by this work. Sanitize the imported source before the first commit. No private-branding intermediate commit is acceptable. Preserve the original local source and current personal installation until the replacement is verified.

Replace the hardcoded personal name with optional `displayName` in the plugin settings page. Default is an empty string; the greeting renders only its time-of-day text without a comma or empty-name artifact. A configured name is trimmed, limited to 80 characters, and rendered as text, not HTML. Time-of-day behavior follows the client's local time.

The same plugin settings page provides an actual file upload control for an optional icon, preview, remove/reset control, success state, and actionable validation errors. An empty icon means no custom icon; do not ship a substitute reproduction of the private mark. Accept PNG, JPEG and WebP, with a maximum decoded file size of 256 KiB; reject SVG and other types and malformed/disguised data at the server boundary. No remote icon URL or external analytics is needed. Store uploads in private plugin-managed storage, never in the repository. Failed validation retains the prior good icon. State must survive reload and support removal.

Use supported BB settings and `settingsSection` APIs, typed RPC and plugin storage. Prefer a declarative displayName setting plus an icon-upload settings section. The worker must verify current SDK declarations for exact signatures. Proposed internal public-to-plugin contract: `getAppearance(null)` returns `{displayName:string, iconDataUrl:string|null}`; `setIcon({iconDataUrl:string|null})` persists only validated icons and returns the effective appearance. Appearance refresh must update the mounted hero after settings change without requiring a plugin reinstall; a bounded refresh-on-focus/poll is sufficient if a supported subscription is unavailable.

Keep the greeting layout and typography from the existing customization. Avoid app-wide CSS changes to host branding: remove the original global bb-logo filter override. Scope DOM/CSS changes to the mounted home surface and release them on disable, unmount or reload. No duplicate heroes on repeated mounts. Respect reduced motion. If host selectors are absent, leave the host UI usable and do not throw or hide the composer. Declare truthful BB/SDK floors based on APIs actually used.

## Composer Auto-collapse public behavior

Retain existing independent plugin identity and configurable focus-out delay, idle threshold, empty-draft and hidden-tab behavior. Preserve settings defaults unless a verified bug requires a focused change. Clicking outside the expanded composer compacts it; interacting with its editor, toolbar, typeahead, model picker or related portal must not collapse it unexpectedly. Preserve draft contents and native click-to-expand behavior. Idle collapse must respect configured conditions and avoid interrupting an active, nonempty draft. Cleanup removes listeners, intervals and pending work; missing host selectors fail harmlessly.

Review server dependencies: this source imports zod at runtime while its original manifest has it only in devDependencies. Correct actual runtime/build requirements and prove an isolated install; do not copy the full scaffold dependency list without need.

## Documentation and screenshots

Root README describes the collection and all three plugins with per-plugin links, installation commands, independent releases, supported requirements, and direct-Git versus marketplace availability. Root README does not present the repo as only credits. Each plugin has its own README, package-local changelog and PLUGIN_OVERVIEW.md. Move credits-specific long-form documentation under its package where useful; keep existing root links working or update every current link coherently without unnecessary moves.

Each plugin README includes real, current UI screenshots, maximum TWO referenced screenshots per README. Credits can reuse two of the existing real captures. Home Hero and auto-collapse screenshots must come from real running UI with neutral demo settings and no private logo, conversations, credentials or personal paths. Do not generate mock screenshots. If a capture cannot be produced, report the gap rather than invent evidence. Use captioned before/after if needed for auto-collapse within the two-image limit. Keep screenshot paths inside the package for self-contained documentation. Root need not repeat screenshots.

## Validation and delivery

Run clean dependency installs, existing full credits suite (including Pi install/load/remove), all new package tests/typechecks, and actual `bb plugin build` for each new plugin. Add meaningful focused tests for greeting boundaries, name/icon validation and persistence, safe rendering, lifecycle cleanup and collapse focus/idle behavior. Test individual installation from a clean local Git fixture and then public pinned Git sources after publication. New-plugin tags must not enter credits' unprefixed semver selection.

Capture live home/settings and composer behavior. Verify upload, reset, blank name, custom name, light/dark and narrow layout, reduced motion, navigation, duplicate mount cleanup and co-installation with credits. Do not replace the owner's active customization or lose personal settings merely to collect evidence; use an isolated BB test instance/profile when possible. Parent reviews diffs and evidence before source PR merge. CI must be green on the exact PR head; verify merged commit afterwards.

Only release reviewed code from merged main. Create immutable plugin-specific Git tags once parent accepts verification; do not retag. Supply tested commands for another machine for each plugin, plus Pi companion only when needed. State actual compatibility and verification limits.

## Local migration and archival

Execute all code work before moving the active checkout. Before moving, record current BB project source IDs, environment IDs and local tool references. Verify the target directory is absent. Rename the directory, update origin and the BB project source/name using supported commands, and have parent switch the thread to the existing target directory with update_environment_directory. That switch ends the parent's turn; continuation runs at the new path. Never leave BB pointing at a nonexistent folder.

After imported code is verified, archive superseded LOCAL implementation branches using local refs or a private backup, with old SHA recorded. Do not publish the historical `implementation/monorepo` branch: the existing release guide identifies private screenshots in it. Do not delete old source folders or push archive refs. Verify all public refs are intentional. No broad `git push --all` or `--mirror`.

## Completion evidence

Deliver the source PR URL and merged SHA, renamed repo URL and local path, per-plugin release refs/SHAs, test/build/CI results, public-install evidence, privacy scan result, archive receipt, and cross-machine installation commands. Any missing requirement remains explicit and prevents an unqualified completion claim.
