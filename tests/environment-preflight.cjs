const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { checkEnvironment } = require('../scripts/environment-preflight.cjs');
const registry = require('../config/environment');
const baseline = require('../app.json').expo;
const profiles = require('../eas.json').build;
const key = 'sb_publishable_NEVER_PRINT_THIS_FIXTURE';
const ref = 'abcdefghijklmnopqrst';
function config(variant = 'production') {
  const identity = registry.identityFor(variant);
  return { ...baseline, name: identity.name, scheme: identity.scheme,
    android: { ...baseline.android, package: identity.androidPackage }, extra: { ...baseline.extra, appVariant: variant } };
}
function input(variant = 'production', profile = 'production') {
  return { variant, profile, url: `https://${variant === 'production' ? registry.productionProjectRef : ref}.supabase.co`, key };
}
function cli(variant, args, extra = {}) {
  const env = { ...process.env, APP_VARIANT: variant, EXPO_PUBLIC_SUPABASE_URL: input().url,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, ...extra };
  if (variant === undefined) delete env.APP_VARIANT;
  return spawnSync(process.execPath, [path.resolve('scripts/environment-preflight.cjs'), ...args], { env, encoding: 'utf8' });
}
test('read-only summary validates production and historical preview without returning keys', () => {
  for (const profile of ['production', 'preview']) {
    const summary = checkEnvironment(input('production', profile), config());
    assert.equal(summary.projectRef, registry.productionProjectRef);
    assert.equal(summary.callback, 'lumehousemobile://auth/callback');
    assert.equal(summary.key, undefined); assert.ok(!JSON.stringify(summary).includes(key));
  }
});
test('future trusted NONPROD preflight covers both profiles; actual registry still blocks them', () => {
  for (const variant of ['development', 'staging']) {
    const summary = checkEnvironment(input(variant, variant), config(variant), profiles, value => registry.validateEnvironment(value, ref));
    assert.equal(summary.variant, variant); assert.equal(summary.projectRef, ref);
    assert.throws(() => checkEnvironment(input(variant, variant), config(variant)), /not configured/);
  }
});
test('wrong profile and tampered EAS environment, binary or dotenv safety are refused', () => {
  for (const profile of ['development', 'staging', 'unknown', 'toString', null]) {
    assert.throws(() => checkEnvironment(input('production', profile), config()));
  }
  assert.throws(() => checkEnvironment({ ...input(), profile: undefined }, config()));
  for (const patch of [{ environment: 'preview' }, { android: { buildType: 'apk' } },
    { developmentClient: true }, { distribution: 'internal' }, { env: { APP_VARIANT: 'staging', EXPO_NO_DOTENV: '1' } },
    { env: { APP_VARIANT: 'production' } }]) {
    assert.throws(() => checkEnvironment(input(), config(), { ...profiles, production: { ...profiles.production, ...patch } }));
  }
});
test('resolved metadata, name, association, package and scheme must all match', () => {
  for (const patch of [{ name: 'Lumé House Dev' }, { extra: { ...baseline.extra, appVariant: 'staging' } },
    { extra: { appVariant: 'production', eas: { projectId: 'wrong-association' } } },
    { android: { package: 'com.najbuilds.lumehouse.dev' } }, { scheme: 'lumehousemobile-staging' }]) {
    assert.throws(() => checkEnvironment(input(), { ...config(), ...patch }));
  }
});
test('actual CLI resolves dynamic production configuration and emits only safe metadata', () => {
  const result = cli('production', ['--profile', 'production']);
  assert.equal(result.status, 0); const summary = JSON.parse(result.stdout);
  assert.equal(summary.readOnly, true); assert.equal(summary.status, 'PASS');
  assert.equal(summary.androidPackage, 'com.najbuilds.lumehouse');
  assert.ok(!result.stdout.includes(key)); assert.equal(result.stderr, '');
});
test('installed Expo CLI resolves all three app identities without dotenv or backend initialization', () => {
  for (const variant of ['development', 'staging', 'production']) {
    const result = spawnSync(process.execPath, [path.resolve('node_modules/expo/bin/cli'), 'config', '--type', 'public', '--json'], {
      env: { ...process.env, APP_VARIANT: variant, EXPO_NO_DOTENV: '1', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }, encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    const resolved = JSON.parse(result.stdout);
    const expected = registry.identityFor(variant);
    assert.equal(resolved.android.package, expected.androidPackage);
    assert.equal(resolved.scheme, expected.scheme); assert.equal(resolved.name, expected.name);
    assert.equal(resolved.extra.appVariant, variant);
    assert.equal(resolved.extra.eas.projectId, baseline.extra.eas.projectId);
    assert.ok(!result.stdout.includes(key));
  }
});
test('actual CLI refuses wrong environment, malformed inputs and missing selectors without leaking values', () => {
  for (const [variant, args, extra] of [
    ['development', ['--profile', 'development'], {}], ['staging', ['--profile', 'staging'], {}],
    [undefined, ['--profile', 'production'], {}], ['unknown', ['--profile', 'production'], {}],
    ['production', ['--profile', 'staging'], {}], ['production', ['--profile', 'production'], { EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_PRIVATE_SENTINEL' }],
    ['production', ['--profile', 'production'], { EXPO_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co` }],
    ['production', ['--unknown', 'private'], {}], ['production', ['--profile', 'production', '--profile', 'preview'], {}],
  ]) {
    const result = cli(variant, args, extra);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.match(result.stderr, /preflight refused/); assert.ok(!result.stderr.includes(key)); assert.ok(!result.stderr.includes('PRIVATE_SENTINEL'));
  }
});
