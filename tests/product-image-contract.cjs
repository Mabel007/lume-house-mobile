// Offline source contracts; no client, credentials, network or device actions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function load(file) {
  const moduleFixture = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { module: moduleFixture, exports: moduleFixture.exports, URL,
    require: name => {
      assert.equal(name, '../config/shop');
      return load('src/config/shop.ts');
    },
  });
  return moduleFixture.exports;
}
const { resolveProductImage } = load('src/utils/productImage.ts');
const origin = 'https://lume-house-delta.vercel.app';
const rejects = values => values.forEach(value => assert.throws(() => resolveProductImage(value), /Invalid product image/));

test('all reviewed formats resolve flat and nested paths against the web asset origin', () => {
  for (const extension of ['webp', 'png', 'jpg', 'jpeg', 'svg']) {
    for (const folder of ['', 'collection/', 'collection/room_2/']) {
      const value = `/images/${folder}piece-1.${extension}`;
      assert.equal(resolveProductImage(value), origin + value);
    }
  }
  assert.equal(resolveProductImage('/images/mug.svg'), `${origin}/images/mug.svg`);
  assert.equal(resolveProductImage('/images/_legacy-name.webp'), `${origin}/images/_legacy-name.webp`);
});

test('the reviewed historical catalogue WebP paths remain compatible', () => {
  // Stable public path fixtures: tests do not depend on ignored reports or the web checkout.
  const names = ['amber-candle', 'reed-diffuser', 'arch-vase', 'ceramic-bowl', 'linen-cushion',
    'woven-throw', 'stoneware-mug', 'serving-board', 'woven-basket', 'lidded-box', 'catchall-tray',
    'table-lamp', 'pillar-holder', 'incense-dish', 'table-runner', 'napkin-set', 'arched-mirror',
    'ceramic-planter', 'glass-carafe', 'wood-bookends'];
  for (const name of names) assert.equal(resolveProductImage(`/images/${name}.webp`), `${origin}/images/${name}.webp`);
});

test('credential-free HTTPS keeps normalization, encoded filenames, queries and fragments', () => {
  for (const value of ['https://cdn.example.com/photo.png', 'HTTPS://CDN.EXAMPLE.COM:443/folder/image.svg',
    'https://cdn.example.com/a%20photo.jpeg?version=2#image', 'https://cdn.example.com/100%25.webp',
    'https://cdn.example.com/photo%2Epng', 'https://cdn.example.com/image?signature=fixture%2Fvalue']) {
    assert.equal(resolveProductImage(value), new URL(value).href);
  }
});

test('unsafe schemes, credentials and malformed authority are rejected', () => {
  rejects(['http://cdn.example.com/a.png', '//cdn.example.com/a.png', 'data:image/png;base64,fixture',
    'file:///images/a.png', 'content://images/a.png', 'javascript:alert(1)',
    'https://user:pass@cdn.example.com/a.png', 'https://user@cdn.example.com/a.png',
    'https:cdn.example.com/a.png', 'https:///cdn.example.com/a.png', 'https://', 'https://[invalid/a.png']);
});

test('raw and encoded traversal or backslashes are rejected before normalization', () => {
  const paths = ['/images/../a.png', '/images/./a.png', '/images/folder/../../a.png',
    '/images/%2e%2e/a.png', '/images/%2E/a.png', '/images/%252e%252e/a.png',
    '/images/folder%2f..%2fa.png', '/images/%2e%2e%5ca.png', '/images/folder\\a.png',
    '/images/%255c../a.png', '/images/%25252e%25252e/a.png'];
  rejects(paths);
  rejects(paths.map(value => `https://cdn.example.com${value}`));
});

test('malformed or unreviewed relative paths are rejected', () => {
  rejects(['', 'images/a.png', '/other/a.png', '/images//a.png', '/images/folder//a.png',
    '/images/a.PNG', '/images/a.gif', '/images/a.png?version=1', '/images/a.svg#image',
    '/images/a%20photo.png', '/images/.hidden.png', '/images/a..png', '/images/a.png/',
    ' /images/a.png', '/images/a.png\n', 'https://cdn.example.com/a.png\n',
    'https://cdn.example.com/a%ZZ.png', 'https://cdn.example.com/a%2.png',
    'https://cdn.example.com/a%00.png', 'https://cdn.example.com/a%250a.png', null, undefined]);
  rejects([`/images/${'a'.repeat(490)}.webp`]);
});
