// Offline contracts only: a fake RPC and a fake key store. No order, payment or email ever leaves this process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./helpers/source.cjs');

const checkout = load('src/features/checkout/checkout.ts');
const order = load('src/features/checkout/order.ts');
const repository = load('src/features/checkout/orderRepository.ts');
const variants = load('src/features/products/variants.ts');
const { CheckoutController } = load('src/features/checkout/CheckoutController.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const variantRow = (overrides = {}) => ({ id: 'actual-variant-a', product_id: 'product-a', options: {}, is_default: true,
  price_cents: 12000, currency: 'NLE', active: true, inventory_policy: 'untracked', ...overrides });
const priced = (rows, price = 12000) => [{ id: 'product-a', name: 'Vase', price, variants: variants.parseVariants(rows) }];
const readyProducts = priced([variantRow()]);
const item = (quantity = 1, variantId = 'actual-variant-a') => ({ productId: 'product-a', variantId, quantity });
const placed = { id: '11111111-1111-4111-8111-111111111111', reference: 'LH-0123456789ABCDEF', total: 16000,
  currency: 'NLE', status: 'placed', payment_status: 'awaiting_payment' };
const validDraft = () => ({ ...checkout.emptyCheckout, full_name: 'Aisha Sesay', contact_phone: '+23276521208',
  email: 'a@example.invalid', street: 'Landmark', area: 'Goderich', city: 'Freetown', zone: 'zone-1', payment_phone: '+23276521208' });
const keyFor = userId => `lume:checkout-request:${userId}`;

test('the expected cart is the reviewed quote, key for key, and fails closed on anything unpriced', () => {
  assert.deepEqual(plain(order.expectedCart([item(2)], readyProducts)),
    [{ product_id: 'product-a', variant_id: 'actual-variant-a', quantity: 2, unit_price: 12000 }]);
  assert.deepEqual(plain(Object.keys(order.expectedCart([item(1)], readyProducts)[0]).sort()),
    ['product_id', 'quantity', 'unit_price', 'variant_id'], 'no total, fee or status is ever quoted');
  assert.equal(order.expectedCart([], readyProducts), null, 'an empty Bag is never submitted');
  assert.equal(order.expectedCart([item(1, 'unknown-variant')], readyProducts), null);
  assert.equal(order.expectedCart([item(1)], []), null, 'an unloaded catalogue cannot be quoted');
  assert.equal(order.expectedCart([item(1)], priced([variantRow({ inventory_policy: 'tracked' })])), null,
    'unconfirmed stock is never presented as reviewed');
  const choices = priced([variantRow(), variantRow({ id: 'actual-variant-b', options: { Colour: 'Blue' }, is_default: false, price_cents: 13500 })], 100);
  const quote = order.expectedCart([item(1, 'actual-variant-b'), item(1, 'actual-variant-a')], choices);
  assert.deepEqual(plain(quote.map(line => line.unit_price)), [12000, 13500], 'variant prices order, never the parent price');
});

test('only the exact response the trusted RPC returns becomes a placed order', () => {
  assert.deepEqual(plain(repository.parsePlacedOrder(placed)),
    { id: placed.id, reference: placed.reference, total: 16000, currency: 'NLE', status: 'placed', paymentStatus: 'awaiting_payment' });
  const rejected = [{ ...placed, reference: 'lh-0123456789abcdef' }, { ...placed, reference: 'LH-123' }, { ...placed, total: 16000.5 },
    { ...placed, total: -1 }, { ...placed, total: '16000' }, { ...placed, currency: 'USD' }, { ...placed, status: 'delivered' },
    { ...placed, status: 'reversed' }, { ...placed, payment_status: 'refunded' }, { ...placed, payment_status: 'awaiting' },
    { ...placed, id: '' }, { ...placed, total: null }, null, [], 'placed'];
  for (const value of rejected) {
    assert.throws(() => repository.parsePlacedOrder(value),
      error => error instanceof repository.OrderError && !error.definite && !String(error.message).includes('undefined'),
      `refused: ${JSON.stringify(value)}`);
  }
});

