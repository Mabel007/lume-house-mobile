const assert = require('node:assert/strict');
const test = require('node:test');
const { load, hooks, find } = require('./helpers/source.cjs');
const { filterProducts, productCategories } = load('src/features/products/search.ts');
const products = [
  { id: 'a', name: 'Café Mug', category: 'Dining', description: 'Warm stoneware', variants: [{ id: 'actual-a' }] },
  { id: 'b', name: 'Soft throw', category: 'Living', description: 'Warm cotton' },
  { id: 'c', name: 'Glass Mug', category: 'Dining', description: 'Clear glass' },
];
const ids = result => Array.from(result, product => product.id);
test('case/accent-insensitive multi-term search matches name/category/description using AND', () => {
  assert.deepEqual(ids(filterProducts(products, '  CAFE  WARM dining ', null)), ['a']);
  assert.deepEqual(ids(filterProducts(products, 'mug glass', null)), ['c']);
  assert.deepEqual(ids(filterProducts(products, 'cafe cotton', null)), []);
  assert.deepEqual(ids(filterProducts(products, '  ', null)), ['a', 'b', 'c']);
});
test('derived categories and exact category/search AND preserve authoritative products', () => {
  assert.deepEqual(Array.from(productCategories(products)), ['Dining', 'Living']);
  assert.deepEqual(ids(filterProducts(products, 'warm', 'Dining')), ['a']);
  assert.deepEqual(ids(filterProducts(products, 'mug', 'Living')), []);
  assert.equal(filterProducts(products, 'cafe', null)[0], products[0]);
  assert.equal(filterProducts(products, '', 'Dining')[0].variants[0].id, 'actual-a');
});
function screen(initial = { status: 'ready', products }) {
  const host = hooks(); let state = initial; let refreshes = 0;
  const Screen = load('src/features/products/CatalogueScreen.tsx', {
    react: host.react, 'expo-router': { Link: 'Link' },
    '../../components/ProductCard': { ProductCard: 'ProductCard' },
    './ProductContext': { useProducts: () => ({ state, refresh: () => { refreshes++; } }) },
    '../cart/BagContext': { useBag: () => ({ signedIn: false }) },
  }).default;
  return { render: () => { host.begin(); return find(Screen(), element => element.type === 'FlatList'); },
    setState: value => { state = value; }, refreshes: () => refreshes };
}
const button = (list, label) => find(list.props.ListHeaderComponent, element => element.props?.label === label || element.props?.accessibilityLabel === label);
test('native search/category controls clear query only and reset both, with accessible keyboard contracts', () => {
  const view = screen(); let list = view.render();
  const input = find(list.props.ListHeaderComponent, element => element.type === 'TextInput');
  assert.equal(input.props.accessibilityLabel, 'Search products'); assert.equal(input.props.autoCapitalize, 'none');
  assert.equal(input.props.autoCorrect, false); assert.equal(input.props.returnKeyType, 'search');
  assert.equal(list.props.keyboardShouldPersistTaps, 'handled'); assert.equal(list.props.keyboardDismissMode, 'on-drag');
  button(list, 'Category: Dining').props.onPress(); input.props.onChangeText('cafe'); list = view.render();
  assert.deepEqual(ids(list.props.data), ['a']); assert.equal(button(list, 'Category: Dining').props.accessibilityState.selected, true);
  button(list, 'Clear search').props.onPress(); list = view.render(); assert.deepEqual(ids(list.props.data), ['a', 'c']);
  button(list, 'Reset filters').props.onPress(); list = view.render(); assert.deepEqual(ids(list.props.data), ['a', 'b', 'c']);
  assert.equal(button(list, 'All categories').props.accessibilityState.selected, true);
  assert.equal(button(list, 'Clear search').props.disabled, true);
});
test('no-match, empty catalogue, loading and error remain distinct; retry retains repository refresh', () => {
  const view = screen(); let list = view.render();
  find(list.props.ListHeaderComponent, element => element.type === 'TextInput').props.onChangeText('missing');
  list = view.render(); assert.equal(list.props.data.length, 0);
  assert.match(find(list.props.ListEmptyComponent, element => element.type === 'Text').props.children, /No products match/);
  view.setState({ status: 'ready', products: [] }); list = view.render();
  assert.match(find(list.props.ListEmptyComponent, element => element.type === 'Text').props.children, /New pieces/);
  view.setState({ status: 'loading' }); list = view.render();
  assert.equal(find(list.props.ListEmptyComponent, element => element.type === 'ActivityIndicator').props.accessibilityLabel, 'Loading catalogue');
  view.setState({ status: 'error' }); list = view.render();
  assert.equal(find(list.props.ListEmptyComponent, element => element.type === 'Text').props.accessibilityRole, 'alert');
  find(list.props.ListEmptyComponent, element => element.props?.label === 'Retry catalogue').props.onPress();
  assert.equal(view.refreshes(), 1); assert.equal(button(list, 'Reset filters'), undefined);
});
