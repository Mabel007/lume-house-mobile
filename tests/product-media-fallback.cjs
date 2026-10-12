// Simulated source/JSX contracts only, NOT a React Native renderer or live API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const jsxRuntime = require('react/jsx-runtime');
const { contextShims } = require('./helpers/source.cjs');
const native = { Text: 'Text', View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };

function load(file, overrides = {}) {
  const moduleFixture = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module: moduleFixture, exports: moduleFixture.exports, URL, AbortController,
    require: name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react-native') return native;
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (!name.startsWith('.')) throw new Error(`Unmocked dependency: ${name}`);
      const base = path.resolve(path.dirname(file), name);
      const next = ['.ts', '.tsx'].map(extension => base + extension).find(candidate => fs.existsSync(candidate));
      if (!next || !next.startsWith(path.resolve('src') + path.sep)) throw new Error('Unexpected source dependency');
      return load(next, overrides);
    },
  });
  return moduleFixture.exports;
}

function hooks() {
  const slots = []; let index = 0; const effects = [];
  return { begin: () => { index = 0; }, effects,
    react: { useState: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
    }, useCallback: callback => callback, useEffect: effect => { effects.push(effect); }, ...contextShims },
  };
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const row = (id, image = '/images/arch-vase.webp') => ({ id, name: `Product ${id}`, description: 'Description',
  category: 'Living', price_cents: 100, currency: 'NLE', image_path: image, background_color: '#FFFFFF', active: true });
const { parseProducts } = load('src/features/products/products.ts');
function client(rows, failure = null) {
  return { from: table => {
    const builder = { select: () => builder, eq: () => builder, order: () => builder,
      abortSignal: async () => ({ data: table === 'products' ? rows : rows.map(product => ({
        id: `variant-${product.id}`, product_id: product.id, options: {}, is_default: true,
        price_cents: 100, currency: 'NLE', active: true, inventory_policy: 'untracked',
      })), error: failure }) };
    return builder;
  } };
}

function provider(repository, fakeClient) {
  const host = hooks(); const context = { Provider: 'ProductContext' };
  const { ProductProvider } = load('src/features/products/ProductProvider.tsx', {
    react: host.react, './ProductContext': { ProductContext: context },
    '../../lib/supabase/client': { getSupabaseClient: () => fakeClient }, './productRepository': repository,
  });
  const render = () => { host.begin(); return ProductProvider({ children: 'catalogue' }).props.value; };
  return { render, mount: () => { render(); return host.effects.at(-1)(); } };
}

function imageView() {
  let host = hooks(); let previous;
  // useState delegates to the current keyed image instance in this simulation.
  const { ProductImage } = load('src/components/ProductImage.tsx', {
    react: { useState: initial => host.react.useState(initial) }, 'expo-image': { Image: 'ExpoImage' },
  });
  return { render: (image, name = 'Vase') => {
    const element = ProductImage({ image, name });
    if (previous !== element.key) { host = hooks(); previous = element.key; }
    host.begin();
    return element.type(element.props);
  } };
}

test('invalid media alongside valid products reaches ready catalogue with unchanged real variants', async () => {
  const rows = [row('valid'), row('unsafe', 'javascript:fixture'), row('unsupported', '/images/a.gif'), row('missing', null)];
  const repository = load('src/features/products/productRepository.ts');
  const view = provider(repository, client(rows)); view.mount(); await flush();
  const state = view.render().state;
  assert.equal(state.status, 'ready'); assert.equal(state.products.length, 4);
  const { variantAvailable } = load('src/features/products/variants.ts');
  for (const product of state.products) {
    assert.equal(product.price, 100); assert.equal(product.variants[0].id, `variant-${product.id}`);
    assert.equal(variantAvailable(product.variants[0]), true);
  }
  assert.equal(imageView().render(state.products[0].image).type, 'ExpoImage');
  for (const product of state.products.slice(1)) assert.equal(imageView().render(product.image).type, 'Text');
});

test('missing, null, empty and malformed media fields degrade only presentation', () => {
  for (const image of [undefined, null, '', ' ', 42, {}, '/images/a.gif']) {
    const product = parseProducts([{ ...row('a'), image_path: image }], 'NLE')[0];
    assert.equal(product.id, 'a'); assert.equal(product.price, 100);
    assert.equal(imageView().render(product.image).type, 'Text');
  }
  const missing = row('a'); delete missing.image_path;
  assert.equal(imageView().render(parseProducts([missing], 'NLE')[0].image).type, 'Text');
});

test('malformed commerce remains rejected and repository failures remain catalogue-wide errors', async () => {
  for (const patch of [{ id: '' }, { price_cents: -1 }, { price_cents: 1.5 }, { currency: 'USD' },
    { active: false }, { name: null }, { category: '' }, { description: '' }, { background_color: 'unsafe' }]) {
    assert.throws(() => parseProducts([{ ...row('a', null), ...patch }], 'NLE'));
  }
  assert.throws(() => parseProducts([row('a'), row('a')], 'NLE'));
  const repository = load('src/features/products/productRepository.ts');
  for (const fakeClient of [client([{ ...row('a'), price_cents: -1 }]), client([], { code: 'network' })]) {
    const view = provider(repository, fakeClient); view.mount(); await flush();
    assert.equal(view.render().state.status, 'error');
  }
});

