// Offline contracts only: a fake order service and a fake key store. No order, payment or email ever leaves this process.
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
const envelope = { order: placed, email_status: 'queued' };
const validDraft = () => ({ ...checkout.emptyCheckout, full_name: 'Aisha Sesay', contact_phone: '+23276521208',
  email: 'a@example.invalid', street: 'Landmark', area: 'Goderich', city: 'Freetown', zone: 'zone-1', payment_phone: '+23276521208' });
const keyFor = userId => `lume:checkout-request:${userId}`;
const request = () => ({ requestId: '00000000-0000-4000-8000-000000000001', checkout: checkout.checkoutPayload(validDraft()),
  expectedCart: [{ product_id: 'product-a', variant_id: 'actual-variant-a', quantity: 1, unit_price: 12000 }] });

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

test('only the exact order the trusted service returns becomes a placed order', () => {
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

test('the email answer is read from the envelope and anything unknown falls back to queued', () => {
  assert.deepEqual(plain(repository.parsePlacement(envelope)), { order: plain(repository.parsePlacedOrder(placed)), emailStatus: 'queued' });
  for (const value of ['sent', 'review_required']) assert.equal(repository.parsePlacement({ ...envelope, email_status: value }).emailStatus, value);
  assert.equal(order.emailStates.length, 3, 'no delivered or failed state is invented for the customer');
  for (const value of [undefined, null, 'delivered', 'failed', 7, {}]) {
    assert.equal(repository.parsePlacement({ ...envelope, email_status: value }).emailStatus, 'queued', `unknown email answer: ${JSON.stringify(value)}`);
  }
  for (const value of [null, {}, { email_status: 'sent' }, { order: null }, 'placed', []]) {
    assert.throws(() => repository.parsePlacement(value), error => error instanceof repository.OrderError && !error.definite,
      `an envelope without a real order is never success: ${JSON.stringify(value)}`);
  }
});

test('a structured refusal from the order service is definite and safe', async () => {
  for (const code of ['AUTH_REQUIRED', 'INVALID_REQUEST', 'INVALID_CHECKOUT', 'INVALID_DELIVERY_ZONE', 'INVALID_DELIVERY_DETAILS',
    'PRODUCT_UNAVAILABLE', 'OUT_OF_STOCK', 'CART_LIMIT', 'CART_CHANGED', 'EMPTY_CART', 'ORDER_TOTAL_LIMIT']) {
    const failure = await repository.edgeFailure({ context: { status: 400, json: async () => ({ error: code }) } });
    assert.ok(failure instanceof repository.OrderError, `${code} needs an OrderError`);
    assert.equal(failure.code, code);
    assert.equal(failure.definite, true, `${code} is raised before the order exists`);
    assert.ok(failure.message.length > 20 && !failure.message.includes(code), `${code} needs its own customer-facing message`);
  }
});

test('never leak a raw provider body, and never call an unread failure definite', async () => {
  const leaky = await repository.edgeFailure({ context: { status: 500, json: async () => ({ message: 'connection to smtp.internal timed out' }) } });
  assert.equal(leaky.definite, false);
  assert.equal(leaky.message.includes('smtp'), false, 'a server detail is never shown to a customer');
  const html = await repository.edgeFailure({ context: { status: 502, json: async () => '<html>Bad gateway</html>' } });
  assert.equal(html.definite, false);
  assert.equal(html.message.includes('html'), false);
  for (const reason of [new Error('Network request failed'), { context: undefined }, {}, null, 'failed']) {
    const failure = await repository.edgeFailure(reason);
    assert.equal(failure.definite, false, 'a failure with no status cannot prove the order was not created');
  }
});

test('a refusal the service can only give before touching the transaction is definite', async () => {
  for (const [status, code] of [[413, 'REQUEST_TOO_LARGE'], [403, 'REQUEST_REFUSED'], [404, 'REQUEST_REFUSED'], [400, 'REQUEST_REFUSED']]) {
    const failure = await repository.edgeFailure({ context: { status, json: async () => { throw new Error('not json'); } } });
    assert.equal(failure.code, code);
    assert.equal(failure.definite, true, `http ${status} is answered before any order could be written`);
  }
  for (const status of [500, 503, 504]) {
    const failure = await repository.edgeFailure({ context: { status, json: async () => ({ detail: 'upstream failed' }) } });
    assert.equal(failure.definite, false, `http ${status} may follow an order that already committed`);
    assert.match(failure.message, /could not confirm|check your orders/i);
  }
});

test('the placement call is the trusted Edge contract with the customer token', async () => {
  const calls = [];
  const client = { functions: { invoke: async (name, options) => { calls.push({ name, options }); return { data: envelope, error: null }; } } };
  const request = { requestId: '00000000-0000-4000-8000-000000000001', checkout: checkout.checkoutPayload(validDraft()),
    expectedCart: order.expectedCart([item(2)], readyProducts) };
  const result = await repository.placeOrder(client, 'synthetic-token', request);
  assert.equal(calls[0].name, 'place-order', 'the function, not the raw RPC, so the email attempt is not skipped');
  assert.deepEqual(plain(Object.keys(calls[0].options.body).sort()), ['cart_version', 'checkout', 'expected_cart', 'request_id'],
    'the body is exactly the request id, the checkout, the reviewed cart and the version');
  assert.equal(calls[0].options.body.cart_version, 2);
  assert.deepEqual(plain(calls[0].options.body), plain({ request_id: request.requestId, checkout: request.checkout,
    expected_cart: request.expectedCart, cart_version: 2 }));
  assert.equal(JSON.stringify(calls[0].options.body).match(/total|fee|payment_status|paid/i), null, 'no client-side money or status is ever sent');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(plain(result), plain({ order: repository.parsePlacedOrder(placed), emailStatus: 'queued' }));
});

test('the transport refuses the direct RPC so the email step cannot be bypassed', () => {
  const source = fs.readFileSync('src/features/checkout/orderRepository.ts', 'utf8');
  assert.equal(/client\.rpc\(/.test(source), false, 'a direct RPC commits without the function\'s post-commit email attempt');
  assert.equal(/service_role|SERVICE_ROLE|secret/i.test(source), false, 'no server credential can appear in the mobile bundle');
});

test('the owner-scoped recovery read finds only an order this request already created', async () => {
  const calls = [];
  const rows = data => ({ from: () => ({ select: () => ({ eq: (column, value) => ({ maybeSingle: () => ({ setHeader: async () => {
    calls.push({ column, value }); return { data, error: null }; } }) }) }) }) });
  const found = await repository.findCheckout(rows({ id: placed.id }), 'synthetic-token', request().requestId);
  assert.equal(found, placed.id);
  assert.deepEqual(plain(calls[0]), { column: 'checkout_request_id', value: request().requestId }, 'the request id is the only key');
  assert.equal(await repository.findCheckout(rows(null), 'synthetic-token', request().requestId), null, 'no row means no order, not an error');
  const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => ({ setHeader: async () => ({ data: null, error: { message: 'permission denied' } }) }) }) }) }) };
  await assert.rejects(repository.findCheckout(failing, 'synthetic-token', request().requestId),
    error => error instanceof repository.OrderError && !error.definite && !error.message.includes('permission'));
  for (const id of ['', 'not-a-uuid', placed.id.replace('1111', 'zzzz'), 7, null]) {
    const unused = { from: () => { throw new Error('a malformed request id never reaches the network'); } };
    await assert.rejects(repository.findCheckout(unused, 'synthetic-token', id), error => !error.definite);
  }
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
function rig({ responses = [], orders = null, user = 'customer-a', session = user, store = storage() } = {}) {
  const requests = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: session }, access_token: 'synthetic-token' } }, error: null }) },
    functions: { invoke: async (name, options) => {
      requests.push({ name, body: options.body, headers: options.headers });
      const next = responses.shift();
      return next === undefined ? { data: envelope, error: null } : (typeof next === 'function' ? await next() : next);
    } },
    from: table => ({ select: () => ({ eq: (column, value) => ({ maybeSingle: () => ({ setHeader: async () => {
      requests.push({ table, column, value });
      return typeof orders === 'function' ? await orders() : { data: orders ? { id: orders } : null, error: null };
    } }) }) }) }),
  };
  const instance = new CheckoutController(client, user, store.api, newId);
  instance.activate();
  return { instance, requests, store };
}
const refusal = (status, error) => ({ data: null, error: { context: { status, json: async () => (error ? { error } : 'not json') } } });

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

