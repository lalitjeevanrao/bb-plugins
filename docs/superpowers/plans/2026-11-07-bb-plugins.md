# BB Plugins Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The owner specifically selected a DeepSeek Thinking worker. Parent plans, orchestrates and reviews; worker executes.

**Goal:** Rename this public repository to bb-plugins and deliver three independently installable, documented BB plugins through a reviewed source-repository PR.

**Architecture:** Keep independent packages and lockfiles under packages/, indexed by .bb/plugins.json. Credits and its root Pi companion retain their existing release contract; the new plugins get independent prefixed releases.

**Tech Stack:** Node >=22.19.0, TypeScript, React, BB plugin SDK and CLI, existing Node tests, Pi >=1.5.0 for credits tests, GitHub Actions.

**Spec:** docs/superpowers/specs/2026-11-07-bb-plugins-design.md

## Global Constraints

- The owner's violet Mobius artwork is PRIVATE. Never commit or push its payload, derived artwork or screenshots.
- New versions: home-hero 0.1.0 and composer-autocollapse 0.1.0; tags home-hero/v0.1.0 and composer-autocollapse/v0.1.0.
- Preserve credits ID, package path, v0.3.0/v0.3.1, root Pi extension and receipt compatibility. Root Pi companion version is independent of new plugin releases.
- Lightweight collection; no shared runtime dependency or npm workspace migration.
- Home name defaults empty, trimmed max 80 chars. Icon accepts PNG/JPEG/WebP up to 256 KiB decoded, validated server-side; no SVG or remote URL.
- Each package README has actual UI screenshots, maximum TWO. No private branding in public captures.
- No marketplace mutation, npm publication, private branch publication, force push or moved release tags.
- Use only the selected DeepSeek thinking worker for execution. Keep parent informed at task boundaries and before publication/move.
- All execution, including code edits and release mutations, belongs to the worker. Parent may inspect, review and run read-only verification.

## Task 1: Record work and prepare the collection boundary

**Files:** create AGENTS.md; modify .bb/plugins.json, package.json, README.md, docs/releasing.md, .github/workflows/ci.yml; add package-local documentation as later tasks land.
**Consumes:** existing public main at 9ea17a8, inspected source directories and approved spec.
**Produces:** feat/bb-plugins-collection branch with documented independent package checks and tracked source-repo issue.

- [ ] Read the spec, local instructions and relevant BB authoring references. Read executing-plans. Owner authorized source-repo issue/branch/PR work; no further approval loop is needed for that flow.
- [ ] Record git status, origin, current v0.3.0/v0.3.1 SHAs, project source details and available BB/SDK versions. Ensure tracked/untracked user work is preserved.
- [ ] Add concise repo AGENTS.md covering source issue as record, design/review/verification gates, independent releases, privacy and no marketplace mutations. Create the source issue and implementation branch using gh-axi; use --body-file for multiline content. If gh-axi lacks an operation, use gh as a documented fallback.
- [ ] Add a collection-index test that checks all three expected entry names and distinct existing package paths after imports. Add independent per-package build/test scripts; retain current credits/Pi commands. Extend CI installation and checks to all three package lockfiles.
- [ ] Keep exact current credits ID/path and historical release commands. Update current release guidance for independent new plugin namespaces and root Pi behavior. New packages need not use the root Pi version.
- [ ] Verify collection checks fail before missing packages arrive, and pass after Tasks 2–3. Commit only reviewed docs/config and no private-source artifacts.

## Task 2: Import Home Hero with configurable private appearance

**Files:** create packages/bb-plugin-home-hero/{package.json,package-lock.json,tsconfig.json,server.ts,app.tsx,greeting.ts,appearance.ts,settings.tsx,README.md,PLUGIN_OVERVIEW.md,CHANGELOG.md,test/appearance.test.mjs,test/greeting.test.mjs,test/lifecycle.test.mjs}; exclude original bb-mark.ts.
**Consumes:** original local home-hero source, available SDK settings/storage/RPC and settingsSection contracts.
**Produces:** independently buildable home-hero@0.1.0, settings-driven greeting and bounded private icon upload.

