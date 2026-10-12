// Offline contracts only: mocked clients and repositories. No network, order, payment or email leaves this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, find, expand } = require('./helpers/source.cjs');

const orders = load('src/features/orders/orders.ts');
const repository = load('src/features/orders/orderRepository.ts');
const unreadable = /This order record could not be read/;
const identifier = '22222222-2222-4222-8222-222222222222';

// A row in the shape the owner-scoped orders read returns. No timezone offset in the timestamp: the date is
// read back as the parts the writer stored, so these assertions hold whatever the test machine timezone is.
const summaryRow = {
  id: identifier, order_reference: 'LH-2222222222222222', created_at: '2026-10-09T14:05:00', total_cents: 16000,
  currency: 'NLE', fulfilment_method: 'delivery', status: 'placed', payment_status: 'awaiting_payment',
};
const detailRow = {
  ...summaryRow, full_name: 'Aisha Sesay', customer_email: 'customer-a@example.invalid', customer_phone: '+23276521208',
  delivery_street_address: 'Landmark', delivery_area: 'Goderich', delivery_city: 'Freetown',
  delivery_zone_label: 'Goderich to Lumley', delivery_instructions: 'Call on arrival', pickup_location: null,
  payment_provider: 'orange', payment_phone_last4: '2120', subtotal_cents: 12000, delivery_fee_cents: 4000,
  order_items: [{ product_name: 'Vase', quantity: 1, unit_price_cents: 12000,
    variant_id: null, variant_sku: null, variant_options: null, variant_currency: null }],
};
const plain = value => JSON.parse(JSON.stringify(value));
const textOf = element => {
  if (typeof element === 'string') return element;
  if (!element || typeof element !== 'object') return '';
  return [element.props?.children].flat(Infinity).map(textOf).join(' ');
};
const header = tree => find(tree, element => element.props?.accessibilityRole === 'header');
const alert = tree => find(tree, element => element.props?.accessibilityRole === 'alert');
const link = (tree, href) => find(tree, element => element.type === 'Link' && element.props?.href === href);
const button = (tree, label) => find(tree, element => element.props?.accessibilityRole === 'button' && element.props?.accessibilityLabel === label);
const totalRow = (tree, label) => find(tree, element => element.props?.accessible === true && String(element.props?.accessibilityLabel ?? '').startsWith(`${label}.`));

test('an order summary is read only when every identifying field is intact', () => {
  assert.deepEqual(plain(orders.parseOrderSummary(summaryRow)), {
    id: identifier, reference: 'LH-2222222222222222', placedAt: '2026-10-09T14:05:00', total: 16000, currency: 'NLE',
    fulfilment: 'delivery', status: 'placed', paymentStatus: 'awaiting_payment',
  });
  for (const field of ['id', 'order_reference', 'created_at', 'total_cents', 'currency', 'fulfilment_method', 'status', 'payment_status']) {
    assert.throws(() => orders.parseOrderSummary({ ...summaryRow, [field]: null }), unreadable, `a missing ${field} is refused`);
  }
  for (const reference of ['LH-2222', 'lh-2222222222222222', 'ORDER-2222222222222222']) {
    assert.throws(() => orders.parseOrderSummary({ ...summaryRow, order_reference: reference }), unreadable, `${reference} is not a Lumé House reference`);
  }
  assert.throws(() => orders.parseOrderSummary({ ...summaryRow, id: '22222222-2222-2222-8222-222222222222' }), unreadable, 'a non-v4 id is not an order identity');
  assert.throws(() => orders.parseOrderSummary({ ...summaryRow, total_cents: 16000.5 }), unreadable, 'a fractional amount is never money');
  assert.throws(() => orders.parseOrderSummary({ ...summaryRow, created_at: 'whenever' }), unreadable);
  assert.throws(() => orders.parseOrderSummary({ ...summaryRow, status: 'paid' }), unreadable, 'an order status outside the shared vocabulary is refused');
  assert.throws(() => orders.parseOrderSummary([]), unreadable);
});

