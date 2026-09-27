const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const pinMath = require('../pin-math.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const source = read('content.js');
const css = read('content.css');
const hookSource = read('map-hook.js');
const pinMathSource = read('pin-math.js');
const manifest = JSON.parse(read('manifest.json'));

// A real frame captured from Google Maps (937x375 canvas, zoom 16, side
// panel open). Camera uniforms as uploaded to the vector-map shaders.
const REAL = {
  w: 937,
  h: 375,
  hi: [0.2794799208641052, 0.3649902343750000, 0],
  lo: [1.1928567e-7, 0.0000054241, 0],
  m: [3.485582113265991, 0, 0, 0, 0, -8.709307670593262, 0, 0, 0, 0, -1, -1, 0, 0, 544.3317260742188, 1632.9952392578125],
  s: 16777216,
  url: { lat: 43.6426128, lng: -79.3871855, zoom: 16 },
  cnTower: { lat: 43.6425662, lng: -79.3870568, x: 474.5, y: 190.5 },
};
const realCam = () => ({ cx: REAL.hi[0] + REAL.lo[0], cy: REAL.hi[1] + REAL.lo[1], s: REAL.s, m: REAL.m });

// ---------- pin-math unit tests ----------

test('worldX/worldY map lat/lng to normalized Mercator and back', () => {
  assert.equal(pinMath.worldX(-180), 0);
  assert.equal(pinMath.worldX(0), 0.5);
  assert.ok(Math.abs(pinMath.worldY(0) - 0.5) < 1e-12);
  assert.ok(pinMath.worldY(43.6) < 0.5, 'north is up (smaller y)');
  const back = pinMath.worldToLatLng(pinMath.worldX(-79.3871855), pinMath.worldY(43.6426128));
  assert.ok(Math.abs(back.lat - 43.6426128) < 1e-9 && Math.abs(back.lng + 79.3871855) < 1e-9);
});

test('camera uniform signature matches the real frame and rejects look-alikes', () => {
  assert.ok(pinMath.isCameraHi(REAL.hi));
  assert.ok(pinMath.isCameraLo(REAL.lo));
  assert.ok(pinMath.isPerspective(REAL.m));
  assert.ok(pinMath.isWorldScale(REAL.s));
  assert.ok(!pinMath.isCameraHi([0.2, 0.4, 1]), 'colors/normals with z != 0');
  assert.ok(!pinMath.isCameraLo([0.3, 0.2, 0]), 'lo must be tiny');
  assert.ok(!pinMath.isPerspective([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 'identity');
  for (const v of [0, 1, 2, 4, 0.8, 0.000244]) assert.ok(!pinMath.isWorldScale(v), `scale ${v}`);
  assert.ok(Math.abs(pinMath.zoomFromScale(REAL.s) - 16) < 1e-12);
  assert.ok(Math.abs(pinMath.zoomFromScale(14354498.76) - 15.775) < 1e-3, 'fractional zoom mid-animation');
});

test('projectGL puts CN Tower where Google drew its native marker', () => {
  const cam = realCam();
  const pt = pinMath.projectGL(pinMath.worldX(REAL.cnTower.lng), pinMath.worldY(REAL.cnTower.lat), cam, REAL.w, REAL.h);
  assert.ok(Math.abs(pt.x - REAL.cnTower.x) < 1, `x=${pt.x}`);
  assert.ok(Math.abs(pt.y - REAL.cnTower.y) < 1, `y=${pt.y}`);
});

test('URL camera is the full-canvas center (even with the panel open)', () => {
  const cam = realCam();
  assert.ok(pinMath.glAgreesWithUrl(cam, REAL.url, REAL.w, REAL.h));
  const wx = pinMath.worldX(REAL.cnTower.lng);
  const wy = pinMath.worldY(REAL.cnTower.lat);
  const a = pinMath.projectGL(wx, wy, cam, REAL.w, REAL.h);
  const b = pinMath.projectUrl(wx, wy, REAL.url, REAL.w, REAL.h);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.1, 'GL and URL projections agree at rest');
  assert.ok(!pinMath.glAgreesWithUrl(cam, { ...REAL.url, zoom: 15 }, REAL.w, REAL.h), 'zoom mismatch');
  assert.ok(!pinMath.glAgreesWithUrl(cam, { ...REAL.url, lng: REAL.url.lng + 0.001 }, REAL.w, REAL.h), 'center mismatch');
});

test('inCanvas clips pins outside the map (with margin)', () => {
  assert.ok(pinMath.inCanvas({ x: 10, y: 10 }, 100, 100, 0));
  assert.ok(pinMath.inCanvas({ x: -30, y: 50 }, 100, 100, 40));
  assert.ok(!pinMath.inCanvas({ x: -50, y: 50 }, 100, 100, 40));
  assert.ok(!pinMath.inCanvas(null, 100, 100, 40));
});

test('isRoutablePlacePath only accepts place URLs carrying a place id', () => {
  assert.ok(pinMath.isRoutablePlacePath('/maps/place/Rogers+Centre/@43.641804,-79.3891419,17z/data=!3m1!4b1!4m6!3m5!1s0x882b350049ba4395:0xefcebaf2e76df74d!8m2!3d43.641804!4d-79.3891419'));
  assert.ok(!pinMath.isRoutablePlacePath('/maps/place/Fran/@43.6552,-79.3807,17z'));
  assert.ok(!pinMath.isRoutablePlacePath('/maps/search/coffee'));
  assert.ok(!pinMath.isRoutablePlacePath('https://evil.example/maps/place/x!1s0x1:0x2'));
  assert.ok(!pinMath.isRoutablePlacePath(undefined));
});

test('parseCameraFromUrl and easing helpers', () => {
  assert.deepEqual(pinMath.parseCameraFromUrl('https://www.google.com/maps/@31.23,121.47,12.5z'), { lat: 31.23, lng: 121.47, zoom: 12.5 });
  assert.equal(pinMath.parseCameraFromUrl('https://www.google.com/maps/search/coffee'), null);
  assert.equal(pinMath.easeInOutCubic(0), 0);
  assert.equal(pinMath.easeInOutCubic(1), 1);
  assert.equal(pinMath.easeInOutCubic(2), 1);
  assert.equal(pinMath.easeInOutCubic(0.5), 0.5);
});

// ---------- map-hook.js in a simulated page ----------

function bootHook({ href = 'https://www.google.com/maps/@43.6426128,-79.3871855,16z' } = {}) {
  const listeners = {};
  const pushed = [];
  const dispatched = [];
  const canvas = { clientWidth: REAL.w, clientHeight: REAL.h, offsetLeft: 0, offsetTop: 0, isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: REAL.w, height: REAL.h }),
    dispatchEvent: (e) => dispatched.push(e) };
  const pinEl = (lat, lng) => ({
    style: {},
    getAttribute: (k) => (k === 'data-greenoil-lat' ? String(lat) : k === 'data-greenoil-lng' ? String(lng) : null),
  });
  const pins = [pinEl(REAL.cnTower.lat, REAL.cnTower.lng), pinEl(0, 0)];
  const layer = { isConnected: true, querySelectorAll: () => pins, setAttribute() {} };
  function GLProto() {}
  GLProto.prototype.uniform3fv = function () {};
  GLProto.prototype.uniformMatrix4fv = function () {};
  GLProto.prototype.uniform1f = function () {};
  const workerPosts = [];
  class Worker { postMessage(d) { workerPosts.push(d); } }
  const frames = [];
  const location = { href, assign: (p) => dispatched.push({ assign: p }) };
  const window = {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: (e) => { dispatched.push(e); },
    postMessage: (data) => dispatched.push({ posted: data }),
    WebGLRenderingContext: GLProto,
  };
  window.window = window;
  const context = vm.createContext({
    window, location, console, Promise, Math, isFinite, parseFloat, WeakMap, Array,
    setTimeout: () => 0, clearTimeout: () => {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    Worker,
    Uint8Array,
    DataView,
    performance: { now: () => 1000 },
    history: {
      replaceState: () => {},
      state: null,
      pushState: (state, _t, url) => { pushed.push({ state, url }); location.href = 'https://www.google.com' + url; },
    },
    document: {
      documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } },
      getElementById: (id) => (id === 'greenoil-waypoint-pin-layer' ? layer : null),
      querySelector: (sel) => (sel.startsWith('canvas') ? canvas : null),
      querySelectorAll: (sel) => (sel.startsWith('canvas') ? [canvas] : []),
      dispatchEvent: (e) => dispatched.push(e),
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    PopStateEvent: class { constructor(type, init) { this.type = type; this.state = init && init.state; } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    WebGLRenderingContext: GLProto,
  });
  vm.runInContext(pinMathSource, context);
  vm.runInContext(hookSource, context);
  const gl = new GLProto();
  gl.canvas = canvas;
  const drawFrame = (hi, lo, m, s) => {
    gl.uniform3fv(null, hi);
    gl.uniform3fv(null, lo);
    gl.uniformMatrix4fv(null, false, m);
    gl.uniform1f(null, s);
  };
  const fire = (type, data) => (listeners[type] || []).forEach((fn) => fn({ source: window, data }));
  const runFrames = () => { while (frames.length) frames.shift()(); };
  const worker = new Worker();
  return { window, context, gl, drawFrame, pins, pushed, dispatched, fire, listeners, worker, workerPosts, runFrames };
}

const tick = () => new Promise((r) => setImmediate(r));

test('map-hook reads the camera from shader uniforms and places pins in the same frame', async () => {
  const h = bootHook();
  h.drawFrame(REAL.hi, REAL.lo, REAL.m, REAL.s);
  await tick(); // microtask flush
  const st = h.window.__greenoil_map_hook_state__();
  assert.equal(st.mode, 'gl');
  assert.ok(Math.abs(st.zoom - 16) < 1e-9);
  const t = h.pins[0].style.transform;
  const [, x, y] = t.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,0\)/).map(Number);
  assert.ok(Math.abs(x - REAL.cnTower.x) < 1 && Math.abs(y - REAL.cnTower.y) < 1, t);
  assert.equal(h.pins[0].style.visibility, 'visible');
  assert.equal(h.pins[1].style.visibility, 'hidden', 'off-map pin (0,0) is clipped');

  // Next frame, mid zoom animation: pins follow with fractional zoom.
  h.drawFrame(REAL.hi, REAL.lo, REAL.m, REAL.s * Math.pow(2, 0.4));
  await tick();
  const t2 = h.pins[0].style.transform;
  assert.notEqual(t2, t, 'pin moved with the zoom frame');
});

