// Source/JSX simulation only: not a native renderer or device acceptance.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'FlatList', 'ScrollView', 'TextInput', 'ActivityIndicator'].map(name => [name, name]));
native.StyleSheet = { create: value => value };
native.useWindowDimensions = () => ({ width: 400, fontScale: 1 });
function load(file, overrides = {}) {
  const fixture = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { module: fixture, exports: fixture.exports, URL, AbortController, require: name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return native;
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
  const slots = []; let index = 0;
  return { begin: () => { index = 0; }, react: {
    useState: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
    }, useCallback: fn => fn,
  } };
}
function find(element, predicate) {
  if (!element || typeof element !== 'object') return undefined;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const result = find(child, predicate); if (result) return result;
  }
}
module.exports = { load, hooks, find };