test('an order detail is shown only after its own money adds up', () => {
  const detail = orders.parseOrderDetail(detailRow);
  assert.deepEqual(plain([detail.subtotal, detail.fee, detail.total]), [12000, 4000, 16000]);
  assert.deepEqual(plain(detail.lines), [{ key: 'item-0', name: 'Vase', options: '', quantity: 1, unitPrice: 12000, lineTotal: 12000 }]);
  assert.deepEqual(plain([detail.delivery.street, detail.delivery.area, detail.delivery.city, detail.delivery.zoneLabel, detail.delivery.instructions]),
    ['Landmark', 'Goderich', 'Freetown', 'Goderich to Lumley', 'Call on arrival']);
  assert.equal(detail.pickupLocation, null);

  const chosen = orders.parseOrderDetail({ ...detailRow, subtotal_cents: 16000, total_cents: 16000, delivery_fee_cents: 0,
    order_items: [{ product_name: 'Vase', quantity: 2, unit_price_cents: 8000,
      variant_id: 'variant-a', variant_sku: 'LH-VASE-CLAY', variant_options: { Colour: 'Clay' }, variant_currency: 'NLE' }] });
  assert.equal(chosen.lines[0].key, 'variant-a-0', 'the variant snapshot keys the line the customer actually ordered');
  assert.equal(chosen.lines[0].options, 'Colour: Clay');
  assert.equal(chosen.fee, 0);

  const pickup = orders.parseOrderDetail({ ...detailRow, fulfilment_method: 'pickup', delivery_street_address: null,
    delivery_area: null, delivery_city: null, delivery_zone_label: null, delivery_instructions: null,
    pickup_location: 'Lumley, Freetown', delivery_fee_cents: 0, total_cents: 12000 });
  assert.equal(pickup.delivery, null, 'a pickup order carries no delivery address block');
  assert.equal(pickup.pickupLocation, 'Lumley, Freetown');
  // Half a record is worse than none: the numbers on screen must be the ones the shop wrote.
  assert.throws(() => orders.parseOrderDetail({ ...detailRow, total_cents: 17000 }), unreadable, 'subtotal plus fee must equal the stored total');
  assert.throws(() => orders.parseOrderDetail({ ...detailRow, subtotal_cents: 11000 }), unreadable, 'the item snapshot must add up to the stored subtotal');
  assert.throws(() => orders.parseOrderDetail({ ...detailRow, order_items: [] }), unreadable, 'an order with no lines is not an order');
  assert.throws(() => orders.parseOrderDetail({ ...detailRow, payment_provider: 'wave' }), unreadable, 'no provider outside the recorded two is named');
  assert.throws(() => orders.parseOrderDetail({ ...detailRow, payment_provider: null }), unreadable);
  assert.throws(() => orders.parseOrderDetail({ ...detailRow, delivery_street_address: null }), unreadable, 'a delivery order needs every address row');
  assert.throws(() => orders.parseOrderDetail({ ...detailRow, order_items: [{ ...detailRow.order_items[0],
    variant_id: 'variant-a', variant_sku: null, variant_options: null, variant_currency: null }] }), unreadable, 'a variant snapshot is all or nothing');
});