test('the known order and payment vocabulary parses and nothing else does', () => {
  for (const status of order.orderStatuses) assert.equal(repository.parsePlacedOrder({ ...placed, status }).status, status);
  for (const paymentStatus of order.paymentStatuses) assert.equal(repository.parsePlacedOrder({ ...placed, payment_status: paymentStatus }).paymentStatus, paymentStatus);
  assert.equal(order.orderStatuses.includes('reversed'), false, 'no reversed or refunded state is invented for mobile');
  assert.equal(order.paymentStatuses.includes('refunded'), false);
});

test('database rejections are definite and safe while anything else stays uncertain', async () => {
  const request = { requestId: '00000000-0000-4000-8000-000000000001', checkout: checkout.checkoutPayload(validDraft()), expectedCart: [{ product_id: 'product-a', variant_id: 'actual-variant-a', quantity: 1, unit_price: 12000 }] };
  const fake = (error, data = null) => ({ rpc: () => ({ setHeader: async () => ({ data, error }) }) });
  await assert.rejects(repository.placeOrder(fake({ code: 'P0001', message: 'OUT_OF_STOCK' }), 'fixture', request),
    error => error.code === 'OUT_OF_STOCK' && error.definite && /out of stock/i.test(error.message));
  await assert.rejects(repository.placeOrder(fake({ code: 'P0001', message: 'violates constraint fk_orders_user_id' }), 'fixture', request),
    error => !error.definite && !error.message.includes('constraint') && !error.message.includes('fk_orders'));
  await assert.rejects(repository.placeOrder(fake({ code: '22P02', message: 'invalid input syntax for type uuid' }), 'fixture', request),
    error => !error.definite && !error.message.includes('uuid'));
  await assert.rejects(repository.placeOrder(fake({ code: '', message: 'fetch failed' }), 'fixture', request), error => !error.definite);
  await assert.rejects(repository.placeOrder(fake(null, { ...placed, total: -5 }), 'fixture', request), error => !error.definite);
  await assert.rejects(repository.placeOrder(fake({ code: 'PGRST202', message: 'function not found' }), 'fixture', request),
    error => error.code === 'SCHEMA_NOT_READY' && /unchanged/i.test(error.message));
  for (const code of ['AUTH_REQUIRED', 'INVALID_REQUEST', 'INVALID_CHECKOUT', 'INVALID_DELIVERY_ZONE', 'INVALID_DELIVERY_DETAILS',
    'PRODUCT_UNAVAILABLE', 'OUT_OF_STOCK', 'CART_LIMIT', 'CART_CHANGED', 'EMPTY_CART', 'ORDER_TOTAL_LIMIT']) {
    await assert.rejects(repository.placeOrder(fake({ code: 'P0001', message: code }), 'fixture', request),
      error => error.code === code && error.definite && error.message.length > 20 && !error.message.includes(code),
      `${code} needs its own customer-facing message`);
  }
});

test('the placement call matches the trusted RPC signature with the customer token', async () => {
  const calls = [];
  const client = { rpc: (name, args) => ({ setHeader: async (header, value) => { calls.push({ name, args, header, value }); return { data: placed, error: null }; } }) };
  const request = { requestId: '00000000-0000-4000-8000-000000000001', checkout: checkout.checkoutPayload(validDraft()),
    expectedCart: order.expectedCart([item(2)], readyProducts) };
  const result = await repository.placeOrder(client, 'synthetic-token', request);
  assert.equal(calls[0].name, 'place_variant_order');
  assert.deepEqual(plain(Object.keys(calls[0].args).sort()), ['p_checkout', 'p_expected_cart', 'p_request_id'],
    'the RPC takes exactly the request id, the checkout and the reviewed cart');
  assert.deepEqual(plain(calls[0].args), plain({ p_request_id: request.requestId, p_checkout: request.checkout, p_expected_cart: request.expectedCart }));
  assert.equal(calls[0].header, 'Authorization');
  assert.equal(calls[0].value, 'Bearer synthetic-token');
  assert.equal(result.total, 16000);
});

