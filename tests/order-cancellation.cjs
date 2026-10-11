// Offline contracts only: parsed records, mocked clients and a mocked shop answer. No cancellation request,
// order status, payment state or stock level is touched by this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks, find, expand } = require('./helpers/source.cjs');

const cancellation = load('src/features/orders/cancellation.ts');
const repository = load('src/features/orders/cancellationRepository.ts');

const orderId = '22222222-2222-4222-8222-222222222222';
const otherOrder = '33333333-3333-4333-8333-333333333333';
const pending = { order_id: orderId, reason: 'Change of plan', requested_at: '2026-10-09T14:05:00', resolved_at: null, status: 'pending', resolution: null };
const accepted = { ...pending, status: 'accepted', resolved_at: '2026-10-10T09:00:00', resolution: 'Order cancelled by Lumé House. Cancellation does not issue a refund.' };
const rejected = { ...pending, status: 'rejected', resolved_at: '2026-10-10T09:00:00', resolution: 'The order was already being prepared.' };

const plain = value => JSON.parse(JSON.stringify(value));
const unreadable = /The cancellation request could not be read/;
const loadFailure = 'Your cancellation request could not be loaded. Check your connection and retry.';
const uncertain = 'The cancellation request could not be confirmed. Reload to review it before retrying.';
const guard = 'Retry with the reason you first sent, or reload to review the request you submitted.';
const refused = 'This cancellation reason cannot be sent. Please shorten it and retry.';
const textOf = element => {
  if (typeof element === 'string') return element;
  if (!element || typeof element !== 'object') return '';
  return [element.props?.children].flat(Infinity).map(textOf).join(' ');
};
const heading = tree => find(tree, element => element.props?.accessibilityRole === 'header' && element.props?.children === 'Cancellation request');
const alert = tree => find(tree, element => element.props?.accessibilityRole === 'alert');
const input = tree => find(tree, element => element.type === 'TextInput');
const button = (tree, label) => find(tree, element => element.props?.accessibilityRole === 'button' && element.props?.accessibilityLabel === label);
const pill = tree => find(tree, element => typeof element.props?.children === 'string' && element.props.children.startsWith('Cancellation request:'));
// The whole record is announced as one item, so a screen reader is not left assembling the branches itself.
const announced = tree => find(tree, element => typeof element.props?.accessibilityLabel === 'string' && element.props.accessibilityLabel.startsWith('Cancellation request '));

test('a stored request is read only when its own status and resolution agree', () => {
  assert.equal(cancellation.parseCancellation(null), null, 'no request is an answer, not a failure');
  assert.deepEqual(plain(cancellation.parseCancellation(pending)), plain(pending));
  assert.deepEqual(plain(cancellation.parseCancellation(accepted)), plain(accepted));
  assert.equal(cancellation.maximumReasonLength, 500, 'the reason cap is the column check the shop wrote');

  for (const field of ['order_id', 'reason', 'requested_at', 'status', 'resolution']) {
    assert.throws(() => cancellation.parseCancellation({ ...pending, [field]: undefined }), unreadable, `a missing ${field} is refused`);
  }
  assert.throws(() => cancellation.parseCancellation({ ...pending, status: 'cancelled' }), unreadable, 'a request status is not an order status');
  assert.throws(() => cancellation.parseCancellation({ ...pending, status: 'approved' }), unreadable);
  assert.throws(() => cancellation.parseCancellation({ ...pending, reason: 'x'.repeat(501) }), unreadable);
  assert.throws(() => cancellation.parseCancellation({ ...pending, requested_at: 'whenever' }), unreadable);
  assert.throws(() => cancellation.parseCancellation({ ...pending, resolution: 7 }), unreadable);
  assert.throws(() => cancellation.parseCancellation({ ...pending, resolved_at: 'whenever' }), unreadable);
  // One decision cannot be half-recorded: a date without a word, or a word without a date, is not shown.
  assert.throws(() => cancellation.parseCancellation({ ...pending, resolved_at: '2026-10-10T09:00:00' }), unreadable, 'a pending request has no resolution time');
  assert.throws(() => cancellation.parseCancellation({ ...pending, resolution: 'Done' }), unreadable, 'a pending request has no resolution');
  assert.throws(() => cancellation.parseCancellation({ ...accepted, resolution: null }), unreadable);
  assert.throws(() => cancellation.parseCancellation({ ...accepted, resolved_at: null }), unreadable);
  assert.throws(() => cancellation.parseCancellation({ ...pending, order_id: '   ' }), unreadable);
  for (const value of [[], 'pending', 7, true]) assert.throws(() => cancellation.parseCancellation(value), unreadable);
});

