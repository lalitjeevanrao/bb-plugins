# bb-plugins

Three BB plugins, one repository, released independently.

| Plugin | What it does | Screenshots |
| --- | --- | --- |
| [Copilot session credits](packages/bb-plugin-copilot-session-credits/README.md) | GitHub Copilot AI Credits for the current thread, beside the context indicator | [Copilot CLI](docs/screenshots/copilot-cli.png) · [Pi](docs/screenshots/pi-copilot.png) |
| [Home Hero](packages/bb-plugin-home-hero/README.md) | Time-of-day greeting and an optional uploaded icon at the top of the home screen | [Home Hero](packages/bb-plugin-home-hero/docs/screenshots/home-hero.png) |
| [Composer Auto-collapse](packages/bb-plugin-composer-autocollapse/README.md) | Collapses an unused prompt box on focus-out or after idle time, without losing the draft | [Settings](packages/bb-plugin-composer-autocollapse/docs/screenshots/settings.png) |

## Install

Requires **BB 0.49.0+** for Home Hero and Composer Auto-collapse, **BB 0.48.1+** for Copilot session credits. Tested on macOS.

```sh
# Copilot session credits (also needs Pi 1.5.0+ for Pi coverage)
bb plugin install git:https://github.com/lalitjeevanrao/bb-plugins.git@v0.3.1 --plugin copilot-session-credits

# Home Hero
bb plugin install git:https://github.com/lalitjeevanrao/bb-plugins.git@home-hero/v0.1.1 --plugin home-hero

# Composer Auto-collapse
bb plugin install git:https://github.com/lalitjeevanrao/bb-plugins.git@composer-autocollapse/v0.1.0 --plugin composer-autocollapse
```

Each plugin installs on its own: pick only the ones you want, and update or remove them separately. Use `bb plugin remove <id>` to uninstall.

From a local clone, `bb plugin install . --plugin <name>` installs the same package the tagged release ships. On a second machine, [`docs/install-on-another-machine.sh`](docs/install-on-another-machine.sh) runs the three pinned installs (with the optional Pi companion commented out).

## Releases

Credits keeps the unprefixed `vX.Y.Z` tags and stays compatible with the existing install and Pi sources. The other two plugins use `home-hero/vX.Y.Z` and `composer-autocollapse/vX.Y.Z` so each version moves on its own. See [releasing](docs/releasing.md).

## Privacy

No plugin in this repository talks to an analytics service. Home Hero icons are validated in the plugin server and stored in BB's private plugin storage for that plugin. Composer Auto-collapse only reads focus and draft state in the page; it stores nothing but its own settings. Credits collect the usage fields described in its [security notes](SECURITY.md).

Screenshots in this repository show live UI with neutral demo data.

## Repository layout

```
packages/bb-plugin-copilot-session-credits/   BB plugin + shared collector
packages/bb-plugin-home-hero/                 Home screen greeting and icon
packages/bb-plugin-composer-autocollapse/     Composer focus-out and idle collapse
test/                                         Collection and install checks
docs/                                         Guides, screenshots, spec and plan
```

Each package is standalone: its own `package.json`, lockfile, tests, build and version. There is no workspace, shared runtime dependency or root `node_modules` requirement.

## Development

Requires Node 22.19+ and BB 0.49.0+:

```sh
npm --prefix packages/bb-plugin-copilot-session-credits ci
npm --prefix packages/bb-plugin-home-hero ci
npm --prefix packages/bb-plugin-composer-autocollapse ci
npm test            # credits plugin, collector and install tests
npm run check       # collection index, all plugin tests, typecheck and builds
```

Tests use synthetic inputs and make no paid model calls. Plugin DOM placement and host selectors can change between BB releases.

[Changelog](CHANGELOG.md) · [Releasing](docs/releasing.md) · [MIT license](LICENSE)

Author: **Lalit Rao**