function storage(initial = {}) {
  const values = { ...initial };
  return { values, api: {
    getItem: async key => (key in values ? values[key] : null),
    setItem: async (key, value) => { values[key] = value; },
    removeItem: async key => { delete values[key]; },
  } };
}
let allocated = 0;
const newId = () => `00000000-0000-4000-8000-${String(++allocated).padStart(12, '0')}`;
function rig({ responses = [], user = 'customer-a', session = user, store = storage() } = {}) {
  const requests = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: session }, access_token: 'synthetic-token' } }, error: null }) },
    rpc: (name, args) => ({ setHeader: async () => {
      requests.push({ name, args });
      const next = responses.shift();
      return next === undefined ? { data: placed, error: null } : (typeof next === 'function' ? next() : next);
    } }),
  };
  const instance = new CheckoutController(client, user, store.api, newId);
  instance.activate();
  return { instance, requests, store };
}

test('an unusable draft or Bag never reaches the network and never reserves a request id', async () => {
  const view = rig({ responses: [] });
  assert.equal(await view.instance.submit({ ...checkout.emptyCheckout }, [item(1)], readyProducts), false);
  assert.equal(view.requests.length, 0);
  assert.equal(view.instance.getSnapshot().status, 'error');
  assert.match(view.instance.getSnapshot().message, /highlighted checkout details/);
  assert.equal(Object.keys(view.store.values).length, 0, 'nothing is reserved for a request that was never built');
  assert.equal(await view.instance.submit(validDraft(), [item(1, 'unknown-variant')], readyProducts), false);
  assert.equal(view.requests.length, 0);
  assert.match(view.instance.getSnapshot().message, /prices need to refresh/);
  view.instance.deactivate();
});

test('a confirmed order shows the server total and is never repeated by the same controller', async () => {
  const view = rig({ responses: [{ data: placed, error: null }] });
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), true);
  const snapshot = view.instance.getSnapshot();
  assert.equal(snapshot.status, 'placed');
  assert.equal(snapshot.order.total, 16000, 'the money comes back from the server, not from the client estimate');
  assert.equal(snapshot.order.reference, 'LH-0123456789ABCDEF');
  assert.equal(snapshot.order.paymentStatus, 'awaiting_payment');
  assert.equal(view.store.values[keyFor('customer-a')], undefined, 'a confirmed order releases its request id');
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), false, 'one controller never places twice');
  assert.equal(view.requests.length, 1);
  assert.equal(view.instance.getSnapshot().order.reference, 'LH-0123456789ABCDEF', 'the refusal does not erase the confirmation');
  view.instance.deactivate();
});

test('a lost response keeps its request id and retries the byte-identical request', async () => {
  const lost = deferred();
  const view = rig({ responses: [() => lost.promise, { data: placed, error: null }] });
  const first = view.instance.submit(validDraft(), [item(2)], readyProducts);
  await tick();
  assert.equal(view.instance.getSnapshot().status, 'submitting');
  assert.equal(await view.instance.retry(), false, 'a submission in flight cannot be duplicated');
  assert.equal(view.requests.length, 1);
  const original = plain(view.requests[0]);
  assert.equal(view.store.values[keyFor('customer-a')], original.args.p_request_id, 'the id is persisted before the response');
  lost.resolve({ code: '', message: 'fetch failed' });
  assert.equal(await first, false);
  assert.equal(view.instance.getSnapshot().status, 'uncertain');
  assert.equal(view.instance.getSnapshot().canRetry, true);
  assert.match(view.instance.getSnapshot().message, /could not be confirmed/);
  assert.equal(await view.instance.retry(), true);
  assert.deepEqual(plain(view.requests[1]), original, 'the retry re-sends the exact request id, checkout and reviewed cart');
  assert.equal(view.instance.getSnapshot().status, 'placed');
  assert.equal(view.store.values[keyFor('customer-a')], undefined);
  view.instance.deactivate();
});

