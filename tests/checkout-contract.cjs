// Offline contracts only: every repository and context is mocked. No client, network, order, payment or email.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, find, expand, duplicateKeys, attachRefs, events, pressBack, keyDown, resetEvents } = require('./helpers/source.cjs');

const { deliveryConfig, getDeliveryFee } = load('src/config/fulfilment.ts');
const checkout = load('src/features/checkout/checkout.ts');
const profile = load('src/features/profile/profile.ts');
const variants = load('src/features/products/variants.ts');
const cart = load('src/features/cart/cart.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const draft = overrides => ({ ...checkout.emptyCheckout, ...overrides });
const row = { full_name: 'Aisha Sesay', phone: '+23276521208', default_street_address: 'Landmark', default_area: 'Goderich', default_city: 'Freetown' };

test('delivery fees mirror the trusted zone table and pickup is free', () => {
  assert.deepEqual(plain(deliveryConfig.zones.map(zone => [zone.id, zone.fee])), [['zone-1', 4000], ['zone-2', 5000], ['zone-3', 6000]]);
  assert.equal(deliveryConfig.serviceCity, 'Freetown');
  assert.equal(deliveryConfig.pickupLocation, 'Lumley, Freetown');
  for (const [zone, fee] of [['zone-1', 4000], ['zone-2', 5000], ['zone-3', 6000]]) {
    assert.equal(getDeliveryFee('delivery', 'Freetown', zone), fee, `fee for ${zone}`);
  }
  assert.equal(getDeliveryFee('delivery', '  freetown ', 'zone-2'), 5000, 'the city gate is trimmed and case-insensitive');
  assert.equal(getDeliveryFee('delivery', 'Bo', 'zone-1'), null, 'outside the service city no fee is quoted');
  assert.equal(getDeliveryFee('delivery', 'Freetown', 'zone-9'), null, 'an unknown zone never invents a fee');
  assert.equal(getDeliveryFee('delivery', 'Freetown', ''), null);
  assert.equal(getDeliveryFee('pickup', 'Freetown', ''), 0, 'pickup carries no delivery fee');
  assert.equal(getDeliveryFee('pickup', 'Bo', 'zone-9'), 0);
  const closed = { ...deliveryConfig, zones: deliveryConfig.zones.map(zone => ({ ...zone, active: false })) };
  assert.equal(getDeliveryFee('delivery', 'Freetown', 'zone-1', closed), null);
});

test('saved profile defaults prefill an independent checkout draft', () => {
  const saved = profile.mapProfile(row);
  const start = checkout.checkoutDefaults(saved, 'customer-a@example.invalid');
  assert.equal(start.full_name, 'Aisha Sesay');
  assert.equal(start.contact_phone, '+23276521208');
  assert.equal(start.email, 'customer-a@example.invalid');
  assert.equal(start.street, 'Landmark');
  assert.equal(start.area, 'Goderich');
  assert.equal(start.city, 'Freetown');
  assert.equal(start.fulfilment, 'delivery');
  assert.equal(start.provider, 'orange');
  assert.equal(start.reuse_phone, false);
  start.full_name = 'Edited only here';
  assert.equal(saved.full_name, 'Aisha Sesay', 'the saved profile is never written back');
  const blank = checkout.checkoutDefaults(profile.mapProfile(null), '');
  assert.deepEqual(plain(blank), plain(checkout.emptyCheckout));
});

test('validation mirrors the placement rules without inventing provider checks', () => {
  const missing = checkout.checkoutErrors(draft({}));
  assert.deepEqual(Object.keys(missing).sort(), ['area', 'city', 'contact_phone', 'email', 'full_name', 'payment_phone', 'street', 'zone']);
  assert.equal(missing.zone, 'Choose a supported Freetown delivery zone.');
  assert.equal(missing.contact_phone, 'Enter a Sierra Leone phone number, for example +23276521208.');
  assert.equal(missing.payment_phone, 'Enter a Sierra Leone mobile number, for example +23276521208.');

  const complete = draft({ full_name: 'Aisha Sesay', contact_phone: '076521208', email: 'a@example.invalid',
    street: 'Landmark', area: 'Goderich', city: 'Freetown', zone: 'zone-1', payment_phone: '+232 76 521 208' });
  assert.deepEqual(plain(checkout.checkoutErrors(complete)), {}, 'the same numbers web accepts must be accepted here');
  assert.deepEqual(checkout.checkoutErrors(draft({ ...complete, payment_phone: '12345' })).payment_phone, missing.payment_phone);
  assert.deepEqual(checkout.checkoutErrors(draft({ ...complete, email: 'not-an-email' })).email, 'Enter a valid email address.');
  assert.deepEqual(checkout.checkoutErrors(draft({ ...complete, city: 'Bo' })).city, undefined, 'a non-Freetown city is gated by the fee, not by a required-field error');
  assert.equal(checkout.deliveryFee(draft({ ...complete, city: 'Bo' })), null);
  assert.equal(checkout.deliveryNotice(draft({ ...complete, city: 'Bo' })), 'Delivery is currently limited to Freetown.');
  assert.equal(checkout.deliveryNotice(complete), null);
  assert.equal(checkout.deliveryNotice(draft({ ...complete, city: '' })), null, 'an empty city is a required-field error, not a service-area notice');

  const collected = checkout.checkoutErrors(draft({ ...complete, fulfilment: 'pickup', street: '', area: '', city: '', zone: '' }));
  assert.deepEqual(Object.keys(collected), [], 'pickup asks for no delivery address at all');
  assert.equal(checkout.checkoutErrors(draft({ ...complete, full_name: 'x'.repeat(201) })).full_name, 'Please keep this field within 200 characters.');
  assert.equal(checkout.checkoutErrors(draft({ ...complete, instructions: 'x'.repeat(501) })).instructions, 'Please keep delivery instructions within 500 characters.');
  assert.deepEqual(plain(checkout.checkoutErrors(draft({ ...complete, instructions: 'x'.repeat(500) }))), {});
});

test('a field only reports once the customer has visited it', () => {
  const missing = checkout.checkoutErrors(draft({}));
  assert.deepEqual(plain(checkout.shownErrors(missing, {})), {}, 'an untouched draft shows no error at all');
  assert.deepEqual(plain(checkout.shownErrors(missing, { full_name: true })), { full_name: missing.full_name });
  assert.deepEqual(plain(checkout.shownErrors(missing, { full_name: true, contact_phone: true })),
    { full_name: missing.full_name, contact_phone: missing.contact_phone });
  assert.deepEqual(plain(checkout.shownErrors({}, { full_name: true })), {}, 'a valid field has nothing to report');
  assert.deepEqual(plain(checkout.shownErrors(missing, { full_name: false })), {}, 'visiting is remembered as a boolean, not as a string');
});

test('the reuse switch makes the contact number the payment number', () => {
  const base = draft({ contact_phone: '+23276521208', payment_phone: '070000001', reuse_phone: false });
  assert.equal(checkout.paymentPhone(base), '070000001');
  assert.equal(checkout.checkoutErrors(base).payment_phone, undefined, '070000001 normalizes to a valid national number');
  const invalid = draft({ ...base, payment_phone: '12345' });
  assert.match(checkout.checkoutErrors(invalid).payment_phone, /mobile number/);
  const reused = draft({ ...invalid, reuse_phone: true });
  assert.equal(checkout.paymentPhone(reused), '+23276521208');
  assert.equal(checkout.checkoutErrors(reused).payment_phone, undefined,
    'a valid mirrored number clears the error instead of repeating the web stale-error defect');
  const brokenContact = draft({ ...reused, contact_phone: '12345' });
  assert.match(checkout.checkoutErrors(brokenContact).payment_phone, /mobile number/, 'a broken contact number surfaces through reuse');
});

test('totals stay an estimate and fail closed until every line prices', () => {
  const priced = [{ available: true, lineTotal: 45000 }, { available: true, lineTotal: 190000 }];
  assert.deepEqual(plain(checkout.estimatedTotals(priced, 4000)), { subtotal: 235000, fee: 4000, total: 239000, complete: true });
  assert.deepEqual(plain(checkout.estimatedTotals(priced, null)), { subtotal: 235000, fee: null, total: null, complete: true },
    'the Bag subtotal is shown but no total is claimed without a zone');
  assert.deepEqual(plain(checkout.estimatedTotals(priced, 0)), { subtotal: 235000, fee: 0, total: 235000, complete: true });
  assert.deepEqual(plain(checkout.estimatedTotals([{ available: false, lineTotal: null }], 4000)),
    { subtotal: null, fee: 4000, total: null, complete: false });
  assert.deepEqual(plain(checkout.estimatedTotals([], 0)), { subtotal: null, fee: 0, total: null, complete: false }, 'an empty Bag is never totalled');
});

test('estimate wording only claims what the client can actually resolve', () => {
  const priced = [{ available: true, lineTotal: 12000 }];
  assert.deepEqual(plain(checkout.estimateLabels(draft({}), checkout.estimatedTotals(priced, null))),
    { subtotal: 'NLe 120', fee: 'Choose at checkout', total: 'Delivery details needed' });
  assert.deepEqual(plain(checkout.estimateLabels(draft({}), checkout.estimatedTotals(priced, 5000))),
    { subtotal: 'NLe 120', fee: 'NLe 50', total: 'NLe 170' });
  assert.deepEqual(plain(checkout.estimateLabels(draft({ fulfilment: 'pickup' }), checkout.estimatedTotals(priced, 0))),
    { subtotal: 'NLe 120', fee: 'Free with pickup', total: 'NLe 120' }, 'pickup is free because the trusted RPC sets that fee to zero');
  assert.deepEqual(plain(checkout.estimateLabels(draft({}), checkout.estimatedTotals([{ available: false, lineTotal: null }], 4000))),
    { subtotal: 'Prices unavailable yet', fee: 'NLe 40', total: 'Prices unavailable yet' }, 'an unpriced Bag is never totalled around a zone fee');
  assert.deepEqual(plain(checkout.estimateLabels(draft({ fulfilment: 'pickup' }), checkout.estimatedTotals([{ available: false, lineTotal: null }], 0))),
    { subtotal: 'Prices unavailable yet', fee: 'Free with pickup', total: 'Prices unavailable yet' });
  assert.deepEqual(plain(checkout.estimateLabels(draft({}), checkout.estimatedTotals([], null))),
    { subtotal: 'Prices unavailable yet', fee: 'Choose at checkout', total: 'Prices unavailable yet' }, 'an empty Bag shows no money');
});

test('the placement payload normalizes phones and trims text without carrying client authority', () => {
  const payload = checkout.checkoutPayload(draft({ full_name: '  Aisha Sesay  ', contact_phone: '00232 76 521 208',
    email: ' a@example.invalid ', street: ' Landmark ', area: ' Goderich ', city: ' freetown ', zone: 'zone-2',
    instructions: ' Call on arrival ', provider: 'afri', payment_phone: '076521208', reuse_phone: false }));
  assert.deepEqual(plain(payload), { full_name: 'Aisha Sesay', email: 'a@example.invalid', contact_phone: '+23276521208',
    payment_phone: '+23276521208', provider: 'afri', fulfilment: 'delivery', zone_id: 'zone-2', street: 'Landmark',
    area: 'Goderich', city: 'freetown', instructions: 'Call on arrival' });
  assert.equal(Object.hasOwn(payload, 'total'), false, 'no total, fee or status is ever submitted');
  assert.equal(Object.hasOwn(payload, 'status'), false);
});

// The controller only ever sees this client, so a screen test can read exactly what left the draft.
const placedRow = { id: '11111111-1111-4111-8111-111111111111', reference: 'LH-0123456789ABCDEF', total: 16000,
  currency: 'NLE', status: 'placed', payment_status: 'awaiting_payment' };
const queued = { data: { order: placedRow, email_status: 'queued' }, error: null };
function fakeBackend({ responses = [], read = { data: null, error: null } } = {}) {
  const calls = { invokes: [], reads: [] };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'customer-a' }, access_token: 'synthetic-token' } }, error: null }) },
    functions: { invoke: async (name, options) => { calls.invokes.push({ name, options }); const next = responses.shift(); return next === undefined ? queued : next; } },
    from: () => {
      const chain = { select: () => chain, eq: (column, value) => { calls.reads.push({ column, value }); return chain; },
        maybeSingle: () => chain, setHeader: () => Promise.resolve(read) };
      return chain;
    },
  };
  return { client, calls };
}
function memoryStore(initial = {}) {
  const values = { ...initial };
  return { values, api: { getItem: async key => (key in values ? values[key] : null),
    setItem: async (key, value) => { values[key] = value; }, removeItem: async key => { delete values[key]; } } };
}
let issued = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++issued).padStart(12, '0')}`;

function mountScreen({ auth, bag, catalogue, profileLoad = async () => profile.mapProfile(null), backend = fakeBackend(),
  store = memoryStore(), newId = nextId }) {
  const host = hooks();
  const view = {
    host, tree: null, backs: [], routes: [], calls: [], store: store.values, backend,
    render: () => { host.begin(); view.tree = expand(Screen({})); return view.tree; },
    // A state change from an effect only shows up on the next render, so settle re-renders after each microtask drain.
    settle: async () => {
      for (let pass = 0; pass < 3; pass++) {
        await new Promise(resolve => setTimeout(resolve, 0));
        host.begin();
        view.tree = expand(Screen({}));
      }
      return view.tree;
    },
  };
  const Screen = load('src/features/checkout/CheckoutScreen.tsx', {
    react: { ...host.react, useCallback: fn => fn },
    // Both navigation forms are recorded so a test can prove placement hands off exactly once.
    'expo-router': { Link: 'Link', useFocusEffect: () => {}, router: { back: () => view.backs.push('back'),
      replace: route => view.routes.push(route), navigate: route => view.routes.push(route) } },
    'expo-crypto': { randomUUID: newId },
    // A default-imported module arrives here unwrapped: the loader's interop adds the `default` key.
    '@react-native-async-storage/async-storage': store.api,
    '../../lib/supabase/client': { getSupabaseClient: () => backend.client },
    '../profile/profileRepository': { loadProfile: async (loaded, id, active) => { view.calls.push({ loaded, id, active: typeof active }); return profileLoad(id, active); } },
    '../auth/AuthContext': { useAuth: auth },
    '../cart/BagContext': { useBag: bag },
    '../products/ProductContext': { useProducts: catalogue },
  }).default;
  return view;
}
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
const variantRow = { id: 'actual-variant-a', product_id: 'product-a', options: {}, is_default: true,
  price_cents: 12000, currency: 'NLE', active: true, inventory_policy: 'untracked' };
const readyProducts = [{ id: 'product-a', name: 'Vase', price: 12000, variants: variants.parseVariants([variantRow]) }];
const readyAuth = () => ({ state: { status: 'signed-in', user: { id: 'customer-a', email: 'customer-a@example.invalid' } }, busy: false });
const readyBag = (items) => () => ({ signedIn: true, state: { status: 'ready', items, message: null, canRetry: false }, refresh: async () => {}, retry: async () => false, dispatch: async () => false });
const readyCatalogue = () => ({ state: { status: 'ready', products: readyProducts }, refresh: () => {} });
const oneItem = [{ productId: 'product-a', variantId: 'actual-variant-a', quantity: 1 }];
const inputLabeled = (tree, label) => find(tree, element => element.type === 'TextInput' && element.props?.accessibilityLabel === label);
const inputLabels = tree => collect(tree, element => element.type === 'TextInput').map(element => element.props.accessibilityLabel);
const editors = ['Full name *', 'Phone number *', 'Email *'];
const paymentEditor = ['Mobile money number *'];
const deliveryEditors = [...editors, 'Street address / landmark *', 'Area / community *', 'City / town *', 'Delivery instructions (optional)'];
const summaryRow = (tree, label) => find(tree, element => element.props?.accessible === true && String(element.props?.accessibilityLabel ?? '').startsWith(`${label}.`));
const radio = (tree, label) => find(tree, element => element.props?.accessibilityRole === 'radio' && element.props?.accessibilityLabel === label);
const button = (tree, label) => find(tree, element => element.props?.accessibilityRole === 'button' && element.props?.accessibilityLabel === label);
const placeButton = tree => button(tree, 'Place order');
const statusAlert = tree => find(tree, element => element.props?.accessibilityRole === 'alert' && element.props?.accessible === true);

test('the checkout foundation resolves session, Bag and catalogue state before an order is placed', () => {
  const signedOut = mountScreen({ auth: () => ({ state: { status: 'signed-out' }, busy: false }),
    bag: () => ({ signedIn: false, state: { status: 'ready', items: [], message: null, canRetry: false }, refresh: async () => {}, retry: async () => false, dispatch: async () => false }),
    catalogue: () => ({ state: { status: 'ready', products: [] }, refresh: () => {} }) });
  let tree = signedOut.render();
  assert.equal(textOf(find(tree, element => element.props?.accessibilityRole === 'header')), 'Checkout.', 'the screen announces its own title');
  assert.match(textOf(tree), /Sign in to check out/);

  const empty = mountScreen({ auth: () => ({ state: { status: 'signed-in', user: { id: 'customer-a' } }, busy: false }),
    bag: () => ({ signedIn: true, state: { status: 'ready', items: [], message: null, canRetry: false }, refresh: async () => {}, retry: async () => false, dispatch: async () => false }),
    catalogue: () => ({ state: { status: 'ready', products: readyProducts }, refresh: () => {} }) });
  tree = empty.render();
  assert.match(textOf(tree), /Your Bag is empty/);
  assert.doesNotMatch(textOf(tree), /selections in your Bag/);

  const loaded = mountScreen({ auth: () => ({ state: { status: 'signed-in', user: { id: 'customer-a' } }, busy: false }),
    bag: () => ({ signedIn: true, state: { status: 'ready', items: [{ productId: 'product-a', variantId: 'actual-variant-a', quantity: 2 }], message: null, canRetry: false }, refresh: async () => {}, retry: async () => false, dispatch: async () => false }),
    catalogue: () => ({ state: { status: 'ready', products: readyProducts }, refresh: () => {} }) });
  tree = loaded.render();
  assert.match(textOf(tree), /1 selection\s+in your Bag/);
  assert.match(textOf(tree), /Payment awaits confirmation\. Placing an order saves your order and requests a confirmation email/);
  assert.equal(placeButton(tree).props.disabled, true, 'an incomplete draft cannot place an order');
  assert.equal(cart.cartLine({ productId: 'product-a', variantId: 'actual-variant-a', quantity: 2 }, readyProducts).lineTotal, 24000);
  signedOut.host.unmount(); empty.host.unmount(); loaded.host.unmount();
});

test('checkout edits apply here only: contact, delivery and money editors beside one honest placement control', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue });
  view.render();
  await view.settle();
  assert.deepEqual(inputLabels(view.tree), [...deliveryEditors, ...paymentEditor], 'delivery is the default fulfilment');
  assert.equal(view.calls.length, 1, 'the saved profile is read once per signed-in customer');
  assert.equal(view.calls[0].id, 'customer-a');
  assert.equal(view.calls[0].active, 'function', 'the repository is given an ownership guard');
  assert.ok(collect(view.tree, element => element.type === 'TextInput').every(input => input.props.accessibilityLabel.length > 0), 'every editor is labelled for screen readers');
  assert.equal(inputLabeled(view.tree, 'Email *').props.keyboardType, 'email-address');
  assert.equal(inputLabeled(view.tree, 'Phone number *').props.keyboardType, 'phone-pad');
  assert.equal(inputLabeled(view.tree, 'Mobile money number *').props.keyboardType, 'phone-pad');
  assert.equal(inputLabeled(view.tree, 'Delivery instructions (optional)').props.multiline, true);
  assert.equal(inputLabeled(view.tree, 'Delivery instructions (optional)').props.maxLength, 500);
  assert.equal(inputLabeled(view.tree, 'Full name *').props.maxLength, 200);
  const text = textOf(view.tree);
  assert.match(text, /Contact information/);
  assert.match(text, /Delivery or pickup/);
  assert.match(text, /Mobile money/);
  assert.ok(placeButton(view.tree), 'placement is offered on this screen now');
  assert.doesNotMatch(text, /Pay now|Payment successful|payment confirmed|Order paid|Email sent/i, 'placement never claims money it did not take or an email it did not prove');
  assert.deepEqual(duplicateKeys(view.tree), []);
  view.host.unmount();
});

test('saved profile defaults prefill the draft once and are never written back', async () => {
  const saved = profile.mapProfile(row);
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, profileLoad: async () => saved });
  view.render();
  await view.settle();
  assert.equal(inputLabeled(view.tree, 'Full name *').props.value, 'Aisha Sesay');
  assert.equal(inputLabeled(view.tree, 'Phone number *').props.value, '+23276521208');
  assert.equal(inputLabeled(view.tree, 'Email *').props.value, 'customer-a@example.invalid');
  assert.equal(inputLabeled(view.tree, 'Street address / landmark *').props.value, 'Landmark');
  assert.equal(inputLabeled(view.tree, 'Area / community *').props.value, 'Goderich');
  assert.equal(inputLabeled(view.tree, 'City / town *').props.value, 'Freetown');
  assert.equal(inputLabeled(view.tree, 'Delivery instructions (optional)').props.value, '', 'optional free text is not filled from the profile');
  inputLabeled(view.tree, 'Full name *').props.onChangeText('Aisha M. Sesay');
  await view.settle();
  assert.equal(inputLabeled(view.tree, 'Full name *').props.value, 'Aisha M. Sesay');
  assert.equal(saved.full_name, 'Aisha Sesay', 'the saved profile is never mutated by a checkout edit');
  view.host.unmount();
});

test('a late profile load cannot overwrite a typed checkout edit', async () => {
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, profileLoad: () => pending });
  view.render();
  await view.settle();
  assert.equal(inputLabeled(view.tree, 'Full name *').props.value, '', 'nothing is prefilled before the profile arrives');
  inputLabeled(view.tree, 'Full name *').props.onChangeText('Typed while loading');
  view.render();
  resolve(profile.mapProfile(row));
  await view.settle();
  assert.equal(inputLabeled(view.tree, 'Full name *').props.value, 'Typed while loading', 'an edit always beats a late default');
  assert.equal(inputLabeled(view.tree, 'Street address / landmark *').props.value, '', 'once the customer is typing, nothing else is inserted under them either');
  assert.equal(view.calls.length, 1, 'the profile is still read exactly once');
  view.host.unmount();
});

test('pickup hides the delivery editors and delivery zones state their provisional fee', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue });
  view.render();
  await view.settle();
  const zones = collect(view.tree, element => element.props?.accessibilityRole === 'radio' && String(element.props?.accessibilityLabel).includes('Delivery NLe'));
  assert.deepEqual(zones.map(element => element.props.accessibilityLabel), [
    'Goderich to Lumley. Delivery NLe 40.',
    'Lumley to Congo Cross, including Aberdeen. Delivery NLe 50.',
    'Congo Cross to Central Freetown. Delivery NLe 60.',
  ], 'screen readers hear the provisional fee with the coverage it belongs to');
  assert.match(textOf(view.tree), /provisional/i, 'the fee copy never claims authority');
  zones[1].props.onPress();
  await view.settle();
  const chosen = collect(view.tree, element => element.props?.accessibilityRole === 'radio' && element.props?.accessibilityState?.checked === true);
  assert.equal(chosen.length, 3, 'one fulfilment, one zone and one provider are checked');
  assert.equal(chosen[1].props.accessibilityLabel, 'Lumley to Congo Cross, including Aberdeen. Delivery NLe 50.');
  const pickup = find(view.tree, element => element.props?.accessibilityRole === 'radio' && element.props?.accessibilityLabel === 'Pickup');
  pickup.props.onPress();
  await view.settle();
  assert.deepEqual(inputLabels(view.tree), [...editors, ...paymentEditor], 'pickup asks for no delivery address at all');
  assert.match(textOf(view.tree), /No delivery fee/);
  view.host.unmount();
});

const fieldAlerts = tree => collect(tree, element => element.props?.accessibilityRole === 'alert')
  .map(textOf).filter(text => !text.startsWith('Payment awaits confirmation'));

test('an untouched form stays quiet and a field reports only once the customer has left it', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue });
  view.render();
  await view.settle();
  assert.deepEqual(fieldAlerts(view.tree), [], 'nobody has filled this in yet, so nothing is red');
  assert.equal(inputLabeled(view.tree, 'Full name *').props.accessibilityHint, 'Required for your order.', 'the hint is help, not a complaint');
  assert.equal(inputLabeled(view.tree, 'Email *').props.value, 'customer-a@example.invalid', 'the account email is a starting point, not an error');
  inputLabeled(view.tree, 'Full name *').props.onBlur();
  await view.settle();
  assert.equal(inputLabeled(view.tree, 'Full name *').props.accessibilityHint, 'Enter your full name.', 'the hint carries the live error to the field');
  assert.deepEqual(fieldAlerts(view.tree), ['Enter your full name.'], 'only the field the customer visited reports');
  assert.equal(inputLabeled(view.tree, 'City / town *').props.accessibilityHint, 'Delivery is currently limited to Freetown.',
    'an unvisited field keeps its help text');
  inputLabeled(view.tree, 'City / town *').props.onChangeText('Bo');
  inputLabeled(view.tree, 'City / town *').props.onBlur();
  await view.settle();
  assert.equal(inputLabeled(view.tree, 'City / town *').props.accessibilityHint, 'Delivery is currently limited to Freetown.');
  assert.ok(fieldAlerts(view.tree).includes('Delivery is currently limited to Freetown.'));
  inputLabeled(view.tree, 'City / town *').props.onChangeText('Freetown');
  zones(view).props.onPress();
  await view.settle();
  assert.ok(!fieldAlerts(view.tree).includes('Choose a supported Freetown delivery zone.'), 'choosing a zone settles the zone question');
  assert.ok(!fieldAlerts(view.tree).includes('Delivery is currently limited to Freetown.'), 'leaving the service area re-clears the notice');
  view.host.unmount();
});
function zones(view) {
  return find(view.tree, element => element.props?.accessibilityRole === 'radio' && String(element.props?.accessibilityLabel).startsWith('Goderich to Lumley.'));
}

test('Android back hides the keyboard first, then confirms before discarding checkout edits', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue });
  view.render();
  await view.settle();
  resetEvents();
  assert.equal(pressBack(), false, 'an untouched draft leaves checkout without a prompt');
  inputLabeled(view.tree, 'Full name *').props.onChangeText('Changed but unsaved');
  await view.settle();
  keyDown('keyboardDidShow', { endCoordinates: { height: 620 } });
  view.render();
  assert.equal(pressBack(), true, 'the first back is spent on the keyboard');
  assert.equal(events.dismissed, 1);
  assert.equal(events.alerts.length, 0, 'a keyboard dismissal is never treated as leaving checkout');
  keyDown('keyboardDidHide', {});
  view.render();
  assert.equal(pressBack(), true);
  assert.equal(events.alerts.length, 1);
  assert.equal(events.alerts[0][0], 'Leave checkout?');
  const buttons = events.alerts[0][2];
  assert.equal(buttons.length, 2);
  assert.deepEqual(view.backs, [], 'the prompt alone does not leave');
  buttons[1].onPress();
  assert.deepEqual(view.backs, ['back']);
  assert.equal(pressBack(), false, 'a discarded draft does not ask twice');
  view.host.unmount();
});

test('checkout moves the view only when the customer asks it to', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue });
  view.render();
  await view.settle();
  resetEvents();
  const nodes = attachRefs(view.tree);
  const scroller = nodes.find(node => Object.hasOwn(node.props, 'scrollEventThrottle'));
  const deliveryGroup = nodes.find(node => Object.hasOwn(node.props, 'onLayout') && node !== scroller);
  const phone = nodes.find(node => node.props?.accessibilityLabel === 'Phone number *');
  const asked = [];
  scroller.scrollTo = options => asked.push(options);
  for (const node of [deliveryGroup, phone]) node.measureLayout = (anchor, success) => success(0, 1900, 800, 60);
  scroller.props.onLayout({ nativeEvent: { layout: { height: 1600 } } });
  assert.equal(asked.length, 0, 'measuring the viewport never moves the view');
  deliveryGroup.props.onLayout();
  assert.equal(asked.length, 0, 'arriving at checkout never scrolls to the delivery editors');
  radio(view.tree, 'Pickup').props.onPress();
  await view.settle();
  radio(view.tree, 'Delivery').props.onPress();
  await view.settle();
  deliveryGroup.props.onLayout();
  assert.equal(asked.length, 1, 'choosing Delivery opens the editors that just appeared');
  deliveryGroup.props.onLayout();
  assert.equal(asked.length, 1, 'a later re-layout of the same editors does not move the view again');
  phone.props.onFocus();
  assert.ok(asked.length > 1, 'a focused field is brought into the visible band');
  keyDown('keyboardDidShow', { endCoordinates: { height: 620 } });
  view.render();
  const whileTyping = asked.length;
  keyDown('keyboardDidHide', {});
  view.render();
  scroller.props.onContentSizeChange();
  assert.equal(asked.length, whileTyping, 'a finished field is not chased when unrelated content changes');
  view.host.unmount();
});

test('the checkout summary prices the Bag and withholds anything the server has not confirmed', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag([{ productId: 'product-a', variantId: 'actual-variant-a', quantity: 2 }]),
    catalogue: readyCatalogue, profileLoad: async () => profile.mapProfile(row) });
  view.render();
  await view.settle();
  assert.equal(summaryRow(view.tree, 'Vase, quantity 2').props.accessibilityLabel, 'Vase, quantity 2. NLe 240', 'the line uses the variant price, not the parent price');
  assert.equal(summaryRow(view.tree, 'Bag subtotal').props.accessibilityLabel, 'Bag subtotal. NLe 240');
  assert.equal(summaryRow(view.tree, 'Delivery').props.accessibilityLabel, 'Delivery. Choose at checkout');
  const total = summaryRow(view.tree, 'Estimated total');
  assert.equal(total.props.accessibilityLabel, 'Estimated total. Delivery details needed');
  assert.equal(total.props.accessibilityLiveRegion, 'polite', 'a recalculation is announced without stealing focus');
  zones(view).props.onPress();
  await view.settle();
  assert.equal(summaryRow(view.tree, 'Delivery').props.accessibilityLabel, 'Delivery. NLe 40');
  assert.equal(summaryRow(view.tree, 'Estimated total').props.accessibilityLabel, 'Estimated total. NLe 280');
  radio(view.tree, 'Pickup').props.onPress();
  await view.settle();
  assert.equal(summaryRow(view.tree, 'Pickup').props.accessibilityLabel, 'Pickup. Free with pickup');
  assert.equal(summaryRow(view.tree, 'Estimated total').props.accessibilityLabel, 'Estimated total. NLe 240');
  assert.match(textOf(view.tree), /totals are confirmed by the shop when the order is placed/i);
  view.host.unmount();
});

test('an unavailable selection keeps the estimate honest instead of totalling around it', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag([{ productId: 'product-a', variantId: 'gone-variant', quantity: 1 }]),
    catalogue: readyCatalogue, profileLoad: async () => profile.mapProfile(row) });
  view.render();
  await view.settle();
  assert.match(textOf(view.tree), /Update your Bag before continuing/);
  assert.equal(find(view.tree, element => String(element.props?.accessibilityLabel ?? '').startsWith('Vase, quantity')).props.accessibilityLabel,
    'Vase, quantity 1. No longer available');
  assert.equal(summaryRow(view.tree, 'Bag subtotal').props.accessibilityLabel, 'Bag subtotal. Prices unavailable yet');
  assert.equal(summaryRow(view.tree, 'Estimated total').props.accessibilityLabel, 'Estimated total. Prices unavailable yet');
  view.host.unmount();
});

test('mobile money is collected as settlement detail only, with reuse clearing its own error', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, profileLoad: async () => profile.mapProfile(row) });
  view.render();
  await view.settle();
  const providers = collect(view.tree, element => element.props?.accessibilityRole === 'radio' && ['Orange Money', 'Afrimoney'].includes(String(element.props?.accessibilityLabel)));
  assert.deepEqual(providers.map(element => element.props.accessibilityLabel), ['Orange Money', 'Afrimoney']);
  assert.equal(providers[0].props.accessibilityState.checked, true, 'the web default provider is also the mobile default');
  assert.match(textOf(view.tree), /No payment is collected here/i, 'no provider is presented as operational');
  inputLabeled(view.tree, 'Mobile money number *').props.onChangeText('12345');
  inputLabeled(view.tree, 'Mobile money number *').props.onBlur();
  await view.settle();
  assert.match(inputLabeled(view.tree, 'Mobile money number *').props.accessibilityHint, /Enter a Sierra Leone mobile number/);
  const reuse = find(view.tree, element => element.props?.accessibilityRole === 'checkbox');
  assert.equal(reuse.props.accessibilityLabel, 'Use my contact phone number');
  reuse.props.onPress();
  await view.settle();
  const mirrored = inputLabeled(view.tree, 'Mobile money number *');
  assert.equal(mirrored.props.editable, false, 'a mirrored number is not typed over');
  assert.equal(mirrored.props.value, '+23276521208');
  assert.equal(mirrored.props.accessibilityHint, 'Number format only; this does not verify registration with the selected provider.',
    'the web stale payment error is not reproduced when the value changes through reuse');
  assert.equal(textOf(view.tree).includes('Enter a Sierra Leone mobile number'), false);
  find(view.tree, element => element.props?.accessibilityRole === 'checkbox').props.onPress();
  await view.settle();
  assert.equal(inputLabeled(view.tree, 'Mobile money number *').props.value, '12345', 'unchecking restores the independently entered number');
  assert.deepEqual(duplicateKeys(view.tree), []);
  view.host.unmount();
});

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const requestIdFor = 'lume:checkout-request:customer-a';
const refusal = (status, error) => ({ data: null, error: { context: { status, json: async () => (error ? { error } : {}) } } });

// The saved profile prefills everything but the settlement number and the zone, so this is the whole gap
// between arriving at checkout and being allowed to place.
async function readyToPlace(view) {
  inputLabeled(view.tree, 'Mobile money number *').props.onChangeText('+23276521208');
  await view.settle();
  zones(view).props.onPress();
  await view.settle();
}

test('a complete draft is the only thing that enables placement, and pressing it reveals what is missing', async () => {
  const backend = fakeBackend();
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, backend, profileLoad: async () => profile.mapProfile(row) });
  view.render();
  await view.settle();
  assert.equal(placeButton(view.tree).props.disabled, true, 'no zone means no fee, so no order can be placed');
  placeButton(view.tree).props.onPress();
  await view.settle();
  assert.equal(backend.calls.invokes.length, 0, 'a draft the trusted rules reject never reaches the network');
  assert.deepEqual(fieldAlerts(view.tree).sort(), [
    'Choose a supported Freetown delivery zone.',
    'Enter a Sierra Leone mobile number, for example +23276521208.',
    'Please complete the highlighted checkout details first.',
  ], 'pressing Place order makes every remaining problem visible instead of failing silently');
  await readyToPlace(view);
  assert.equal(placeButton(view.tree).props.disabled, false);
  assert.equal(placeButton(view.tree).props.accessibilityState.disabled, false, 'a screen reader hears the button as enabled too');
  view.host.unmount();
});

test('placing an order calls the shared order service with no client money and shows only what came back', async () => {
  const backend = fakeBackend();
  let refreshes = 0;
  const view = mountScreen({ auth: readyAuth, catalogue: readyCatalogue, backend, profileLoad: async () => profile.mapProfile(row),
    bag: () => ({ signedIn: true, state: { status: 'ready', items: oneItem, message: null, canRetry: false },
      refresh: async () => { refreshes++; }, retry: async () => false, dispatch: async () => false }) });
  view.render();
  await view.settle();
  await readyToPlace(view);
  placeButton(view.tree).props.onPress();
  await view.settle();
  assert.equal(backend.calls.invokes.length, 1);
  assert.equal(backend.calls.invokes[0].name, 'place-order', 'mobile places through the same function the web uses');
  assert.deepEqual(plain(Object.keys(backend.calls.invokes[0].options.body).sort()), ['cart_version', 'checkout', 'expected_cart', 'request_id']);
  assert.equal(backend.calls.invokes[0].options.body.cart_version, 2);
  const sent = backend.calls.invokes[0].options.body.checkout;
  assert.deepEqual(plain(Object.keys(sent).sort()),
    ['area', 'city', 'contact_phone', 'email', 'fulfilment', 'full_name', 'instructions', 'payment_phone', 'provider', 'street', 'zone_id'],
    'the function receives exactly the fields the web checkout sends');
  assert.deepEqual(plain([sent.full_name, sent.contact_phone, sent.email, sent.street, sent.area, sent.city, sent.zone_id, sent.payment_phone, sent.provider, sent.fulfilment]),
    ['Aisha Sesay', '+23276521208', 'customer-a@example.invalid', 'Landmark', 'Goderich', 'Freetown', 'zone-1', '+23276521208', 'orange', 'delivery']);
  assert.deepEqual(plain(backend.calls.invokes[0].options.body.expected_cart),
    [{ product_id: 'product-a', variant_id: 'actual-variant-a', quantity: 1, unit_price: 12000 }]);
  assert.equal(/total|fee|payment_status|paid/i.test(JSON.stringify(backend.calls.invokes[0].options.body)), false,
    'the customer estimate never travels as authority');
  assert.equal(backend.calls.invokes[0].options.headers.Authorization, 'Bearer synthetic-token');
  const text = textOf(view.tree);
  assert.match(text, /Your order is saved\. Opening your order confirmation/);
  assert.doesNotMatch(text, /Payment successful|Email sent|payment confirmed|paid/i, 'a placement is neither a payment nor a delivered email');
  assert.deepEqual(plain(view.routes), [{ pathname: '/orders/[orderId]', params: { orderId: placedRow.id, received: '1' } }],
    'the hand-off carries the order identity only: the email state is asked of the order service, never carried in');
  assert.equal(view.store[requestIdFor], undefined, 'a confirmed order releases its request id');
  assert.equal(refreshes, 1, 'the server emptied the Bag, so this screen reloads it instead of editing a copy');
  assert.deepEqual(inputLabels(view.tree), [], 'the confirmed draft is replaced by the hand-off line');
  assert.equal(button(view.tree, 'Place order'), undefined);
  assert.deepEqual(duplicateKeys(view.tree), []);
  view.host.unmount();
});

test('a tap while an order is in flight never becomes a second order', async () => {
  const gate = deferred();
  const backend = fakeBackend({ responses: [gate.promise] });
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, backend, profileLoad: async () => profile.mapProfile(row) });
  view.render();
  await view.settle();
  await readyToPlace(view);
  placeButton(view.tree).props.onPress();
  await new Promise(resolve => setTimeout(resolve, 0));
  view.render();
  assert.equal(placeButton(view.tree).props.disabled, true, 'the button cannot be pressed again while the order is being placed');
  assert.match(view.store[requestIdFor], /^[0-9a-f-]{36}$/, 'the request id is reserved before the call is answered');
  placeButton(view.tree).props.onPress();
  view.render();
  assert.equal(backend.calls.invokes.length, 1, 'an eager double tap sends one request');
  gate.resolve(queued);
  await view.settle();
  assert.equal(backend.calls.invokes.length, 1);
  assert.equal(view.routes.length, 1, 'one answered placement opens the confirmation screen once');
  view.host.unmount();
});

test('a definite refusal keeps the draft, clears the reserved id and says what actually happened', async () => {
  const backend = fakeBackend({ responses: [refusal(409, 'CART_CHANGED')] });
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, backend, profileLoad: async () => profile.mapProfile(row) });
  view.render();
  await view.settle();
  await readyToPlace(view);
  placeButton(view.tree).props.onPress();
  await view.settle();
  const alert = statusAlert(view.tree);
  assert.equal(alert.props.accessibilityLiveRegion, 'polite', 'the refusal is announced without stealing focus');
  assert.equal(textOf(alert), 'Your Bag changed while you were checking out. Review the new Bag before ordering.');
  assert.equal(view.store[requestIdFor], undefined, 'no order exists, so the id is not held hostage');
  assert.equal(button(view.tree, 'Retry the same request'), undefined, 'a refusal the shop already answered is never silently retried');
  assert.deepEqual(inputLabels(view.tree), [...deliveryEditors, ...paymentEditor], 'the draft stays where the customer left it');
  assert.match(textOf(view.tree), /Payment awaits confirmation\. Placing an order saves your order/, 'the refusal does not claim a payment either way');
  assert.doesNotMatch(textOf(view.tree), /Payment successful|received\./i, 'a refused request is never shown as an order');
  view.host.unmount();
});

test('an unanswered order keeps its request id and retries the byte-identical request', async () => {
  const backend = fakeBackend({ responses: [{ data: null, error: new Error('fetch failed') }, queued] });
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, backend, profileLoad: async () => profile.mapProfile(row) });
  view.render();
  await view.settle();
  await readyToPlace(view);
  placeButton(view.tree).props.onPress();
  await view.settle();
  assert.equal(textOf(statusAlert(view.tree)), 'Your order could not be confirmed. Retry the same request, or check your orders before trying again.');
  const reserved = view.store[requestIdFor];
  assert.match(reserved, /^[0-9a-f-]{36}$/, 'a lost response keeps its id so a retry is not a second order');
  const original = plain(backend.calls.invokes[0].options.body);
  button(view.tree, 'Retry the same request').props.onPress();
  await view.settle();
  assert.equal(backend.calls.invokes.length, 2);
  assert.deepEqual(plain(backend.calls.invokes[1].options.body), original, 'the retry re-sends the same request id, checkout and reviewed cart');
  assert.equal(view.routes.length, 1, 'the retry that came back with an order opens the confirmation once');
  assert.equal(view.store[requestIdFor], undefined);
  view.host.unmount();
});

test('an interrupted checkout is recovered from the order table before a new order is offered', async () => {
  const stored = '00000000-0000-4000-8000-000000000009';
  const backend = fakeBackend({ read: { data: { id: placedRow.id }, error: null } });
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, backend,
    store: memoryStore({ [requestIdFor]: stored }), profileLoad: async () => profile.mapProfile(row) });
  view.render();
  await view.settle();
  assert.deepEqual(backend.calls.reads, [{ column: 'checkout_request_id', value: stored }], 'the recovery read is keyed by the request id alone');
  assert.equal(backend.calls.invokes.length, 0, 'a checkout that already placed an order is never placed again');
  const text = textOf(view.tree);
  assert.match(text, /Your order is saved\. Opening your order confirmation/);
  assert.deepEqual(plain(view.routes), [{ pathname: '/orders/[orderId]', params: { orderId: placedRow.id, received: '1' } }],
    'a recovered checkout is carried to the order the database says exists, and no email state is invented for it');
  assert.doesNotMatch(text, /queued|accepted for sending|manual review/i, 'a recovery read has no email evidence, so none is claimed');
  assert.equal(view.store[requestIdFor], undefined);
  view.host.unmount();
});

test('a reserved id with no order behind it stays reserved, and a checkout that cannot be checked says so', async () => {
  const stored = '00000000-0000-4000-8000-000000000008';
  const missing = fakeBackend();
  const quiet = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, backend: missing,
    store: memoryStore({ [requestIdFor]: stored }) });
  quiet.render();
  await quiet.settle();
  assert.equal(textOf(statusAlert(quiet.tree)), 'No unfinished order was found for your previous checkout.',
    'a checkout that the database says never placed is stated, not treated as a failure');
  assert.equal(button(quiet.tree, 'Retry the same request'), undefined, 'there is nothing in flight to retry');
  assert.equal(quiet.store[requestIdFor], stored, 'nothing proved an order exists, so the id is kept for the retry');
  quiet.host.unmount();

  const broken = fakeBackend({ read: { data: null, error: { message: 'unreachable' } } });
  const doubtful = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue, backend: broken,
    store: memoryStore({ [requestIdFor]: stored }) });
  doubtful.render();
  await doubtful.settle();
  assert.equal(textOf(statusAlert(doubtful.tree)),
    'Your previous checkout could not be checked. Your order may already be in your orders, so a retry reuses the same request.');
  assert.equal(broken.calls.invokes.length, 0, 'an unreadable checkout is never re-placed on the customer behalf');
  assert.equal(doubtful.store[requestIdFor], stored);
  doubtful.host.unmount();
});

test('every checkout summary column gives way before it reaches the edge of the row', async () => {
  const view = mountScreen({ auth: readyAuth, bag: readyBag(oneItem), catalogue: readyCatalogue });
  view.render();
  await view.settle();
  const flat = style => [style].flat(Infinity).filter(entry => entry && typeof entry === 'object');
  const rows = collect(view.tree, element => element.type === 'View' && /^(Bag subtotal|Delivery|Estimated total)\./.test(String(element.props?.accessibilityLabel ?? '')))
    .concat(collect(view.tree, element => element.type === 'View' && /, quantity \d+\. NLe/.test(String(element.props?.accessibilityLabel ?? ''))));
  assert.ok(rows.length >= 4, `the line and the three estimate rows are all present, saw ${rows.length}`);
  for (const row of rows) {
    const texts = collect(row, element => element.type === 'Text');
    assert.equal(texts.length, 2, `a two-column row: ${row.props.accessibilityLabel}`);
    const [left, right] = texts.map(text => flat(text.props.style));
    assert.ok(left.every(entry => entry.flex === undefined && entry.flexGrow === undefined), `the label never grows over its neighbour: ${row.props.accessibilityLabel}`);
    assert.ok(left.some(entry => entry.flexShrink >= 1), `the label shrinks instead of pushing the price away: ${row.props.accessibilityLabel}`);
    assert.ok(right.every(entry => entry.flex === undefined && entry.flexGrow === undefined), 'a value that grows would squeeze a long label out');
    assert.ok(right.some(entry => entry.flexShrink >= 1), `the value shrinks instead of running past the edge: ${row.props.accessibilityLabel}`);
    assert.ok(right.some(entry => entry.textAlign === 'right'), 'a wrapped value stays on its own side of the row');
  }
  view.host.unmount();
});
