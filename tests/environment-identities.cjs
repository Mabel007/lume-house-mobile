const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const baseline = require('../app.json').expo;
const variants = require('../config/variants.json');

function resolve(variant) {
  const sandbox = {
    module: { exports: {} },
    process: { env: { APP_VARIANT: variant } },
    require: name => name === './config/variants.json' ? variants : require('../config/local-build'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.config.js'), 'utf8'), sandbox);
  return JSON.parse(JSON.stringify(sandbox.module.exports({ config: baseline })));
}

test('approved identities and OAuth schemes are independently installable', () => {
  for (const [variant, suffix, name] of [
    ['development', '.dev', 'Lumé House Dev'],
    ['staging', '.staging', 'Lumé House Staging'],
    ['production', '', 'Lumé House'],
  ]) {
    const config = resolve(variant);
    assert.equal(config.android.package, `com.najbuilds.lumehouse${suffix}`);
    assert.equal(config.name, name);
    assert.equal(config.scheme, `lumehousemobile${variant === 'production' ? '' : `-${variant === 'development' ? 'dev' : 'staging'}`}`);
    assert.equal(config.extra.appVariant, variant);
    assert.equal(config.extra.eas.projectId, baseline.extra.eas.projectId);
  }
});

test('production preserves every historical configuration field', () => {
  const config = resolve('production');
  delete config.extra.appVariant;
  assert.deepEqual(config, baseline);
  assert.equal(baseline.extra.appVariant, undefined);
});

test('Development launcher uses only its isolated scheme and does not alter Staging plugins', () => {
  const config = resolve('development');
  assert.deepEqual(config.plugins.slice(0, -1), baseline.plugins);
  assert.deepEqual(config.plugins.at(-1), ['expo-dev-client', { addGeneratedScheme: false, launchMode: 'launcher' }]);
  assert.deepEqual(resolve('staging').plugins, baseline.plugins);
  assert.equal(baseline.plugins.some(plugin => Array.isArray(plugin) && plugin[0] === 'expo-dev-client'), false);
});

test('missing, unknown and prototype property variants are refused', () => {
  for (const variant of [undefined, '', 'preview', 'Production', ' production ', 'toString', '__proto__']) {
    assert.throws(() => resolve(variant), /APP_VARIANT must explicitly select/);
  }
});
