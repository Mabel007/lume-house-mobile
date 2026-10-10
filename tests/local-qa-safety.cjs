const assert = require('node:assert/strict');
const test = require('node:test');
const { localFetch, rollbackContract, requireFixtureRecovery } = require('../scripts/local-contract-qa.cjs');
test('local QA requires explicit confirmation of existing fixture recovery', () => {
  for (const args of [[], ['--seed'], ['--restore-latest-confirmed', '--reset']]) assert.throws(() => requireFixtureRecovery(args));
  assert.doesNotThrow(() => requireFixtureRecovery(['--restore-latest-confirmed']));
});
test('local integration fetch refuses hosted, LAN and unrelated local origins before network access', async () => {
  for (const url of ['https://wyvsbzcltrhnjeuijsva.supabase.co/auth/v1/user', 'http://localhost:54321', 'http://127.0.0.1:54322', 'http://192.168.1.2:54321']) {
    await assert.rejects(localFetch(url), /NONLOCAL_REQUEST_REFUSED/);
  }
});
test('rollback SQL uses bounded transaction and canonical RPCs without reset or durable commit', () => {
  const sql = rollbackContract('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
  assert.ok(sql.startsWith('begin;')); assert.ok(sql.endsWith('rollback;'));
  assert.match(sql, /lock_timeout='2s'/); assert.match(sql, /place_variant_order/); assert.match(sql, /change_variant_cart/);
  assert.doesNotMatch(sql, /\b(commit|truncate|drop)\b/i);
});
test('fixture identity input cannot inject SQL or substitute arbitrary expressions', () => {
  assert.throws(() => rollbackContract("' OR true --", '22222222-2222-4222-8222-222222222222'));
});
