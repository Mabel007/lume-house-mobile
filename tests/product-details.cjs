const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { load, hooks, find, expand } = require('./helpers/source.cjs');
const { findRouteProduct, productHref } = load('src/features/products/productRoute.ts');
const product = { id: 'real-a', name: 'Mug', category: 'Dining', description: 'Full product description',
  image: 'unsafe', color: '#FFFFFF', price: 900, variants: [
    { id: 'small-real', productId: 'real-a', price: 100, options: { Size: 'Small' }, isDefault: false, inventoryPolicy: 'untracked' },
    { id: 'large-real', productId: 'real-a', price: 200, options: { Size: 'Large' }, isDefault: false, inventoryPolicy: 'untracked' },
    { id: 'sold-real', productId: 'real-a', price: 300, options: { Size: 'Sold' }, isDefault: false, inventoryPolicy: 'tracked', available: false },
  ] };
test('exact public identity lookup and encoded route never synthesize products/variants', () => {
  assert.equal(findRouteProduct([product], 'real-a'), product);
  for (const id of ['unknown', 'archived', '', null, undefined, ['real-a']]) assert.equal(findRouteProduct([product], id), undefined);
  assert.equal(productHref('a/b?#'), '/products/a%2Fb%3F%23');
  assert.match(fs.readFileSync('src/app/products/[productId].tsx', 'utf8'), /ProductDetailsScreen/);
});
function details(initial = { status: 'ready', products: [product] }, id = 'real-a') {
  let state = initial; let routeId = id; let refreshes = 0; let canGoBack = false; const navigation = [];
  const host = hooks();
  const Screen = load('src/features/products/ProductDetailsScreen.tsx', {
    react: host.react,
    'expo-router': { Link: 'Link', useLocalSearchParams: () => ({ productId: routeId }), router: {
      canGoBack: () => canGoBack, back: () => navigation.push('back'), replace: path => navigation.push(path),
    } }, '../../components/ProductCard': { ProductCard: 'ProductCard' },
    '../features/cart/BagContext': { useBag: () => ({ signedIn: true, state: { status: 'ready', items: [] } }) },
    './ProductContext': { useProducts: () => ({ state, refresh: () => { refreshes++; } }) },
  }).default;
  return { render: () => { host.begin(); return Screen(); }, setState: value => { state = value; }, setId: value => { routeId = value; },
    setBack: value => { canGoBack = value; }, navigation, refreshes: () => refreshes };
}
test('cold route loads through shared provider; loading/error/retry/unknown/archive stay safe', () => {
  const view = details({ status: 'loading' });
  assert.equal(find(view.render(), element => element.type === 'ActivityIndicator').props.accessibilityLabel, 'Loading product');
  view.setState({ status: 'error' }); assert.equal(find(view.render(), element => element.props?.accessibilityRole === 'alert').type, 'Text');
  find(view.render(), element => element.props?.label === 'Retry product').props.onPress(); assert.equal(view.refreshes(), 1);
  view.setState({ status: 'ready', products: [product] }); assert.equal(find(view.render(), element => element.type === 'ProductCard').props.product, product);
  for (const id of ['unknown', 'archived']) {
    view.setId(id); assert.equal(find(view.render(), element => element.type === 'ProductCard'), undefined);
    assert.equal(find(view.render(), element => element.props?.accessibilityRole === 'header').props.children, 'Product unavailable');
  }
  view.setState({ status: 'ready', products: [] }); assert.equal(find(view.render(), element => element.type === 'ProductCard'), undefined);
});
test('changing product changes keyed selection instance and deep-link back has a collection fallback', () => {
  const second = { ...product, id: 'real-b' }; const view = details({ status: 'ready', products: [product, second] });
  assert.equal(find(view.render(), element => element.type === 'ProductCard').key, 'real-a');
  view.setId('real-b'); assert.equal(find(view.render(), element => element.type === 'ProductCard').key, 'real-b');
  find(view.render(), element => element.props?.label === 'Back').props.onPress(); assert.equal(view.navigation[0], '/');
  view.setBack(true); find(view.render(), element => element.props?.label === 'Back').props.onPress(); assert.equal(view.navigation[1], 'back');
  assert.ok(find(expand(view.render()), element => element.type === 'Link' && element.props.href === '/bag'),
    'the shared Bag destination is on the product page');
  assert.ok(find(expand(view.render()), element => element.type === 'Link' && element.props.href === '/account'),
    'and so is the account one');
});
function card(signedIn, initial = product) {
  const host = hooks(); const actions = []; const navigation = [];
  const { ProductCard } = load('src/components/ProductCard.tsx', {
    react: host.react, 'expo-router': { Link: 'Link', router: { push: path => navigation.push(path), navigate: path => navigation.push(path) } },
    './ProductImage': { ProductImage: 'ProductImage' }, './ActionButton': { ActionButton: 'ActionButton' },
    '../features/auth/AuthContext': { useAuth: () => ({ state: { status: signedIn ? 'signed-in' : 'signed-out' }, busy: false }) },
    '../features/cart/BagContext': { useBag: () => ({ signedIn, state: { status: 'ready', items: [] },
      current: () => ({ status: 'ready', items: [] }),
      dispatch: async action => { actions.push(action); return true; } }) },
  });
  return { render: (details = true) => { host.begin(); return ProductCard({ product: initial, details }); }, actions, navigation };
}
test('details reuse explicit real-ID choice, variant price, availability, image and authenticated add-one', async () => {
  const view = card(true); let tree = view.render();
  assert.equal(find(tree, element => element.type === 'ProductImage').props.image, 'unsafe');
  assert.equal(find(tree, element => element.props?.children === product.description).type, 'Text');
  assert.equal(find(tree, element => element.type === 'ActionButton').props.disabled, true);
  find(tree, element => element.props?.accessibilityLabel?.includes('Small')).props.onPress(); tree = view.render();
  assert.equal(find(tree, element => element.props?.accessibilityLabel?.includes('Sold')).props.disabled, true);
  assert.ok(find(tree, element => element.props?.children === 'Available'));
  const price = find(tree, element => element.type === 'Text' && Array.isArray(element.props.children) && element.props.children.at(-1)?.includes?.('NLe'));
  assert.ok(price); assert.equal(price.props.children.at(-1), 'NLe 1');
  find(tree, element => element.type === 'ActionButton').props.onPress(); await Promise.resolve();
  assert.equal(view.actions[0].variantId, 'small-real'); assert.equal(view.actions[0].type, 'add');
  find(view.render(), element => element.props?.accessibilityLabel?.includes('Large')).props.onPress();
  assert.equal(find(view.render(), element => element.props?.accessibilityLabel?.includes('Large')).props.accessibilityState.checked, true);
  assert.equal(view.navigation.length, 0);
});
test('signed-out browse/add directs to Account; unavailable selections never become purchasable', () => {
  const view = card(false); find(view.render(), element => element.props?.accessibilityLabel?.includes('Small')).props.onPress();
  assert.equal(find(view.render(), element => element.type === 'ActionButton').props.label, 'Sign in to add');
  find(view.render(), element => element.type === 'ActionButton').props.onPress(); assert.equal(view.navigation[0], '/account');
  assert.equal(view.actions.length, 0);
  const unavailable = card(true, { ...product, variants: [{ ...product.variants[2], options: {}, isDefault: true }] });
  assert.equal(find(unavailable.render(), element => element.type === 'ActionButton').props.disabled, true);
  assert.ok(find(unavailable.render(), element => element.props?.children === 'Unavailable'));
});
test('card image/information link is separate from variant/Add controls; detail card has no self-link', () => {
  const view = card(true); const tree = view.render(false);
  const link = find(tree, element => element.props?.accessibilityRole === 'link');
  assert.equal(find(link, element => element.props?.accessibilityRole === 'radio'), undefined);
  assert.equal(find(link, element => element.type === 'ActionButton'), undefined);
  link.props.onPress(); assert.equal(view.navigation[0], '/products/real-a');
  assert.equal(find(view.render(true), element => element.props?.accessibilityRole === 'link'), undefined);
});
