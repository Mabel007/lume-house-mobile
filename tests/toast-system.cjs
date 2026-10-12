// Slice S2: one reusable, accessible notice channel, and only the actions that are allowed to raise it.
// Source/JSX simulation only: no native renderer, no network and no device acceptance.
const assert = require('node:assert/strict');
const { mock, test } = require('node:test');
const { load, hooks, find, expand } = require('./helpers/source.cjs');

const flush = async () => { for (let pass = 0; pass < 8; pass++) await Promise.resolve(); };
const textOf = element => {
  if (typeof element === 'string') return element;
  if (!element || typeof element !== 'object') return '';
  return [element.props?.children].flat(Infinity).map(textOf).join(' ');
};
// The channel is replaced by a recorder, so a test can see exactly what a screen claimed and in what order.
// The notice is re-created here because it is built inside the simulated module realm, and an assertion must
// compare the words, not two prototypes that never match.
const spy = key => {
  const notices = [];
  const override = { [key]: { useToast: () => ({ notify: notice => notices.push(notice.description === undefined
    ? { variant: notice.variant, title: notice.title } : { variant: notice.variant, title: notice.title, description: notice.description }) }) } };
  return { notices, override };
};
const action = (tree, label) => find(tree, element => element.props?.label === label);
const pressPlace = tree => find(tree, element => element.props?.accessibilityRole === 'button' && element.props?.accessibilityLabel === 'Place order');

const product = { id: 'mug-a', name: 'Mug', category: 'Dining', description: 'A mug', image: '', color: '#FFFFFF',
  price: 900, variants: [{ id: 'variant-a', productId: 'mug-a', price: 900, options: {}, isDefault: true, inventoryPolicy: 'untracked' }] };
const cartItem = { productId: 'mug-a', variantId: 'variant-a', quantity: 2 };
const definite = { status: 'error', items: [cartItem], message: 'This selection is unavailable. Refresh your Bag and catalogue.', canRetry: false };
const uncertain = { status: 'uncertain', items: [cartItem], message: 'Your change may have been saved. Refresh to see your Bag, or retry the saved change safely before making another.', canRetry: true };
const blankProfile = { full_name: '', phone: '', email: '', default_street_address: '', default_area: '', default_city: '' };

test('one banner at a time: a repeat keeps its identity, a new notice replaces it, and each holds for its variant', () => {
  const { ToastController } = load('src/components/Toast.tsx', { react: hooks().react });
  const timers = [];
  const expire = (fire, delay) => { const entry = { fire, delay, cancelled: false }; timers.push(entry); return () => { entry.cancelled = true; }; };
  const controller = new ToastController(expire);
  const published = []; const unsubscribe = controller.subscribe(() => published.push(controller.getSnapshot()));
  assert.equal(controller.getSnapshot(), null, 'nothing is on screen before an action');
  controller.show({ variant: 'success', title: 'Added to your Bag' });
  assert.equal(controller.getSnapshot().key, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 3000, 'a success is held long enough to read and short enough to leave');
  controller.show({ variant: 'success', title: 'Added to your Bag' });
  assert.equal(controller.getSnapshot().key, 1, 'the same notice keeps its identity instead of stacking a second banner');
  assert.equal(timers[0].cancelled, true, 'the older dismissal cannot clear the notice that just restarted its timer');
  assert.equal(timers.length, 2);
  controller.show({ variant: 'error', title: 'Your Bag could not be updated' });
  assert.equal(controller.getSnapshot().key, 2, 'a different notice is a new banner');
  assert.equal(timers[1].cancelled, true, 'a replacement stops the timer of the banner it replaced');
  assert.equal(published.length, 3, 'the screen is told about every publish, including a restarted one');
  controller.hide();
  assert.equal(controller.getSnapshot(), null, 'hiding leaves nothing behind');
  unsubscribe();
});