test('map-hook ignores uniform sequences that are not the camera signature', async () => {
  const h = bootHook();
  h.drawFrame([0.2, 0.4, 1], [0.1, 0.1, 0], REAL.m, REAL.s); // color-like vec3s
  h.drawFrame(REAL.hi, REAL.lo, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], REAL.s); // identity
  h.drawFrame(REAL.hi, REAL.lo, REAL.m, 2); // not a world scale
  await tick();
  assert.equal(h.window.__greenoil_map_hook_state__().mode, 'url');
});

test('map-hook opens place URLs through Google\'s router (no reload)', () => {
  const h = bootHook();
  const p = '/maps/place/Rogers+Centre/@43.641804,-79.3891419,17z/data=!4m6!3m5!1s0x882b350049ba4395:0xefcebaf2e76df74d!8m2';
  h.context.history.state = { index: 4 };
  h.fire('message', { type: 'GREENOIL_NAVIGATE', path: p, lat: 43.641804, lng: -79.3891419 });
  assert.deepEqual(h.pushed.map((x) => x.url), [p]);
  assert.equal(JSON.stringify(h.pushed[0].state), '{"index":5}', 'follows Google\'s {index} history convention');
  const pop = h.dispatched.find((e) => e.type === 'popstate');
  assert.ok(pop, 'popstate dispatched');
  assert.equal(JSON.stringify(pop.state), '{"index":5}');
  assert.ok(!h.dispatched.some((e) => e.assign), 'no page load');
});

