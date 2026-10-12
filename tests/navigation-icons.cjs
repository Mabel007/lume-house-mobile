// Slice S4: the shared account/Bag destinations, the count they carry, and the Account rows.
// Source/JSX simulation only: no native renderer, no font on this machine, no device acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { load, hooks, find, expand } = require('./helpers/source.cjs');
const glyphs = require('../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');

const collect = (element, predicate, found = []) => {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  for (const child of [element.props?.children].flat(Infinity)) collect(child, predicate, found);
  return found;
};
// A Pressable may take its style from a render prop, so the touch target is read the way the platform reads it.
const stylesOf = element => (typeof element.props?.style === 'function' ? element.props.style({ pressed: false }) : [element.props?.style]).flat();

const ready = units => ({ status: 'ready', items: [{ variantId: 'a', quantity: units }], message: null, canRetry: false });

function nav(signedIn = true, state = ready(3)) {
  const host = hooks(); const bag = { signedIn, state };
  const module = load('src/components/CommerceNav.tsx', {
    react: host.react, 'expo-router': { Link: 'Link' },
    '../features/cart/BagContext': { useBag: () => bag },
  });
  return { bag, module,
    render: name => { host.begin(); return expand(name === 'bag' ? module.BagLink() : module.AccountLink({})); },
    grid: label => { host.begin(); return expand(module.BagLink({ label })); } };
}

const link = tree => find(tree, element => element.type === 'Link');
const pressable = tree => find(tree, element => element.type === 'Pressable');
const icon = tree => find(tree, element => element.type === 'MaterialCommunityIcons');
const badge = tree => find(tree, element => element.type === 'Text' && element.props?.style?.backgroundColor === '#535B40');

test('the badge counts units the shop published, and stays silent whenever it could not', () => {
  const { bagBadge } = nav().module;
  // Re-built in this realm: a badge made inside the simulated module is the same shape but not the same prototype.
  const said = badge => (badge ? { shown: badge.shown, spoken: badge.spoken } : badge);
  assert.deepEqual(said(bagBadge(true, { status: 'ready', items: [{ variantId: 'a', quantity: 2 }, { variantId: 'b', quantity: 3 }] })),
    { shown: '5', spoken: '5 items in your Bag' }, 'two selections of different pieces are five units, not two');
  assert.deepEqual(said(bagBadge(true, ready(1))), { shown: '1', spoken: '1 item in your Bag' }, 'one unit is not described as many');
  assert.deepEqual(said(bagBadge(true, ready(100))), { shown: '99+', spoken: 'more than 99 items in your Bag' },
    'a count that would widen the row is capped, and the spoken form stays honest about the cap');
  assert.equal(bagBadge(true, ready(0)), null, 'an empty Bag shows nothing rather than an alarming zero');
  assert.equal(bagBadge(false, ready(3)), null, 'a signed-out browse has no server Bag to count');
  for (const status of ['loading', 'error', 'uncertain']) {
    assert.equal(bagBadge(true, { status, items: [{ variantId: 'a', quantity: 3 }] }), null,
      `${status}: while the cart is unknown or unconfirmed there is no honest number to show`);
  }
  assert.deepEqual(said(bagBadge(true, { status: 'saving', items: [{ variantId: 'a', quantity: 3 }] })),
    { shown: '3', spoken: '3 items in your Bag' }, 'a change being written still shows the last answer the shop gave');
});

test('the Bag destination names itself, carries the count once, and keeps the words the count sits beside', () => {
  const view = nav();
  const tree = view.render('bag');
  assert.equal(link(tree).props.href, '/bag'); assert.equal(link(tree).props.asChild, true, 'the route stays an Expo Router link');
  assert.equal(pressable(tree).props.accessibilityRole, 'link');
  assert.equal(pressable(tree).props.accessibilityLabel, 'Your Bag. 3 items in your Bag.',
    'one swipe stop says the destination and the count together');
  assert.equal(find(tree, element => element.type === 'Text' && element.props.children === 'Your Bag').props.accessibilityElementsHidden, undefined,
    'the words are still there for anyone who reads rather than hears');
  assert.equal(badge(tree).props.children, '3');
  assert.equal(badge(tree).props.accessibilityElementsHidden, true, 'the badge glyph is not a second announcement of the number');
  assert.equal(icon(tree).props.name, 'bag-personal-outline');
  assert.equal(icon(tree).props.accessibilityElementsHidden, true, 'the icon never carries meaning the label does not already have');
  assert.equal(pressable(tree).props.style.minHeight, 48, 'a navigation target stays at the touch minimum');
});

