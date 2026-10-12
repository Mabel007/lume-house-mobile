// Slice S1: a rejected or unconfirmed Bag change must stay recoverable on the product screens.
// Source/JSX simulation only: no native renderer, no network and no device acceptance.
const assert = require('node:assert/strict');
const test = require('node:test');
const { load, hooks, find, expand, native } = require('./helpers/source.cjs');

const variants = [{ id: 'default-real', productId: 'real-a', price: 900, options: {}, isDefault: true, inventoryPolicy: 'untracked' }];
const product = { id: 'real-a', name: 'Mug', category: 'Dining', description: 'A mug', image: '', color: '#FFFFFF', price: 900, variants };
const errorState = { status: 'error', items: [], message: 'This selection is unavailable. Refresh your Bag and catalogue.', canRetry: false };
const uncertainState = { status: 'uncertain', items: [], message: 'Your change may have been saved. Refresh to see your Bag, or retry the saved change safely before making another.', canRetry: true };

function collect(element, predicate, found = []) {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  for (const child of [element.props?.children].flat(Infinity)) collect(child, predicate, found);
  return found;
}
const button = (tree, label) => find(tree, element => element.type === 'ActionButton' && element.props?.label === label);
const addButton = tree => collect(tree, element => element.type === 'ActionButton').at(-1);

function card(state, signedIn = true) {
  const host = hooks(); const calls = [];
  const bag = { signedIn, state, refresh: async () => { calls.push('refresh'); }, retry: async () => { calls.push('retry'); return true; },
    dispatch: async action => { calls.push(`dispatch:${action.type}`); return true; },
    current: () => ({ status: 'ready', items: [], message: null, canRetry: false }) };
  const { ProductCard } = load('src/components/ProductCard.tsx', {
    react: host.react,
    'expo-router': { Link: 'Link', router: { navigate: path => calls.push(`navigate:${path}`), push: () => { throw new Error('Forced duplicate push'); } } },
    './ProductImage': { ProductImage: 'ProductImage' }, './ActionButton': { ActionButton: 'ActionButton' },
    '../features/auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-in' }, busy: false }) },
    '../features/cart/BagContext': { useBag: () => bag },
  });
  return { render: (details = true) => { host.begin(); return expand(ProductCard({ product, details })); }, calls };
}

function catalogue(state) {
  const host = hooks(); const calls = [];
  const Screen = load('src/features/products/CatalogueScreen.tsx', {
    react: host.react, 'react-native': native,
    'expo-router': { Link: 'Link' }, '../../components/ProductCard': { ProductCard: 'ProductCard' },
    './ProductContext': { useProducts: () => ({ state: { status: 'ready', products: [] }, refresh: () => {} }) },
    '../cart/BagContext': { useBag: () => ({ signedIn: true, state, refresh: async () => calls.push('refresh'),
      retry: async () => calls.push('retry') }) },
  }).default;
  host.begin(); return { header: find(Screen(), element => element.type === 'FlatList').props.ListHeaderComponent, calls };
}

test('a definite Bag failure on Product Details explains itself and offers the existing refresh', () => {
  const view = card(errorState); const tree = view.render();
  assert.equal(find(tree, element => element.props?.accessibilityRole === 'alert').props.children, errorState.message,
    'the customer-facing reason from the Bag controller is shown, not a generic retry line');
  assert.equal(button(tree, 'Refresh Bag').props.disabled, false, 'recovery is possible without leaving the product');
  assert.equal(button(tree, 'Retry saved change'), undefined, 'a definite failure has no intent left to retry');
  const add = addButton(tree);
  assert.equal(add.props.busy, false, 'a finished failure is never announced as progress');
  assert.equal(add.props.disabled, true, 'a new Add waits until the Bag has been refreshed');
  add.props.onPress();
  assert.deepEqual(view.calls, [], 'pressing a disabled Add must not reach the cart at all');
});