test('order wording never shortens a stored state into a payment or delivery claim', () => {
  assert.equal(orders.orderLabel('awaiting_payment'), 'Awaiting confirmation', 'the state every new order starts in is named as a wait, not a payment');
  assert.equal(orders.orderLabel('ready_for_pickup'), 'Ready for pickup');
  assert.equal(orders.orderLabel('out_for_delivery'), 'Out for delivery');
  assert.equal(orders.orderLabel('placed'), 'Placed');
  for (const status of ['placed', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled',
    'pending', 'awaiting_payment', 'paid', 'failed']) {
    assert.match(orders.orderLabel(status), /^[A-Z]/, `${status} is still describable`);
  }
  assert.doesNotMatch(orders.orderLabel('awaiting_payment'), /paid|charged/i);

  assert.deepEqual(plain([orders.orderDate('2026-10-09T14:05:00'), orders.orderDateTime('2026-10-09T14:05:00')]),
    ['09 October 2026', '09 October 2026, 14:05'], 'built from date parts, so two devices show one date');
  assert.deepEqual(plain([orders.orderDate('2026-01-02T03:04:00'), orders.orderDateTime('2026-12-31T23:59:00')]),
    ['02 January 2026', '31 December 2026, 23:59']);
  assert.deepEqual(plain([orders.orderDate('whenever'), orders.orderDateTime('whenever')]), ['Date unavailable', 'Date unavailable']);

  assert.deepEqual(plain(Object.keys(orders.emailCopy)), ['queued', 'sent', 'review_required'], 'only the states the order service can report are worded');
  assert.match(orders.emailCopy.queued, /nothing here proves it was delivered/);
  assert.match(orders.emailCopy.sent, /acceptance, not proof that it arrived/);
  assert.match(orders.emailCopy.review_required, /manual review by the shop/);
  for (const copy of Object.values(orders.emailCopy)) {
    assert.match(copy, /Your order|nothing here|not proof/, `${copy} keeps the order separate from the email`);
    assert.doesNotMatch(copy, /has been delivered|has arrived|Email sent|confirmation email sent/i, 'no email state is worded as delivery');
  }
});

const summaryColumns = 'id,order_reference,created_at,total_cents,currency,fulfilment_method,status,payment_status';
const detailColumns = `${summaryColumns},full_name,customer_email,customer_phone,delivery_street_address,delivery_area,` +
  'delivery_city,delivery_zone_label,delivery_instructions,pickup_location,payment_provider,payment_phone_last4,' +
  'subtotal_cents,delivery_fee_cents,order_items(product_name,quantity,unit_price_cents,variant_id,variant_sku,variant_options,variant_currency)';

function fakeClient({ rows = null, error = null, userId = 'customer-a', session = { user: { id: 'customer-a' }, access_token: 'synthetic-token' },
  invoked = { data: { email_status: 'sent' }, error: null } } = {}) {
  const queries = [];
  const invokes = [];
  const client = {
    auth: {
      getUser: async () => (userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: { message: 'expired' } }),
      getSession: async () => ({ data: { session }, error: null }),
    },
    from: table => {
      const query = { table, select: null, eq: [], order: [], range: null, terminal: null };
      const chain = {
        select: columns => { query.select = columns; return chain; },
        eq: (column, value) => { query.eq.push([column, value]); return chain; },
        order: (column, config) => { query.order.push([column, config?.ascending]); return chain; },
        range: (from, to) => { query.range = [from, to]; query.terminal = 'range'; return Promise.resolve({ data: rows, error }); },
        maybeSingle: () => { query.terminal = 'maybeSingle'; return Promise.resolve({ data: rows, error }); },
      };
      queries.push(query);
      return chain;
    },
    functions: { invoke: async (name, options) => { invokes.push({ name, options }); return invoked; } },
  };
  return { client, queries, invokes };
}
const live = () => true;

test('the order history reads the owner-scoped columns, newest first, one page at a time', async () => {
  const backend = fakeClient({ rows: [summaryRow] });
  const first = await repository.loadOrders(backend.client, 'customer-a', 0, live);
  assert.deepEqual(plain(first), [plain(orders.parseOrderSummary(summaryRow))]);
  assert.deepEqual(plain(backend.queries.map(query => query.table)), ['orders']);
  assert.equal(backend.queries[0].select, summaryColumns, 'history asks for exactly the list columns');
  assert.deepEqual(plain(backend.queries[0].order), [['created_at', false], ['id', false]], 'one stable tie-break so a page never repeats or skips an order');
  assert.deepEqual(backend.queries[0].range, [0, 19]);
  const next = fakeClient({ rows: [summaryRow] });
  await repository.loadOrders(next.client, 'customer-a', 2, live);
  assert.deepEqual(next.queries[0].range, [40, 59]);
  assert.equal(orders.historyPageSize, 20, 'the page size is the website page size');
});

