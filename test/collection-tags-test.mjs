// Proves the tag namespaces stay separate: credits resolve unprefixed tags,
// the new plugins resolve their own prefixes, and a prefixed tag never
// matches the credits range.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'bb-plugins-tags-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');
writeFileSync(join(dir, 'README.md'), 'fixture\n');
git('add', '.');
git('commit', '-q', '-m', 'fixture');
for (const tag of ['v0.3.1', 'home-hero/v0.1.0', 'composer-autocollapse/v0.1.0']) git('tag', tag);

assert.deepEqual(git('tag', '--list', 'v*').split('\n'), ['v0.3.1'], 'credits sees only unprefixed tags');
assert.equal(git('describe', '--tags', '--match', 'home-hero/v*', '--abbrev=0'), 'home-hero/v0.1.0');
assert.equal(git('describe', '--tags', '--match', 'composer-autocollapse/v*', '--abbrev=0'), 'composer-autocollapse/v0.1.0');
assert.equal(git('describe', '--tags', '--match', 'v*', '--abbrev=0'), 'v0.3.1', 'the credits range ignores prefixed tags');

console.log(JSON.stringify({ tags: git('tag', '--list').split('\n'), status: 'passed' }, null, 2));
