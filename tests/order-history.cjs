// Offline contracts only: the order read is injected or mocked. No network, session, order or email.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks, find, expand, duplicateKeys } = require('./helpers/source.cjs');

const orders = load('src/features/orders/orders.ts');
const { OrdersController } = load('src/features/orders/OrdersController.ts');
const pageSize = orders.historyPageSize;
const plain = value => JSON.parse(JSON.stringify(value));
const summary = n => orders.parseOrderSummary({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, order_reference: `LH-${String(n).padStart(16, '0')}`,
  created_at: '2026-10-09T14:05:00', total_cents: 16000, currency: 'NLE', fulfilment_method: 'delivery',
  status: 'placed', payment_status: 'awaiting_payment',
});
const idsOf = list => list.map(order => order.id);
const page = (start, size = pageSize) => Array.from({ length: size }, (_, offset) => summary(start + offset));
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const textOf = element => {
  if (typeof element === 'string') return element;
  if (!element || typeof element !== 'object') return '';
  return [element.props?.children].flat(Infinity).map(textOf).join(' ');
};
function collect(element, predicate, found = []) {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  for (const child of [element.props?.children].flat(Infinity)) collect(child, predicate, found);
  return found;
}
const header = tree => find(tree, element => element.props?.accessibilityRole === 'header');
const alert = tree => find(tree, element => element.props?.accessibilityRole === 'alert');
const button = (tree, label) => find(tree, element => element.props?.accessibilityRole === 'button' && element.props?.accessibilityLabel === label);
const rows = tree => collect(tree, element => element.type === 'Link' && element.props?.href?.pathname === '/orders/[orderId]');
const references = tree => rows(tree).map(row => row.props.href.params.orderId);
// The href lives on the Link; the announcement a screen reader hears lives on the Pressable it wraps.
const rowLabel = tree => collect(rows(tree)[0] ?? {}, element => element.props?.accessibilityRole === 'link')[0]?.props?.accessibilityLabel;

test('a full page means more orders may exist and a short page closes the history', async () => {
  const reads = [];
  const controller = new OrdersController(async (customer, at) => {
    reads.push([customer, at]);
    return at === 0 ? page(1, pageSize) : page(pageSize + 1, 3);
  });
  controller.activate();
  await controller.refresh('customer-a');
  const first = controller.getSnapshot();
  assert.equal(first.status, 'ready');
  assert.equal(first.orders.length, pageSize);
  assert.equal(first.older, true, 'a whole page says nothing further has been asked for yet');
  await controller.loadMore();
  assert.deepEqual(plain(reads), [['customer-a', 0], ['customer-a', 1]]);
  const next = controller.getSnapshot();
  assert.equal(next.orders.length, pageSize + 3);
  assert.equal(next.older, false, 'a short page is the end of this account history');
  await controller.loadMore();
  assert.equal(reads.length, 2, 'an exhausted history asks for no further page');
  controller.deactivate();
});

test('a page that shifted under the customer never becomes the same order twice', async () => {
  const controller = new OrdersController(async (customer, at) => at === 0 ? page(1) : page(15));
  controller.activate();
  await controller.refresh('customer-a');
  await controller.loadMore();
  const state = controller.getSnapshot();
  assert.equal(new Set(idsOf(state.orders)).size, state.orders.length, 'an overlapping row is dropped, not duplicated');
  assert.deepEqual(plain(idsOf(state.orders)), plain(idsOf(page(1)).concat(idsOf(page(21, 14)))), 'the overlap is dropped and only the new rows join');
  assert.equal(state.orders.length, pageSize + 14);
  controller.deactivate();
});

test('a failed read is stated as a failure, never as an empty history', async () => {
  const controller = new OrdersController(async (customer, at) => { if (at === 0) return page(1); throw new Error('unreachable'); });
  controller.activate();
  await controller.refresh('customer-a');
  await controller.loadMore();
  const partial = controller.getSnapshot();
  assert.equal(partial.status, 'ready', 'the orders already read stay on screen');
  assert.equal(partial.orders.length, pageSize);
  assert.equal(partial.message, 'Earlier orders could not be loaded. The orders above are unchanged.');
  assert.equal(partial.loadingMore, false);
  assert.equal(partial.older, true, 'a page that failed may still exist, so the offer stays open');
  controller.deactivate();

  const none = new OrdersController(async () => { throw new Error('private driver detail'); });
  none.activate();
  await none.refresh('customer-a');
  const failed = none.getSnapshot();
  assert.equal(failed.status, 'error');
  assert.equal(failed.message, 'Your orders could not be loaded. Check your connection and retry.', 'the driver reason is never repeated');
  assert.equal(failed.orders.length, 0, 'a failed read publishes no order records');
  assert.equal(failed.older, false, 'a history that never loaded offers no pages');
  none.deactivate();
});

