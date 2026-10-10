const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const protocol = require('../config/fixture-enrollment');
const { createEnrollmentStore } = require('../scripts/fixture-enrollment-store.cjs');
const { createFixtureServer } = require('../scripts/local-fixture-auth.cjs');
const { load, hooks, find } = require('./helpers/source.cjs');
const request = (code, patch = {}) => ({ ...protocol.nativeIdentity, alias: 'customer-a', code, ...patch });

test('native enrollment rejects production, staging, package, callback, backend and unauthorized aliases', () => {
  const store = createEnrollmentStore(), code = store.issue('customer-a');
  for (const patch of [{ variant: 'production' }, { variant: 'staging' }, { androidPackage: 'com.najbuilds.lumehouse' }, { callback: 'lumehousemobile://auth/callback' }, { origin: 'https://wyvsbzcltrhnjeuijsva.supabase.co' }, { origin: 'http://localhost:54321' }, { alias: 'admin-a' }, { alias: '__proto__' }, { alias: 'customer-c' }]) {
    assert.throws(() => store.consume(request(code, patch)));
  }
  assert.equal(store.consume(request(code)), 'customer-a');
});
test('enrollment codes are single-use and alias-bound including concurrent redemption', () => {
  const store = createEnrollmentStore(), code = store.issue('customer-a');
  assert.throws(() => store.consume(request(code, { alias: 'customer-b' })));
  assert.equal(store.consume(request(code)), 'customer-a');
  assert.throws(() => store.consume(request(code)));
});
test('expired and superseded enrollment cannot be redeemed', () => {
  let now = 0; const store = createEnrollmentStore(() => now);
  const old = store.issue('customer-a'), current = store.issue('customer-a');
  assert.throws(() => store.consume(request(old)));
  now = 120000; assert.throws(() => store.consume(request(current)));
  assert.throws(() => store.issue('admin-a'));
});
async function serverRequest(server, url, origin, input) {
  const req = { method: 'POST', url, headers: { host: '127.0.0.1:5190', 'content-type': 'application/json', ...(origin ? { origin } : {}) }, async *[Symbol.asyncIterator]() { yield JSON.stringify(input); } };
  let status = 200, body;
  const res = { setHeader() {}, writeHead(value) { status = value; }, end(value) { body = value; } };
  await server.listeners('request')[0](req, res);
  return { status, body };
}
test('web-origin protection remains exact; native does not spoof a browser Origin', async () => {
  let issued = 0; const store = createEnrollmentStore();
  const server = createFixtureServer({ issueSession: async () => { issued++; return {}; } }, store);
  for (const origin of [undefined, 'http://localhost:5188', 'https://example.invalid']) assert.equal((await serverRequest(server, '/session', origin, { role: 'customer-a' })).status, 403);
  assert.equal(issued, 0);
  const code = store.issue('customer-a');
  assert.equal((await serverRequest(server, '/native-session', 'http://127.0.0.1:5188', request(code))).status, 403);
  assert.equal(issued, 0);
  assert.equal((await serverRequest(server, '/native-session', undefined, request(code))).status, 200);
  assert.equal(issued, 1);
  assert.equal((await serverRequest(server, '/native-session', undefined, request(code))).status, 403);
});
function mobile(environment, tokenRole = 'authenticated') {
  const exported = { exports: {} }; let fetched = 0, restored = 0, verified = 0;
  const token = `offline.${Buffer.from(JSON.stringify({ role: tokenRole, iss: 'http://127.0.0.1:54321/auth/v1' })).toString('base64url')}.offline`;
  const client = { auth: { getUser: async () => { verified++; return { error: null, data: { user: { id: 'existing-fixture' } } }; }, setSession: async () => { restored++; return { error: null, data: { user: { id: 'existing-fixture' } } }; } } };
  const code = ts.transpileModule(fs.readFileSync('src/features/auth/localFixtureAuth.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module: exported, exports: exported.exports, atob, AbortController, setTimeout, clearTimeout, fetch: async (_url, options) => {
    fetched++; assert.equal(options.headers.Origin, undefined); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ access_token: token, refresh_token: 'offline-fixture' }) };
  }, require: name => ({ '../../config/environment': { readEnvironment: () => environment }, '../../lib/supabase/client': { getSupabaseClient: () => client }, '../../../config/fixture-enrollment': protocol })[name] });
  return { auth: exported.exports, counts: () => ({ fetched, restored, verified }) };
}
const environment = { ...protocol.nativeIdentity, url: protocol.nativeIdentity.origin, projectRef: 'local:lume-house' };
test('mobile refuses wrong environment before network or session access', async () => {
  for (const patch of [{ variant: 'production' }, { variant: 'staging' }, { url: 'https://wyvsbzcltrhnjeuijsva.supabase.co' }, { androidPackage: 'com.najbuilds.lumehouse' }, { projectRef: 'other' }]) {
    const value = mobile({ ...environment, ...patch });
    assert.equal(value.auth.localFixtureAvailable(), false);
    await assert.rejects(value.auth.signInLocalFixture('customer-a', 'a'.repeat(43)));
    assert.deepEqual(value.counts(), { fetched: 0, restored: 0, verified: 0 });
  }
});
test('mobile verifies ordinary local session before standard setSession and rejects privileged tokens', async () => {
  const valid = mobile(environment); assert.equal(valid.auth.localFixtureAvailable(), true);
  await valid.auth.signInLocalFixture('customer-a', 'a'.repeat(43));
  assert.deepEqual(valid.counts(), { fetched: 1, restored: 1, verified: 1 });
  const privileged = mobile(environment, 'service_role');
  await assert.rejects(privileged.auth.signInLocalFixture('customer-a', 'a'.repeat(43)));
  assert.deepEqual(privileged.counts(), { fetched: 1, restored: 0, verified: 0 });
});
test('local Account hides Google/PII, masks and clears enrollment, and exposes labelled customer choices', () => {
  const host = hooks(); const calls = [];
  const Screen = load('src/features/auth/AccountScreen.tsx', { '../profile/CustomerProfile': { CustomerProfile: 'CustomerProfile' }, react: host.react, 'expo-router': { Link: 'Link' }, './localFixtureAuth': { localFixtureAvailable: () => true }, './AuthContext': { useAuth: () => ({ state: { status: 'signed-out' }, busy: false, message: null, signInFixture: (...args) => { calls.push(args); } }) } }).default;
  host.begin(); let tree = Screen();
  assert.equal(find(tree, element => element.props?.accessibilityLabel === 'Continue with Google'), undefined);
  let input = find(tree, element => element.props?.accessibilityLabel === 'Private enrollment code'); assert.equal(input.props.secureTextEntry, true);
  input.props.onChangeText('a'.repeat(43));
  host.begin(); tree = Screen(); find(tree, element => element.props?.accessibilityLabel === 'Sign in to local QA').props.onPress();
  host.begin(); tree = Screen(); input = find(tree, element => element.props?.accessibilityLabel === 'Private enrollment code'); assert.equal(input.props.value, '');
  assert.deepEqual(calls, [['customer-a', 'a'.repeat(43)]]);
});