function fakeClient({ userId = 'customer-a', data = null, error = null } = {}) {
  const calls = [];
  const client = {
    auth: { getUser: async () => (userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: { message: 'expired' } }) },
    rpc: async (name, args) => { calls.push({ name, args }); return { data, error }; },
  };
  return { client, calls };
}
const live = () => true;

test('asking about a request is the customer function, the order id, and nothing else', async () => {
  const backend = fakeClient({ data: pending });
  assert.deepEqual(plain(await repository.getCancellation(backend.client, 'customer-a', orderId, live)), plain(pending));
  assert.deepEqual(plain(backend.calls), [{ name: 'customer_get_cancellation_request', args: { p_order_id: orderId } }]);

  const empty = fakeClient({ data: null });
  assert.equal(await repository.getCancellation(empty.client, 'customer-a', orderId, live), null);
  assert.deepEqual(plain(empty.calls[0].args), { p_order_id: orderId }, 'an absent request is read without a second query');

  const mismatched = fakeClient({ data: { ...pending, order_id: otherOrder } });
  await assert.rejects(repository.getCancellation(mismatched.client, 'customer-a', orderId, live), /could not be loaded/,
    'a request for another order is not this customer’s answer');
});

test('a refusal is given in the app’s own words, and a lost connection is only a retry', async () => {
  const named = {
    AUTH_REQUIRED: 'Please sign in again to review your cancellation request.',
    INVALID_REASON: refused,
    ORDER_UNAVAILABLE: 'This order is not on your account, so its cancellation request is not shown.',
    REQUEST_ALREADY_EXISTS: 'A cancellation request is already recorded for this order. Reload to review it before retrying.',
    CANCELLATION_REQUEST_UNAVAILABLE: 'This order has moved on, so a cancellation request is no longer possible.',
  };
  for (const [token, copy] of Object.entries(named)) {
    const read = fakeClient({ error: { message: token, code: '42501' } });
    await assert.rejects(repository.getCancellation(read.client, 'customer-a', orderId, live),
      error => error.message === copy, `${token} is worded for the customer`);
    const write = fakeClient({ error: { message: `Failing row contains ${token}.`, code: '22023' } });
    await assert.rejects(repository.requestCancellation(write.client, 'customer-a', orderId, 'Change of plan', live),
      error => error.message === copy, `${token} reads the same on the way back from a write`);
  }

  const privateDetail = fakeClient({ error: { message: 'permission denied for table order_cancellation_requests', code: '42501' } });
  await assert.rejects(repository.getCancellation(privateDetail.client, 'customer-a', orderId, live), error => error.message === loadFailure);
  assert.doesNotMatch(loadFailure, /permission|table|order_cancellation_requests/, 'the driver detail is never part of the customer line');

  const lost = fakeClient({ error: { message: 'fetch failed', code: undefined } });
  await assert.rejects(repository.requestCancellation(lost.client, 'customer-a', orderId, 'Change of plan', live),
    error => error.message === uncertain, 'a request that cannot be confirmed is named as unconfirmed, never as absent');
});

test('sending a request is one write of the reason the customer typed', async () => {
  const backend = fakeClient({ data: pending });
  assert.deepEqual(plain(await repository.requestCancellation(backend.client, 'customer-a', orderId, '  Change of plan  ', live)), plain(pending));
  assert.deepEqual(plain(backend.calls), [{ name: 'customer_cancellation_request', args: { p_order_id: orderId, p_reason: 'Change of plan' } }],
    'the same two arguments the website sends, with the reason trimmed the way the column is stored');

  const empty = fakeClient({ data: { ...pending, reason: '' } });
  assert.equal((await repository.requestCancellation(empty.client, 'customer-a', orderId, '   ', live)).reason, '',
    'an optional reason may be empty, and an empty retry still matches the stored record');

  // An answer is confirmation only if it is this order's record with the reason just sent.
  for (const data of [null, { ...pending, reason: 'Something else' }, { ...pending, order_id: otherOrder }]) {
    await assert.rejects(repository.requestCancellation(fakeClient({ data }).client, 'customer-a', orderId, 'Change of plan', live),
      error => error.message === uncertain);
  }
  await assert.rejects(repository.requestCancellation(fakeClient({ data: { ...pending, status: 'maybe' } }).client,
    'customer-a', orderId, 'Change of plan', live), unreadable);

  const tooLong = fakeClient({ data: pending });
  await assert.rejects(repository.requestCancellation(tooLong.client, 'customer-a', orderId, 'x'.repeat(501), live),
    error => error.message === refused, 'an over-long reason is refused before a request is built');
  assert.equal(tooLong.calls.length, 0, 'a refused reason never becomes a write');
});

