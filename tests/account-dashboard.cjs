const test = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, find, expand, events, resetEvents, duplicateKeys } = require('./helpers/source.cjs');
const profile = load('src/features/profile/profile.ts');
const { shop } = load('src/config/shop.ts');
const blank = () => ({ full_name: '', phone: '', default_street_address: '', default_area: '', default_city: '' });
const settle = () => new Promise(done => setImmediate(done));
const rowFor = (tree, title) => find(tree, element => String(element.props?.accessibilityLabel ?? '').startsWith(`${title}.`));
const avatar = tree => find(tree, element => element.props?.style?.borderRadius === 28).props.children;
const surface = tree => find(tree, element => element.type === 'CustomerProfile').props;
function textOf(element) {
  if (typeof element === 'string') return element;
  if (!element || typeof element !== 'object') return '';
  return [element.props?.children].flat(Infinity).map(textOf).join(' ');
}
function mount(id, rows, { local = false } = {}) {
  const host = hooks(); const writes = []; const routes = [];
  const Dashboard = load('src/features/account/AccountDashboard.tsx', {
    react: { ...host.react, useSyncExternalStore: (subscribe, get) => get() },
    'expo-router': { router: { navigate: route => routes.push(['navigate', route]), push: route => routes.push(['push', route]) } },
    '../profile/CustomerProfile': { CustomerProfile: 'CustomerProfile' },
    '../profile/profileRepository': {
      loadProfile: async (_client, owner) => { writes.push(['load', owner]); return profile.mapProfile(rows[owner]); },
      saveProfile: async (_client, owner, draft, fields) => { writes.push(['save', owner, [...fields]]); return { ...profile.mapProfile(rows[owner]), ...Object.fromEntries(fields.map(key => [key, draft[key]])) }; },
    },
    '../../lib/supabase/client': { getSupabaseClient: () => ({ synthetic: true }) },
  }).AccountDashboard;
  const render = () => { host.begin(); return expand(Dashboard({ userId: id, email: `${id}@example.invalid`, accountName: 'OAuth Name', local, busy: false, onSignOut: () => writes.push(['sign-out', id]) })); };
  return { host, writes, routes, render, ready: async () => { render(); await settle(); return render(); } };
}

