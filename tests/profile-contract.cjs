const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/source.cjs');
const profile = load('src/features/profile/profile.ts');
const { ProfileController } = load('src/features/profile/ProfileController.ts');
const { loadProfile, saveProfile } = load('src/features/profile/profileRepository.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const blank = () => ({ ...profile.emptyProfile });
test('account dashboard is keyed per customer and hidden immediately on sign-out', () => {
  const { native, find } = require('./helpers/source.cjs');
  let state = { status: 'signed-in', user: { id: 'a', email: 'a@example.invalid', user_metadata: { full_name: 'Customer A' } } };
  const Screen = load('src/features/auth/AccountScreen.tsx', { react: { useState: value => [value, () => {}] }, 'react-native': native,
    'expo-router': { Link: 'Link' }, '../account/AccountDashboard': { AccountDashboard: 'AccountDashboard' }, './localFixtureAuth': { localFixtureAvailable: () => true },
    './AuthContext': { useAuth: () => ({ state, busy: false, message: null }) } }).default;
  let dashboard = find(Screen(), element => element.type === 'AccountDashboard');
  assert.equal(dashboard.key, 'a'); assert.equal(dashboard.props.userId, 'a'); assert.equal(dashboard.props.accountName, 'Customer A');
  state = { status: 'signed-in', user: { id: 'b', email: 'b@example.invalid' } }; dashboard = find(Screen(), element => element.type === 'AccountDashboard');
  assert.equal(dashboard.key, 'b'); assert.equal(dashboard.props.accountName, '');
  state = { status: 'signed-out' }; const tree = Screen();
  assert.equal(find(tree, element => element.type === 'AccountDashboard'), undefined, 'sign-out must unmount the private dashboard');
  assert.equal(find(tree, element => element.props?.children === 'a@example.invalid'), undefined, 'the previous customer email must not remain');
  assert.equal(find(tree, element => element.props?.children === 'Customer A'), undefined, 'the previous customer name must not remain');
  assert.equal(find(tree, element => element.type === 'KeyboardAvoidingView').props.behavior, 'height');
  assert.equal(find(tree, element => element.type === 'ScrollView').props.keyboardDismissMode, 'on-drag');
});
test('account screen renders no duplicate sibling keys in any status', () => {
  const { native, find, duplicateKeys } = require('./helpers/source.cjs');
  let state = { status: 'signed-in', user: { id: 'a', email: 'a@example.invalid' } };
  const Screen = load('src/features/auth/AccountScreen.tsx', { react: { useState: value => [value, () => {}] }, 'react-native': native,
    'expo-router': { Link: 'Link' }, '../account/AccountDashboard': { AccountDashboard: 'AccountDashboard' }, './localFixtureAuth': { localFixtureAvailable: () => true },
    './AuthContext': { useAuth: () => ({ state, busy: false, message: 'Loading' }) } }).default;
  for (const next of [
    { status: 'signed-in', user: { id: 'a', email: 'a@example.invalid' } },
    { status: 'signed-in', user: { id: 'customer-uuid-with-dashes', email: null } },
    { status: 'signed-out' },
    { status: 'restoring' },
  ]) {
    state = next; const tree = Screen();
    assert.deepEqual(duplicateKeys(tree), [], `duplicate sibling keys rendering ${next.status} as ${next.user?.id}`);
  }
  state = { status: 'signed-out' };
  assert.deepEqual(duplicateKeys(Screen()), [], 'the local fixture choices must stay uniquely keyed');
});
test('delivery UI exposes labelled fields, inline errors, save/cancel and empty states', () => {
  const { hooks, find } = require('./helpers/source.cjs'); const host = hooks(); let snapshot = { status: 'ready', saved: blank(), draft: blank(), errors: { phone: 'Invalid phone' }, message: null };
  let cancelled = false; const calls = []; let editor = null;
  class Controller { getSnapshot = () => snapshot; subscribe = () => () => {}; activate() {} deactivate() {} refresh() {} edit() {} cancel() { cancelled = true; } save = async fields => { calls.push(fields); return false; }; }
  const Screen = load('src/features/profile/CustomerProfile.tsx', { react: { ...host.react, useSyncExternalStore: (subscribe, get) => get() },
    '../../components/ActionButton': { ActionButton: 'ActionButton' } }).CustomerProfile;
  const render = () => { host.begin(); return Screen({ controller: new Controller(), editor, onEditorChange: value => { editor = value; } }); };
  let tree = render();
  for (const heading of ['Personal Information', 'Delivery Details']) assert.ok(find(tree, element => element.props?.accessibilityRole === 'header' && element.props.children === heading));
  assert.ok(find(tree, element => element.props?.children === 'No name saved.'));
  assert.ok(find(tree, element => element.props?.children === 'No contact phone saved.'));
  assert.ok(find(tree, element => element.props?.children === 'No delivery address saved.'));
  find(tree, element => element.props?.label === 'Edit delivery details').props.onPress(); tree = render();
  assert.equal(editor, 'delivery');
  for (const label of ['Delivery contact name', 'Delivery contact phone', 'Street address / landmark', 'Area / community', 'City / town']) assert.ok(find(tree, element => element.type === 'TextInput' && element.props.accessibilityLabel === label));
  assert.equal(find(tree, element => element.props?.accessibilityRole === 'alert').props.children, 'Invalid phone');
  find(tree, element => element.props?.label === 'Save delivery details').props.onPress(); assert.equal(calls[0].length, 5);
  find(tree, element => element.props?.label === 'Cancel delivery changes').props.onPress(); assert.equal(cancelled, true); assert.equal(editor, null);
  // The two editors stay separate: opening one never hides the other summary.
  editor = 'profile'; tree = render();
  assert.ok(find(tree, element => element.type === 'TextInput' && element.props.accessibilityLabel === 'Full name'));
  assert.equal(find(tree, element => element.type === 'TextInput' && element.props.accessibilityLabel === 'City / town'), undefined);
  assert.ok(find(tree, element => element.props?.label === 'Edit delivery details'), 'delivery summary stays reachable');
  editor = null;
  snapshot = { ...snapshot, status: 'error', message: 'Please retry' }; tree = render(); assert.ok(find(tree, element => element.props?.label === 'Retry loading details'));
  host.unmount();
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
function mountEditor(rows, saves, id = 'a') {
  const { hooks, load } = require('./helpers/source.cjs');
  const host = hooks(); let editor = null;
  const controller = new ProfileController({
    load: async () => profile.mapProfile(rows[id]),
    save: async (draft, fields) => { saves.push({ id, fields }); return { ...profile.mapProfile(rows[id]), ...Object.fromEntries(fields.map(key => [key, draft[key]])) }; },
  });
  const { CustomerProfile } = load('src/features/profile/CustomerProfile.tsx', {
    react: { ...host.react, useSyncExternalStore: (subscribe, get) => get() },
    '../../components/ActionButton': { ActionButton: 'ActionButton' },
  });
  controller.activate();
  return { host, controller, render: () => { host.begin(); return CustomerProfile({ controller, editor, onEditorChange: value => { editor = value; } }); } };
}
const row = (id, name) => ({ id, full_name: name, phone: '+23276521208', default_street_address: 'Landmark', default_area: 'Community', default_city: 'Town' });
test('back leaves a clean editor alone and only confirms meaningful unsaved edits', async () => {
  const { find, events, pressBack, resetEvents } = require('./helpers/source.cjs');
  resetEvents(); const saves = [];
  const view = mountEditor({ a: row('a', 'Customer A') }, saves);
  await view.controller.refresh(); view.render();
  assert.equal(pressBack(), false, 'browsing without an open editor must not confirm');
  find(view.render(), element => element.props?.label === 'Edit profile').props.onPress();
  assert.equal(events.back.length, 1);
  assert.equal(pressBack(), false, 'an opened but untouched editor is clean');
  view.render();
  find(view.render(), element => element.type === 'TextInput' && element.props.accessibilityLabel === 'Full name').props.onChangeText('Customer A');
  assert.equal(pressBack(), false, 'typing a saved value back is not a meaningful change');
  find(view.render(), element => element.type === 'TextInput' && element.props.accessibilityLabel === 'Full name').props.onChangeText('Customer A editing');
  view.render();
  assert.equal(pressBack(), true);
  assert.equal(events.alerts.length, 1);
  const [title, message, buttons] = events.alerts[0];
  assert.match(title, /discard/i); assert.match(message, /not saved/i);
  assert.deepEqual(plain(buttons.map(button => button.text)), ['Continue editing', 'Discard changes']);
  assert.equal(saves.length, 0, 'back must never silently save or drop data');
  // Continuing editing keeps the draft and the editor open.
  assert.equal(view.controller.getSnapshot().draft.full_name, 'Customer A editing');
  assert.ok(find(view.render(), element => element.props.accessibilityLabel === 'Full name'));
  // Discarding restores the last saved values and closes the editor.
  assert.equal(pressBack(), true, 'back keeps confirming while the draft is unsaved');
  assert.equal(events.alerts.length, 2);
  events.alerts[1][2][1].onPress();
  view.render();
  assert.equal(view.controller.getSnapshot().draft.full_name, 'Customer A');
  assert.equal(find(view.render(), element => element.props.accessibilityLabel === 'Full name'), undefined);
  assert.equal(pressBack(), false, 'after discarding, back behaves normally');
  assert.equal(saves.length, 0);
  view.host.unmount();
});
test('back guard registers one listener, spares keyboard dismissal and detaches on unmount', async () => {
  const { find, events, pressBack, keyDown, resetEvents } = require('./helpers/source.cjs');
  resetEvents(); const saves = [];
  const view = mountEditor({ a: row('a', 'Customer A') }, saves);
  await view.controller.refresh(); view.render();
  find(view.render(), element => element.props?.label === 'Edit profile').props.onPress();
  for (let render = 0; render < 4; render++) { view.render(); assert.equal(events.back.length, 1); assert.equal(events.keyboard.length, 2); }
  find(view.render(), element => element.type === 'TextInput' && element.props.accessibilityLabel === 'Full name').props.onChangeText('Draft in progress');
  view.render();
  keyDown('keyboardDidShow');
  assert.equal(pressBack(), true, 'back must consume keyboard dismissal');
  assert.equal(events.dismissed, 1); assert.equal(events.alerts.length, 0);
  assert.equal(events.back.length, 1);
  keyDown('keyboardDidHide');
  assert.equal(pressBack(), true, 'a dirty editor still confirms once the keyboard is gone');
  assert.equal(events.alerts.length, 1);
  assert.equal(view.controller.isActive(), true);
  view.host.unmount();
  assert.equal(events.back.length, 0, 'unmount must remove the back listener');
  assert.equal(events.keyboard.length, 0);
});
test('signing out one customer leaves no draft and no back listener for the next customer', async () => {
  const { find, events, pressBack, resetEvents } = require('./helpers/source.cjs');
  resetEvents(); const saves = [];
  const rows = { a: row('a', 'Customer A'), b: row('b', 'Customer B') };
  const first = mountEditor(rows, saves, 'a');
  await first.controller.refresh(); first.render();
  find(first.render(), element => element.props?.label === 'Edit profile').props.onPress();
  find(first.render(), element => element.type === 'TextInput' && element.props.accessibilityLabel === 'Full name').props.onChangeText('Private customer A draft');
  first.render();
  assert.equal(pressBack(), true, 'the outgoing customer is protected from losing the draft');
  // Signing out tears down the owner guard and the screen in that order.
  first.controller.deactivate(); first.host.unmount();
  assert.equal(events.back.length, 0, 'a signed-out screen must not leave a back listener behind');
  assert.equal(events.keyboard.length, 0, 'and no keyboard listeners either');
  assert.equal(first.controller.isActive(), false);
  assert.equal(first.controller.getSnapshot().draft.full_name, '', 'sign-out erases the private draft');
  resetEvents();
  const second = mountEditor(rows, saves, 'b');
  await second.controller.refresh(); second.render();
  assert.equal(events.back.length, 1, 'the next customer mounts exactly one back guard');
  assert.equal(pressBack(), false, 'the next customer starts clean and must not be asked to discard');
  find(second.render(), element => element.props?.label === 'Edit profile').props.onPress();
  assert.equal(find(second.render(), element => element.type === 'TextInput' && element.props.accessibilityLabel === 'Full name').props.value, 'Customer B');
  assert.equal(events.alerts.length, 0, 'no discard prompt may carry over from the previous account');
  second.host.unmount();
});
test('whitespace-only edits are not treated as unsaved changes', () => {
  const saved = profile.mapProfile(row('a', 'Customer A'));
  assert.equal(profile.hasUnsavedChanges(saved, { ...saved, full_name: 'Customer A  ' }, profile.editorFields.profile), false);
  assert.equal(profile.hasUnsavedChanges(saved, { ...saved, default_city: '' }, profile.editorFields.profile), false);
  assert.equal(profile.hasUnsavedChanges(saved, { ...saved, default_city: '' }, profile.editorFields.delivery), true);
  assert.deepEqual(plain([...profile.editorFields.profile]), ['full_name', 'phone']);
  assert.deepEqual(plain([...profile.editorFields.delivery]), plain(profile.profileFields));
});