test('a history that fails to load or arrives malformed says so instead of showing half a list', async () => {
  const broken = fakeClient({ error: { message: 'private network detail' } });
  await assert.rejects(repository.loadOrders(broken.client, 'customer-a', 0, live),
    /Your orders could not be loaded\. Check your connection and retry/);
  await assert.rejects(repository.loadOrders(broken.client, 'customer-a', 0, live),
    error => !error.message.includes('private'), 'the driver message is never shown to the customer');
  await assert.rejects(repository.loadOrders(fakeClient({ rows: {} }).client, 'customer-a', 0, live), /could not be loaded/);
  await assert.rejects(repository.loadOrders(fakeClient({ rows: [summaryRow, { ...summaryRow, id: 'nope' }] }).client, 'customer-a', 0, live),
    unreadable, 'one unreadable order refuses the whole page');
});

test('an order read trusts row level security: not yours and not there both read as nothing', async () => {
  const missing = fakeClient({ rows: null });
  assert.equal(await repository.loadOrder(missing.client, 'customer-a', identifier, live), null);
  assert.equal(missing.queries[0].select, detailColumns);
  assert.deepEqual(plain(missing.queries[0].eq), [['id', identifier]], 'the order id is the only filter the client sends');
  assert.equal(missing.queries[0].terminal, 'maybeSingle');
  assert.match(detailColumns, /payment_phone_last4/);
  assert.doesNotMatch(detailColumns, /payer_phone|service_role|secret/, 'only the last digits the shop keeps are ever selected');

  const detail = await repository.loadOrder(fakeClient({ rows: detailRow }).client, 'customer-a', identifier, live);
  assert.equal(detail.reference, 'LH-2222222222222222');
  assert.equal(detail.lines[0].name, 'Vase');

  await assert.rejects(repository.loadOrder(fakeClient({ error: { message: 'unreachable' } }).client, 'customer-a', identifier, live),
    /This order could not be loaded\. Check your connection and retry/);
});

test('every order read re-checks the session owner before the table is touched', async () => {
  const other = fakeClient({ rows: [summaryRow], userId: 'customer-b' });
  await assert.rejects(repository.loadOrders(other.client, 'customer-a', 0, live), /Please sign in again to view your orders/);
  assert.equal(other.queries.length, 0, 'a session for someone else never becomes a query');
  const signedOut = fakeClient({ rows: [summaryRow], userId: null });
  await assert.rejects(repository.loadOrder(signedOut.client, 'customer-a', identifier, live), /sign in again/);
  assert.equal(signedOut.queries.length, 0);
  const left = fakeClient({ rows: [summaryRow] });
  await assert.rejects(repository.loadOrders(left.client, 'customer-a', 0, () => false), /sign in again/,
    'a customer who signs out mid-read is not shown an order list');
  assert.equal(left.queries.length, 0);
});

test('the email check is the website control: owner, bearer token, order id and nothing else', async () => {
  const backend = fakeClient({ invoked: { data: { email_status: 'review_required' }, error: null } });
  assert.equal(await repository.checkConfirmation(backend.client, 'customer-a', identifier, live), 'review_required');
  assert.deepEqual(plain(backend.invokes), [{ name: 'order-email', options: { body: { order_id: identifier },
    headers: { Authorization: 'Bearer synthetic-token' } } }], 'mobile asks the same function the website button calls');
  assert.equal(backend.queries.length, 0, 'asking about an email does not read the order table directly');

  const vague = fakeClient({ invoked: { data: { email_status: 'delivered' }, error: null } });
  assert.equal(await repository.checkConfirmation(vague.client, 'customer-a', identifier, live), 'queued',
    'a state outside the three the function can return is reported as the fail-closed one');

  await assert.rejects(repository.checkConfirmation(fakeClient({ invoked: { data: null, error: { message: 'private' } } }).client,
    'customer-a', identifier, live), /The confirmation email status could not be checked\. Your order is still saved/);
  await assert.rejects(repository.checkConfirmation(fakeClient({ session: null }).client, 'customer-a', identifier, live), /sign in again/);
});