test('dashboard header shows the saved customer identity with a real initials mark', async () => {
  resetEvents();
  const rows = { a: { ...blank(), full_name: 'Aisha Sesay', phone: '+23276521208' }, b: blank() };
  const saved = mount('a', rows); const tree = await saved.ready();
  assert.equal(avatar(tree), 'AS');
  assert.ok(find(tree, element => element.props?.children === 'Aisha Sesay'), 'the saved profile name is the displayed name');
  assert.ok(find(tree, element => element.props?.children === 'a@example.invalid'));
  assert.ok(find(tree, element => element.props?.children === 'Signed in with Google'));
  assert.equal(textOf(tree).includes('OAuth Name'), false, 'the saved name wins over account metadata');
  saved.host.unmount();
  const anonymous = mount('b', rows); const second = await anonymous.ready();
  assert.equal(avatar(second), 'ON', 'a customer with nothing saved falls back to the account name');
  assert.equal(find(second, element => element.props?.children === 'Your account'), undefined);
  anonymous.host.unmount();
});
test('initials follow the web algorithm without browser-only Intl APIs', async () => {
  const { accountInitials } = load('src/features/account/accountInitials.ts');
  for (const [name, expected] of [['Aisha Sesay', 'AS'], ['  christian   NYUMA  ', 'CN'], ['Ada', 'A'], ['', 'LH'], ['   ', 'LH'], ['-Anne Bello', 'AB'], ['O', 'O'], ['Fatu Kamara Sesay', 'FS']]) {
    assert.equal(accountInitials(name), expected, `initials of ${JSON.stringify(name)}`);
  }
  assert.equal(accountInitials(null), 'LH');
  const source = require('node:fs').readFileSync('src/features/account/accountInitials.ts', 'utf8');
  assert.doesNotMatch(source, /new Intl\.Segmenter/, 'Hermes must not be asked for Intl.Segmenter');
});
test('local QA builds hide Google identity and never render an email address', async () => {
  const rows = { a: { ...blank(), full_name: 'Customer A', phone: '+23276521208' }, b: blank() };
  const view = mount('a', rows, { local: true }); const copy = textOf(await view.ready());
  assert.ok(copy.includes('Signed in to local QA'));
  assert.ok(!copy.includes('@'), `local build leaked an address: ${copy}`);
  assert.ok(!copy.includes('Google'), `local build claimed Google sign-in: ${copy}`);
  assert.ok(!copy.includes('OAuth Name'), 'local build must not surface OAuth metadata as identity');
  assert.ok(copy.includes('Customer A'), 'the customer own saved name is still shown');
  view.host.unmount();
  const blankView = mount('b', rows, { local: true }); const tree = await blankView.ready();
  assert.equal(avatar(tree), 'LH');
  assert.ok(textOf(tree).includes('Your account'));
  blankView.host.unmount();
});
test('the identity block is one screen-reader focus stop that names the customer and the sign-in context', async () => {
  const rows = { a: { ...blank(), full_name: 'Aisha Sesay', phone: '+23276521208' }, b: blank() };
  const saved = mount('a', rows); const tree = await saved.ready();
  const header = find(tree, element => element.props?.accessible === true);
  assert.ok(header, 'the identity block is merged into one accessible element');
  assert.equal(header.props.accessibilityRole, 'header');
  assert.equal(header.props.accessibilityLabel, 'Your account, Aisha Sesay, a@example.invalid, Signed in with Google');
  assert.equal([header.props.children].flat(Infinity).filter(child => child?.props?.accessibilityLabel !== undefined).length, 0, 'a merged child must not repeat the announcement');
  assert.equal(avatar(header), 'AS', 'the initials stay on screen but are decorative');
  assert.equal(header.props.accessibilityElementsHidden, undefined, 'the focus stop itself is never hidden');
  saved.host.unmount();
  const localView = mount('b', rows, { local: true }); const local = await localView.ready();
  const localHeader = find(local, element => element.props?.accessible === true);
  assert.equal(localHeader.props.accessibilityLabel, 'Your account, Signed in to local QA', 'a customer with nothing saved is still named once');
  assert.ok(!localHeader.props.accessibilityLabel.includes('@'), 'a local session must not announce an address');
  assert.ok(!localHeader.props.accessibilityLabel.includes('Google'), 'a local session must not claim Google sign-in');
  localView.host.unmount();
});
test('navigation opens exactly one editor at a time and keeps the panels honest', async () => {
  resetEvents();
  const rows = { a: { ...blank(), full_name: 'Customer A', phone: '+23276521208', default_street_address: 'Landmark', default_area: 'Community', default_city: 'Town' } };
  const view = mount('a', rows); await view.ready();
  for (const title of ['Personal Information', 'Delivery Details', 'My Orders', 'Help & Support']) assert.ok(rowFor(view.render(), title), `${title} row is missing`);
  assert.ok(find(view.render(), element => element.props?.accessibilityLabel === 'Sign out of your account'));
  rowFor(view.render(), 'Personal Information').props.onPress(); let tree = view.render();
  assert.equal(surface(tree).editor, 'profile');
  assert.equal(rowFor(tree, 'Personal Information').props.accessibilityState.selected, true);
  rowFor(tree, 'Delivery Details').props.onPress(); tree = view.render();
  assert.equal(surface(tree).editor, 'delivery', 'the editors stay separate but never both open');
  assert.equal(rowFor(tree, 'Personal Information').props.accessibilityState.selected, false);
  rowFor(tree, 'Delivery Details').props.onPress(); tree = view.render();
  assert.equal(surface(tree).editor, null, 'the same row closes its section');
  assert.deepEqual(view.writes.filter(call => call[0] === 'load'), [['load', 'a']], 'the owner bound into the repository is the signed-in customer');
  rowFor(view.render(), 'My Orders').props.onPress(); tree = view.render();
  assert.deepEqual(view.routes, [['navigate', '/orders']], 'My Orders is a native screen now, not a panel on this screen');
  assert.doesNotMatch(textOf(tree), /Order history is not available|you have \d+ orders|order reference/i, 'the placeholder is gone and no order data is implied');
  assert.equal(events.links.length, 0, 'order history never leaves the app for the hosted website');
  view.host.unmount();
});
test('local builds do not link customer data to the hosted website', async () => {
  resetEvents();
  const rows = { a: { ...blank(), full_name: 'Customer A' } };
  const view = mount('a', rows, { local: true }); let tree = await view.ready();
  rowFor(tree, 'My Orders').props.onPress(); tree = view.render();
  assert.equal(find(tree, element => String(element.props?.accessibilityLabel ?? '').startsWith('Open My Orders')), undefined);
  assert.deepEqual(view.routes, [['navigate', '/orders']], 'a local build reads its own local orders screen');
  assert.equal(events.links.length, 0, 'local QA must not open hosted customer pages');
  rowFor(tree, 'Help & Support').props.onPress(); tree = view.render();
  assert.equal(events.links.length, 0);
  assert.match(textOf(tree), /private local enrollment code/);
  view.host.unmount();
});
test('help panel states only verified facts and links published pages', async () => {
  resetEvents();
  const view = mount('a', { a: blank() }); await view.ready();
  rowFor(view.render(), 'Help & Support').props.onPress(); const tree = view.render();
  const copy = textOf(tree);
  assert.match(copy, /You sign in with Google\. Lumé House does not manage a password/);
  assert.match(copy, /Checkout edits apply to that order only/);
  assert.ok(!/\+\d{7,}/.test(copy), `invented phone number leaked: ${copy}`);
  assert.ok(!copy.includes('mailto:'), 'no fabricated contact address is bundled');
  const labels = ['Help & Contact on the Lumé House website', 'Delivery & Pickup on the Lumé House website', 'Returns & Refunds on the Lumé House website'];
  for (const label of labels) assert.ok(find(tree, element => element.props?.accessibilityLabel === label), `${label} missing`);
  find(tree, element => element.props?.accessibilityLabel === labels[1]).props.onPress();
  assert.deepEqual(events.links, [`${shop.webOrigin}/help/delivery-pickup`]);
  view.host.unmount();
});
test('sign-out action is handed to the auth layer for the current customer only', async () => {
  const view = mount('a', { a: blank() }); await view.ready();
  find(view.render(), element => element.props?.accessibilityLabel === 'Sign out of your account').props.onPress();
  assert.deepEqual(view.writes, [['load', 'a'], ['sign-out', 'a']]);
  view.host.unmount();
});
test('switching customers rebuilds the owner guard and erases the private draft', async () => {
  resetEvents();
  const rows = { a: { ...blank(), full_name: 'Customer A', phone: '+23276521208' }, b: { ...blank(), full_name: 'Customer B', phone: '+23276521209' } };
  const first = mount('a', rows, { local: true }); await first.ready();
  rowFor(first.render(), 'Personal Information').props.onPress();
  const before = surface(first.render());
  before.controller.edit('full_name', 'Private draft');
  first.render();
  assert.equal(before.controller.getSnapshot().draft.full_name, 'Private draft');
  assert.equal(before.controller.isActive(), true);
  first.host.unmount();
  assert.equal(before.controller.isActive(), false, 'sign-out must deactivate the owner guard before any write');
  assert.equal(before.controller.getSnapshot().draft.full_name, '', 'sign-out must erase the private draft');
  const second = mount('b', rows, { local: true }); await second.ready();
  const after = surface(second.render());
  assert.notEqual(after.controller, before.controller, 'the next customer must not reuse the previous owner guard');
  assert.equal(after.controller.getSnapshot().saved.full_name, 'Customer B');
  assert.equal(textOf(second.render()).includes('Private draft'), false, 'customer A draft must not surface for customer B');
  assert.deepEqual(second.writes, [['load', 'b']]);
  second.host.unmount();
});
test('dashboard renders no duplicate sibling keys in any section', async () => {
  const view = mount('a', { a: { ...blank(), full_name: 'Customer A' } }); await view.ready();
  assert.deepEqual(duplicateKeys(view.render()), []);
  for (const title of ['Personal Information', 'Delivery Details', 'My Orders', 'Help & Support']) {
    rowFor(view.render(), title).props.onPress();
    assert.deepEqual(duplicateKeys(view.render()), [], `duplicate sibling keys with ${title} open`);
  }
  view.host.unmount();
});