test('every request read and write re-checks the session owner before the shop is asked', async () => {
  const other = fakeClient({ userId: 'customer-b', data: pending });
  await assert.rejects(repository.getCancellation(other.client, 'customer-a', orderId, live), /Please sign in again to view your orders/);
  assert.equal(other.calls.length, 0, 'a session for someone else never becomes a cancellation query');

  const signedOut = fakeClient({ userId: null, data: pending });
  await assert.rejects(repository.requestCancellation(signedOut.client, 'customer-a', orderId, 'Change of plan', live), /sign in again/);
  assert.equal(signedOut.calls.length, 0);

  const left = fakeClient({ data: pending });
  await assert.rejects(repository.getCancellation(left.client, 'customer-a', orderId, () => false), /sign in again/,
    'a customer who signs out mid-read is not shown a request');
  assert.equal(left.calls.length, 0);
});

function mountPanel({ userId = 'customer-a', status = 'placed', read = async () => null, write = async () => { throw new Error('unreachable'); } } = {}) {
  const host = hooks();
  const view = {
    host, tree: null, userId, order: { id: orderId, status }, calls: { reads: [], writes: [] },
    user: next => { view.userId = next; },
    status: next => { view.order = { ...view.order, status: next }; },
    render: () => { host.begin(); view.tree = expand(Panel({ userId: view.userId, order: view.order })); return view.tree; },
    // An answer resolves outside the render that asked for it, so each pass drains microtasks then re-renders.
    settle: async () => {
      for (let pass = 0; pass < 3; pass++) {
        await new Promise(resolve => setTimeout(resolve, 0));
        host.begin();
        view.tree = expand(Panel({ userId: view.userId, order: view.order }));
      }
      return view.tree;
    },
  };
  const Panel = load('src/features/orders/CancellationPanel.tsx', {
    react: host.react,
    '../../lib/supabase/client': { getSupabaseClient: () => ({}) },
    // The shop is mocked here: this file proves the screen, not a live request.
    './cancellationRepository': {
      getCancellation: async (client, user, id, active) => { view.calls.reads.push({ user, id, active: typeof active }); return read(user, id); },
      requestCancellation: async (client, user, id, reason, active) => { view.calls.writes.push({ user, id, reason, active: typeof active }); return write(reason, view.calls.writes.length); },
    },
  }).CancellationPanel;
  return view;
}
const sendButton = 'Send a cancellation request for this order';

test('a placed order is offered a request, worded as a request and nothing more', async () => {
  const view = mountPanel();
  view.render();
  assert.equal(textOf(heading(view.tree)), 'Cancellation request');
  assert.equal(view.calls.reads.length, 1, 'the stored request is read as soon as the order is on screen');
  assert.deepEqual(plain(view.calls.reads[0]), { user: 'customer-a', id: orderId, active: 'function' });
  assert.equal(find(view.tree, element => element.type === 'ActivityIndicator').props.accessibilityLabel, 'Loading your cancellation request');
  await view.settle();
  assert.equal(view.calls.reads.length, 1, 'one order asks the shop once until it is reloaded');
  const text = textOf(view.tree);
  assert.match(text, /A request is not immediate cancellation\. Lumé House confirmation is required\. Cancellation does not issue a refund\./);
  assert.match(text, /Reason \(optional\)/);
  assert.equal(input(view.tree).props.accessibilityLabel, 'Reason for the cancellation request');
  assert.equal(input(view.tree).props.maxLength, 500);
  assert.match(input(view.tree).props.accessibilityHint, /does not cancel the order/);
  assert.equal(textOf(button(view.tree, sendButton)), 'Request cancellation');
  assert.match(text, /Sending this button records your request with Lumé House\. It does not change the order status, payment state or stock\./);
  assert.doesNotMatch(text, /has been cancelled|Order cancelled|refund issued/i, 'an unsubmitted offer is never worded as a cancelled order');
  view.host.unmount();
});