test('a confirmed order shows the server reference and is never repeated by the same controller', async () => {
  const view = rig({ responses: [{ data: envelope, error: null }] });
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), true);
  const snapshot = view.instance.getSnapshot();
  assert.equal(snapshot.status, 'placed');
  assert.equal(snapshot.orderId, placed.id);
  assert.equal(snapshot.reference, 'LH-0123456789ABCDEF');
  assert.equal(snapshot.emailStatus, 'queued', 'the service answer is carried, never invented by the client');
  assert.equal(snapshot.orderId, placed.id, 'the identifier is the server row, not a client estimate');
  assert.equal(view.store.values[keyFor('customer-a')], undefined, 'a confirmed order releases its request id');
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), false, 'one controller never places twice');
  assert.equal(view.requests.length, 1);
  assert.equal(view.instance.getSnapshot().reference, 'LH-0123456789ABCDEF', 'the refusal does not erase the confirmation');
  view.instance.deactivate();
});

test('a lost response keeps its request id and retries the byte-identical request', async () => {
  const lost = deferred();
  const view = rig({ responses: [() => lost.promise, { data: envelope, error: null }] });
  const first = view.instance.submit(validDraft(), [item(2)], readyProducts);
  await tick();
  assert.equal(view.instance.getSnapshot().status, 'submitting');
  assert.equal(await view.instance.retry(), false, 'a submission in flight cannot be duplicated');
  assert.equal(view.requests.length, 1);
  const original = plain(view.requests[0]);
  assert.equal(view.store.values[keyFor('customer-a')], original.body.request_id, 'the id is persisted before the response');
  lost.reject(new Error('Network request failed'));
  assert.equal(await first, false);
  assert.equal(view.instance.getSnapshot().status, 'uncertain');
  assert.equal(view.instance.getSnapshot().canRetry, true);
  assert.equal(view.instance.getSnapshot().orderId, null, 'a timeout is never presented as an order');
  assert.match(view.instance.getSnapshot().message, /could not be confirmed/);
  assert.equal(await view.instance.retry(), true);
  assert.deepEqual(plain(view.requests[1]), original, 'the retry re-sends the exact request id, checkout and reviewed cart');
  assert.equal(view.instance.getSnapshot().status, 'placed');
  assert.equal(view.store.values[keyFor('customer-a')], undefined);
  view.instance.deactivate();
});

