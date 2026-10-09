const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const registry = require('../config/environment');
const nonprod = 'abcdefghijklmnopqrst'; // Synthetic, never accepted by the runtime registry.
const key = 'sb_publishable_offline_fixture';
function input(variant = 'production', ref = registry.productionProjectRef) {
  const identity = registry.identityFor(variant);
  return { ...identity, url: `https://${ref}.supabase.co`, key };
}
function load(file, imports, env = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, process: { env }, require: name => {
    assert.ok(Object.hasOwn(imports, name), `Unmocked import ${name}`);
    return imports[name];
  } });
  return module.exports;
}

test('production uses exactly its existing backend and callback', () => {
  const result = registry.validateEnvironment(input());
  assert.equal(result.url, 'https://wyvsbzcltrhnjeuijsva.supabase.co');
  assert.equal(result.callback, 'lumehousemobile://auth/callback');
  assert.equal(result.key, key);
});
test('trusted future NONPROD registry supports both isolated identities without production fallback', () => {
  for (const variant of ['development', 'staging']) {
    assert.equal(registry.validateEnvironment(input(variant, nonprod), nonprod).projectRef, nonprod);
    assert.throws(() => registry.validateEnvironment(input(variant), nonprod));
    assert.throws(() => registry.validateEnvironment(input(variant), registry.productionProjectRef));
  }
  assert.throws(() => registry.validateEnvironment(input('production', nonprod), nonprod));
});
test('actual NONPROD runtime remains refused until separately approved provisioning', () => {
  assert.equal(registry.approvedNonprodProjectRef, null);
  for (const variant of ['development', 'staging']) {
    assert.throws(() => registry.validateEnvironment(input(variant, nonprod)), /not configured/);
    assert.throws(() => registry.validateEnvironment(input(variant)), /not configured/);
  }
});
test('missing and malformed URL/key and wrong identity/callback are rejected without leaking values', () => {
  for (const patch of [
    { variant: undefined }, { variant: '__proto__' }, { androidPackage: 'com.najbuilds.lumehouse.dev' },
    { scheme: 'lumehousemobile-dev' }, { callback: 'lumehousemobile-staging://auth/callback' },
    { url: undefined }, { url: 'http://wyvsbzcltrhnjeuijsva.supabase.co' },
    { url: 'https://wyvsbzcltrhnjeuijsva.supabase.co/' }, { url: 'https://user:private@wyvsbzcltrhnjeuijsva.supabase.co' },
    { key: undefined }, { key: 'sb_secret_private' }, { key: 'sb_publishable_' }, { key: 'sb_publishable_bad whitespace' },
  ]) {
    assert.throws(() => registry.validateEnvironment({ ...input(), ...patch }), error => !error.message.includes('private'));
  }
});
test('runtime validates resolved Expo manifest against public backend settings', () => {
  const identity = registry.identityFor('production');
  const config = { extra: { appVariant: 'production' }, scheme: identity.scheme, android: { package: identity.androidPackage } };
  const environment = load('src/config/environment.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: config } },
    '../../config/environment': registry,
  }, { EXPO_PUBLIC_SUPABASE_URL: input().url, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key });
  assert.equal(environment.readEnvironment().callback, identity.callback);
  config.scheme = 'lumehousemobile-dev';
  assert.throws(() => environment.readEnvironment(), /identity or OAuth/);
});
test('wrong environment fails before createClient, persistence or Auth/Bag access and cached reuse', () => {
  let allowed = false; let created = 0; let storage = 0;
  const client = load('src/lib/supabase/client.ts', {
    'react-native-url-polyfill/auto': {},
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: () => { storage++; } } },
    '@supabase/supabase-js': { createClient: () => { created++; return {}; }, processLock: () => {} },
    'react-native': { Platform: { OS: 'android' } },
    './config': { readSupabaseConfig: () => {
      if (!allowed) return registry.validateEnvironment(input('development'));
      return registry.validateEnvironment(input());
    } },
  });
  assert.throws(() => client.getSupabaseClient(), /not configured/);
  assert.equal(created, 0); assert.equal(storage, 0);
  allowed = true; const first = client.getSupabaseClient();
  assert.equal(client.getSupabaseClient(), first); assert.equal(created, 1);
  allowed = false; assert.throws(() => client.getSupabaseClient(), /not configured/);
  assert.equal(created, 1); assert.equal(storage, 0);
});