test('the banner is inside the safe area, out of the touch path, and reads as words rather than as a glyph', () => {
  const host = hooks();
  const { ToastProvider } = load('src/components/Toast.tsx', { react: host.react });
  host.begin();
  let tree = expand(ToastProvider({ children: 'Bag screen' }));
  assert.equal(find(tree, element => element.type === 'Text'), undefined, 'nothing is announced while there is no notice');
  find(tree, element => element.type === 'ContextProvider').props.value.notify(
    { variant: 'warning', title: 'Your Bag change is unconfirmed', description: 'Refresh your Bag to see what the shop has.' });
  host.begin(); tree = expand(ToastProvider({ children: 'Bag screen' }));
  assert.ok(find(tree, element => element.props?.pointerEvents === 'none'), 'the notice never absorbs a tap meant for a control underneath');
  assert.equal(find(tree, element => element.props?.accessibilityRole === 'button' || element.props?.onPress), undefined,
    'a banner carries no affordance of its own');
  const live = find(tree, element => element.props?.accessibilityLiveRegion === 'polite');
  assert.equal(live.type, 'SafeAreaView', 'the announcement is laid out below the status bar, not under it');
  assert.match(textOf(live), /Your Bag change is unconfirmed/, 'the title is what is read out');
  assert.match(textOf(live), /Refresh your Bag to see what the shop has/, 'the optional description carries the recovery');
  const mark = find(tree, element => element.props?.accessibilityElementsHidden === true);
  assert.equal(mark.props.children, '!', 'the variant glyph is decoration only, so TalkBack reads words and not "exclamation"');
});

test('a banner dismisses itself on its variant schedule, and an unmounted provider never leaves one stranded', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const host = hooks();
    const { ToastProvider } = load('src/components/Toast.tsx', { react: host.react });
    host.begin();
    const notify = find(expand(ToastProvider({ children: 'Bag screen' })), element => element.type === 'ContextProvider').props.value.notify;
    const shown = () => { host.begin(); return find(expand(ToastProvider({ children: 'Bag screen' })), element => element.props?.children === 'Item removed'); };
    notify({ variant: 'success', title: 'Item removed' });
    assert.ok(shown(), 'the notice appears at once, without waiting for a timer');
    mock.timers.tick(2999); assert.ok(shown(), 'the shortest hold is three seconds, not a flicker');
    mock.timers.tick(1); assert.equal(shown(), undefined, 'the notice dismisses itself with no customer action');
    notify({ variant: 'success', title: 'Item removed' }); assert.ok(shown());
    host.unmount();
    assert.equal(shown(), undefined, 'a notice cannot outlive the app that raised it');
  } finally {
    mock.timers.reset();
  }
});

test('a screen outside the provider still works, because the channel degrades to silence', () => {
  const { useToast } = load('src/components/Toast.tsx', { react: hooks().react });
  assert.deepEqual(Object.keys(useToast()), ['notify']);
  useToast().notify({ variant: 'success', title: 'Added to your Bag' });
});

test('the Bag notice names the outcome only, and never repeats the shop’s own reason', () => {
  const { bagNotice } = load('src/features/cart/bagNotice.ts');
  for (const status of ['ready', 'loading', 'saving']) {
    assert.equal(bagNotice({ status, items: [], message: null, canRetry: false }), null,
      `${status} is the normal state or real in-flight work, and neither is a result to announce`);
  }
  const failure = bagNotice(definite);
  assert.equal(failure.variant, 'error');
  assert.doesNotMatch(`${failure.title} ${failure.description}`, /unavailable\. Refresh your Bag and catalogue/,
    'the controller message stays with the recovery controls that can act on it');
  assert.doesNotMatch(`${failure.title} ${failure.description}`, /removed|updated your Bag|saved/, 'a rejection is never worded as a change');
  const waiting = bagNotice(uncertain);
  assert.equal(waiting.variant, 'warning', 'uncertainty is a warning, not an error and not a success');
  assert.match(waiting.description, /Refresh/, 'uncertainty always points at the safe recovery');
  assert.doesNotMatch(`${waiting.title} ${waiting.description}`, /token|SQL|relation|change_variant_cart|price_cents/i,
    'no backend wording reaches a banner');
});