test('a refused submission that may already have committed stays uncertain', async () => {
  const view = rig({ responses: [refusal(503)] });
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), false);
  assert.equal(view.instance.getSnapshot().status, 'uncertain');
  assert.equal(view.instance.getSnapshot().canRetry, true);
  assert.equal(view.store.values[keyFor('customer-a')], view.requests[0].body.request_id,
    'the id is held so the retry can be answered by the order it already created');
  view.instance.deactivate();
});

test('a definite rejection releases the request id so the next attempt is a new order, not a stale echo', async () => {
  const view = rig({ responses: [refusal(409, 'CART_CHANGED'), { data: envelope, error: null }] });
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), false);
  assert.equal(view.instance.getSnapshot().status, 'error');
  assert.match(view.instance.getSnapshot().message, /changed while you were checking out/);
  assert.equal(view.instance.getSnapshot().orderId, null);
  assert.equal(view.store.values[keyFor('customer-a')], undefined, 'no order exists, so the id is not held hostage');
  assert.equal(await view.instance.retry(), false, 'a definite rejection is never silently retried');
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), true);
  assert.notEqual(plain(view.requests[1].body.request_id), plain(view.requests[0].body.request_id),
    'reusing an id would return the old order instead of the new Bag');
  view.instance.deactivate();
});

test('sign-out mid-flight discards a late order and keeps the id for its own customer', async () => {
  const pending = deferred();
  const store = storage();
  const view = rig({ responses: [() => pending.promise], store });
  const submitting = view.instance.submit(validDraft(), [item(2)], readyProducts);
  await tick();
  const requestId = plain(view.requests[0].body.request_id);
  view.instance.deactivate();
  assert.equal(view.instance.getSnapshot().status, 'idle');
  assert.equal(await view.instance.retry(), false);
  pending.resolve({ data: envelope, error: null });
  assert.equal(await submitting, false);
  assert.equal(view.instance.getSnapshot().orderId, null, 'a late success cannot confirm an order on a signed-out screen');
  assert.equal(view.store.values[keyFor('customer-a')], requestId,
    'the id stays for this customer because an order may already exist behind the lost response');
  const next = rig({ responses: [], store, user: 'customer-b', session: 'customer-b' });
  assert.equal(await next.instance.submit(validDraft(), [item(2)], readyProducts), true);
  assert.notEqual(plain(next.requests[0].body.request_id), requestId, 'a new customer never inherits the previous request id');
  assert.equal(next.store.values[keyFor('customer-b')], undefined);
  next.instance.deactivate();
});