- [ ] Copy only the necessary source into the new package while excluding bb-mark.ts, .git, node_modules, dist and personal configs. Remove private mark imports/payload and hardcoded personal-name constants before any git add or commit. Remove global host logo CSS overrides.
- [ ] Write meaningful failing pure tests for time boundaries 11/12/16/17, blank-name punctuation, trimming/80-char validation, PNG/JPEG/WebP acceptance, empty/removal state, SVG rejection, spoofed MIME/signature, malformed base64, and 256 KiB limit. Tests must assert behavior, not source-string matching.
- [ ] Implement small appearance/greeting helpers. Keep the UI appearance contract getAppearance(null) -> {displayName,iconDataUrl} and setIcon({iconDataUrl}) -> effective appearance; validate all server inputs. Declare the displayName setting and store icon in plugin-managed private storage. Read current SDK declarations before choosing APIs.
- [ ] Implement an icon upload settingsSection with file input, preview, remove, pending/error/success states. Never discard prior good data on a bad upload. Ensure the native displayName field and mounted home hero reflect persisted appearance changes. Use text nodes for names.
- [ ] Preserve home-scoped layout and existing typography, make animations obey reduced-motion, and handle missing selectors and repeated mounting/unmounting safely. Keep no uploaded icon as a clean iconless greeting.
- [ ] Add lifecycle tests for duplicate mounts, cleanup and absent host target. Choose dependency fields from actual build/runtime imports; use BB's normal build contract and truthful engine floors.
- [ ] Run npm ci, package tests/typecheck, and bb plugin build in this package; save logs and test reports in BB_THREAD_STORAGE. Commit sanitized source only after a private-artwork scan. Do not migrate the owner's installed plugin yet.

## Task 3: Import and verify Composer Auto-collapse

**Files:** create packages/bb-plugin-composer-autocollapse/{package.json,package-lock.json,tsconfig.json,server.ts,app.tsx,README.md,PLUGIN_OVERVIEW.md,CHANGELOG.md,test/composer.test.mjs}; split a small helper module if useful for behavior tests.
**Consumes:** existing local auto-collapse source and existing settings defaults; no Home Hero dependency.
**Produces:** independently buildable composer-autocollapse@0.1.0 with preserved settings and reliable click-outside behavior.

- [ ] Import necessary source only and preserve plugin ID/settings keys. Audit zod and all runtime imports against isolated Git build requirements; correct manifest fields and remove demonstrably unused scaffold dependencies.
- [ ] Add focused behavior tests: outside interaction collapses once; editor/toolbar/typeahead/related portal interaction does not; native draft survives collapse; idle nonempty visible draft is preserved; configured idle cases work; disabling cleans intervals/listeners/pending callbacks; absent selectors do nothing.
- [ ] Run tests red before focused fixes. Make the smallest change needed to satisfy click-outside and lifecycle requirements; do not expand unrelated behavior. Keep settings validation on the server and no dependency on Home Hero.
- [ ] Run clean npm ci, package tests/typecheck and bb plugin build; commit the independent package and evidence references.

## Task 4: Documentation, captures and end-to-end installation

