# Repository rules

This repository is the public home of the BB plugin collection. It currently
publishes `copilot-session-credits`; `home-hero` and `composer-autocollapse`
join it under `packages/`.

## Work tracking

- The source-repo issue is the record for a change. Open or reuse one before
  implementation, and link it from the PR.
- Three gates: the design is reviewed, the implementation diff and evidence are
  reviewed, and CI is green on the exact reviewed head before merge.
- Only reviewed code from merged `main` is released. Each plugin is released
  with its own immutable tag; never retag or rewrite a release commit.

## Collection layout

- Each plugin is an independent package under `packages/` with its own
  `package.json`, lockfile, tests, manifest, documentation and version.
- `.bb/plugins.json` indexes the packages for `bb plugin install ... --plugin`.
- No package may depend on a sibling package or on root `node_modules`.

## Releases

- `copilot-session-credits` keeps the unprefixed `vX.Y.Z` namespace and the root
  Pi companion entry at `package.json#pi`.
- New plugins use prefixed tags, for example `home-hero/v0.1.0`, installed with
  `--plugin home-hero` or a range plus `--tag-prefix home-hero/`.
- Git direct installation is the distribution mechanism. No npm publication.

## Privacy and publication boundaries

- Test, screenshot and document with neutral demo data. Never commit a
  personal avatar, icon, conversation, credential, machine path or private
  artwork — including in an intermediate commit.
- Do not publish historical implementation branches, private screenshots, or
  private backup refs. Push only reviewed branches and the exact release tags.
- Do not modify the external marketplace repository from this repo's flow. A
  marketplace listing is a separate, explicitly requested change.

## Checks

```sh
npm run check          # collection index + all package checks
npm test               # credits: typecheck, accounting, host, UI, Pi install
```

Run the per-package `ci`, `test`, `typecheck` and `bb plugin build` commands
documented in each package README before a release.