test('an order the shop has moved on cannot take a new request', async () => {
  for (const status of ['processing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled']) {
    const view = mountPanel({ status });
    view.render();
    await view.settle();
    assert.match(textOf(view.tree), /This order is no longer eligible for a cancellation request\./);
    assert.equal(input(view.tree), undefined, 'no form is shown for an order that cannot use one');
    assert.equal(button(view.tree, sendButton), undefined);
    assert.equal(view.calls.writes.length, 0);
    view.host.unmount();
  }
});

test('a request on file is shown instead of a second form', async () => {
  const view = mountPanel({ read: async () => pending });
  view.render();
  await view.settle();
  const text = textOf(view.tree);
  assert.equal(pill(view.tree).props.children, 'Cancellation request: Pending');
  assert.match(text, /Requested 09 October 2026, 14:05/);
  assert.match(text, /Your reason: Change of plan/);
  assert.match(text, /Lumé House has your request\. Nothing on this screen has cancelled the order or released stock\./);
  assert.equal(input(view.tree), undefined, 'one order holds one request, so no second form is offered');
  assert.doesNotMatch(text, /Recorded|Shop resolution/, 'a pending request is not given a decision it does not have');
  view.host.unmount();

  const decision = mountPanel({ status: 'cancelled', read: async () => accepted });
  decision.render();
  await decision.settle();
  const shown = textOf(decision.tree);
  assert.equal(pill(decision.tree).props.children, 'Cancellation request: Accepted');
  assert.match(shown, /Lumé House has cancelled this order\. Cancellation does not issue a refund\./);
  assert.match(shown, /Shop resolution:\s+Order cancelled by Lumé House\. Cancellation does not issue a refund\./);
  assert.match(shown, /Recorded 10 October 2026, 09:00/);
  assert.doesNotMatch(shown, /refunded|money is returned|payment reversed|stock returned/i, 'no branch of this contract promises money or stock back');
  decision.host.unmount();

  const kept = mountPanel({ read: async () => rejected });
  kept.render();
  await kept.settle();
  assert.equal(pill(kept.tree).props.children, 'Cancellation request: Rejected');
  assert.match(textOf(kept.tree), /Lumé House has kept this order\./);
  assert.match(textOf(kept.tree), /Shop resolution:\s+The order was already being prepared\./);
  assert.equal(announced(kept.tree).props.accessibilityLabel,
    'Cancellation request Rejected. Requested 09 October 2026, 14:05. Your reason: Change of plan. Lumé House has kept this order.');
  kept.host.unmount();
});

test('a request read that fails can be reloaded, and only the request reloads', async () => {
  let asked = 0;
  const view = mountPanel({ read: async () => { asked++; if (asked === 1) throw new Error(loadFailure); return pending; } });
  view.render();
  await view.settle();
  assert.equal(textOf(alert(view.tree)), loadFailure);
  assert.equal(alert(view.tree).props.accessibilityLiveRegion, 'polite');
  assert.equal(input(view.tree), undefined, 'a failed read does not open a form the shop may already hold');
  button(view.tree, 'Reload the cancellation request for this order').props.onPress();
  await view.settle();
  assert.deepEqual(plain(view.calls.reads.map(call => call.id)), [orderId, orderId]);
  assert.equal(pill(view.tree).props.children, 'Cancellation request: Pending');
  assert.equal(alert(view.tree), undefined, 'the failure line goes once the request is read');
  view.host.unmount();
});

test('sending a request records the answer and never restates the order', async () => {
  // The shop answers with the stored record, reason included, so the screen can only show what came back.
  const view = mountPanel({ write: async reason => ({ ...pending, reason }) });
  view.render();
  await view.settle();
  input(view.tree).props.onChangeText('  Wrong size ordered  ');
  view.render();
  button(view.tree, sendButton).props.onPress();
  view.render();
  assert.equal(textOf(button(view.tree, sendButton)), 'Sending your request…');
  assert.equal(button(view.tree, sendButton).props.accessibilityState.busy, true);
  await view.settle();
  assert.deepEqual(plain(view.calls.writes), [{ user: 'customer-a', id: orderId, reason: 'Wrong size ordered', active: 'function' }],
    'the reason is sent trimmed, the way the shop stores it');
  assert.equal(pill(view.tree).props.children, 'Cancellation request: Pending');
  assert.match(textOf(view.tree), /Your reason: Wrong size ordered/);
  assert.equal(view.order.status, 'placed', 'a request leaves the order status exactly as the shop recorded it');
  assert.doesNotMatch(textOf(view.tree), /NLe/, 'the request section shows no money');
  assert.equal(input(view.tree), undefined, 'the form is gone once the request is on file');
  assert.equal(view.calls.writes.length, 1);
  view.host.unmount();
});

