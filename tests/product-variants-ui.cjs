// Slice S5: what a product card shows in the collection, and where the choices live.
// Source/JSX simulation only: no native renderer, no layout measurement and no device acceptance.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load, hooks, find, expand, native } = require('./helpers/source.cjs');

const flush = async () => { for (let pass = 0; pass < 8; pass++) await Promise.resolve(); };
const textOf = element => {
  if (typeof element === 'string') return element;
  if (typeof element === 'number') return String(element);
  if (!element || typeof element !== 'object') return '';
  return [element.props?.children].flat(Infinity).map(textOf).join(' ');
};
// JSX keeps the line break a source fold would have collapsed, so prose is asserted with its spacing normalised.
const spoken = tree => textOf(tree).replace(/\s+/g, ' ');
const action = (tree, label) => find(tree, element => element.props?.label === label);
const radio = (tree, label) => find(tree, element => element.props?.accessibilityRole === 'radio' &&
  String(element.props?.accessibilityLabel ?? '').includes(label));
const collect = (element, predicate, found = []) => {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  for (const child of [element.props?.children].flat(Infinity)) collect(child, predicate, found);
  return found;
};
// A state shown by colour alone cannot be asserted, so the style sheets behind each control are read too.
const painted = element => [element.props?.style].flat(Infinity).filter(Boolean);
const ready = (items = []) => ({ status: 'ready', items, message: null, canRetry: false });
// The card's own price line, which JSX hands over as two children: the from- hedge and the amount.
const priceLine = tree => spoken(collect(tree, element => element.type === 'Text' &&
  /^(From )?NLe [\d.,]+$/.test(spoken(element).trim()))[0]).trim();

const small = { id: 'variant-small', productId: 'mug', price: 100, currency: 'NLE', options: { Size: 'Small' }, isDefault: false, inventoryPolicy: 'untracked' };
const large = { id: 'variant-large', productId: 'mug', price: 250, currency: 'NLE', options: { Size: 'Large' }, isDefault: false, inventoryPolicy: 'tracked', available: true };
const sold = { id: 'variant-sold', productId: 'mug', price: 300, currency: 'NLE', options: { Size: 'Sold' }, isDefault: false, inventoryPolicy: 'tracked', available: false };
const standard = { id: 'variant-standard', productId: 'mug', price: 90, currency: 'NLE', options: {}, isDefault: true, inventoryPolicy: 'untracked' };
const mug = { id: 'mug', name: 'Mug', category: 'Dining', description: 'A mug', image: '', color: '#FFFFFF', price: 90, variants: [standard, small, large, sold] };
// A piece with nothing to choose, so a direct Add stays a direct Add.
const vase = { id: 'vase', name: 'Vase', category: 'Living', description: 'A vase', image: '', color: '#FFFFFF', price: 400,
  variants: [{ ...standard, id: 'variant-vase', productId: 'vase', price: 400 }] };
// And one the shop cannot take at all, which is the only news a collection card adds a line for.
const stall = { id: 'stall', name: 'Stall', category: 'Living', description: 'A tray', image: '', color: '#FFFFFF', price: 500,
  variants: [{ ...standard, id: 'variant-stall', productId: 'stall', price: 500, inventoryPolicy: 'tracked', available: false }] };

function card(product, { signedIn = true, items = [] } = {}) {
  const host = hooks(); const routes = []; const intents = []; const notices = [];
  const bag = { signedIn, state: ready(items), current: () => bag.state,
    refresh: async () => {}, retry: async () => false,
    // Recorded and rebuilt in this realm: an object made inside the simulated component is structurally
    // identical but not prototype-equal, which `deepEqual` would otherwise report as a difference.
    dispatch: async action => {
      intents.push({ type: action.type, variantId: action.variantId });
      bag.state = ready([...bag.state.items, { productId: product.id, variantId: action.variantId, quantity: 1 }]);
      return true;
    } };
  const { ProductCard } = load('src/components/ProductCard.tsx', {
    react: host.react, 'expo-router': { Link: 'Link', router: { navigate: path => routes.push(path) } },
    './ProductImage': { ProductImage: 'ProductImage' }, './ActionButton': { ActionButton: 'ActionButton' },
    '../features/auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in' }, busy: false }) },
    '../features/cart/BagContext': { useBag: () => bag },
    './Toast': { useToast: () => ({ notify: ({ variant, title, description }) => notices.push({ variant, title, description }) }) },
  });
  const view = {
    routes, intents, notices,
    render: (details = false) => { host.begin(); return { tree: expand(ProductCard({ product, details })) }; },
    select: label => { radio(view.render(true).tree, label).props.onPress(); },
  };
  return view;
}

