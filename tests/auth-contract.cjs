// Isolated contract tests: no network, credentials or fabricated provider login.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}, context = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, Object.assign(context, { module, exports: module.exports, URL, Date, require: name => {
    if (!(name in imports)) throw new Error('Unexpected dependency');
    return imports[name];
  } }));
  return module.exports;
}
const callback = load('src/features/auth/callback.ts');
const target = 'lumehousemobile://auth/callback';
const valid = `${target}?code=synthetic-contract-fixture`;
assert.equal(callback.parseCallback(valid, target).kind, 'code');
for (const value of [target, `${target}?code=`, `${target}?code=a&code=b`, `${target}#access_token=fixture`,
  `${target}?code=a&refresh_token=fixture`, `${target}?code=%20`, 'https://auth/callback?code=a',
  'lumehousemobile://elsewhere/callback?code=a', 'lumehousemobile://auth/other?code=a', 'malformed',
  `${valid}&sb_flow_id=short`, `${valid}&sb_flow_id=abcdefgh&sb_flow_id=ijklmnop`]) {
  assert.equal(callback.parseCallback(value, target).kind, 'invalid');
}
assert.equal(callback.parseCallback(`${target}?error=access_denied&error_description=private`, target).kind, 'error');
assert.equal(callback.parseCallback(`${valid}&sb_flow_id=abcdefgh`, target).flowId, 'abcdefgh');
const now = Date.now();
assert.equal(callback.pendingIsFresh(String(now - 1000), now), true);
for (const value of [null, '', 'garbage', String(now + 1), String(now - 600000)]) assert.equal(callback.pendingIsFresh(value, now), false);

async function run() {
  const linking = load('node_modules/expo-linking/src/createURL.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: { scheme: 'lumehousemobile' } } },
    './Schemes': { hasCustomScheme: () => true, resolveScheme: options => options.scheme },
    './validateURL': { validateURL: () => {} },
  }, { URLSearchParams });
  assert.equal(linking.createURL('auth/callback', { scheme: 'lumehousemobile', isTripleSlashed: false }), target);
  const nodeCrypto = require('node:crypto');
  const cryptoContext = { TextEncoder, btoa };
  const nativeCrypto = load('src/features/auth/pkceCrypto.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-crypto': {
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      getRandomValues: value => nodeCrypto.webcrypto.getRandomValues(value),
      digest: (algorithm, bytes) => nodeCrypto.webcrypto.subtle.digest(algorithm, bytes),
    },
  }, cryptoContext);
  nativeCrypto.ensurePKCECrypto();
  assert.equal(typeof cryptoContext.crypto.getRandomValues, 'function');
  const hash = await cryptoContext.crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
  assert.equal(Buffer.from(hash).toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.throws(() => cryptoContext.crypto.subtle.digest('unsupported', new Uint8Array()));
  const storage = new Map();
  let exchanges = 0;
  let browserResult = { type: 'cancel' };
  const auth = {
    signInWithOAuth: async options => {
      assert.equal(options.provider, 'google');
      assert.equal(options.options.redirectTo, target);
      assert.equal(options.options.skipBrowserRedirect, true);
      return { data: { url: 'https://example.invalid/oauth' }, error: null };
    },
    exchangeCodeForSession: async (_code, options) => {
      if (options) assert.equal(options.flowId, 'abcdefgh');
      exchanges++; return { data: { session: null }, error: new Error('fixture rejection') };
    },
  };
  const oauth = load('src/features/auth/nativeOAuth.ts', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: {
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async key => { storage.delete(key); },
    } },
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    'expo-linking': linking,
    'expo-web-browser': { openAuthSessionAsync: async () => browserResult },
    'react-native': { Platform: { OS: 'android' } },
    '../../lib/supabase/client': { getSupabaseClient: () => ({ auth }) }, './callback': callback,
    './pkceCrypto': { ensurePKCECrypto: () => {} },
  });
  assert.equal(await oauth.startNativeGoogleOAuth(), 'cancelled');
  assert.equal(storage.size, 0);
  assert.equal(exchanges, 0);
  browserResult = { type: 'success', url: `${target}?error=access_denied` };
  assert.equal(await oauth.startNativeGoogleOAuth(), 'error');
  assert.equal(exchanges, 0);
  browserResult = { type: 'success', url: valid };
  assert.equal(await oauth.startNativeGoogleOAuth(), 'error');
  assert.equal(await oauth.completeNativeOAuth(valid), 'error');
  assert.equal(exchanges, 1); // Rejected exchange is still deduplicated.
  assert.equal(storage.size, 0);
  assert.equal(await oauth.completeNativeOAuth(`${target}?code=unsolicited-fixture`), 'error');
  assert.equal(exchanges, 1);
  browserResult = { type: 'success', url: `${valid}&sb_flow_id=abcdefgh` };
  assert.equal(await oauth.startNativeGoogleOAuth(), 'error');
  assert.equal(exchanges, 2);
  console.log('Auth contracts passed: callback validation, attempt expiry, cancellation, provider rejection, exchange deduplication, unsolicited callback rejection. No provider login tested.');
}
run().catch(() => { console.error('Auth contract tests failed.'); process.exitCode = 1; });