test('one tap is one request, however slow the shop is', async () => {
  let release;
  const view = mountPanel({ write: () => new Promise(resolve => { release = resolve; }) });
  view.render();
  await view.settle();
  input(view.tree).props.onChangeText('Change of plan');
  view.render();
  const send = () => button(view.tree, sendButton).props.onPress();
  send();
  send();
  send();
  view.render();
  assert.equal(view.calls.writes.length, 1, 'a slow answer does not open a second request');
  release(pending);
  await view.settle();
  assert.equal(view.calls.writes.length, 1);
  assert.equal(pill(view.tree).props.children, 'Cancellation request: Pending');
  view.host.unmount();
});

test('an unconfirmed request stays retryable only with the reason already sent', async () => {
  let asked = 0;
  const view = mountPanel({ write: async () => { asked++; if (asked === 1) throw new Error(uncertain); return pending; } });
  view.render();
  await view.settle();
  input(view.tree).props.onChangeText('Change of plan');
  view.render();
  button(view.tree, sendButton).props.onPress();
  await view.settle();
  assert.equal(textOf(alert(view.tree)), uncertain);
  assert.equal(view.calls.writes.length, 1, 'a lost answer is never reported as a stored request');
  assert.equal(pill(view.tree), undefined, 'nothing is shown as a request while the answer is unknown');

  input(view.tree).props.onChangeText('A different reason');
  view.render();
  button(view.tree, sendButton).props.onPress();
  view.render();
  assert.equal(textOf(alert(view.tree)), guard);
  assert.equal(view.calls.writes.length, 1, 'a second reason is refused instead of becoming a second request');

  input(view.tree).props.onChangeText('Change of plan');
  view.render();
  button(view.tree, sendButton).props.onPress();
  await view.settle();
  assert.equal(view.calls.writes.length, 2, 'the original reason can be retried: the shop returns the stored request');
  assert.equal(pill(view.tree).props.children, 'Cancellation request: Pending');
  assert.equal(alert(view.tree), undefined);
  view.host.unmount();
});

test('a customer or order change never leaves the previous request on screen', async () => {
  const view = mountPanel({ read: async user => (user === 'customer-a' ? pending : null) });
  view.render();
  await view.settle();
  assert.match(textOf(view.tree), /Your reason: Change of plan/);

  view.user('customer-b');
  view.render();
  assert.doesNotMatch(textOf(view.tree), /Change of plan|Cancellation request: Pending/, "customer B is never shown customer A's request");
  assert.match(textOf(view.tree), /Loading your cancellation request/);
  await view.settle();
  assert.deepEqual(plain(view.calls.reads.map(call => call.user)), ['customer-a', 'customer-b']);
  assert.doesNotMatch(textOf(view.tree), /Change of plan/);

  // The shop can decide while this screen is open, so a moved order re-reads rather than re-uses.
  view.status('processing');
  view.render();
  assert.match(textOf(view.tree), /Loading your cancellation request/);
  await view.settle();
  assert.equal(view.calls.reads.length, 3);
  assert.match(textOf(view.tree), /This order is no longer eligible for a cancellation request\./);
  view.host.unmount();
});

test('the cancellation slice is one customer contract and no order write', () => {
  for (const file of ['src/features/orders/cancellation.ts', 'src/features/orders/cancellationRepository.ts', 'src/features/orders/CancellationPanel.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\.from\(['"]orders['"]\)|\.update\(|\.delete\(|\.insert\(|\.upsert\(/, 'a request is never an order, stock or payment write');
    assert.doesNotMatch(source, /admin_get_cancellation_request|admin_reject_cancellation_request|require_business_admin/, "the shop's own review functions are not a customer path");
    assert.doesNotMatch(source, /refund will|money is returned|payment reversed|stock is released/i, 'no wording promises a refund or a stock movement');
  }
  const repo = fs.readFileSync('src/features/orders/cancellationRepository.ts', 'utf8');
  assert.deepEqual([...repo.matchAll(/'(customer_[a-z_]+)'/g)].map(match => match[1]).sort(),
    ['customer_cancellation_request', 'customer_get_cancellation_request'], 'exactly the two customer functions are callable');
  assert.match(fs.readFileSync('src/features/orders/OrderDetailsScreen.tsx', 'utf8'), /<CancellationPanel userId=\{userId\} order=\{order\} \/>/,
    'the request belongs to the signed-in customer and the order they were shown');
});