test('a session that changed identity during submission blocks the request before it is sent', async () => {
  const view = rig({ responses: [{ data: envelope, error: null }], user: 'customer-a', session: 'customer-b' });
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), false);
  assert.equal(view.requests.length, 0, 'the order request is never made with another customer token');
  assert.equal(view.instance.getSnapshot().status, 'error');
  assert.match(view.instance.getSnapshot().message, /sign in again/);
  assert.match(view.instance.getSnapshot().message, /order/i, 'the Bag wording of the shared session guard is not reused');
  assert.equal(view.store.values[keyFor('customer-a')], undefined, 'a definite auth refusal leaves no reserved id behind');
  view.instance.deactivate();
});

test('an interrupted checkout is recovered from the database, never from a guess', async () => {
  const reserved = '00000000-0000-4000-8000-000000000009';
  const view = rig({ orders: placed.id, store: storage({ [keyFor('customer-a')]: reserved }) });
  await view.instance.recover();
  const snapshot = view.instance.getSnapshot();
  assert.equal(snapshot.status, 'placed', 'the order this request already created is the only thing that can be announced');
  assert.equal(snapshot.orderId, placed.id);
  assert.equal(snapshot.reference, null, 'a reference the service never returned is not shown');
  assert.equal(snapshot.emailStatus, null, 'a recovery says nothing about email, because it knows nothing');
  assert.equal(view.store.values[keyFor('customer-a')], undefined, 'a found order releases its request id');
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), false, 'a recovered order is never re-submitted');
  assert.equal(view.requests.filter(call => call.name === 'place-order').length, 0);
  view.instance.deactivate();
});

test('a reserved id with no order behind it stays reserved and is reused, not discarded', async () => {
  const reserved = '00000000-0000-4000-8000-000000000010';
  const view = rig({ orders: null, store: storage({ [keyFor('customer-a')]: reserved }) });
  await view.instance.recover();
  assert.equal(view.instance.getSnapshot().status, 'idle');
  assert.match(view.instance.getSnapshot().message, /No unfinished order was found/);
  assert.equal(view.store.values[keyFor('customer-a')], reserved);
  assert.equal(await view.instance.submit(validDraft(), [item(2)], readyProducts), true);
  assert.equal(view.requests[view.requests.length - 1].body.request_id, reserved,
    'the same request id is reused so a slow first attempt cannot produce a second order');
  view.instance.deactivate();
});

test('a recovery that cannot be checked says so and never places anything', async () => {
  const reserved = '00000000-0000-4000-8000-000000000011';
  const view = rig({ orders: () => { throw new Error('permission denied'); }, store: storage({ [keyFor('customer-a')]: reserved }) });
  await view.instance.recover();
  assert.equal(view.instance.getSnapshot().status, 'idle');
  assert.match(view.instance.getSnapshot().message, /could not be checked/);
  assert.equal(view.store.values[keyFor('customer-a')], reserved);
  view.instance.deactivate();

  const quiet = rig({ responses: [] });
  await quiet.instance.recover();
  assert.equal(quiet.requests.length, 0, 'a customer with no interrupted checkout is never queried');
  assert.equal(quiet.instance.getSnapshot().status, 'idle');
  assert.equal(quiet.instance.getSnapshot().message, null);
  quiet.instance.deactivate();
});

test('the checkout screen is wired to the trusted seam with no client-side authority', () => {
  const files = ['src/app/checkout.tsx', 'src/features/checkout/CheckoutScreen.tsx', 'src/features/checkout/CheckoutDetails.tsx',
    'src/features/checkout/CheckoutPayment.tsx', 'src/features/checkout/CheckoutController.ts', 'src/app/_layout.tsx'];
  const present = files.filter(file => fs.existsSync(file));
  const sources = present.map(file => fs.readFileSync(file, 'utf8'));
  assert.ok(present.length >= 6);
  assert.equal(sources.some(source => /CheckoutController/.test(source)), true, 'the submission seam is now in use');
  const screen = sources[1];
  assert.match(screen, /Place order/);
  assert.match(screen, /awaiting confirmation/i);
  assert.equal(/total_cents|delivery_fee|unit_price.*body|paid\b/i.test(screen), false, 'the screen sends no money and claims no payment');
  assert.doesNotMatch(screen, /Payment successful|payment confirmed|Order paid|email sent|Email sent/i, 'no invented success');
});