function mountDetails({ params = {}, auth = { status: 'signed-in', user: { id: 'customer-a' } },
  orderLoad = async () => orders.parseOrderDetail(detailRow), emailCheck = async () => 'sent' } = {}) {
  const host = hooks();
  const view = {
    host, tree: null, authState: auth, calls: { loads: [], checks: [], routes: [] },
    // A session change is the one input this screen cannot control, so tests can move the customer under it.
    auth: state => { view.authState = state; },
    render: () => { host.begin(); view.tree = expand(Screen()); return view.tree; },
    // An effect resolves outside the render that started it, so each pass drains microtasks then re-renders.
    settle: async () => {
      for (let pass = 0; pass < 3; pass++) {
        await new Promise(resolve => setTimeout(resolve, 0));
        host.begin();
        view.tree = expand(Screen());
      }
      return view.tree;
    },
  };
  const Screen = load('src/features/orders/OrderDetailsScreen.tsx', {
    react: host.react,
    'expo-router': { Link: 'Link', useLocalSearchParams: () => params,
      router: { canGoBack: () => true, back: () => view.calls.routes.push('back'), replace: route => view.calls.routes.push(route) } },
    '../../lib/supabase/client': { getSupabaseClient: () => ({}) },
    '../auth/AuthContext': { useAuth: () => ({ state: view.authState, busy: false }) },
    // The cancellation panel is a screen of its own contract, tested in order-cancellation.cjs.
    './CancellationPanel': { CancellationPanel: () => null },
    // The screen is tested against the read contract, not a live session: nothing here reaches Supabase.
    './orderRepository': {
      loadOrder: async (client, userId, orderId, active) => { view.calls.loads.push({ userId, orderId, active: typeof active }); return orderLoad(userId, orderId); },
      checkConfirmation: async (client, userId, orderId, active) => { view.calls.checks.push({ userId, orderId, active: typeof active }); return emailCheck(userId, orderId); },
    },
  }).default;
  return view;
}
const emailButton = tree => button(tree, 'Check the confirmation email status for this order');

test('the order screen belongs to a session: nothing is read before the customer is known', async () => {
  const signedOut = mountDetails({ auth: { status: 'signed-out' }, params: { orderId: identifier } });
  signedOut.render();
  await signedOut.settle();
  assert.match(textOf(signedOut.tree), /Sign in to your Lumé House account to see this order/);
  assert.ok(link(signedOut.tree, '/account'), 'the way in is offered, but no order data is');
  assert.equal(signedOut.calls.loads.length, 0);
  assert.doesNotMatch(textOf(signedOut.tree), /NLe/);
  signedOut.host.unmount();

  const restoring = mountDetails({ auth: { status: 'restoring' }, params: { orderId: identifier } });
  restoring.render();
  await restoring.settle();
  assert.equal(textOf(header(restoring.tree)), 'Your order');
  assert.match(textOf(restoring.tree), /Restoring your session/);
  assert.equal(link(restoring.tree, '/account'), undefined, 'a session that may still arrive is not called signed out');
  assert.equal(restoring.calls.loads.length, 0);
  restoring.host.unmount();
});

test('an order reference that never arrived is stated, never guessed at', async () => {
  for (const params of [{}, { orderId: 'not-an-order' }, { orderId: ['not-an-order', identifier] }]) {
    const view = mountDetails({ params });
    view.render();
    await view.settle();
    assert.match(textOf(alert(view.tree)), /No order reference reached this screen/);
    assert.equal(view.calls.loads.length, 0, 'an unvalidated id is never used as a query key');
    assert.ok(link(view.tree, '/account'), 'the customer is sent where their real orders live');
    assert.doesNotMatch(textOf(view.tree), /NLe/);
    view.host.unmount();
  }
});