test('catalogue cancellation ignores late result and refresh still loads replacement source', async () => {
  let complete;
  const view = provider({ loadProducts: () => new Promise(resolve => { complete = resolve; }) }, {});
  const cleanup = view.mount(); cleanup(); complete(parseProducts([row('old')], 'NLE')); await flush();
  assert.equal(view.render().state.status, 'loading');
  view.render().refresh(); view.mount(); complete(parseProducts([row('new', '/images/mug.svg')], 'NLE')); await flush();
  assert.equal(view.render().state.status, 'ready'); assert.equal(view.render().state.products[0].image, '/images/mug.svg');
});

test('unsafe/unsupported URI never reaches expo-image and fallback has contextual accessibility', () => {
  for (const uri of ['', '/images/a.gif', '/images/../a.png', '/images/%252e%252e/a.png',
    'http://example.com/a.png', 'https://user:pass@example.com/a.png', 'file:///a.png', 'data:image/png;base64,fixture']) {
    const element = imageView().render(uri, 'Stoneware mug');
    assert.equal(element.type, 'Text'); assert.equal(element.props.children, 'Image unavailable');
    assert.equal(element.props.accessible, true); assert.equal(element.props.accessibilityRole, 'image');
    assert.equal(element.props.accessibilityLabel, 'Image unavailable for Stoneware mug');
  }
});

test('simulated remote load and decode error callbacks show the same accessible fallback', () => {
  for (const error of ['HTTP 404', 'Image decoder failed']) {
    const view = imageView(); const source = '/images/missing.png'; const element = view.render(source);
    assert.equal(element.type, 'ExpoImage'); element.props.onError({ error });
    assert.equal(view.render(source).type, 'Text');
    assert.equal(view.render(source).props.accessibilityLabel, 'Image unavailable for Vase');
    assert.equal(imageView().render('/images/arch-vase.webp').type, 'ExpoImage');
  }
});

test('source replacement recovers, old-source late errors stay isolated, and remount retries same URI', () => {
  const view = imageView(); const old = view.render('/images/a.png'); old.props.onError({ error: '404' });
  assert.equal(view.render('/images/a.png').type, 'Text');
  assert.equal(view.render('/images/mug.svg').type, 'ExpoImage'); old.props.onError({ error: 'late' });
  assert.equal(view.render('/images/mug.svg').type, 'ExpoImage');
  assert.equal(view.render('/images/a.png').type, 'ExpoImage');
  assert.equal(imageView().render('/images/a.png').type, 'ExpoImage');
  assert.equal(view.render('unsafe').type, 'Text'); assert.equal(view.render('/images/a.png').type, 'ExpoImage');
});

test('valid supported formats/nested URIs retain image name label and cover fit', () => {
  for (const extension of ['webp', 'png', 'jpg', 'jpeg', 'svg']) {
    const uri = `/images/folder/a.${extension}`; const element = imageView().render(uri, 'Mug');
    assert.equal(element.type, 'ExpoImage'); assert.equal(element.props.source.uri, `https://lume-house-delta.vercel.app${uri}`);
    assert.equal(element.props.accessibilityLabel, 'Mug'); assert.equal(element.props.contentFit, 'cover');
  }
});

function find(element, predicate) {
  if (!element || typeof element !== 'object') return undefined;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const match = find(child, predicate); if (match) return match;
  }
}
test('image failure does not disable available variant selection/add or enable unavailable variants', async () => {
  const host = hooks(); const actions = [];
  const { ProductCard } = load('src/components/ProductCard.tsx', {
    react: host.react, 'expo-router': { router: { push: () => {} } }, './ProductImage': { ProductImage: 'ProductImage' },
    './ActionButton': { ActionButton: 'ActionButton' },
    '../features/auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in' }, busy: false }) },
    '../features/cart/BagContext': { useBag: () => ({ signedIn: true, state: { status: 'ready', items: [] },
      dispatch: async action => { actions.push(action); return true; } }) },
  });
  const product = { ...parseProducts([row('a', 'unsafe')], 'NLE')[0], variants: [
    { id: 'variant-a', productId: 'a', price: 100, options: { Size: 'Small' }, isDefault: false, inventoryPolicy: 'untracked' },
    { id: 'variant-b', productId: 'a', price: 200, options: { Size: 'Large' }, isDefault: false, inventoryPolicy: 'tracked', available: false },
  ] };
  const render = () => { host.begin(); return ProductCard({ product }); };
  assert.equal(find(render(), element => element.type === 'ActionButton').props.disabled, true);
  find(render(), element => element.type === 'Pressable' && element.props.accessibilityLabel.includes('Small')).props.onPress();
  const add = find(render(), element => element.type === 'ActionButton'); assert.equal(add.props.disabled, false);
  add.props.onPress(); await flush(); assert.equal(actions[0].variantId, 'variant-a'); assert.equal(actions[0].type, 'add');
  product.image = '/images/mug.svg'; assert.equal(find(render(), element => element.type === 'ActionButton').props.disabled, false);
  assert.equal(find(render(), element => element.type === 'Pressable' && element.props.accessibilityLabel.includes('Large')).props.disabled, true);
});