test('one customer’s order list is never published into another customer’s session', async () => {
  const gate = deferred();
  const reads = [];
  const controller = new OrdersController((customer, at) => {
    reads.push([customer, at]);
    return customer === 'customer-a' ? gate.promise : Promise.resolve(page(900));
  });
  controller.activate();
  const pending = controller.refresh('customer-a');
  controller.deactivate();
  controller.activate();
  await controller.refresh('customer-b');
  gate.resolve(page(1));
  await pending;
  assert.deepEqual(idsOf(controller.getSnapshot().orders), idsOf(page(900)), 'the answer to a session that ended is dropped');
  assert.deepEqual(plain(reads), [['customer-a', 0], ['customer-b', 0]]);
  controller.deactivate();
});

test('overlapping reads of the same history never start a second page', async () => {
  const gate = deferred();
  const reads = [];
  const controller = new OrdersController((customer, at) => { reads.push([customer, at]); return gate.promise; });
  controller.activate();
  const first = controller.refresh('customer-a');
  await controller.refresh('customer-a');
  await controller.loadMore();
  assert.deepEqual(plain(reads), [['customer-a', 0]], 'a read in flight is not started again');
  gate.resolve(page(1));
  await first;
  assert.equal(controller.getSnapshot().orders.length, pageSize);
  controller.deactivate();
});

function mountList({ auth = { status: 'signed-in', user: { id: 'customer-a' } }, read = async () => [] } = {}) {
  const host = hooks();
  const view = {
    host, tree: null, calls: [], routes: [], authState: auth,
    auth: state => { view.authState = state; },
    render: () => { host.begin(); view.tree = expand(Screen()); return view.tree; },
    settle: async () => {
      for (let pass = 0; pass < 3; pass++) {
        await new Promise(resolve => setTimeout(resolve, 0));
        host.begin();
        view.tree = expand(Screen());
      }
      return view.tree;
    },
  };
  const Screen = load('src/features/orders/OrdersScreen.tsx', {
    react: host.react,
    'expo-router': { Link: 'Link', router: { canGoBack: () => true, back: () => view.routes.push('back'), replace: route => view.routes.push(route) } },
    '../../lib/supabase/client': { getSupabaseClient: () => ({}) },
    '../auth/AuthContext': { useAuth: () => ({ state: view.authState, busy: false }) },
    // Only the read contract is mocked here: the screen, its controller and its wording are the real ones.
    './orderRepository': { loadOrders: async (client, userId, page, active) => {
      view.calls.push({ userId, page, active: typeof active });
      return read(userId, page);
    } },
  }).default;
  return view;
}

test('the history screen waits for a session before it reads anything', async () => {
  const signedOut = mountList({ auth: { status: 'signed-out' } });
  signedOut.render();
  await signedOut.settle();
  assert.equal(textOf(header(signedOut.tree)), 'My Orders');
  assert.match(textOf(signedOut.tree), /Sign in to your Lumé House account to see your orders/);
  assert.equal(signedOut.calls.length, 0, 'no order read runs for a customer this app does not know');
  signedOut.host.unmount();

  const restoring = mountList({ auth: { status: 'restoring' } });
  restoring.render();
  await restoring.settle();
  assert.match(textOf(restoring.tree), /Restoring your session/);
  assert.equal(restoring.calls.length, 0);
  restoring.host.unmount();
});

test('a loaded history lists each order as itself, in the order the shop returned them', async () => {
  const view = mountList({ read: async () => [summary(1), summary(2)] });
  view.render();
  assert.equal(find(view.tree, element => element.type === 'ActivityIndicator').props.accessibilityLabel, 'Loading your orders');
  await view.settle();
  const text = textOf(view.tree);
  assert.deepEqual(plain(view.calls), [{ userId: 'customer-a', page: 0, active: 'function' }]);
  assert.deepEqual(references(view.tree), idsOf([summary(1), summary(2)]));
  assert.equal(rowLabel(view.tree),
    'LH-0000000000000001. 09 October 2026. Delivery. NLe 160. Order Placed. Payment Awaiting confirmation.');
  assert.match(text, /LH-0000000000000001/);
  assert.match(text, /Order status describes fulfilment\. Payment stays awaiting confirmation until the shop records it/);
  assert.match(text, /That is every order on this account/);
  assert.equal(button(view.tree, 'Load earlier orders'), undefined, 'two orders are not a full page');
  assert.doesNotMatch(text, /Payment successful|Email sent|delivered|paid/i, 'a list of records claims nothing beyond them');
  assert.deepEqual(duplicateKeys(view.tree), []);
  view.host.unmount();
});