test('a confirmation opened from checkout shows only what the shop recorded', async () => {
  const view = mountDetails({ params: { orderId: identifier, received: '1', email: 'queued' } });
  view.render();
  assert.equal(textOf(header(view.tree)), 'Order received', 'the hand-off keeps its own heading while the order is read back');
  assert.equal(find(view.tree, element => element.type === 'ActivityIndicator').props.accessibilityLabel, 'Loading your order');
  await view.settle();
  const text = textOf(view.tree);
  assert.deepEqual(plain(view.calls.loads), [{ userId: 'customer-a', orderId: identifier, active: 'function' }],
    'the order is read back under this customer, not drawn from what the request remembered');
  assert.equal(textOf(header(view.tree)), 'LH-2222222222222222');
  assert.match(text, /ORDER RECEIVED/);
  assert.match(text, /Your order has been placed\. Payment is awaiting confirmation/);
  assert.match(text, /has not been charged or verified by Lumé House/);
  assert.match(text, /09 October 2026, 14:05/);
  assert.match(text, /Order: Placed/);
  assert.match(text, /Payment: Awaiting confirmation/);
  assert.match(text, /Completion describes fulfilment, not payment settlement/);
  assert.match(text, /This app does not process or verify mobile-money payments/);
  assert.equal(totalRow(view.tree, 'Vase, quantity 1').props.accessibilityLabel, 'Vase, quantity 1. NLe 120');
  assert.match(text, /1 × NLe 120/);
  assert.deepEqual(plain(['Subtotal', 'Delivery', 'Total'].map(label => totalRow(view.tree, label).props.accessibilityLabel)),
    ['Subtotal. NLe 120', 'Delivery. NLe 40', 'Total. NLe 160']);
  for (const part of ['Landmark', 'Goderich, Freetown', 'Goderich to Lumley', 'Instructions:', 'Call on arrival', 'Aisha Sesay']) {
    assert.ok(text.includes(part), `${part} is shown`);
  }
  assert.match(text, /Selected method: Orange Money · number ending 2120/, 'only the last digits the shop kept are repeated');
  assert.match(text, /The provider accepted the confirmation email for sending\. That is acceptance, not proof that it arrived/);
  assert.doesNotMatch(text, /The confirmation email is queued/, 'the state the service reported wins over anything the hand-off claimed');
  assert.match(text, /Your order is saved even if the confirmation email is delayed/);
  assert.doesNotMatch(text, /Payment successful|payment confirmed|Email sent|has been delivered|paid/i,
    'placement is shown as placement: no money taken, no email delivered');
  assert.ok(link(view.tree, '/'), 'the way back to the catalogue is offered');
  assert.match(text, /Continue shopping/);
  assert.ok(link(view.tree, '/orders'), 'the rest of this account\u2019s orders is one step away');
  assert.deepEqual(plain(view.calls.checks), [{ userId: 'customer-a', orderId: identifier, active: 'function' }],
    'the email state is asked of the order service under this customer, never read off the route');
  view.host.unmount();
});

test('a reopen after a restart or a lost stack still reads the order back', async () => {
  const view = mountDetails({ params: { orderId: identifier } });
  view.render();
  await view.settle();
  const text = textOf(view.tree);
  assert.equal(textOf(header(view.tree)), 'LH-2222222222222222');
  assert.match(text, /ORDER DETAILS/);
  assert.doesNotMatch(text, /Your order has been placed/, 'a record read later is not presented as a fresh placement');
  assert.match(text, /Payment: Awaiting confirmation/);
  assert.match(text, /The confirmation email status for this order has not been checked on this device/);
  assert.doesNotMatch(text, /queued|delivered|is sent/i, 'a restart cannot invent an email outcome');
  view.host.unmount();

  const other = mountDetails({ params: { orderId: identifier }, orderLoad: async () => null });
  other.render();
  await other.settle();
  assert.match(textOf(alert(other.tree)), /This order is not on your account\. Order records belong to the account that placed them/);
  assert.doesNotMatch(textOf(other.tree), /NLe/, "an order that is not yours reveals no amounts");
  assert.ok(link(other.tree, '/account'));
  other.host.unmount();
});

