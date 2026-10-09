const assert = require('node:assert/strict');
const test = require('node:test');
const registry = require('../config/environment');
const { developmentPlan } = require('../scripts/start-development.cjs');
const profiles = require('../eas.json').build;
const ref = 'abcdefghijklmnopqrst';
const fixture = `EXPO_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_offline_fixture`;

test('EAS profiles explicitly separate variant, environment, binary and distribution', () => {
  for (const [name, variant, environment, client, distribution, binary] of [
    ['development', 'development', 'development', true, 'internal', 'apk'],
    ['staging', 'staging', 'preview', false, 'internal', 'apk'],
    ['production', 'production', 'production', false, 'store', 'app-bundle'],
    ['preview', 'production', 'production', false, 'internal', 'apk'],
  ]) {
    const profile = profiles[name];
    assert.equal(profile.env.APP_VARIANT, variant); assert.equal(profile.environment, environment);
    assert.equal(profile.env.EXPO_NO_DOTENV, '1'); assert.equal(profile.developmentClient, client);
    assert.equal(profile.distribution, distribution); assert.equal(profile.android.buildType, binary);
    assert.equal(Object.keys(profile.env).length, 2);
  }
});
test('launcher removes inherited public configuration and disables automatic dotenv with fixed USB-compatible command', () => {
  const inherited = { APP_VARIANT: 'production', EXPO_NO_DOTENV: '0', EXPO_PUBLIC_SUPABASE_URL: 'https://production.invalid', EXPO_PUBLIC_PRIVATE_TOKEN: 'not-for-bundle', PATH: 'fixture-path' };
  const plan = developmentPlan(fixture, inherited, input => registry.validateEnvironment(input, ref));
  assert.equal(plan.options.env.APP_VARIANT, 'development'); assert.equal(plan.options.env.EXPO_NO_DOTENV, '1');
  assert.equal(plan.options.env.EXPO_PUBLIC_PRIVATE_TOKEN, undefined);
  assert.equal(plan.options.env.EXPO_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`);
  assert.equal(plan.options.env.PATH, inherited.PATH); assert.equal(inherited.APP_VARIANT, 'production');
  assert.deepEqual(plan.args.slice(1), ['start', '--dev-client', '--localhost', '--port', '8081']);
  assert.equal(plan.options.shell, false); assert.equal(plan.identity.androidPackage, 'com.najbuilds.lumehouse.dev');
});
test('launcher cannot use current production file, unknown public settings or secret settings', () => {
  for (const content of ['', fixture, fixture.replace(ref, registry.productionProjectRef), `${fixture}\nSUPABASE_SERVICE_ROLE_KEY=private`, `${fixture}\nEXPO_PUBLIC_SECRET=private`]) {
    assert.throws(() => developmentPlan(content));
  }
  assert.throws(() => developmentPlan(fixture.replace(ref, registry.productionProjectRef), {}, input => registry.validateEnvironment(input, ref)));
});