test('map-hook glides to nearby coordinates with a synthetic mouse drag', async () => {
  const h = bootHook();
  h.drawFrame(REAL.hi, REAL.lo, REAL.m, REAL.s);
  await tick();
  h.fire('message', { type: 'GREENOIL_NAVIGATE', path: '/maps/place/Fran/@43.6552,-79.3807,17z', lat: 43.6433, lng: -79.3860 });
  const types = h.dispatched.map((e) => e.type).filter(Boolean);
  assert.ok(types.includes('mousedown'), 'drag started with MouseEvent (Google ignores PointerEvent)');
  assert.ok(!h.dispatched.some((e) => e.assign), 'nearby: no page load');
  const done = h.dispatched.find((e) => e.posted && e.posted.type === 'GREENOIL_NAVIGATE_DONE');
  assert.equal(done.posted.mode, 'glide');
});

test('map-hook falls back to a normal load for far targets without a place id', async () => {
  const h = bootHook();
  h.drawFrame(REAL.hi, REAL.lo, REAL.m, REAL.s);
  await tick();
  h.fire('message', { type: 'GREENOIL_NAVIGATE', path: '/maps/place/Far/@31.23,121.47,17z', lat: 31.23, lng: 121.47 });
  assert.ok(h.dispatched.some((e) => e.assign === '/maps/place/Far/@31.23,121.47,17z'));
  h.fire('message', { type: 'GREENOIL_NAVIGATE', path: 'https://evil.example/', lat: NaN, lng: NaN });
  assert.ok(!h.dispatched.some((e) => e.assign === 'https://evil.example/'), 'only /maps/ paths');
});