test('an Add the shop confirmed is announced once, and one it refused is never announced as success', async () => {
  const host = hooks(); const notices = spy('./Toast');
  let outcome = true;
  const bag = { signedIn: true, state: { status: 'ready', items: [], message: null, canRetry: false },
    current: () => bag.state, refresh: async () => {}, retry: async () => false, dispatch: async () => {
      if (!outcome) return false;
      bag.state = { status: 'ready', items: [{ ...cartItem, quantity: 3 }], message: null, canRetry: false };
      return true;
    } };
  const { ProductCard } = load('src/components/ProductCard.tsx', {
    react: host.react, 'expo-router': { Link: 'Link', router: { navigate: () => {} } },
    './ProductImage': { ProductImage: 'ProductImage' }, './ActionButton': { ActionButton: 'ActionButton' },
    '../features/auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in' }, busy: false }) },
    '../features/cart/BagContext': { useBag: () => bag }, ...notices.override,
  });
  const render = () => { host.begin(); return expand(ProductCard({ product, details: true })); };
  action(render(), 'Add to Bag').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [{ variant: 'success', title: 'Added to your Bag', description: 'Mug. 3 items in your Bag.' }],
    'the banner follows the confirmed answer and carries the count the shop now holds');
  const record = find(render(), element => element.props?.children === 'Added to your Bag');
  assert.equal(record.props.accessibilityLiveRegion, undefined,
    'the record left on the card is visible, not a second announcement of the same words');
  notices.notices.length = 0; outcome = false; bag.state = definite;
  action(render(), 'Add to Bag').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [], 'a refused Add raises no success, and the recovery panel stays the one message');
});

test('Bag quantity and removal announce the shop answer, and an unconfirmed change announces recovery', async () => {
  const host = hooks(); const notices = spy('../../components/Toast');
  let saved = true; let state = { status: 'ready', items: [cartItem], message: null, canRetry: false };
  const bag = { signedIn: true, state, current: () => state, refresh: async () => {}, retry: async () => true, dispatch: async () => saved };
  const Screen = load('src/features/cart/BagScreen.tsx', {
    react: host.react, 'expo-router': { Link: 'Link', useFocusEffect: () => {} },
    '../../components/ActionButton': { ActionButton: 'ActionButton' }, ...notices.override,
    './BagContext': { useBag: () => bag },
    '../auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in' }, busy: false }) },
    '../products/ProductContext': { useProducts: () => ({ state: { status: 'ready', products: [product] }, refresh: () => {} }) },
  }).default;
  const line = () => { host.begin(); bag.state = state;
    return expand(find(expand(Screen()), element => element.type === 'FlatList').props.renderItem({ item: cartItem })); };
  action(line(), '+').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [{ variant: 'success', title: 'Bag updated' }], 'a saved quantity change is announced as an update');
  notices.notices.length = 0;
  action(line(), 'Remove').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [{ variant: 'success', title: 'Item removed' }]);
  notices.notices.length = 0; saved = false; state = definite;
  action(line(), '+').props.onPress(); await flush();
  assert.equal(notices.notices.length, 1, 'this screen’s own Bag message has no live region, so the banner is the announcement');
  assert.equal(notices.notices[0].variant, 'error');
  assert.equal(notices.notices[0].title, 'Your Bag could not be updated');
  notices.notices.length = 0; state = uncertain;
  action(line(), '−').props.onPress(); await flush();
  assert.equal(notices.notices[0].variant, 'warning');
  notices.notices.length = 0; state = { status: 'saving', items: [cartItem], message: null, canRetry: false };
  action(line(), '+').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [], 'work that is merely unfinished is never reported as a result');
});

test('retrying a saved Bag change announces the answer, not the attempt', async () => {
  const host = hooks(); const notices = spy('../../components/Toast');
  let state = uncertain; let confirmed = false;
  const bag = { signedIn: true, state, current: () => state, refresh: async () => {},
    retry: async () => { if (confirmed) state = { status: 'ready', items: [cartItem], message: null, canRetry: false }; return confirmed; },
    dispatch: async () => false };
  const Screen = load('src/features/cart/BagScreen.tsx', {
    react: host.react, 'expo-router': { Link: 'Link', useFocusEffect: () => {} },
    '../../components/ActionButton': { ActionButton: 'ActionButton' }, ...notices.override,
    './BagContext': { useBag: () => bag },
    '../auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in' }, busy: false }) },
    '../products/ProductContext': { useProducts: () => ({ state: { status: 'ready', products: [] }, refresh: () => {} }) },
  }).default;
  const header = () => { host.begin(); bag.state = state;
    return find(expand(Screen()), element => element.type === 'FlatList').props.ListHeaderComponent; };
  action(header(), 'Retry saved change').props.onPress(); await flush();
  assert.equal(notices.notices[0].variant, 'warning', 'a retry that could not be confirmed says so instead of claiming a Bag');
  assert.equal(notices.notices.length, 1, 'one attempt, one notice');
  notices.notices.length = 0; confirmed = true;
  action(header(), 'Retry saved change').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [{ variant: 'success', title: 'Bag updated' }]);
});

