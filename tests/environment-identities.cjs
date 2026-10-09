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
    require: () => variants,
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

test('missing, unknown and prototype property variants are refused', () => {
  for (const variant of [undefined, '', 'preview', 'Production', ' production ', 'toString', '__proto__']) {
    assert.throws(() => resolve(variant), /APP_VARIANT must explicitly select/);
  }
});
