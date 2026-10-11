// Offline contracts only: every repository and context is mocked. No client, network, order, payment or email.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, find, expand, duplicateKeys } = require('./helpers/source.cjs');

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

function mountScreen({ auth, bag, catalogue }) {
  const host = hooks();
  const Screen = load('src/features/checkout/CheckoutScreen.tsx', {
    react: { ...host.react, useCallback: fn => fn },
    'expo-router': { Link: 'Link', useFocusEffect: () => {} },
    '../auth/AuthContext': { useAuth: auth },
    '../cart/BagContext': { useBag: bag },
    '../products/ProductContext': { useProducts: catalogue },
  }).default;
  const render = () => { host.begin(); return expand(Screen({})); };
  return { host, render };
}
const textOf = element => {
  if (typeof element === 'string') return element;
  if (!element || typeof element !== 'object') return '';
  return [element.props?.children].flat(Infinity).map(textOf).join(' ');
};
const variantRow = { id: 'actual-variant-a', product_id: 'product-a', options: {}, is_default: true,
  price_cents: 12000, currency: 'NLE', active: true, inventory_policy: 'untracked' };
const readyProducts = [{ id: 'product-a', name: 'Vase', price: 12000, variants: variants.parseVariants([variantRow]) }];

test('the checkout foundation resolves session, Bag and catalogue state without offering placement', () => {
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
  assert.match(textOf(tree), /Order placement is not available in this build yet/);
  const notice = find(tree, element => element.props?.accessibilityRole === 'alert');
  assert.equal(notice.props.accessible, true, 'the notice is a real screen-reader focus stop');
  assert.equal(notice.props.accessibilityLiveRegion, 'polite');
  assert.equal(cart.cartLine({ productId: 'product-a', variantId: 'actual-variant-a', quantity: 2 }, readyProducts).lineTotal, 24000);
  signedOut.host.unmount(); empty.host.unmount(); loaded.host.unmount();
});

test('the checkout screen exposes no inputs, no place-order control and no duplicate keys', () => {
  const view = mountScreen({ auth: () => ({ state: { status: 'signed-in', user: { id: 'customer-a' } }, busy: false }),
    bag: () => ({ signedIn: true, state: { status: 'ready', items: [{ productId: 'product-a', variantId: 'actual-variant-a', quantity: 1 }], message: null, canRetry: false }, refresh: async () => {}, retry: async () => false, dispatch: async () => false }),
    catalogue: () => ({ state: { status: 'ready', products: readyProducts }, refresh: () => {} }) });
  const tree = view.render();
  assert.equal(find(tree, element => element.type === 'TextInput'), undefined, 'details arrive in the next slice');
  assert.doesNotMatch(textOf(tree), /place order|pay now|order placed|success/i);
  assert.deepEqual(duplicateKeys(tree), []);
  view.host.unmount();
});
