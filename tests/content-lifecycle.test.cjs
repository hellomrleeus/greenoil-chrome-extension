const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function boot(sharedDocument) {
  const intervals = new Map(), timers = new Map(), frames = new Map();
  const messages = [], listeners = [];
  let id = 0;
  const attributes = new Map();
  const document = sharedDocument || {
    readyState: 'complete', hidden: false,
    documentElement: {setAttribute: (k,v) => attributes.set(k,v), getAttribute: k => attributes.get(k), removeAttribute: k => attributes.delete(k)},
    addEventListener: (type, fn, options) => listeners.push({type, fn, options}),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  };
  const window = {
    addEventListener: (type, fn, options) => listeners.push({type, fn, options}),
    setTimeout: fn => {timers.set(++id, fn); return id;}, clearTimeout: id => timers.delete(id),
    setInterval: fn => {intervals.set(++id, fn); return id;}, clearInterval: id => intervals.delete(id),
    requestAnimationFrame: fn => {frames.set(++id, fn); return id;}, cancelAnimationFrame: id => frames.delete(id),
  };
  const chrome = {runtime: {id: 'test-extension', sendMessage: msg => messages.push(msg), onMessage: {addListener: () => {}}}};
  const context = vm.createContext({window, document, chrome, AbortController, console, URL, location: {pathname: '/maps/', href: 'https://www.google.com/maps/@0,0,10z'}});
  vm.runInContext(source, context);
  return {context, document, window, chrome, intervals, timers, frames, listeners, messages};
}
test('full content script boots and performs only local extension reads on Maps load', () => {
  const f = boot();
  assert.deepEqual(f.messages.map(m => m.action), ['getActiveTheme', 'getRouteWaypoints']);
  for (const callback of [...f.intervals.values()]) callback();
  vm.runInContext(source, f.context); // duplicate injection must not add timers
  assert.equal(f.intervals.size, 1);
});
test('invalidated extension clears every timer/frame and aborts event listeners', () => {
  const f = boot();
  for (const callback of [...f.intervals.values()]) callback();
  delete f.chrome.runtime.id;
  for (const callback of [...f.intervals.values()]) callback();
  assert.equal(f.intervals.size, 0); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  assert.ok(f.listeners.every(l => l.options.signal.aborted));
  assert.equal(f.window.__greenoil_injected__, false);
});
test('new isolated context takes ownership; previous renderer stops without deleting new owner', () => {
  const first = boot(); const second = boot(first.document);
  const owner = first.document.documentElement.getAttribute('data-greenoil-owner');
  for (const callback of [...first.intervals.values()]) callback();
  assert.equal(first.intervals.size, 0); assert.equal(second.intervals.size, 1);
  assert.equal(first.document.documentElement.getAttribute('data-greenoil-owner'), owner);
});