test('the Account destination claims nothing it cannot know', () => {
  const tree = nav().render('account');
  assert.equal(link(tree).props.href, '/account');
  assert.equal(pressable(tree).props.accessibilityLabel, 'Your account', 'no Bag count is spoken from the account link');
  assert.equal(icon(tree).props.name, 'account-circle-outline');
  assert.equal(badge(tree), undefined, 'and the badge belongs to the Bag alone');
});

test('a badge follows the session it belongs to: it vanishes on sign-out and on the next customer', () => {
  const view = nav();
  assert.equal(badge(view.render('bag')).props.children, '3');
  view.bag.signedIn = false; view.bag.state = { status: 'ready', items: [] };
  assert.equal(badge(view.render('bag')), undefined, 'the previous customer’s count is never left on screen');
  assert.equal(pressable(view.render('bag')).props.accessibilityLabel, 'Your Bag', 'and the label stops quoting a number it no longer has');
  view.bag.signedIn = true; view.bag.state = { status: 'loading', items: [] };
  assert.equal(badge(view.render('bag')), undefined, 'a Bag being restored shows no zero while it is unknown');
  view.bag.state = ready(2);
  assert.equal(badge(view.render('bag')).props.children, '2', 'the number the new session publishes is the number shown');
});

test('the label the screen already used survives the shared component', () => {
  assert.equal(find(nav().grid('View your Bag'), element => element.type === 'Text' && element.props.children === 'View your Bag').props.children,
    'View your Bag', 'the Account screen still calls it View your Bag');
  assert.equal(pressable(nav().grid('Review your Bag')).props.accessibilityLabel, 'Review your Bag. 3 items in your Bag.');
});

test('every glyph the app names exists in the font it is given, and nothing iOS-only is used', () => {
  const files = ['src/components/CommerceNav.tsx', 'src/features/account/AccountNavigation.tsx'];
  const named = files.flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    return [...source.matchAll(/(?:name|icon)="([^"]+)"|icon: '([^']+)'/g)].map(match => match[1] ?? match[2]);
  });
  assert.ok(named.length >= 6, 'the scan actually found the glyphs this slice added');
  for (const name of named) assert.ok(Object.hasOwn(glyphs, name), `${name} is not in the MaterialCommunityIcons map`);
  assert.deepEqual([...new Set(named)].filter(name => /apple|ios|sf/i.test(name)), [],
    'an iOS-only name would render as an empty box on Android');
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /expo-symbols/, `${file} would ask for SF Symbols`);
});

test('an Account row still speaks its own title and description, with the icon as decoration', () => {
  const host = hooks();
  const { AccountNavigation } = load('src/features/account/AccountNavigation.tsx', { react: host.react });
  const chosen = []; let signedOut = 0;
  const tree = expand(AccountNavigation({ active: 'orders', busy: false, local: false,
    onSelect: section => chosen.push(section), onSignOut: () => { signedOut++; } }));
  const rows = collect(tree, element => element.type === 'Pressable');
  assert.equal(rows.length, 5, 'four sections and the sign out row');
  assert.deepEqual(rows.map(row => row.props.accessibilityLabel), [
    'Personal Information. Your saved name and contact phone.',
    'Delivery Details. Your default street address, area and city.',
    'My Orders. Your placed orders and the status the shop recorded.',
    'Help & Support. Help, delivery, returns and contact pages.',
    'Sign out of your account',
  ], 'the words carry the row, so a row still makes sense with no font at all');
  for (const row of rows) assert.equal(icon(row).props.accessibilityElementsHidden, true, 'the chip is decoration beside those words');
  assert.deepEqual(collect(tree, element => element.type === 'MaterialCommunityIcons').map(element => element.props.name),
    ['account-circle-outline', 'map-marker-outline', 'receipt', 'help-circle-outline', 'logout']);
  assert.equal(rows[2].props.accessibilityState.selected, true, 'the open section is still the open section');
  assert.equal(rows[0].props.accessibilityState.selected, false);
  rows[0].props.onPress(); assert.deepEqual(chosen, ['profile'], 'a row still selects, and only selects');
  rows[4].props.onPress(); assert.equal(signedOut, 1);
  assert.ok(rows.every(row => stylesOf(row).some(style => style?.minHeight >= 48)), 'every row stays a large target');
});

test('an Account row under load stays labelled, refused and announced as busy', () => {
  const { AccountNavigation } = load('src/features/account/AccountNavigation.tsx', { react: hooks().react });
  const tree = expand(AccountNavigation({ active: null, busy: true, local: true, onSelect: () => { throw new Error('Busy row'); }, onSignOut: () => {} }));
  const rows = collect(tree, element => element.type === 'Pressable');
  assert.ok(rows.every(row => row.props.disabled === true && row.props.accessibilityState.busy === true));
  assert.equal(rows[3].props.accessibilityLabel, 'Help & Support. Account and delivery guidance.', 'the local build still describes its own help row');
});
