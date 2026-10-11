// Source/JSX simulation only: not a native renderer or device acceptance.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'FlatList', 'ScrollView', 'TextInput', 'ActivityIndicator', 'KeyboardAvoidingView'].map(name => [name, name]));
native.Platform = { OS: 'android' };
native.StyleSheet = { create: value => value };
native.useWindowDimensions = () => ({ width: 400, fontScale: 1 });
const events = { back: [], keyboard: [], alerts: [], dismissed: 0, links: [] };
function remove(list, entry) { const at = list.indexOf(entry); if (at >= 0) list.splice(at, 1); }
const webBrowser = { openBrowserAsync: url => { events.links.push(url); return Promise.resolve(); } };
native.BackHandler = { addEventListener: (type, listener) => {
  if (type !== 'hardwareBackPress') throw new Error(`Unexpected back event: ${type}`);
  events.back.push(listener);
  return { remove: () => remove(events.back, listener) };
} };
native.Keyboard = { addListener: (type, listener) => { const entry = { type, listener }; events.keyboard.push(entry); return { remove: () => remove(events.keyboard, entry) }; }, dismiss: () => { events.dismissed++; } };
native.Alert = { alert: (...args) => { events.alerts.push(args); } };
function pressBack() {
  // React Native runs hardware back listeners newest-first and stops at the first that returns true.
  for (const listener of [...events.back].reverse()) if (listener() === true) return true;
  return false;
}
function keyDown(type, event) { events.keyboard.filter(entry => entry.type === type).forEach(entry => entry.listener(event)); }
// Clears recorded interactions only; live listener registrations follow component mount/unmount.
function resetEvents() { events.alerts = []; events.dismissed = 0; events.links = []; }
function load(file, overrides = {}) {
  const fixture = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { module: fixture, exports: fixture.exports, URL, AbortController, require: name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return native;
    if (name === 'expo-web-browser') return webBrowser;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (!name.startsWith('.')) throw new Error(`Unmocked dependency: ${name}`);
    const base = path.resolve(path.dirname(file), name);
    const next = ['.ts', '.tsx'].map(extension => base + extension).find(candidate => fs.existsSync(candidate));
    if (!next || !next.startsWith(path.resolve('src') + path.sep)) throw new Error('Unexpected source dependency');
    return load(next, overrides);
  } });
  return fixture.exports;
}
function hooks() {
  const slots = []; const effects = []; let index = 0; let effect = 0;
  return { begin: () => { index = 0; effect = 0; }, react: {
    useState: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
    }, useCallback: fn => fn,
    useRef: initial => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect: (fn, deps) => {
      const slot = effect++;
      const previous = effects[slot];
      // A missing dependency array re-runs the effect every render, as in React.
      if (!previous || !deps || deps.length !== previous.deps.length || deps.some((value, key) => value !== previous.deps[key])) {
        previous?.cleanup?.();
        effects[slot] = { deps, cleanup: fn() };
      }
    },
  }, unmount: () => { effects.splice(0).forEach(entry => entry?.cleanup?.()); } };
}
function find(element, predicate) {
  if (!element || typeof element !== 'object') return undefined;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const result = find(child, predicate); if (result) return result;
  }
}
// Simulates native ref attachment only: no layout, no measurement, no scrolling.
function attachRefs(element, collected = []) {
  if (!element || typeof element !== 'object') return collected;
  const target = element.props?.ref;
  if (target) {
    const node = { props: element.props };
    if (typeof target === 'function') target(node);
    else if ('current' in target) target.current = node;
    collected.push(node);
  }
  for (const child of [element.props?.children].flat(Infinity)) attachRefs(child, collected);
  return collected;
}
// Renders nested function components so assertions can inspect their output.
function expand(element) {
  if (!element || typeof element !== 'object') return element;
  if (typeof element.type === 'function') return expand(element.type(element.props));
  if (element.props?.children === undefined) return element;
  const children = [element.props.children].flat(Infinity).map(expand);
  // Keep a single child single, so text predicates keep matching the real tree shape.
  return { ...element, props: { ...element.props, children: Array.isArray(element.props.children) ? children : children[0] ?? element.props.children } };
}
// Mirrors React's dev-mode duplicate key check: keys must be unique within one sibling set.
function duplicateKeys(element, report = []) {
  if (!element || typeof element !== 'object') return report;
  const children = [element.props?.children].flat(Infinity).filter(child => child && typeof child === 'object');
  const seen = new Set;
  for (const child of children) {
    if (child.key != null && seen.has(child.key)) report.push(`${String(element.type)}#${child.key}`);
    seen.add(child.key);
  }
  for (const child of children) duplicateKeys(child, report);
  return report;
}
module.exports = { load, hooks, find, expand, duplicateKeys, attachRefs, native, events, pressBack, keyDown, resetEvents };
