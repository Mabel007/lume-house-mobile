const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/source.cjs');
const profile = load('src/features/profile/profile.ts');
const { ProfileController } = load('src/features/profile/ProfileController.ts');
const { loadProfile, saveProfile } = load('src/features/profile/profileRepository.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const blank = () => ({ ...profile.emptyProfile });
test('account identity is keyed per customer and hidden immediately on sign-out', () => {
  const { native, find } = require('./helpers/source.cjs');
  let state = { status: 'signed-in', user: { id: 'a', email: 'a@example.invalid' } };
  const Screen = load('src/features/auth/AccountScreen.tsx', { react: { useState: value => [value, () => {}] }, 'react-native': native,
    'expo-router': { Link: 'Link' }, '../profile/CustomerProfile': { CustomerProfile: 'CustomerProfile' }, './localFixtureAuth': { localFixtureAvailable: () => true },
    './AuthContext': { useAuth: () => ({ state, busy: false, message: null }) } }).default;
  let tree = Screen(); let customer = find(tree, element => element.type === 'CustomerProfile'); assert.equal(customer.key, 'a'); assert.equal(customer.props.email, 'a@example.invalid');
  state = { status: 'signed-in', user: { id: 'b', email: 'b@example.invalid' } }; customer = find(Screen(), element => element.type === 'CustomerProfile'); assert.equal(customer.key, 'b');
  state = { status: 'signed-out' }; tree = Screen(); assert.equal(find(tree, element => element.type === 'CustomerProfile'), undefined);
  assert.equal(find(tree, element => element.type === 'KeyboardAvoidingView').props.behavior, 'height');
  assert.equal(find(tree, element => element.type === 'ScrollView').props.keyboardDismissMode, 'on-drag');
});
test('delivery UI exposes labelled fields, inline errors, save/cancel and empty states', () => {
  const { hooks, find } = require('./helpers/source.cjs'); const host = hooks(); let snapshot = { status: 'ready', saved: blank(), draft: blank(), errors: { phone: 'Invalid phone' }, message: null };
  let cancelled = false; const calls = [];
  class Controller { getSnapshot = () => snapshot; subscribe = () => () => {}; activate() {} deactivate() {} refresh() {} edit() {} cancel() { cancelled = true; } save = async fields => { calls.push(fields); return false; }; }
  const Screen = load('src/features/profile/CustomerProfile.tsx', { react: { ...host.react, useEffect: () => {}, useSyncExternalStore: (subscribe, get) => get() },
    './ProfileController': { ProfileController: Controller }, './profileRepository': {}, '../../lib/supabase/client': {}, '../../components/ActionButton': { ActionButton: 'ActionButton' } }).CustomerProfile;
  const render = () => { host.begin(); return Screen({ userId: 'a', email: 'synthetic@example.invalid' }); };
  let tree = render(); assert.ok(find(tree, element => element.props?.children === 'No delivery address saved.'));
  find(tree, element => element.props?.label === 'Edit delivery details').props.onPress(); tree = render();
  for (const label of ['Delivery contact name', 'Delivery contact phone', 'Street address / landmark', 'Area / community', 'City / town']) assert.ok(find(tree, element => element.type === 'TextInput' && element.props.accessibilityLabel === label));
  assert.equal(find(tree, element => element.props?.accessibilityRole === 'alert').props.children, 'Invalid phone');
  find(tree, element => element.props?.label === 'Save delivery details').props.onPress(); assert.equal(calls[0].length, 5);
  find(tree, element => element.props?.label === 'Cancel delivery changes').props.onPress(); assert.equal(cancelled, true);
  snapshot = { ...snapshot, status: 'error', message: 'Please retry' }; tree = render(); assert.ok(find(tree, element => element.props?.label === 'Retry loading details'));
});
test('optional profile matches web normalization, nulls and length bounds', () => {
  for (const phone of ['76521208', '076521208', '23276521208', '0023276521208', '+232 (76) 521-208']) assert.equal(profile.normalizePhone(phone), '+23276521208');
  assert.equal(profile.profileValues({ ...blank(), phone: '076521208' }, ['phone']).phone, '+23276521208');
  assert.equal(profile.profileValues(blank(), ['full_name']).full_name, null);
  assert.ok(profile.profileErrors({ ...blank(), phone: '123' }).phone);
  assert.ok(profile.profileErrors({ ...blank(), full_name: 'a'.repeat(201) }).full_name);
  assert.deepEqual(plain(profile.mapProfile({ phone: null, full_name: 4, default_city: 'Town' })), { ...blank(), default_city: 'Town' });
});
test('controller validates before saving, cancel restores and refresh retrieves server values', async () => {
  let savedCalls = 0;
  const value = { ...blank(), full_name: 'Customer A' };
  const controller = new ProfileController({ load: async () => value, save: async draft => { savedCalls++; return draft; } });
  controller.activate(); await controller.refresh();
  controller.edit('phone', 'invalid'); assert.equal(await controller.save(['full_name', 'phone']), false); assert.equal(savedCalls, 0);
  controller.cancel(); assert.equal(controller.getSnapshot().draft.phone, '');
  controller.edit('full_name', 'Changed'); assert.equal(await controller.save(['full_name']), true);
  assert.equal(controller.getSnapshot().saved.full_name, 'Changed');
  await controller.refresh(); assert.equal(controller.getSnapshot().draft.full_name, 'Customer A');
});
test('late load and save cannot leak across deactivation and reactivation', async () => {
  let resolve;
  const controller = new ProfileController({ load: () => new Promise(done => { resolve = done; }), save: () => new Promise(done => { resolve = done; }) });
  controller.activate(); const loading = controller.refresh(); controller.deactivate(); resolve({ ...blank(), full_name: 'A' }); await loading;
  assert.equal(controller.getSnapshot().saved.full_name, '');
  controller.activate(); const next = controller.refresh(); resolve(blank()); await next;
  controller.edit('full_name', 'A'); const saving = controller.save(['full_name']); controller.deactivate(); controller.activate(); resolve({ ...blank(), full_name: 'A' }); await saving;
  assert.equal(controller.getSnapshot().saved.full_name, '');
});
test('recoverable load and uncertain save errors do not erase valid data', async () => {
  let fail = true;
  const controller = new ProfileController({ load: async () => { if (fail) throw Error('private backend error'); return { ...blank(), full_name: 'Saved' }; }, save: async () => { throw Error('private backend error'); } });
  controller.activate(); await controller.refresh(); assert.equal(controller.getSnapshot().status, 'error');
  fail = false; await controller.refresh(); controller.edit('full_name', 'Draft'); await controller.save(['full_name']);
  assert.equal(controller.getSnapshot().saved.full_name, 'Saved'); assert.equal(controller.getSnapshot().draft.full_name, 'Draft');
  assert.match(controller.getSnapshot().message, /Refresh/); assert.doesNotMatch(controller.getSnapshot().message, /private/);
});
function client({ id = 'a', existing = true, race = false, wrongUpdate = false } = {}) {
  const writes = []; let selection;
  const api = { auth: { getUser: async () => ({ data: { user: { id } }, error: null }) }, from: table => {
    assert.equal(table, 'profiles'); const query = {
      select: columns => { selection = columns; return query; }, eq: (key, value) => { assert.equal(key, 'id'); assert.equal(value, 'a'); return query; },
      maybeSingle: async () => ({ data: existing ? { id: 'a', full_name: 'A', default_city: 'Saved town' } : null, error: null }),
      insert: values => { writes.push(['insert', values]); return query; }, update: values => { writes.push(['update', values]); return query; },
      single: async () => ({ data: { full_name: 'Changed', default_city: 'Saved town' }, error: race && writes.at(-1)[0] === 'insert' ? { code: '23505' } : wrongUpdate ? { code: 'PGRST116' } : null }),
    }; return query;
  } };
  return { api, writes, selection: () => selection };
}
test('repository binds owner and rejects inactive or mismatched sessions before writes', async () => {
  for (const options of [{ id: 'b' }, { id: 'a' }]) {
    const fixture = client(options);
    await assert.rejects(saveProfile(fixture.api, 'a', blank(), ['full_name'], () => options.id !== 'a'));
    assert.equal(fixture.writes.length, 0);
  }
});
test('repository saves partial fields, handles insert race and requires returned owner row', async () => {
  for (const options of [{}, { existing: false }, { existing: false, race: true }]) {
    const fixture = client(options);
    const saved = await saveProfile(fixture.api, 'a', { ...blank(), full_name: 'Changed' }, ['full_name'], () => true);
    assert.equal(saved.default_city, 'Saved town');
    for (const [, values] of fixture.writes) assert.equal(Object.hasOwn(values, 'default_city'), false);
  }
  const denied = client({ wrongUpdate: true });
  await assert.rejects(saveProfile(denied.api, 'a', blank(), ['full_name'], () => true));
  const fixture = client(); assert.equal((await loadProfile(fixture.api, 'a', () => true)).full_name, 'A');
});
test('delivery defaults share contact fields, allow missing information and reject malformed inputs', async () => {
  const draft = { ...blank(), full_name: 'Synthetic customer', phone: '076521208', default_street_address: ' Synthetic landmark ', default_area: 'Community', default_city: 'Town' };
  assert.deepEqual(plain(profile.profileValues(draft, profile.profileFields)), { ...draft, phone: '+23276521208', default_street_address: 'Synthetic landmark' });
  assert.equal(profile.profileValues(blank(), profile.profileFields).default_city, null);
  assert.throws(() => profile.profileValues({ ...draft, default_area: 'a'.repeat(201) }, profile.profileFields));
  const fixture = client(); await saveProfile(fixture.api, 'a', draft, profile.profileFields, () => true);
  assert.equal(fixture.writes[0][1].default_street_address, 'Synthetic landmark');
  assert.equal(fixture.writes[0][1].phone, '+23276521208');
});