test('a definite rejection releases the request id so the next attempt is a new order, not a stale echo', async () => {
  const view = rig({ responses: [{ data: null, error: { code: 'P0001', message: 'CART_CHANGED' } }, { data: placed, error: null }] });
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), false);
  assert.equal(view.instance.getSnapshot().status, 'error');
  assert.match(view.instance.getSnapshot().message, /changed while you were checking out/);
  assert.equal(view.instance.getSnapshot().order, null);
  assert.equal(view.store.values[keyFor('customer-a')], undefined, 'no order exists, so the id is not held hostage');
  assert.equal(await view.instance.retry(), false, 'a definite rejection is never silently retried');
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), true);
  assert.notEqual(plain(view.requests[1].args.p_request_id), plain(view.requests[0].args.p_request_id),
    'reusing an id would return the old order instead of the new Bag');
  view.instance.deactivate();
});

test('sign-out mid-flight discards a late order and keeps the id for its own customer', async () => {
  const pending = deferred();
  const store = storage();
  const view = rig({ responses: [() => pending.promise], store });
  const submitting = view.instance.submit(validDraft(), [item(2)], readyProducts);
  await tick();
  const requestId = plain(view.requests[0].args.p_request_id);
  view.instance.deactivate();
  assert.equal(view.instance.getSnapshot().status, 'idle');
  assert.equal(await view.instance.retry(), false);
  pending.resolve({ data: placed, error: null });
  assert.equal(await submitting, false);
  assert.equal(view.instance.getSnapshot().order, null, 'a late success cannot confirm an order on a signed-out screen');
  assert.equal(view.store.values[keyFor('customer-a')], requestId,
    'the id stays for this customer because an order may already exist behind the lost response');
  const next = rig({ responses: [], store, user: 'customer-b', session: 'customer-b' });
  assert.equal(await next.instance.submit(validDraft(), [item(2)], readyProducts), true);
  assert.notEqual(plain(next.requests[0].args.p_request_id), requestId, 'a new customer never inherits the previous request id');
  assert.equal(next.store.values[keyFor('customer-b')], undefined);
  next.instance.deactivate();
});

test('a session that changed identity during submission blocks the request before it is sent', async () => {
  const view = rig({ responses: [{ data: placed, error: null }], user: 'customer-a', session: 'customer-b' });
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), false);
  assert.equal(view.requests.length, 0, 'the order request is never made with another customer token');
  assert.equal(view.instance.getSnapshot().status, 'error');
  assert.match(view.instance.getSnapshot().message, /sign in again/);
  assert.match(view.instance.getSnapshot().message, /order/i, 'the Bag wording of the shared session guard is not reused');
  assert.equal(view.store.values[keyFor('customer-a')], undefined, 'a definite auth refusal leaves no reserved id behind');
  view.instance.deactivate();
});

test('nothing in the checkout screens can reach the placement seam in this build', () => {
  const files = ['src/app/checkout.tsx', 'src/features/checkout/CheckoutScreen.tsx', 'src/features/checkout/CheckoutDetails.tsx',
    'src/features/checkout/CheckoutPayment.tsx', 'src/app/_layout.tsx'];
  const present = files.filter(file => fs.existsSync(file));
  const sources = present.map(file => fs.readFileSync(file, 'utf8'));
  assert.ok(present.length >= 5);
  assert.equal(sources.some(source => /CheckoutController|place_variant_order|placeOrder|expectedCart|KeyStorage/.test(source)), false,
    'the submission seam stays unwired until the transport decision is made');
  assert.equal(sources.some(source => /Place order|Submit order|Pay now|Order placed/i.test(source)), false);
});