test('one customer never sees the order record another customer was shown', async () => {
  const view = mountDetails({ params: { orderId: identifier }, orderLoad: async userId =>
    userId === 'customer-a' ? orders.parseOrderDetail(detailRow) : null });
  view.render();
  await view.settle();
  assert.match(textOf(view.tree), /LH-2222222222222222/);
  view.auth({ status: 'signed-in', user: { id: 'customer-b' } });
  view.render();
  assert.doesNotMatch(textOf(view.tree), /LH-2222222222222222|NLe|Aisha/, 'the previous customer\u2019s record is not left on screen');
  assert.equal(textOf(header(view.tree)), 'Order details');
  await view.settle();
  assert.equal(view.calls.loads.length, 2);
  assert.deepEqual(plain(view.calls.loads[1]), { userId: 'customer-b', orderId: identifier, active: 'function' });
  assert.match(textOf(alert(view.tree)), /This order is not on your account/);
  view.host.unmount();
});

test('a pickup order shows its pickup point and no delivery address', async () => {
  const view = mountDetails({ params: { orderId: identifier }, orderLoad: async () => orders.parseOrderDetail({ ...detailRow,
    fulfilment_method: 'pickup', delivery_street_address: null, delivery_area: null, delivery_city: null,
    delivery_zone_label: null, delivery_instructions: null, pickup_location: 'Lumley, Freetown',
    delivery_fee_cents: 0, total_cents: 12000 }) });
  view.render();
  await view.settle();
  const text = textOf(view.tree);
  assert.match(text, /Lumley, Freetown/);
  assert.doesNotMatch(text, /Landmark|Goderich|Delivery zone/);
  assert.equal(totalRow(view.tree, 'Pickup').props.accessibilityLabel, 'Pickup. NLe 0');
  assert.equal(totalRow(view.tree, 'Total').props.accessibilityLabel, 'Total. NLe 120');
  assert.match(text, /Pickup fulfilment uses ready for pickup before completion/);
  view.host.unmount();
});

test('an order read that fails offers only a retry of the same read', async () => {
  const view = mountDetails({ params: { orderId: identifier }, orderLoad: async () => {
    throw new Error('This order could not be loaded. Check your connection and retry.');
  } });
  view.render();
  await view.settle();
  assert.equal(textOf(alert(view.tree)), 'This order could not be loaded. Check your connection and retry.');
  assert.equal(alert(view.tree).props.accessibilityLiveRegion, 'polite');
  assert.equal(find(view.tree, element => element.type === 'ActivityIndicator'), undefined);
  button(view.tree, 'Retry this order').props.onPress();
  await view.settle();
  assert.equal(view.calls.loads.length, 2, 'the retry re-reads the same order id');
  assert.deepEqual(plain(view.calls.loads[1]), { userId: 'customer-a', orderId: identifier, active: 'function' });
  view.host.unmount();

  // A repository failure can arrive from another realm, so the screen reads its message rather than its class.
  const raw = mountDetails({ params: { orderId: identifier }, orderLoad: async () => { throw { message: 'relation orders not found' }; } });
  raw.render();
  await raw.settle();
  assert.equal(textOf(alert(raw.tree)), 'relation orders not found');
  raw.host.unmount();

  const blank = mountDetails({ params: { orderId: identifier }, orderLoad: async () => { throw new Error(''); } });
  blank.render();
  await blank.settle();
  assert.equal(textOf(alert(blank.tree)), 'This order could not be loaded. Check your connection and retry.');
  assert.doesNotMatch(textOf(blank.tree), /undefined|null|Error:/);
  blank.host.unmount();
});

