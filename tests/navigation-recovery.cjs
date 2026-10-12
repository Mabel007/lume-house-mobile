const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { load, hooks, find, expand, native } = require('./helpers/source.cjs');
test('Account restoration hides auth actions; signed-out/in actions have labels and preserve existing handlers', () => {
  let state = { status: 'restoring' }; let busy = false; const actions = [];
  const Screen = load('src/features/auth/AccountScreen.tsx', {
    react: { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useSyncExternalStore: (subscribe, get) => get() },
    '../profile/CustomerProfile': { CustomerProfile: 'CustomerProfile' }, '../../lib/supabase/client': { getSupabaseClient: () => ({}) },
    './localFixtureAuth': { localFixtureAvailable: () => false },
    'expo-router': { Link: 'Link' }, './AuthContext': { useAuth: () => ({ state, busy, message: null,
      signIn: async () => { actions.push('in'); }, signOut: async () => { actions.push('out'); } }) },
  }).default;
  const view = () => expand(Screen());
  assert.equal(find(view(), element => element.props?.accessibilityRole === 'button'), undefined);
  assert.equal(find(view(), element => element.type === 'ActivityIndicator').props.accessibilityLabel, 'Account loading');
  state = { status: 'signed-out' }; let button = find(view(), element => element.props?.accessibilityRole === 'button');
  assert.equal(button.props.accessibilityLabel, 'Continue with Google'); button.props.onPress();
  state = { status: 'signed-in', user: { id: 'actual-user', email: 'fixture@example.invalid' } };
  const row = () => find(view(), element => element.props?.accessibilityLabel === 'Sign out of your account');
  assert.equal(row().props.accessibilityRole, 'button'); row().props.onPress();
  assert.deepEqual(actions, ['in', 'out']); busy = true;
  assert.equal(row().props.accessibilityState.busy, true);
  assert.equal(find(view(), element => element.type === 'CustomerProfile').props.editor, null, 'the profile area stays mounted and closed');
  assert.ok(find(view(), element => element.type === 'Link' && element.props.href === '/'));
  assert.ok(find(view(), element => element.type === 'Link' && element.props.href === '/bag'));
});
function bagScreen() {
  const host = hooks(); let signedIn = false; let state = { status: 'ready', items: [{ variantId: 'previous-user', quantity: 1 }] };
  let catalogue = { status: 'ready', products: [] }; let focus; const calls = [];
  const Screen = load('src/features/cart/BagScreen.tsx', {
    react: host.react, 'expo-router': { Link: 'Link', useFocusEffect: effect => { focus = effect; } },
    './BagContext': { useBag: () => ({ signedIn, state, current: () => state, refresh: async () => { calls.push('bag'); }, retry: async () => { calls.push('retry'); } }) },
    '../auth/AuthContext': { useAuth: () => ({ state: { status: signedIn ? 'signed-in' : 'signed-out' }, busy: false }) },
    '../products/ProductContext': { useProducts: () => ({ state: catalogue, refresh: () => { calls.push('catalogue'); } }) },
  }).default;
  return { render: () => { host.begin(); return find(Screen(), element => element.type === 'FlatList'); },
    signedIn: value => { signedIn = value; }, state: value => { state = value; }, catalogue: value => { catalogue = value; },
    focus: () => focus(), calls };
}
test('signed-out Bag excludes old customer lines and focus refresh; signed-in empty Bag retains refresh/navigation', () => {
  const view = bagScreen(); let list = view.render(); assert.equal(list.props.data.length, 0); view.focus(); assert.equal(view.calls.length, 0);
  assert.ok(find(list.props.ListHeaderComponent, element => element.type === 'Link' && element.props.href === '/account'));
  view.signedIn(true); view.state({ status: 'ready', items: [] }); list = view.render(); view.focus(); assert.deepEqual(view.calls, ['bag']);
  assert.equal(list.props.ListEmptyComponent.props.accessibilityLiveRegion, 'polite');
  find(list.props.ListHeaderComponent, element => element.props?.label === 'Refresh Bag').props.onPress();
  assert.deepEqual(view.calls, ['bag', 'catalogue', 'bag']);
  assert.ok(find(list.props.ListHeaderComponent, element => element.type === 'Link' && element.props.href === '/'));
});
test('Bag save/loading announcements and uncertain retry/catalogue error retain separate recovery actions', () => {
  const view = bagScreen(); view.signedIn(true); view.state({ status: 'saving', items: [], canRetry: true });
  let header = view.render().props.ListHeaderComponent;
  assert.equal(find(header, element => element.type === 'ActivityIndicator').props.accessibilityLabel, 'Saving your Bag');
  assert.equal(find(header, element => element.props?.label === 'Retry saved change').props.disabled, true);
  assert.equal(find(header, element => element.props?.label === 'Refresh Bag').props.busy, true);
  view.state({ status: 'loading', items: [] }); header = view.render().props.ListHeaderComponent;
  assert.equal(find(header, element => element.type === 'ActivityIndicator').props.accessibilityLabel, 'Loading your Bag');
  view.state({ status: 'ready', items: [], canRetry: true, message: 'Uncertain saved change' }); view.catalogue({ status: 'error' });
  header = view.render().props.ListHeaderComponent;
  assert.equal(find(header, element => element.props?.accessibilityRole === 'alert').props.children, 'Uncertain saved change');
  find(header, element => element.props?.label === 'Retry saved change').props.onPress();
  find(header, element => element.props?.label === 'Retry catalogue').props.onPress();
  assert.deepEqual(view.calls, ['retry', 'catalogue']);
});
test('large-text catalogue uses one column and keeps Account/Bag links and keyboard controls', () => {
  const host = hooks(); const Screen = load('src/features/products/CatalogueScreen.tsx', {
    react: host.react, 'react-native': { ...native, useWindowDimensions: () => ({ width: 900, fontScale: 2 }) },
    'expo-router': { Link: 'Link' }, '../../components/ProductCard': { ProductCard: 'ProductCard' },
    './ProductContext': { useProducts: () => ({ state: { status: 'ready', products: [] }, refresh: () => {} }) },
    '../cart/BagContext': { useBag: () => ({ signedIn: false }) },
  }).default;
  host.begin(); const list = find(Screen(), element => element.type === 'FlatList');
  assert.equal(list.props.numColumns, 1); assert.equal(list.props.keyboardShouldPersistTaps, 'handled');
  for (const href of ['/account', '/bag']) assert.ok(find(list.props.ListHeaderComponent, element => element.type === 'Link' && element.props.href === href));
});
test('repeated signed-out Add uses navigate instead of forced push; callback replace and provider scope remain intact', () => {
  const host = hooks(); const calls = [];
  const Card = load('src/components/ProductCard.tsx', {
    react: host.react, 'expo-router': { router: { navigate: path => calls.push(path), push: () => { throw new Error('Forced duplicate push'); } } },
    './ProductImage': { ProductImage: 'ProductImage' }, './ActionButton': { ActionButton: 'ActionButton' },
    '../features/auth/AuthContext': { useAuth: () => ({ state: { status: 'signed-out' }, busy: false }) },
    '../features/cart/BagContext': { useBag: () => ({ signedIn: false, state: { status: 'ready', items: [] } }) },
  }).ProductCard;
  host.begin(); const tree = Card({ product: { id: 'actual', name: 'Mug', price: 100, image: '', category: 'Dining', color: '#FFFFFF',
    variants: [{ id: 'actual-variant', productId: 'actual', options: {}, isDefault: true, price: 100, inventoryPolicy: 'untracked' }] } });
  const button = find(tree, element => element.type === 'ActionButton'); button.props.onPress(); button.props.onPress();
  assert.deepEqual(calls, ['/account', '/account']); // Routing intent only, not Android stack simulation.
  assert.match(fs.readFileSync('src/app/auth/callback.tsx', 'utf8'), /router\.replace\('\/account'\)/);
  assert.match(fs.readFileSync('src/app/_layout.tsx', 'utf8'), /<AuthProvider><ProductProvider><BagProvider>/);
});
test('shared action accessibility reports busy/disabled and retains a 48-point minimum target', () => {
  const { ActionButton } = load('src/components/ActionButton.tsx');
  const element = ActionButton({ label: 'Retry', onPress: () => {}, busy: true, disabled: true });
  assert.equal(element.props.accessibilityRole, 'button'); assert.equal(element.props.accessibilityLabel, 'Retry');
  assert.equal(element.props.accessibilityState.busy, true); assert.equal(element.props.accessibilityState.disabled, true);
  assert.equal(element.props.style({ pressed: false })[0].minHeight, 48);
});
