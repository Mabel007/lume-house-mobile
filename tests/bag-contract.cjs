// Offline contracts only: every repository is mocked. No environment, client or network access.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const cache = new Map();
function load(file, overrides = {}) {
  const fullPath = path.resolve(file);
  if (!Object.keys(overrides).length && cache.has(fullPath)) return cache.get(fullPath);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(fullPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, AbortController,
    require: name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (!name.startsWith('.')) throw new Error(`Unmocked dependency: ${name}`);
      const candidate = path.resolve(path.dirname(fullPath), name);
      const next = ['.ts', '.tsx'].map(extension => candidate + extension).find(file => fs.existsSync(file));
      if (!next || !next.startsWith(path.resolve('src') + path.sep)) throw new Error('Unexpected source dependency');
      return load(next);
    },
  }, { filename: fullPath });
  if (!Object.keys(overrides).length) cache.set(fullPath, module.exports);
  return module.exports;
}
const variants = load('src/features/products/variants.ts');
const cart = load('src/features/cart/cart.ts');
const repository = load('src/features/cart/variantCartRepository.ts');
const { BagController } = load('src/features/cart/BagController.ts');
const normalized = value => JSON.parse(JSON.stringify(value));
const item = (quantity = 1, variantId = 'actual-variant-a') => ({ productId: 'product-a', variantId, quantity });
const payload = (...items) => ({ id: 'owned-cart', items });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function controller(repo) {
  let ids = 0;
  const instance = new BagController(repo, () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`);
  instance.activate();
  return instance;
}
const variantRow = (overrides = {}) => ({
  id: 'actual-variant-a', product_id: 'product-a', options: {}, is_default: true,
  price_cents: 12000, currency: 'NLE', active: true, inventory_policy: 'untracked', ...overrides,
});

test('meaningful options require explicit real-ID selection and preserve prices', () => {
  const rows = variants.parseVariants([
    variantRow(), variantRow({ id: 'actual-variant-blue', options: { Colour: 'Blue' }, is_default: false, price_cents: 13500 }),
  ]);
  assert.equal(variants.selectedVariant(rows, null), undefined);
  assert.equal(variants.selectedVariant(rows, 'product-a'), undefined);
  assert.equal(variants.selectedVariant(rows, 'actual-variant-a'), undefined);
  const selected = variants.selectedVariant(rows, 'actual-variant-blue');
  assert.equal(selected.id, 'actual-variant-blue');
  assert.equal(selected.price, 13500);
  assert.equal(variants.variantLabel(selected), 'Colour: Blue');
  assert.equal(variants.selectedVariant([rows[0]], null).id, 'actual-variant-a');
  assert.equal(variants.selectedVariant([], null), undefined);
});

test('availability fails closed for tracked or missing stock and rejects malformed boundaries', () => {
  const tracked = variants.parseVariants([variantRow({ inventory_policy: 'tracked' })]);
  assert.equal(variants.variantAvailable(tracked[0]), false);
  assert.equal(variants.variantAvailable(variants.applyAvailability(tracked, [])[0]), false);
  assert.equal(variants.variantAvailable(variants.applyAvailability(tracked, [{ variant_id: tracked[0].id, available: true }])[0]), true);
  assert.equal(variants.variantAvailable(undefined), false);
  assert.equal(variants.variantAvailable(variants.parseVariants([variantRow()])[0]), true);
  assert.throws(() => variants.applyAvailability(tracked, [{ variant_id: 'a', available: 1 }]));
  assert.throws(() => variants.applyAvailability(tracked, [{ variant_id: 'a', available: true }, { variant_id: 'a', available: false }]));
  for (const row of [variantRow({ price_cents: -1 }), variantRow({ price_cents: 1.5 }), variantRow({ currency: 'USD' }),
    variantRow({ active: false }), variantRow({ options: { Colour: 'Blue' } }), variantRow({ inventory_policy: 'unknown' })]) {
    assert.throws(() => variants.parseVariants([row]));
  }
  assert.throws(() => variants.parseVariants([variantRow(), variantRow()]));
});

test('catalogue from-price uses available variant price, not parent price', () => {
  const choices = variants.parseVariants([
    variantRow({ id: 'red', options: { Colour: 'Red' }, is_default: false, price_cents: 9000, inventory_policy: 'tracked' }),
    variantRow({ id: 'blue', options: { Colour: 'Blue' }, is_default: false, price_cents: 12000 }),
  ]);
  assert.deepEqual(normalized(variants.cataloguePrice({ price: 100, variants: choices })), { price: 12000, from: true });
});

test('quantity boundaries and expected values follow RPC semantics', () => {
  let allocations = 0;
  const id = () => { allocations++; return 'operation-fixture'; };
  for (const quantity of [0, -1, 100, 1.5, NaN]) assert.equal(cart.makeOperation([item(2)], { type: 'set', variantId: item().variantId, quantity }, id), null);
  assert.equal(cart.makeOperation([item(99)], { type: 'add', variantId: item().variantId }, id), null);
  assert.equal(cart.makeOperation([], { type: 'set', variantId: item().variantId, quantity: 1 }, id), null);
  assert.equal(cart.makeOperation([], { type: 'remove', variantId: item().variantId }, id), null);
  assert.equal(allocations, 0);
  const set = cart.makeOperation([item(2)], { type: 'set', variantId: item().variantId, quantity: 99 }, id);
  assert.equal(set.quantity, 99); assert.equal(set.expectedQuantity, 2);
  const remove = cart.makeOperation([item(2)], { type: 'remove', variantId: item().variantId }, id);
  assert.equal(remove.quantity, null); assert.equal(remove.expectedQuantity, 2);
  const add = cart.makeOperation([], { type: 'add', variantId: item().variantId }, id);
  assert.equal(add.quantity, 1); assert.equal(add.expectedQuantity, null);
});

test('saved cart payload validates identities, duplicates and bounded quantities', () => {
  const response = { id: 'owned-cart', items: [{ product_id: 'product-a', variant_id: 'actual-variant-a', quantity: 2 }] };
  assert.deepEqual(normalized(repository.parseVariantCart(response)), payload(item(2)));
  for (const quantity of [0, 100, 1.5]) assert.throws(() => repository.parseVariantCart({ ...response, items: [{ ...response.items[0], quantity }] }));
  assert.throws(() => repository.parseVariantCart({ ...response, items: [response.items[0], response.items[0]] }));
  assert.throws(() => repository.parseVariantCart({ id: '', items: [] }));
});

test('Bag restoration and refresh are authoritative, with actions blocked until ready', async () => {
  const loaded = deferred();
  const instance = controller({ load: () => loaded.promise, change: async () => { throw new Error('must not write'); } });
  assert.equal(await instance.dispatch({ type: 'add', variantId: 'a' }), false);
  const restoring = instance.refresh();
  assert.equal(instance.getSnapshot().status, 'loading');
  loaded.resolve(payload(item(3)));
  await restoring;
  assert.equal(instance.getSnapshot().status, 'ready');
  assert.equal(instance.getSnapshot().items[0].quantity, 3);
  const relaunched = controller({ load: async () => payload(item(3)), change: async () => payload() });
  assert.equal(relaunched.getSnapshot().items.length, 0);
  await relaunched.refresh();
  assert.equal(relaunched.getSnapshot().items[0].quantity, 3);
});

test('ambiguous mutation blocks new intent and retries exact UUID/parameters even after refresh', async () => {
  const operations = [];
  const instance = controller({ load: async () => payload(item(2)), change: async operation => {
    operations.push(normalized(operation));
    if (operations.length === 1) throw new Error('lost network response after commit');
    return payload(item(3));
  } });
  await instance.refresh();
  assert.equal(await instance.dispatch({ type: 'add', variantId: item().variantId }), false);
  assert.equal(instance.getSnapshot().status, 'uncertain');
  assert.equal(instance.getSnapshot().canRetry, true);
  assert.equal(await instance.dispatch({ type: 'add', variantId: 'another' }), false);
  await instance.refresh();
  assert.equal(instance.getSnapshot().status, 'uncertain');
  assert.equal(await instance.retry(), true);
  assert.deepEqual(operations[1], operations[0]);
  assert.equal(instance.getSnapshot().items[0].quantity, 3);
  assert.equal(instance.getSnapshot().canRetry, false);
});

test('stale quantity rejection requires refresh and a newly reviewed expected quantity', async () => {
  const operations = [];
  let loads = 0;
  const instance = controller({ load: async () => payload(item(++loads === 1 ? 2 : 4)), change: async operation => {
    operations.push(normalized(operation));
    if (operations.length === 1) throw new repository.VariantCartError('CART_CHANGED');
    return payload(item(5));
  } });
  await instance.refresh();
  await instance.dispatch({ type: 'set', variantId: item().variantId, quantity: 3 });
  assert.equal(instance.getSnapshot().status, 'error');
  assert.match(instance.getSnapshot().message, /another session/);
  assert.equal(await instance.retry(), false);
  assert.equal(await instance.dispatch({ type: 'set', variantId: item().variantId, quantity: 3 }), false);
  await instance.refresh();
  await instance.dispatch({ type: 'set', variantId: item().variantId, quantity: 5 });
  assert.equal(operations[0].expectedQuantity, 2);
  assert.equal(operations[1].expectedQuantity, 4);
  assert.notEqual(operations[0].operationId, operations[1].operationId);
});

test('saving serializes taps and applies the returned server cart without optimism', async () => {
  const saved = deferred();
  let changes = 0;
  const instance = controller({ load: async () => payload(item(2)), change: () => { changes++; return saved.promise; } });
  await instance.refresh();
  const saving = instance.dispatch({ type: 'add', variantId: item().variantId });
  assert.equal(instance.getSnapshot().status, 'saving');
  assert.equal(instance.getSnapshot().items[0].quantity, 2);
  await instance.refresh();
  assert.equal(await instance.dispatch({ type: 'add', variantId: item().variantId }), false);
  saved.resolve(payload(item(7)));
  assert.equal(await saving, true);
  assert.equal(changes, 1);
  assert.equal(instance.getSnapshot().items[0].quantity, 7);
});

test('logout and account switch isolate pending writes, late successes and late failures', async () => {
  for (const failure of [false, true]) {
    const pending = deferred();
    const customerA = controller({ load: async () => payload(item(2)), change: () => pending.promise });
    await customerA.refresh();
    const saving = customerA.dispatch({ type: 'add', variantId: item().variantId });
    customerA.deactivate();
    assert.equal(customerA.getSnapshot().items.length, 0);
    assert.equal(await customerA.retry(), false);
    const customerB = controller({ load: async () => payload(item(6, 'customer-b-variant')), change: async () => payload() });
    await customerB.refresh();
    if (failure) pending.reject(new Error('late failure')); else pending.resolve(payload(item(3)));
    assert.equal(await saving, false);
    assert.equal(customerA.getSnapshot().items.length, 0);
    assert.equal(customerB.getSnapshot().items[0].variantId, 'customer-b-variant');
    assert.equal(customerB.getSnapshot().items[0].quantity, 6);
    assert.equal(customerB.getSnapshot().message, null);
  }
});

test('stale load cannot repopulate after logout or overwrite reactivated restoration', async () => {
  const first = deferred();
  let loads = 0;
  const instance = controller({ load: () => ++loads === 1 ? first.promise : Promise.resolve(payload(item(8))), change: async () => payload() });
  const old = instance.refresh();
  instance.deactivate(); instance.activate();
  await instance.refresh();
  first.resolve(payload(item(1)));
  await old;
  assert.equal(instance.getSnapshot().items[0].quantity, 8);
});

test('authentication preflight rejects a different customer or a logout during getSession', async () => {
  const session = { user: { id: 'customer-a' }, access_token: 'synthetic-token' };
  const fake = { auth: { getSession: async () => ({ data: { session }, error: null }) } };
  assert.equal(await repository.sessionToken(fake, 'customer-a', () => true), 'synthetic-token');
  await assert.rejects(repository.sessionToken(fake, 'customer-b', () => true), /sign in again/);
  let active = true;
  const delayed = deferred();
  const restoring = repository.sessionToken({ auth: { getSession: () => delayed.promise } }, 'customer-a', () => active);
  active = false;
  delayed.resolve({ data: { session }, error: null });
  await assert.rejects(restoring, /sign in again/);
});

test('provider uses separate identity keys and synchronously supplies empty signed-out/restoring state', () => {
  let auth = { status: 'signed-in', user: { id: 'customer-a' } };
  const { BagProvider } = load('src/features/cart/BagProvider.tsx', {
    'expo-crypto': { randomUUID: () => 'offline-uuid' },
    '../../lib/supabase/client': { getSupabaseClient: () => { throw new Error('live client forbidden'); } },
    '../auth/AuthContext': { useAuth: () => ({ state: auth }) },
  });
  const a = BagProvider({ children: 'screen' });
  auth = { status: 'signed-in', user: { id: 'customer-b' } };
  const b = BagProvider({ children: 'screen' });
  assert.equal(a.key, 'customer-a'); assert.equal(b.key, 'customer-b');
  for (const status of ['signed-out', 'restoring']) {
    auth = { status };
    const boundary = BagProvider({ children: 'screen' });
    assert.equal(boundary.props.value.signedIn, false);
    assert.equal(boundary.props.value.state.items.length, 0);
  }
});

test('unavailable saved items remain removable and variant price owns Bag totals', () => {
  const product = { id: 'product-a', price: 100, variants: variants.parseVariants([variantRow()]) };
  const line = cart.cartLine(item(2), [product]);
  assert.equal(line.lineTotal, 24000);
  const absent = cart.cartLine(item(2, 'inactive-variant'), [product]);
  assert.equal(absent.available, false); assert.equal(absent.lineTotal, null);
  assert.equal(cart.makeOperation([absent.item], { type: 'remove', variantId: absent.item.variantId }, () => 'remove-id').expectedQuantity, 2);
});

test('RPC request matches existing names, arguments and explicit customer Authorization', async () => {
  const calls = [];
  const response = { id: 'owned-cart', items: [] };
  const fake = { rpc: (name, args) => ({ setHeader: async (header, value) => { calls.push({ name, args, header, value }); return { data: response, error: null }; } }) };
  await repository.loadVariantCart(fake, 'synthetic-token');
  const operation = { variantId: 'real-variant', mode: 'remove', quantity: null, expectedQuantity: 2, operationId: 'stable-uuid' };
  await repository.changeVariantCart(fake, 'synthetic-token', operation);
  assert.equal(calls[0].name, 'load_variant_cart');
  assert.equal(calls[1].name, 'change_variant_cart');
  assert.deepEqual(normalized(calls[1].args), { p_variant_id: 'real-variant', p_mode: 'remove', p_quantity: null, p_expected_quantity: 2, p_operation_id: 'stable-uuid' });
  assert.equal(calls[1].header, 'Authorization');
  assert.equal(calls[1].value, 'Bearer synthetic-token');
});

test('database conflicts are definite; malformed success and network failures retain uncertain intent', async () => {
  function fake(error, data = null) { return { rpc: () => ({ setHeader: async () => ({ data, error }) }) }; }
  await assert.rejects(repository.changeVariantCart(fake({ code: 'P0001', message: 'CART_CHANGED' }), 'fixture', {}), error => error.code === 'CART_CHANGED' && error.definite);
  await assert.rejects(repository.changeVariantCart(fake({ code: '', message: 'private network detail' }), 'fixture', {}), error => !error.definite && !error.message.includes('private'));
  await assert.rejects(repository.changeVariantCart(fake(null, { malformed: true }), 'fixture', {}), error => !error.definite);
  await assert.rejects(repository.loadVariantCart(fake({ code: 'PGRST202' }), 'fixture'), error => error.code === 'SCHEMA_NOT_READY');
});

test('catalogue repository reads real variants and boolean availability; absent schema never invents IDs', async () => {
  const { loadProducts } = load('src/features/products/productRepository.ts');
  const product = { id: 'product-a', name: 'Vase', description: 'A vase', category: 'Living',
    price_cents: 100, currency: 'NLE', image_path: '/images/arch-vase.webp', background_color: '#FFFFFF', active: true };
  const queries = [];
  function fake(variantResult) {
    return { from: table => {
      queries.push(table);
      const builder = { select: () => builder, eq: () => builder, order: () => builder,
        abortSignal: async () => table === 'products' ? { data: [product], error: null } : variantResult };
      return builder;
    }, rpc: name => {
      queries.push(name);
      return { abortSignal: async () => ({ data: [{ variant_id: 'actual-variant-a', available: true }], error: null }) };
    } };
  }
  const data = await loadProducts(fake({ data: [variantRow({ inventory_policy: 'tracked' })], error: null }), 'NLE', new AbortController().signal);
  assert.equal(data[0].variants[0].id, 'actual-variant-a');
  assert.equal(data[0].price, 12000);
  assert.equal(variants.variantAvailable(data[0].variants[0]), true);
  assert.deepEqual(queries, ['products', 'product_variants', 'catalogue_variant_availability']);
  const fallback = await loadProducts(fake({ data: null, error: { code: 'PGRST205' } }), 'NLE', new AbortController().signal);
  assert.equal(fallback[0].variants, undefined);
  await assert.rejects(loadProducts(fake({ data: null, error: { code: 'unknown' } }), 'NLE', new AbortController().signal));
});
