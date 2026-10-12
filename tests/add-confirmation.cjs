// Slice S3: what a confirmed Add leaves on the product screen.
// Source/JSX simulation only: no native renderer, no network and no device acceptance.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load, hooks, find, expand } = require('./helpers/source.cjs');

const flush = async () => { for (let pass = 0; pass < 8; pass++) await Promise.resolve(); };
const textOf = element => {
  if (typeof element === 'string') return element;
  if (!element || typeof element !== 'object') return '';
  return [element.props?.children].flat(Infinity).map(textOf).join(' ');
};
const action = (tree, label) => find(tree, element => element.props?.label === label);
const ready = (items = []) => ({ status: 'ready', items, message: null, canRetry: false });

const small = { id: 'variant-small', productId: 'mug', price: 100, currency: 'NLE', options: { Size: 'Small' }, isDefault: false, inventoryPolicy: 'untracked' };
const large = { id: 'variant-large', productId: 'mug', price: 250, currency: 'NLE', options: { Size: 'Large' }, isDefault: false, inventoryPolicy: 'tracked', available: true };
const plain = { id: 'variant-plain', productId: 'mug', price: 90, currency: 'NLE', options: {}, isDefault: true, inventoryPolicy: 'untracked' };
const mug = { id: 'mug', name: 'Mug', category: 'Dining', description: 'A mug', image: '', color: '#FFFFFF', price: 90, variants: [plain, small, large] };
// The same product with nothing to choose, so a direct Add stays a direct Add.
const vase = { id: 'vase', name: 'Vase', category: 'Living', description: 'A vase', image: '', color: '#FFFFFF', price: 400, variants: [{ ...plain, id: 'variant-vase', productId: 'vase', price: 400 }] };

const panel = tree => find(tree, element => String(element.props?.accessibilityLabel ?? '').includes('added to your Bag'));
const viewBag = tree => find(tree, element => element.type === 'Link' && element.props?.href === '/bag');

function card(product, { signedIn = true, initial = ready([]), outcome = true, deferred = null } = {}) {
  const host = hooks(); const notices = []; const intents = [];
  // What the shop is holding after this card's Add: the chosen piece plus a standard one it already had.
  const held = ready(product === vase
    ? [{ productId: 'vase', variantId: 'variant-vase', quantity: 1 }]
    : [{ productId: 'mug', variantId: small.id, quantity: 2 }, { productId: 'mug', variantId: plain.id, quantity: 1 }]);
  const settle = () => {
    if (outcome === true) { bag.state = held; return true; }
    bag.state = typeof outcome === 'string'
      ? { status: outcome, items: initial.items, message: 'The shop did not confirm this change.', canRetry: outcome === 'uncertain' }
      : initial;
    return false;
  };
  const bag = { signedIn, state: initial, current: () => bag.state,
    refresh: async () => {}, retry: async () => false,
    // Recorded in this realm: an object built inside the simulated component is structurally identical but
    // not prototype-equal, which `deepEqual` would otherwise report as a difference.
    dispatch: async action => {
      intents.push({ type: action.type, variantId: action.variantId });
      if (deferred) return new Promise(resolve => { deferred.resolve = () => resolve(settle()); });
      return settle();
    } };
  const { ProductCard } = load('src/components/ProductCard.tsx', {
    react: host.react, 'expo-router': { Link: 'Link', router: { navigate: path => notices.push(`route:${path}`) } },
    './ProductImage': { ProductImage: 'ProductImage' }, './ActionButton': { ActionButton: 'ActionButton' },
    '../features/auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in' }, busy: false }) },
    '../features/cart/BagContext': { useBag: () => bag },
    './Toast': { useToast: () => ({ notify: ({ variant, title, description }) => notices.push({ variant, title, description }) }) },
  });
  const render = (details = true) => { host.begin(); return { tree: expand(ProductCard({ product, details })) }; };
  return {
    notices, intents, render,
    // Choosing is a real press on the real option, so a test cannot accidentally select what the card hides.
    select: label => { find(render().tree, element => element.props?.accessibilityLabel?.includes(label)).props.onPress(); },
    state: value => { bag.state = value; },
  };
}

test('a confirmed Add names the piece, the chosen selection and the count the shop is now holding', async () => {
  const view = card(mug);
  view.select('Small');
  action(view.render().tree, 'Add to Bag').props.onPress(); await flush();
  const tree = view.render().tree;
  const record = panel(tree);
  assert.ok(record, 'the card leaves a record behind, not only a banner that fades');
  assert.equal(record.props.accessibilityLabel, 'Mug, Size: Small added to your Bag. 3 items in your Bag.',
    'one swipe stop that says the piece, the selection and the Bag count together');
  assert.match(textOf(record), /Mug · Size: Small/, 'the visible line names the selection the customer chose');
  assert.match(textOf(record), /NLe 1/, 'and the price of that selection, not the catalogue from-price');
  assert.match(textOf(record), /3 items in your Bag/, 'the count is total units from the server cart: 2 chosen + 1 standard');
  const link = viewBag(tree);
  assert.ok(link, 'the confirmation offers the way to the full Bag');
  assert.equal(link.props.children.props.accessibilityLabel, 'View Bag. 3 items in your Bag.');
  assert.deepEqual(view.notices, [{ variant: 'success', title: 'Added to your Bag', description: 'Mug · Size: Small. 3 items in your Bag.' }],
    'the banner says the same facts once, and the panel is not a second live region');
  assert.equal(find(tree, element => element.props?.accessibilityLiveRegion === 'polite' && textOf(element).includes('Mug')), undefined,
    'nothing on the card re-announces what the banner already announced');
});

