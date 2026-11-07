// Collection index contract: every listed entry is a distinct, self-contained
// package. Run from the repository root: node test/collection-test.mjs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const indexPath = join(root, '.bb/plugins.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));

assert.equal(index.name, 'bb-plugins', 'collection name');
assert.equal(index.schemaVersion, 1, 'collection schema version');

const expected = [
  ['copilot-session-credits', './packages/bb-plugin-copilot-session-credits'],
  ['home-hero', './packages/bb-plugin-home-hero'],
  ['composer-autocollapse', './packages/bb-plugin-composer-autocollapse'],
];
assert.deepEqual(
  index.plugins.map(entry => [entry.name, entry.source]),
  expected,
  'indexed entries and their package paths',
);

const packageNames = new Set();
const pluginIds = new Set();
for (const entry of index.plugins) {
  assert.match(entry.source, /^\.\/packages\//, `${entry.name} source is repository-relative`);
  const dir = join(root, entry.source);
  assert.ok(existsSync(join(dir, 'package.json')), `${entry.name} has a package.json`);
  assert.ok(existsSync(join(dir, 'package-lock.json')), `${entry.name} has its own lockfile`);

  const manifest = read(join(entry.source, 'package.json'));
  assert.ok(manifest.bb, `${entry.name} declares a bb manifest`);
  assert.ok(existsSync(join(dir, manifest.bb.server)), `${entry.name} server entry exists`);
  if (manifest.bb.app) assert.ok(existsSync(join(dir, manifest.bb.app)), `${entry.name} app entry exists`);
  assert.equal(manifest.private, true, `${entry.name} stays unpublished`);

  // The bb plugin id is the package name without the bb-plugin- prefix; it must
  // match the collection entry so `--plugin <name>` resolves.
  assert.equal(manifest.name, `bb-plugin-${entry.name}`, `${entry.name} package name`);
  assert.ok(!packageNames.has(manifest.name), `${entry.name} package name is unique`);
  packageNames.add(manifest.name);
  const id = entry.name;
  assert.ok(!pluginIds.has(id), `${entry.name} plugin id is unique`);
  pluginIds.add(id);

  // Independence: no dependency on a sibling package or the repository root.
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      assert.ok(!dependency.startsWith('bb-plugin-'), `${entry.name} does not depend on ${dependency}`);
      assert.ok(!dependency.startsWith('copilot-session-credits'), `${entry.name} does not depend on the root package`);
    }
  }
}

// Release namespaces: credits owns the unprefixed vX.Y.Z tags; new plugins
// release under their own prefixed tags, so their versions stay independent.
const credits = read('./packages/bb-plugin-copilot-session-credits/package.json');
assert.equal(credits.version, read('./package.json').version, 'credits package shares the root Pi companion version');
const rootManifest = read('./package.json');
assert.deepEqual(rootManifest.pi.extensions, ['./packages/bb-plugin-copilot-session-credits/collector/extension.ts']);
// Each new plugin releases on its own schedule, so this check only requires a
// parseable version and declared engines; exact versions live in release receipts.
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
for (const name of ['home-hero', 'composer-autocollapse']) {
  const manifest = read(`./packages/bb-plugin-${name}/package.json`);
  assert.match(manifest.version, SEMVER, `${name} version is valid semver`);
  assert.ok(manifest.engines?.bb && manifest.engines?.bbPluginSdk, `${name} declares its BB and plugin SDK engines`);
}

console.log(JSON.stringify({ collection: index.name, entries: index.plugins.map(entry => entry.name), status: 'passed' }, null, 2));