test('a saved profile is announced once, by the banner, with the persistent line reserved for problems', async () => {
  const host = hooks(); const notices = spy('../../components/Toast');
  let ok = false; const closed = [];
  const controller = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', saved: blankProfile, draft: blankProfile, errors: {}, message: null }),
    save: async () => ok, edit: () => {}, cancel: () => {}, refresh: async () => {} };
  const { CustomerProfile } = load('src/features/profile/CustomerProfile.tsx', {
    react: { ...host.react, useSyncExternalStore: (subscribe, get) => get() },
    '../../components/ActionButton': { ActionButton: 'ActionButton' }, ...notices.override,
  });
  const render = () => { host.begin(); return expand(CustomerProfile({ controller, editor: 'profile', revealField: () => {},
    onEditorChange: value => closed.push(value) })); };
  action(render(), 'Save profile').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [], 'a save the shop did not confirm raises no success');
  assert.deepEqual(closed, [], 'and the editor stays open so the details are not lost');
  notices.notices.length = 0; ok = true;
  action(render(), 'Save profile').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [{ variant: 'success', title: 'Changes saved' }]);
  assert.deepEqual(closed, [null], 'the confirmed save closes the editor as it always did');
});

test('a confirmed profile save leaves no inline success line, so one fact is announced once', async () => {
  const { ProfileController } = load('src/features/profile/ProfileController.ts');
  const controller = new ProfileController({ load: async () => blankProfile, save: async draft => draft });
  controller.activate(); await controller.refresh();
  controller.edit('full_name', 'Ada');
  assert.equal(await controller.save(['full_name']), true);
  assert.equal(controller.getSnapshot().message, null, 'the banner owns the success announcement');
  assert.equal(controller.getSnapshot().saved.full_name, 'Ada', 'the saved values on screen are the visible record');
});

test('a cancellation request the shop recorded is announced as a request, and a lost one is announced as a problem', async () => {
  const host = hooks(); const notices = spy('../../components/Toast');
  let answer = null;
  const record = { status: 'pending', requested_at: '2026-10-09T08:00:00.000Z', reason: 'Changed my mind', resolved_at: null, resolution: null };
  const Panel = load('src/features/orders/CancellationPanel.tsx', {
    react: host.react, '../../components/ActionButton': { ActionButton: 'ActionButton' },
    '../../lib/supabase/client': { getSupabaseClient: () => ({}) }, ...notices.override,
    './cancellationRepository': { getCancellation: async () => null,
      requestCancellation: async () => { if (answer instanceof Error) throw answer; return answer; } },
  }).CancellationPanel;
  const render = () => { host.begin(); return expand(Panel({ userId: 'customer-a', order: { id: 'order-a', status: 'placed' } })); };
  answer = new Error('The cancellation request could not be confirmed. Reload to review it before retrying.');
  render(); await flush();
  find(render(), element => element.type === 'TextInput').props.onChangeText('Changed my mind');
  action(render(), 'Request cancellation').props.onPress(); await flush();
  assert.deepEqual(notices.notices, [], 'a request the shop never received is not announced as a submission');
  assert.match(textOf(render()), /could not be confirmed/, 'and the persistent recovery line is untouched by this slice');
  notices.notices.length = 0; answer = record;
  action(render(), 'Request cancellation').props.onPress(); await flush();
  const after = render();
  assert.deepEqual(notices.notices, [{ variant: 'success', title: 'Cancellation request submitted' }],
    'the banner arrives with the shop’s answer, not with the press');
  assert.doesNotMatch(notices.notices.map(notice => `${notice.title} ${notice.description ?? ''}`).join(' '), /cancelled|refund/i,
    'no banner words claim the order moved or that money returns');
  assert.match(textOf(after), /Cancellation request:/, 'the record the shop returned still speaks for itself below the banner');
});