test('an account with no orders is said plainly instead of padded out', async () => {
  const view = mountList({ read: async () => [] });
  view.render();
  await view.settle();
  const text = textOf(view.tree);
  assert.match(text, /No orders on this account yet/);
  assert.match(text, /When you place an order it appears here with the status the shop recorded/);
  assert.doesNotMatch(text, /That is every order/, 'an empty account is not presented as a finished history');
  assert.equal(rows(view.tree).length, 0);
  assert.match(text, /Browse the catalogue/);
  view.host.unmount();
});

test('a history that fails to load offers only a retry of the same read', async () => {
  let attempts = 0;
  const view = mountList({ read: async () => {
    attempts++;
    if (attempts === 1) throw new Error('Your orders could not be loaded. Check your connection and retry.');
    return [summary(1)];
  } });
  view.render();
  await view.settle();
  assert.equal(textOf(alert(view.tree)), 'Your orders could not be loaded. Check your connection and retry.');
  assert.equal(alert(view.tree).props.accessibilityLiveRegion, 'polite');
  assert.equal(rows(view.tree).length, 0, 'a failure is never shown as an empty account');
  button(view.tree, 'Retry your orders').props.onPress();
  await view.settle();
  assert.equal(view.calls.length, 2);
  assert.deepEqual(plain(view.calls[1]), { userId: 'customer-a', page: 0, active: 'function' });
  assert.equal(rows(view.tree).length, 1, 'the retry replaces the failure with the orders it actually read');
  view.host.unmount();
});

test('a full page offers earlier orders and the next page joins what is already on screen', async () => {
  const view = mountList({ read: async (customer, at) => at === 0 ? page(1, pageSize) : page(pageSize + 1, 4) });
  view.render();
  await view.settle();
  assert.equal(rows(view.tree).length, pageSize);
  button(view.tree, 'Load earlier orders').props.onPress();
  view.render();
  assert.equal(button(view.tree, 'Load earlier orders').props.accessibilityState.busy, true, 'one page at a time');
  assert.equal(button(view.tree, 'Load earlier orders').props.disabled, true);
  await view.settle();
  assert.deepEqual(plain(view.calls.map(call => call.page)), [0, 1]);
  assert.equal(rows(view.tree).length, pageSize + 4);
  assert.equal(button(view.tree, 'Load earlier orders'), undefined);
  assert.match(textOf(view.tree), /That is every order on this account/);
  assert.deepEqual(duplicateKeys(view.tree), []);
  view.host.unmount();
});

test('an earlier page that fails leaves the orders already shown untouched', async () => {
  const view = mountList({ read: async (customer, at) => { if (at === 0) return page(1, pageSize); throw new Error('unreachable'); } });
  view.render();
  await view.settle();
  button(view.tree, 'Load earlier orders').props.onPress();
  await view.settle();
  assert.match(textOf(alert(view.tree)), /Earlier orders could not be loaded\. The orders above are unchanged/);
  assert.equal(rows(view.tree).length, pageSize);
  assert.equal(button(view.tree, 'Load earlier orders').props.disabled, false, 'the offer to go further back stays open');
  assert.match(textOf(view.tree), /LH-0000000000000001/, 'the orders already read are still listed');
  view.host.unmount();
});

test('order history is a route in this app, reached from the account and from one order', () => {
  assert.match(fs.readFileSync('src/app/orders.tsx', 'utf8'), /from '\.\.\/features\/orders\/OrdersScreen'/, 'the route file hands off to the native history screen');
  assert.match(fs.readFileSync('src/features/account/AccountDashboard.tsx', 'utf8'), /router\.navigate\('\/orders'\)/, 'the account row opens the native history');
  assert.match(fs.readFileSync('src/features/orders/OrderDetailsScreen.tsx', 'utf8'), /href="\/orders"/, 'an order links back to the customer’s own history');
  assert.doesNotMatch(fs.readFileSync('src/features/orders/OrdersScreen.tsx', 'utf8'), /cancel|refund|reverse/i, 'no order action is offered until its backend contract is verified');
});

test('switching account replaces the list with the new session’s own read', async () => {
  const view = mountList({ read: async customer => customer === 'customer-a' ? [summary(1)] : [summary(2)] });
  view.render();
  await view.settle();
  assert.deepEqual(references(view.tree), idsOf([summary(1)]));
  view.auth({ status: 'signed-in', user: { id: 'customer-b' } });
  await view.settle();
  assert.deepEqual(plain(view.calls.map(call => call.userId)), ['customer-a', 'customer-b']);
  assert.deepEqual(references(view.tree), idsOf([summary(2)]), 'the previous customer’s orders are not left on screen');
  view.auth({ status: 'signed-out' });
  view.render();
  assert.doesNotMatch(textOf(view.tree), /LH-/, 'a signed-out session shows no order record at all');
  assert.match(textOf(view.tree), /Sign in to your Lumé House account/);
  view.host.unmount();
});