// ---------- wiring / structure ----------

test('manifest runs pin-math + map-hook in the MAIN world at document_start', () => {
  const main = manifest.content_scripts.find((c) => c.world === 'MAIN');
  assert.ok(main, 'MAIN-world entry');
  assert.deepEqual(main.js, ['pin-math.js', 'map-hook.js']);
  assert.equal(main.run_at, 'document_start');
  const iso = manifest.content_scripts.find((c) => c.js.includes('content.js'));
  assert.ok(!iso.js.includes('pin-math.js'), 'isolated world no longer needs pin math');
  assert.ok(!fs.existsSync(path.join(__dirname, '../camera-bridge.js')), 'URL camera bridge removed');
});

test('pin-math keeps its helpers out of the page global scope', () => {
  assert.match(pinMathSource, /^\(function \(\) \{/m);
  const ctx = vm.createContext({ window: {} });
  ctx.window = ctx;
  vm.runInContext(pinMathSource, ctx);
  assert.equal(typeof ctx.worldX, 'undefined');
  assert.equal(typeof ctx.__greenoil_pinMath.worldX, 'function');
});

test('content.js builds DOM-only pins inside Google\'s map container', () => {
  assert.match(source, /function rebuildPinElements/);
  assert.match(source, /greenoilLat/);
  assert.match(source, /insertAdjacentElement\("afterend", overlay\)/);
  assert.match(source, /greenoil:pins/);
  assert.match(source, /GREENOIL_NAVIGATE/);
  assert.match(source, /greenoil-pins-explore/, '探索 pins have their own group');
  assert.match(source, /greenoil-pins-route/, 'waypoints in their own group (on top)');
  for (const name of [
    'pinTick', 'wakePinLoop', 'cameraNow', 'onCameraUpdate', 'pollMapCamera', 'rebaseDragDelta',
    'visibleMapRect', 'smoothDragPanTo', 'anchorNavigateTo', 'PointerEvent', 'GREENOIL_CAM',
    'injectCameraBridge', 'requestCameraBridge', 'renderWaypointMapPins', 'getMapCamera',
  ]) {
    assert.ok(!source.includes(name), `should not reference ${name}`);
  }
});

test('panToLocation answers the background so it never falls back to a reload', () => {
  const i = source.indexOf('message.action === "panToLocation"');
  const block = source.slice(i, i + 400);
  assert.match(block, /sendResponse\(\{ success: true \}\)/);
});

test('route rebuild only replaces waypoint pins, never the 探索 pins', () => {
  const start = source.indexOf('function rebuildPinElements');
  const end = source.indexOf('// 探索 — every restaurant');
  const body = source.slice(start, end);
  assert.match(body, /getElementById\("greenoil-pins-route"\)\.replaceChildren/);
  assert.ok(!/greenoil-pins-explore"\)\.replaceChildren/.test(body));
});

test('CSS: overlay lives in the map container, click-through, pins anchored at the tip', () => {
  const overlay = css.slice(css.indexOf('#greenoil-waypoint-pins-overlay {'), css.indexOf('}', css.indexOf('#greenoil-waypoint-pins-overlay {')));
  assert.match(overlay, /position:\s*absolute/);
  assert.ok(!/position:\s*fixed/.test(overlay), 'not a viewport overlay');
  assert.match(overlay, /overflow:\s*hidden/);
  assert.match(overlay, /pointer-events:\s*none/);
  assert.ok(!/z-index:\s*998/.test(css));
  assert.match(css, /\.greenoil-pin-body \{[^}]*left:\s*-14px[^}]*top:\s*-29px/s);
  assert.match(css, /\.greenoil-waypoint-map-pin \{[^}]*visibility:\s*hidden;/s);
  assert.match(css, /#greenoil-pins-matched \{ z-index: 1[\s\S]*#greenoil-pins-explore \{ z-index: 2[\s\S]*#greenoil-pins-route \{ z-index: 3/);
  assert.match(css, /@keyframes greenoil-pin-rise/);
  assert.match(css, /\.greenoil-explore-shadowed/);
  assert.match(css, /\.greenoil-pin-shield/);
  assert.ok(!css.includes('.greenoil-pin-tooltip'));
});

// ---------- newer Google Maps: renderer in a Worker (OffscreenCanvas) ----------

// protobuf encoder for test payloads (same layout as captured from Google Maps)
const pbVarint = (n) => { const o = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return o; };
const pbDouble = (f, v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); return [...pbVarint(f * 8 + 1), ...b]; };
const pbFloat = (f, v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return [...pbVarint(f * 8 + 5), ...b]; };
const pbMsg = (f, bytes) => [...pbVarint(f * 8 + 2), ...pbVarint(bytes.length), ...bytes];
function cameraPayload(lat, lng, zoom, { tilt = 0, heading = 0 } = {}) {
  const ll = pbMsg(3, [...pbDouble(1, lat), ...pbDouble(2, lng)]);
  const cam = [...pbMsg(1, ll), ...pbDouble(2, zoom), ...pbFloat(5, tilt), ...pbFloat(6, heading), ...pbFloat(8, 13.1), ...pbVarint(11 * 8), 1];
  return new Uint8Array(pbMsg(8, pbMsg(2, cam)));
}

test('renderer camera is decoded from the Worker command payload (52 bytes like the real one)', () => {
  const payload = cameraPayload(43.65885610608034, -79.3547376375949, 16);
  assert.equal(payload.length, 52);
  assert.deepEqual(pinMath.findProtoCamera(payload), { lat: 43.65885610608034, lng: -79.3547376375949, zoom: 16, tilt: 0, heading: 0 });
  // other renderer commands and junk are ignored
  assert.equal(pinMath.findProtoCamera(new Uint8Array([234, 1, 21, 18, 17, 29, 0, 0, 168, 67, 37, 0, 0, 252, 67, 45, 0, 0, 128, 63, 48, 1, 24, 0])), null);
  assert.equal(pinMath.findProtoCamera(new Uint8Array([255, 255, 255, 1, 2, 3])), null);
  assert.equal(pinMath.findProtoCamera(new Uint8Array(pbMsg(1, pbMsg(3, [...pbDouble(1, 400), ...pbDouble(2, 0)])).concat(pbDouble(2, 16)))), null, 'lat out of range');
});

test('flat camera check: rotated or tilted views are not projected flat', () => {
  for (const h of [0, 359.8, 0.2, -0.3, 720]) assert.ok(pinMath.isFlatCamera({ tilt: 0, heading: h }), `heading ${h}`);
  assert.ok(!pinMath.isFlatCamera({ tilt: 0, heading: 90 }));
  assert.ok(!pinMath.isFlatCamera({ tilt: 30, heading: 0 }));
  assert.ok(pinMath.cameraAgreesWithUrl({ lat: 43.6550953501167, lng: -79.3443414244349, zoom: 16 }, { lat: 43.6550954, lng: -79.3443414, zoom: 16 }));
  assert.ok(!pinMath.cameraAgreesWithUrl({ lat: 43.66, lng: -79.34, zoom: 16 }, { lat: 43.6550954, lng: -79.3443414, zoom: 16 }));
});

test('map-hook follows the Worker renderer camera every frame (no hiding while dragging)', () => {
  const h = bootHook();
  const cam = REAL.url;
  h.worker.postMessage({ command: 9, methodType: 8, payload: cameraPayload(cam.lat, cam.lng, cam.zoom), returnType: 2, v: 20 });
  assert.equal(h.workerPosts.length, 1, 'message still reaches the Worker');
  h.runFrames();
  const st = h.window.__greenoil_map_hook_state__();
  assert.equal(st.mode, 'worker');
  const t = h.pins[0].style.transform;
  const [, x, y] = t.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,0\)/).map(Number);
  assert.ok(Math.abs(x - REAL.cnTower.x) < 1 && Math.abs(y - REAL.cnTower.y) < 1, t);
  assert.equal(h.pins[0].style.visibility, 'visible');

  // a drag: the page sends the moved camera; pins move on the next frame and stay visible
  (h.listeners.mousedown || []).forEach((fn) => fn({ target: { tagName: 'CANVAS' } }));
  h.worker.postMessage({ command: 9, methodType: 8, payload: cameraPayload(cam.lat, cam.lng + 0.001, cam.zoom + 0.25) });
  h.runFrames();
  assert.notEqual(h.pins[0].style.transform, t);
  assert.equal(h.pins[0].style.visibility, 'visible', 'not hidden mid-gesture');

  // rotated / tilted view: hide rather than misplace
  h.worker.postMessage({ command: 9, methodType: 8, payload: cameraPayload(cam.lat, cam.lng, cam.zoom, { heading: 45 }) });
  h.runFrames();
  assert.equal(h.pins[0].style.visibility, 'hidden');
});