test('a collection card hands its choices to the product page instead of becoming a form', () => {
  const view = card(mug); const { tree } = view.render();
  assert.equal(find(tree, element => element.props?.accessibilityRole === 'radio'), undefined,
    'no selection list in the collection: a card is a decision about one piece');
  assert.equal(action(tree, 'Add to Bag'), undefined, 'and no Add that would have to guess which selection was meant');
  assert.equal(action(tree, 'Sign in to add'), undefined);
  const choose = action(tree, 'Choose options');
  assert.ok(choose, 'the card offers the one action a piece with selections can honestly take');
  assert.equal(choose.props.disabled, undefined, 'opening the product page is always possible, so it is never disabled');
  assert.equal(choose.props.accessibilityLabel, 'Choose options for Mug, which opens its product page',
    'a screen reader hears where the button goes, not only what it says');
  choose.props.onPress();
  assert.deepEqual(view.routes, ['/products/mug'], 'the route is the real encoded product href');
  assert.deepEqual(view.intents, [], 'a card with choices never touches the cart');
});

test('the compact card still leads with the piece itself', () => {
  const view = card(mug); const { tree } = view.render();
  assert.ok(find(tree, element => element.type === 'ProductImage'), 'the photo is still the first thing on the card');
  assert.match(spoken(tree), /Dining Mug From NLe 1/, 'category, name and the shop\u2019s cheapest selection, in that order');
  assert.equal(find(tree, element => element.props?.accessibilityRole === 'header'), undefined,
    'a card is not a heading; the collection owns that');
  const opener = find(tree, element => element.props?.accessibilityRole === 'link');
  assert.equal(opener.props.accessibilityLabel, 'View details for Mug');
  opener.props.onPress();
  assert.deepEqual(view.routes, ['/products/mug'], 'and the card body still opens the same page');
});

test('an option-free piece keeps its direct Add, with nothing routed away', async () => {
  const view = card(vase); const { tree } = view.render();
  assert.equal(action(tree, 'Choose options'), undefined, 'nothing to choose means nothing to send the customer away for');
  action(tree, 'Add to Bag').props.onPress(); await flush();
  assert.deepEqual(view.intents, [{ type: 'add', variantId: 'variant-vase' }], 'one unit, and the intent is unchanged');
  assert.deepEqual(view.routes, [], 'the customer stays in the collection');
  assert.deepEqual(view.notices, [{ variant: 'success', title: 'Added to your Bag', description: 'Vase. 1 item in your Bag.' }]);
});

test('the collection prints a line only for bad news, and says it once', () => {
  const open = card(mug); const openTree = open.render().tree;
  assert.equal(find(openTree, element => element.props?.children === 'Unavailable'), undefined,
    'an available piece needs no announcement of it');
  for (const details of [false, true]) {
    const { tree } = card(stall).render(details);
    const lines = collect(tree, element => element.props?.children === 'Unavailable');
    assert.equal(lines.length, 1, `the word for a piece the shop cannot take appears once on the ${details ? 'page' : 'card'}`);
    assert.ok(painted(lines[0]).some(style => style.fontWeight === '600') || details,
      'in the collection the bad news is weighted, not just coloured');
  }
  const { tree } = card(stall).render();
  assert.equal(action(tree, 'Add to Bag'), undefined);
  assert.equal(action(tree, 'Unavailable').props.disabled, true, 'the refused button is refused, and named for the refusal');
  assert.doesNotMatch(spoken(tree), /shop can take right now/, 'the explanation belongs to the page, not every grid card');
});

test('the full selector stays on the product page', () => {
  const view = card(mug); const { tree } = view.render(true);
  assert.equal(action(tree, 'Choose options'), undefined, 'the page that shows the choices needs no route to them');
  assert.ok(find(tree, element => element.props?.children === 'Choose a selection'));
  const choices = collect(tree, element => element.props?.accessibilityRole === 'radio');
  assert.equal(choices.length, 3, 'every selection the shop offers, and the default the card never asked about is not one');
  assert.deepEqual(choices.map(element => element.props.accessibilityState.checked), [false, false, false],
    'nothing is pre-chosen: a selection is an explicit customer decision');
  assert.match(spoken(tree), /Choose an available selection below\./, 'the page says what it wants before anything can be added');
});

test('the chosen selection is distinct in words as well as in colour', () => {
  const view = card(mug);
  assert.equal(find(view.render(true).tree, element => element.props?.children === 'Selected'), undefined,
    'nothing claims a choice before one is made');
  view.select('Size: Small');
  const { tree } = view.render(true);
  const chosen = radio(tree, 'Size: Small');
  assert.equal(chosen.props.accessibilityState.checked, true);
  assert.ok(painted(chosen).some(style => style.borderWidth === 2 && style.borderColor === '#535B40' &&
    style.backgroundColor === '#E7E8DB'), 'the chosen row is heavier and filled, not merely outlined differently');
  assert.equal(collect(tree, element => element.props?.children === 'Selected').length, 1,
    'and it says Selected in words, once for the one selection chosen');
  const other = radio(tree, 'Size: Large');
  assert.equal(other.props.accessibilityState.checked, false);
  assert.equal(find(other, element => element.props?.children === 'Selected'), undefined);
  assert.equal(painted(other).some(style => style.borderWidth === 2), false);
});