test('a placed order is announced once as an order, never as a payment', async () => {
  const host = hooks(); const notices = spy('../../components/Toast');
  const controllers = [];
  class FakeCheckoutController {
    constructor() { this.state = { status: 'idle', message: null, orderId: null, reference: null, emailStatus: null, canRetry: false };
      this.placed = false; controllers.push(this); }
    subscribe = () => () => {};
    getSnapshot = () => this.state;
    activate() {} deactivate() {} recover() {}
    submit() {
      this.state = this.placed ? { status: 'placed', message: null, orderId: 'order-a', reference: 'LH-1', emailStatus: null, canRetry: false }
        : { status: 'error', message: 'The shop could not take this order.', orderId: null, reference: null, emailStatus: null, canRetry: true };
    }
    retry() { this.submit(); }
  }
  const memory = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  const bag = { signedIn: true, state: { status: 'ready', items: [cartItem], message: null, canRetry: false },
    current: () => bag.state, refresh: async () => {}, retry: async () => false, dispatch: async () => false };
  const Screen = load('src/features/checkout/CheckoutScreen.tsx', {
    react: { ...host.react, useCallback: fn => fn },
    'expo-router': { Link: 'Link', useFocusEffect: () => {}, router: { replace: () => {}, back: () => {}, canGoBack: () => true } },
    'expo-crypto': { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    '@react-native-async-storage/async-storage': { default: memory },
    '../../lib/supabase/client': { getSupabaseClient: () => ({}) },
    '../profile/profileRepository': { loadProfile: async () => blankProfile },
    '../orders/placedConfirmation': { rememberPlacedEmail: () => {} },
    '../auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in', user: { id: 'customer-a', email: 'ada@example.invalid' } }, busy: false }) },
    '../cart/BagContext': { useBag: () => bag },
    '../products/ProductContext': { useProducts: () => ({ state: { status: 'ready', products: [product] }, refresh: () => {} }) },
    './CheckoutController': { CheckoutController: FakeCheckoutController }, ...notices.override,
  }).default;
  const render = () => { host.begin(); return expand(Screen({})); };
  for (const label of ['Full name *', 'Phone number *', 'Email *', 'Street address / landmark *', 'Area / community *', 'City / town *', 'Mobile money number *']) {
    const field = find(render(), element => element.type === 'TextInput' && element.props?.accessibilityLabel === label);
    assert.ok(field, `${label} is reachable from checkout`);
    field.props.onChangeText(label === 'Email *' ? 'ada@example.invalid' : label.includes('number') ? '0715000000' : 'Nairobi');
  }
  pressPlace(render()).props.onPress(); await flush();
  assert.deepEqual(notices.notices, [], 'a placement the shop refused raises no success');
  assert.match(textOf(render()), /could not take this order/, 'and its persistent message is still on screen');
  controllers[0].placed = true;
  pressPlace(render()).props.onPress(); await flush();
  const handed = render();
  assert.equal(notices.notices.length, 1, 'one answered placement is announced once, however many renders follow it');
  assert.equal(notices.notices[0].variant, 'success');
  assert.equal(notices.notices[0].title, 'Order placed');
  assert.match(notices.notices[0].description, /Awaiting payment confirmation/, 'the order is confirmed, the payment is not');
  assert.doesNotMatch(notices.notices.map(notice => `${notice.title} ${notice.description ?? ''}`).join(' '), /paid|refunded|emailed|delivered|received/i,
    'no banner claims a payment, an email or a delivery from an order record, and only ever negates a charge');
  assert.equal(handed.type, 'SafeAreaView', 'checkout is still the screen the customer is on while the route changes');
  const handoff = find(handed, element => typeof element.props?.children === 'string' && element.props.children.startsWith('Your order is saved'));
  assert.equal(handoff.props.accessibilityRole, 'alert');
  assert.equal(handoff.props.accessibilityLiveRegion, undefined, 'and it does not announce the same fact the banner just announced');
  render();
  assert.equal(notices.notices.length, 1, 're-rendering the placed state never repeats the notice');
});
