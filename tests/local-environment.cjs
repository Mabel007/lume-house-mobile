const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const registry = require('../config/environment');
const approved = require('../config/local-backend.json');
const actualBuild = require('../config/local-build');
const fixtureKey = 'sb_publishable_synthetic_local_contract';
function buildFixture() {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('config/local-build.js', 'utf8'), { module, require: name => {
    if (name === 'node:crypto') return crypto;
    return { ...approved, publicKeySha256: crypto.createHash('sha256').update(fixtureKey).digest('hex') };
  } });
  return module.exports.localBuildConfig;
}
function input(variant = 'development') {
  return { ...registry.identityFor(variant), url: approved.origin, key: fixtureKey };
}
test('local build fingerprint is checked before approved public manifest metadata exists', () => {
  const build = buildFixture();
  const metadata = build('development', approved.origin, fixtureKey);
  assert.equal(metadata.publicKey, fixtureKey);
  assert.equal(metadata.projectRef, approved.projectRef);
  assert.throws(() => build('development', approved.origin, 'sb_publishable_wrong_environment'));
  assert.throws(() => actualBuild.localBuildConfig('development', approved.origin, fixtureKey));
  assert.equal(build('staging', approved.origin, fixtureKey), undefined);
  assert.equal(build('production', approved.origin, fixtureKey), undefined);
});
test('development uses only the trusted loopback gateway, bound key and isolated session namespace', () => {
  const metadata = buildFixture()('development', approved.origin, fixtureKey);
  const result = registry.validateEnvironment({ ...input(), localBackend: metadata });
  assert.equal(result.url, approved.origin); assert.equal(result.projectRef, 'local:lume-house');
  assert.equal(result.storageKey, 'lume-house-development-local-auth-v1');
  assert.equal(result.callback, 'lumehousemobile-dev://auth/callback');
  assert.throws(() => registry.validateEnvironment(input()));
  assert.throws(() => registry.validateEnvironment({ ...input(), localBackend: metadata, key: 'sb_publishable_wrong_environment' }));
});
test('local trust cannot weaken production/staging, native identity or URL restrictions', () => {
  const metadata = buildFixture()('development', approved.origin, fixtureKey);
  for (const variant of ['production', 'staging']) assert.throws(() => registry.validateEnvironment({ ...input(variant), localBackend: metadata }));
  for (const patch of [{ url: 'http://localhost:54321' }, { url: 'http://127.0.0.1:54322' },
    { url: `${approved.origin}/` }, { url: 'http://192.168.1.10:54321' },
    { url: 'http://user:private@127.0.0.1:54321' }, { scheme: 'lumehousemobile' },
    { androidPackage: 'com.najbuilds.lumehouse' }, { callback: 'lumehousemobile://auth/callback' },
    { key: 'sb_secret_private' }, { localBackend: { ...metadata, projectRef: 'wrong' } }]) {
    assert.throws(() => registry.validateEnvironment({ ...input(), localBackend: metadata, ...patch }));
  }
});