test('changing the selection retires a confirmation that no longer describes the Bag', async () => {
  const view = card(mug);
  view.select('Small');
  action(view.render().tree, 'Add to Bag').props.onPress(); await flush();
  assert.ok(panel(view.render().tree), 'the Small confirmation is on screen');
  view.select('Large');
  const tree = view.render().tree;
  assert.equal(panel(tree), undefined, 'after choosing Large the Small confirmation is gone, because it would be a lie');
  assert.equal(viewBag(tree), undefined, 'and its route to the Bag goes with it');
  assert.deepEqual(view.intents, [{ type: 'add', variantId: small.id }], 'retiring the record never repeats the intent');
});

test('the count is the server cart, so it moves when the shop says so and never before', async () => {
  const view = card(mug);
  view.select('Small');
  assert.equal(panel(view.render().tree), undefined, 'before an Add there is no confirmation at all');
  action(view.render().tree, 'Add to Bag').props.onPress(); await flush();
  assert.match(textOf(panel(view.render().tree)), /3 items in your Bag/);
  // Another device removed the standard piece: the card follows the published cart, with no new press.
  view.state(ready([{ productId: 'mug', variantId: small.id, quantity: 2 }]));
  assert.match(textOf(panel(view.render().tree)), /2 items in your Bag/, 'the record reads the state, not a number remembered at press time');
  view.state({ status: 'loading', items: [], message: null, canRetry: false });
  assert.equal(panel(view.render().tree), undefined, 'a Bag being re-read shows no stale confirmation');
});

test('an Add in flight reads as this card working, and a second tap cannot become a second intent', async () => {
  const deferred = {};
  const view = card(mug, { deferred });
  view.select('Small');
  action(view.render().tree, 'Add to Bag').props.onPress();
  const busy = view.render().tree;
  const button = action(busy, 'Adding to your Bag…');
  assert.ok(button, 'the card says which action it is working on, in the words the customer just chose');
  assert.equal(button.props.busy, true); assert.equal(button.props.disabled, true);
  assert.equal(panel(busy), undefined, 'no success appears before the answer does');
  action(busy, 'Adding to your Bag…').props.onPress();
  assert.equal(view.intents.length, 1, 'a second press while the first is in flight sends nothing');
  deferred.resolve(); await flush();
  assert.ok(panel(view.render().tree), 'and the answer that does arrive is shown');
});

test('a refused or unconfirmed Add never leaves a confirmation behind', async () => {
  for (const outcome of [false, 'error', 'uncertain']) {
    const view = card(mug, { outcome });
    view.select('Small');
    action(view.render().tree, 'Add to Bag').props.onPress(); await flush();
    const tree = view.render().tree;
    assert.equal(panel(tree), undefined, `${outcome}: nothing that reads as a success`);
    assert.equal(viewBag(tree), undefined, `${outcome}: no route to a Bag the shop never confirmed`);
    assert.deepEqual(view.notices.filter(notice => notice.variant === 'success'), [], `${outcome}: no success banner`);
  }
  const uncertain = card(mug, { outcome: 'uncertain' });
  uncertain.select('Small');
  action(uncertain.render().tree, 'Add to Bag').props.onPress(); await flush();
  assert.match(textOf(uncertain.render().tree), /did not confirm/, 'the S1 recovery message is still what the customer gets');
  assert.ok(action(uncertain.render().tree, 'Refresh Bag'), 'with the recovery controls beside it');
});

test('a selection is still required before anything can be added, and an option-free piece adds directly', async () => {
  const view = card(mug);
  const tree = view.render().tree;
  assert.equal(action(tree, 'Choose a selection').props.disabled, true, 'an unchosen selection keeps the Add refused and explained');
  action(tree, 'Choose a selection').props.onPress();
  assert.deepEqual(view.intents, [], 'pressing the refused button reaches the cart not at all');
  assert.equal(panel(tree), undefined);
  const direct = card(vase);
  const directCard = direct.render().tree;
  action(directCard, 'Add to Bag').props.onPress(); await flush();
  assert.deepEqual(direct.intents, [{ type: 'add', variantId: 'variant-vase' }], 'one unit per press, still no quantity in the intent');
  assert.equal(direct.notices[0].description, 'Vase. 1 item in your Bag.', 'and a piece with nothing to choose confirms without inventing a selection');
  assert.match(textOf(panel(direct.render().tree)), /Vase/, 'with the same record on the card');
});

test('a grid card keeps its answer in the banner, so the collection stays compact', async () => {
  const view = card(mug);
  view.select('Small');
  action(view.render(false).tree, 'Add to Bag').props.onPress(); await flush();
  assert.equal(panel(view.render(false).tree), undefined, 'one message per screen, not one per card');
  assert.equal(viewBag(view.render(false).tree), undefined);
  assert.deepEqual(view.notices, [{ variant: 'success', title: 'Added to your Bag', description: 'Mug · Size: Small. 3 items in your Bag.' }],
    'the grid customer still hears the confirmed answer');
});

test('a signed-out browse is unchanged: the card asks for an account and confirms nothing', async () => {
  const view = card(mug, { signedIn: false });
  view.select('Small');
  const tree = view.render().tree;
  action(tree, 'Sign in to add').props.onPress(); await flush();
  assert.deepEqual(view.notices, ['route:/account'], 'the sign-in route is where it always was, and no banner claims a cart change');
  assert.deepEqual(view.intents, [], 'a signed-out press never reaches the cart');
  assert.equal(panel(view.render().tree), undefined, 'and nothing is confirmed');
});