test('asking about the confirmation email replaces only the email line', async () => {
  const view = mountDetails({ params: { orderId: identifier } });
  view.render();
  await view.settle();
  assert.match(textOf(view.tree), /has not been checked on this device/);
  emailButton(view.tree).props.onPress();
  view.render();
  view.render();
  assert.equal(emailButton(view.tree).props.accessibilityState.busy, true, 'one check at a time');
  assert.equal(emailButton(view.tree).props.disabled, true);
  await view.settle();
  assert.deepEqual(plain(view.calls.checks), [{ userId: 'customer-a', orderId: identifier, active: 'function' }]);
  assert.match(textOf(view.tree), /The provider accepted the confirmation email for sending\. That is acceptance, not proof that it arrived/);
  assert.doesNotMatch(textOf(view.tree), /Email sent|has been delivered/, 'provider acceptance is not written as delivery');
  assert.match(textOf(view.tree), /Payment: Awaiting confirmation/);
  assert.equal(view.calls.loads.length, 1, 'an email check does not re-read or rewrite the order');
  assert.equal(emailButton(view.tree).props.accessibilityState.busy, false);
  view.host.unmount();

  const failed = mountDetails({ params: { orderId: identifier }, emailCheck: async () => {
    throw new Error('The confirmation email status could not be checked. Your order is still saved.');
  } });
  failed.render();
  await failed.settle();
  emailButton(failed.tree).props.onPress();
  await failed.settle();
  assert.equal(failed.calls.checks.length, 1);
  assert.match(textOf(failed.tree), /The confirmation email status could not be checked\. Your order is still saved/);
  assert.match(textOf(failed.tree), /LH-2222222222222222/, 'the order stays visible when the email question fails');
  assert.match(textOf(failed.tree), /has not been checked on this device/, 'a failed check leaves the email state as it was');
  assert.doesNotMatch(textOf(failed.tree), /Payment successful|Email sent/i);
  failed.host.unmount();
});

test('an order that still awaits payment says so every time it is opened, not only once', async () => {
  const reopened = mountDetails({ params: { orderId: identifier } });
  reopened.render();
  await reopened.settle();
  const text = textOf(reopened.tree);
  assert.match(text, /Payment is awaiting confirmation\. The selected method has not been charged or verified by this app/,
    'the web states the wait whenever the record awaits payment, so mobile must not state it only on the first visit');
  assert.doesNotMatch(text, /Payment successful|payment confirmed|paid\b|charged to/i,
    'a wait is never dressed up as money received');
  const note = find(reopened.tree, element => element.props?.accessibilityLiveRegion === 'polite'
    && /Payment is awaiting confirmation/.test(String(element.props?.children ?? '')));
  assert.ok(note?.props?.accessible, 'a screen reader is told the payment state changed rather than finding it silently');
  reopened.host.unmount();

  const settled = mountDetails({ params: { orderId: identifier }, orderLoad: async () => orders.parseOrderDetail({ ...detailRow, payment_status: 'paid' }) });
  settled.render();
  await settled.settle();
  assert.doesNotMatch(textOf(settled.tree), /Payment is awaiting confirmation/, 'a paid record is not shown as still waiting');
  assert.match(textOf(settled.tree), /Payment: Paid/);
  settled.host.unmount();
});

test('a typed or deep-linked email state is inert: only the order service may speak about the email', async () => {
  for (const claim of ['sent', 'delivered', 'queued', ['queued', 'sent'], '']) {
    const view = mountDetails({ params: { orderId: identifier, email: claim } });
    view.render();
    await view.settle();
    const text = textOf(view.tree);
    assert.match(text, /The confirmation email status for this order has not been checked on this device/,
      `a route that claims ${JSON.stringify(claim)} still says nothing until the service answers`);
    assert.doesNotMatch(text, /accepted for sending|is queued|needs a manual review|delivered/i);
    assert.equal(view.calls.checks.length, 0, 'an order opened from history is not re-asked just because the route asserted something');
    view.host.unmount();
  }

  // Even on the fresh hand-off the claim is discarded: the answer comes from the owner-scoped check instead.
  const handed = mountDetails({ params: { orderId: identifier, received: '1', email: 'sent' }, emailCheck: async () => 'review_required' });
  handed.render();
  await handed.settle();
  assert.deepEqual(plain(handed.calls.checks), [{ userId: 'customer-a', orderId: identifier, active: 'function' }],
    'the confirmation screen asks the same owner-scoped control the button uses');
  assert.match(textOf(handed.tree), /The confirmation email needs a manual review by the shop\. Your order is saved/);
  assert.doesNotMatch(textOf(handed.tree), /accepted for sending/);
  handed.host.unmount();
});