// ---------- Google's photo / Street View viewer ----------

test('imagery URLs (place photos, Street View, photo spheres) are recognised', () => {
  for (const u of [
    'https://www.google.com/maps/@43.6414378,-79.3893532,3a,90y,90t/data=!3m7!1e1!3m5!1sCIHM0ogKEICAgID4y_DalQE!2e10',
    'https://www.google.com/maps/place/X/@43.8039843,-79.335716,3a,75y,90t/data=!3m8!1e2!3m6!1sAF1Qip',
  ]) assert.ok(pinMath.isImageryUrl(u), u);
  for (const u of [
    'https://www.google.com/maps/@43.6532,-79.3832,16z',
    'https://www.google.com/maps/place/Rogers+Centre/@43.641804,-79.3891419,17z/data=!3m1!4b1',
    'https://www.google.com/maps/search/restaurants/@43.8,-79.3,15.5z',
  ]) assert.ok(!pinMath.isImageryUrl(u), u);
});

test('map-hook flags the imagery viewer so pins and the 探索 bar hide over photos', () => {
  const h = bootHook();
  const attrs = h.context.document.documentElement.attrs;
  assert.equal(attrs['data-greenoil-imagery'], undefined, 'map view');
  h.context.history.replaceState(null, '', '');
  h.context.location.href = 'https://www.google.com/maps/@43.6414378,-79.3893532,3a,90y,90t/data=!3m7!1e1';
  h.context.history.replaceState(null, '', '');
  assert.equal(attrs['data-greenoil-imagery'], '1', 'photo viewer opened');
  h.context.location.href = 'https://www.google.com/maps/@43.6414378,-79.3893532,15z';
  (h.listeners.popstate || []).forEach((fn) => fn({}));
  assert.equal(attrs['data-greenoil-imagery'], undefined, 'back on the map');
  assert.match(css, /html\[data-greenoil-imagery\] #greenoil-waypoint-pins-overlay,\s*html\[data-greenoil-imagery\] #greenoil-pins-control-bar \{\s*display: none !important;/);
});