test('an uncertain Bag change keeps both recovery paths and is never repeated automatically', () => {
  const view = card(uncertainState); const tree = view.render();
  assert.equal(find(tree, element => element.props?.accessibilityRole === 'alert').props.children, uncertainState.message);
  assert.equal(button(tree, 'Refresh Bag').props.disabled, false);
  assert.equal(button(tree, 'Retry saved change').props.disabled, false);
  assert.deepEqual(view.calls, [], 'loading the product never replays the saved change by itself');
  button(tree, 'Retry saved change').props.onPress();
  button(tree, 'Refresh Bag').props.onPress();
  assert.deepEqual(view.calls, ['retry', 'refresh'], 'each recovery action uses the existing controller capability');
  addButton(tree).props.onPress();
  assert.deepEqual(view.calls, ['retry', 'refresh'], 'a new Add intent stays blocked while the change is unconfirmed');
});

test('genuine Bag loading and saving still read as progress without a recovery panel', () => {
  for (const status of ['loading', 'saving']) {
    const view = card({ status, items: [], message: null, canRetry: false }); const tree = view.render();
    assert.equal(addButton(tree).props.busy, true, `${status} is real in-flight work`);
    assert.equal(addButton(tree).props.disabled, true);
    assert.equal(find(tree, element => element.props?.accessibilityRole === 'alert'), undefined);
    assert.equal(button(tree, 'Refresh Bag'), undefined);
  }
});

test('recovery returns Add to Bag to life once the Bag reports ready again', () => {
  const view = card(errorState);
  assert.equal(addButton(view.render()).props.disabled, true);
  // The controller publishes the refreshed server cart; the card follows it with no local guess.
  const ready = card({ status: 'ready', items: [], message: null, canRetry: false });
  assert.equal(addButton(ready.render()).props.disabled, false);
  assert.equal(addButton(ready.render()).props.busy, false);
  addButton(ready.render()).props.onPress();
  assert.deepEqual(ready.calls, ['dispatch:add'], 'the recovered Add sends the same single-unit intent');
  assert.deepEqual(view.calls, [], 'a refreshed Bag on another card cannot invent a refresh for this one');
});

test('grid cards stay silent because the catalogue header owns the shared Bag recovery', () => {
  const grid = card(errorState).render(false);
  assert.equal(button(grid, 'Refresh Bag'), undefined, 'one message per screen, not one per card');
  assert.equal(find(grid, element => element.props?.accessibilityRole === 'alert'), undefined);
  const view = catalogue(errorState);
  assert.equal(find(view.header, element => element.props?.accessibilityRole === 'alert').props.children, errorState.message);
  const bagLinks = collect(view.header, element => element.type === 'Link' && element.props.href === '/bag');
  assert.equal(bagLinks.length, 1, 'the recovery row keeps its own route beside the actions');
  assert.ok(find(bagLinks[0], element => element.type === 'Text' && element.props.children === 'Review your Bag'),
    'the route to the full Bag stays available');
  assert.equal(collect(view.header, element => element.type?.name === 'BagLink').length, 1,
    'the header still offers the shared Bag destination next to it');
  find(view.header, element => element.props?.label === 'Refresh Bag').props.onPress();
  assert.deepEqual(view.calls, ['refresh']);
  assert.equal(find(view.header, element => element.props?.label === 'Retry saved change'), undefined);
  const uncertain = catalogue(uncertainState);
  find(uncertain.header, element => element.props?.label === 'Retry saved change').props.onPress();
  assert.deepEqual(uncertain.calls, ['retry']);
});

test('a signed-out customer browsing never inherits the Bag recovery panel', () => {
  const view = card({ status: 'ready', items: [], message: null, canRetry: false }, false); const tree = view.render();
  assert.equal(find(tree, element => element.props?.accessibilityRole === 'alert'), undefined);
  assert.equal(addButton(tree).props.label, 'Sign in to add');
  addButton(tree).props.onPress();
  assert.deepEqual(view.calls, ['navigate:/account'], 'the sign-in route is unchanged by this slice');
});