**Files:** root README.md; packages/*/README.md, PLUGIN_OVERVIEW.md, CHANGELOG.md, docs/screenshots/*; existing credit docs/current links; test/collection-test.mjs and isolated installation coverage.
**Consumes:** three buildable packages and root collection index.
**Produces:** complete public docs and verified clean installs with real screenshots.

- [ ] Root README introduces all three plugins, links each README, names dependencies and tested compatibility, and explains independent direct Git installation and marketplace status. Do not imply the new plugins are listed.
- [ ] Give credits its own complete README and use at most two of its existing real screenshots. New package READMEs each have at most two actual captures; use neutral demo name and NO private artwork. Preserve/upkeep credits security/accounting documentation links.
- [ ] Use current browser automation guidance and chrome-devtools-axi for real UI verification. Prefer an isolated BB test instance/profile; never overwrite or publish the owner's private icon. Verify Home Hero settings upload/reset, name changes, time-of-day display, light/dark/narrow/reduced-motion, navigation and cleanup. Verify auto-collapse outside clicks, portal menus, active draft, idle and removal.
- [ ] Add isolated local tagged Git fixture tests proving each collection selection installs/builds alone and the new tag namespaces do not enter credits range resolution. Retain the complete credits Pi install/load/remove suite.
- [ ] Run npm test and build/typecheck commands for every package from clean dependency installs, plus documented collection checks. Record commands, exits, reports and live evidence paths. Do not label live behavior verified without observing it.
- [ ] Send parent the exact diff summary, privacy-scan results, evidence and any gaps. Parent reviews before publication. Fix every parent finding in the worker thread and rerun affected checks.

## Task 5: Rename public repository, push PR and satisfy CI

**Files:** repository URLs in current package metadata/documentation, root collection naming, source-repo issue/PR body; no marketplace files.
**Consumes:** parent-reviewed implementation and unchanged historical credits tag SHAs.
**Produces:** renamed public repo and reviewed source PR with green checks.

- [ ] Recheck lalitjeevanrao/bb-plugins availability and authenticated GitHub account. Send exact destination, source SHA and planned mutations to parent. Owner has authorized repo rename/push/merge and this source publication; keep private data exclusion mandatory.
- [ ] Rename existing GitHub repo using gh fallback if gh-axi has no rename command. Set origin to https://github.com/lalitjeevanrao/bb-plugins.git. Update current metadata/docs links while preserving immutable historical tags/commits.
- [ ] Verify old and new URLs resolve credits release refs to the recorded SHAs. Validate source behavior without writing to get-bb/marketplace PR #873. Report redirect limitations if found.
- [ ] Push only the reviewed branch, open source PR linking issue/spec/plan, and wait for CI on the exact head SHA. Save CI JSON via gh-axi or gh fallback for parent review. Do not merge until parent accepts the reviewed head and checks.
- [ ] Parent independently reads diff/check results; worker fixes findings. Then merge the source PR as authorized and verify main contains the reviewed changes. Never merge/push private historical implementation branches.

## Task 6: Immutable direct-install releases, local archival and checkout move

**Files:** new plugin release tags, local git archive refs, BB project source/name/environment references; no retagging.
**Consumes:** merged source PR, parent acceptance, verified main.
**Produces:** public pinned installation commands, archive receipt, renamed local checkout and resumed parent environment.

- [ ] Tag reviewed merged main as home-hero/v0.1.0 and composer-autocollapse/v0.1.0; push only these exact tags. A GitHub release is optional if useful; never publish private sources or blanket tag sets.
- [ ] Verify public reachability and fresh clean installs of each tag via --plugin. Test optional range + --tag-prefix resolution. Validate credits v0.3.1 and its Pi companion remain installable. Report commands and exact resolved SHAs to parent.
- [ ] Record and archive superseded local implementation branch SHAs using refs/archive/... or a private local backup. No public archive refs; no source-folder deletion. Exclude implementation/monorepo from every push. Parent receives archive receipt.
- [ ] Record project source IDs and environment IDs; verify $NEW_CHECKOUT does not exist. Perform the local directory rename LAST. Update BB project source path and project name via supported commands, then notify parent of the exact path. Avoid issuing further shell commands in a stale cwd; use explicit new workdir.
- [ ] Parent verifies target exists and uses update_environment_directory with the absolute new path, then ends that turn. Worker can use the equivalent switch for its own thread after mutation if needed. Continue remaining checks after the harness resumes in the new directory.
- [ ] Final receipt includes source PR URL/merge SHA, renamed repo/path, immutable per-plugin tags, CI/test evidence, privacy scan/archive receipt, and tested installation commands for another machine. Explicitly state any untested platform and marketplace remains untouched.

## Concrete boundary contracts and first tests

The worker owns implementation. Use these pure helpers (or keep equivalent names together with their tests):

```ts
// appearance.ts
export function normalizeDisplayName(value: unknown): string;
export function validateIconDataUrl(value: unknown): string | null;
// greeting.ts
export function formatGreeting(hours: number, displayName: string): string;
```

Start the Home Hero behavior cycle with these assertions in the package tests. Use Node's built-in test runner and native TS stripping when supported by the declared Node floor, or the package's chosen test loader consistently.

```js
import assert from 'node:assert/strict';
import { normalizeDisplayName, validateIconDataUrl } from '../appearance.ts';
import { formatGreeting } from '../greeting.ts';
assert.equal(normalizeDisplayName('  Alex  '), 'Alex');
assert.equal(normalizeDisplayName(''), '');
assert.throws(() => normalizeDisplayName('x'.repeat(81)));
assert.equal(formatGreeting(11, ''), 'Morning');
assert.equal(formatGreeting(12, 'Alex'), 'Afternoon, Alex');
assert.equal(formatGreeting(16, ''), 'Afternoon');
assert.equal(formatGreeting(17, ''), 'Evening');
assert.equal(validateIconDataUrl(null), null);
assert.throws(() => validateIconDataUrl('data:image/svg+xml;base64,PHN2Zy8+'));
assert.throws(() => validateIconDataUrl('data:image/png;base64,bm90LWEtcG5n'));
assert.throws(() => validateIconDataUrl('data:image/png;base64,%%%'));
```

Baseline commands before and after package additions:

```sh
npm --prefix packages/bb-plugin-copilot-session-credits ci
npm test
npm --prefix packages/bb-plugin-home-hero ci
npm --prefix packages/bb-plugin-home-hero test
npm --prefix packages/bb-plugin-home-hero run typecheck
bb plugin build packages/bb-plugin-home-hero
npm --prefix packages/bb-plugin-composer-autocollapse ci
npm --prefix packages/bb-plugin-composer-autocollapse test
npm --prefix packages/bb-plugin-composer-autocollapse run typecheck
bb plugin build packages/bb-plugin-composer-autocollapse
```

Confirm the installed CLI's build path syntax before invoking; run from each package directory if the installed version takes no path argument. Save actual command output instead of inventing test counts.