test('a selection the shop cannot take is refused without hiding its price', () => {
  const { tree } = card(mug).render(true);
  const off = radio(tree, 'Size: Sold');
  assert.equal(off.props.disabled, true);
  assert.equal(off.props.accessibilityState.disabled, true);
  assert.ok(painted(off).some(style => style.opacity === 0.55));
  assert.equal(off.props.accessibilityLabel, 'Mug, Size: Sold, NLe 3, unavailable',
    'the row states its own state, so a swipe never reaches it silently');
  assert.match(spoken(off), /NLe 3 · Unavailable/, 'the number is not the bad news, so it stays readable');
  assert.equal(find(off, element => element.props?.children === 'Selected'), undefined);
});

test('the price on the page follows the selection the customer actually chose', () => {
  const view = card(mug);
  assert.equal(priceLine(view.render(true).tree), 'From NLe 1',
    'before a choice the card shows the cheapest selection the shop can take, and calls it a from-price');
  view.select('Size: Large');
  assert.equal(priceLine(view.render(true).tree), 'NLe 2.50',
    'after a choice the number is that variant\u2019s own price, with no from- hedge left on it');
  view.select('Size: Small');
  assert.equal(priceLine(view.render(true).tree), 'NLe 1', 'and it moves back with the selection, not a remembered value');
});

test('an Add the shop cannot take explains itself and never reaches the cart', async () => {
  const view = card(mug);
  // Availability is the shop\u2019s fact and it can change after a choice: this selection is now one it will not take.
  view.select('Size: Sold');
  const { tree } = view.render(true);
  const add = action(tree, 'Unavailable');
  assert.equal(add.props.disabled, true);
  assert.match(spoken(tree), /This selection is not one the shop can take right now\./);
  assert.match(spoken(tree), /Refresh the product to check its stock, or choose another selection\./,
    'the refusal names a step the customer can take, not a fault of ours');
  add.props.onPress(); await flush();
  assert.deepEqual(view.intents, [], 'a refused Add reaches the cart not at all');
  assert.deepEqual(view.notices, [], 'and nothing is confirmed');
});

test('a Bag already holding the limit states the limit the cart actually enforces', async () => {
  const { MAX_QUANTITY } = load('src/features/cart/cart.ts');
  const view = card(mug, { items: [{ productId: 'mug', variantId: small.id, quantity: MAX_QUANTITY }] });
  view.select('Size: Small');
  const { tree } = view.render(true);
  assert.equal(action(tree, 'Quantity limit reached').props.disabled, true);
  assert.match(spoken(tree), new RegExp(`Your Bag already holds ${MAX_QUANTITY} of this selection\\. ` +
    'Remove one in your Bag to add another\\.'), 'the card quotes the same number the cart refuses at');
  action(tree, 'Quantity limit reached').props.onPress(); await flush();
  assert.deepEqual(view.intents, []);
});

test('a compact card keeps its picture honest when media is refused', () => {
  const host = hooks();
  const { ProductCard } = load('src/components/ProductCard.tsx', {
    react: host.react, 'expo-router': { Link: 'Link', router: { navigate: () => {} } },
    './ActionButton': { ActionButton: 'ActionButton' }, 'expo-image': { Image: 'ExpoImage' },
    '../features/auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in' }, busy: false }) },
    '../features/cart/BagContext': { useBag: () => ({ signedIn: true, state: ready([]), current: () => ready([]),
      dispatch: async () => true }) },
    './Toast': { useToast: () => ({ notify: () => {} }) },
  });
  host.begin();
  const tree = expand(ProductCard({ product: { ...mug, image: 'javascript:fixture' }, details: false }));
  const fallback = find(tree, element => element.props?.accessibilityRole === 'image');
  assert.equal(fallback.props.children, 'Image unavailable');
  assert.equal(fallback.props.accessibilityLabel, 'Image unavailable for Mug');
  assert.ok(find(tree, element => element.props?.label === 'Choose options'), 'and the card still works with no picture');
  assert.match(spoken(tree), /Dining Mug From NLe 1/, 'with the piece still readable beside the note');
});

test('the collection narrows to one column before a card is squeezed', () => {
  const list = (width, fontScale) => {
    const host = hooks();
    const Screen = load('src/features/products/CatalogueScreen.tsx', {
      react: host.react, 'react-native': { ...native, useWindowDimensions: () => ({ width, fontScale }) },
      'expo-router': { Link: 'Link' }, '../../components/ProductCard': { ProductCard: 'ProductCard' },
      './ProductContext': { useProducts: () => ({ state: { status: 'ready', products: [] }, refresh: () => {} }) },
      '../cart/BagContext': { useBag: () => ({ signedIn: false }) },
    }).default;
    host.begin(); return find(Screen(), element => element.type === 'FlatList');
  };
  assert.equal(list(320, 1).props.numColumns, 1, 'a narrow Android screen gets a full-width card');
  assert.equal(list(420, 1).props.numColumns, 2);
  assert.equal(list(800, 1).props.numColumns, 3);
  const narrow = list(320, 1);
  assert.equal(narrow.key, '1', 'changing the layout remounts the list instead of leaving two-column rows behind');
  assert.equal(list(420, 1).key, '2');
  assert.equal(narrow.props.renderItem({ item: { id: 'mug', name: 'Mug' } }).props.product.name, 'Mug',
    'the same card renders at every width: nothing is swapped for a thinner screen');
});
