const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const places = require('../google-places.js');
const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const plain = (v) => JSON.parse(JSON.stringify(v));

const HERE = { lat: 43.8045, lng: -79.3395 };
const VIEW = { lat: 43.8045, lng: -79.3395, zoom: 16, w: 937, h: 375 };

// A Google Maps search record, shaped like the real response
// ([2] address lines, [9] [_, _, lat, lng], [10] id, [11] name, [13] categories, [39] address).
function rec(id, name, dLat, dLng, categories, address) {
  const r = [];
  r[2] = [address.split(',')[0]];
  r[9] = [null, null, HERE.lat + dLat, HERE.lng + dLng];
  r[10] = `0x${id}:0x${id}`;
  r[11] = name;
  r[13] = categories;
  r[39] = address;
  return r;
}
// Real responses nest records deep inside a ")]}'"-guarded array.
const body = (records, wrapped) => {
  const inner = ")]}'\n" + JSON.stringify(['restaurants', [[null, [null, records[0]]], ...records.slice(1).map((r) => [null, r])]]);
  return wrapped ? JSON.stringify({ c: 0, d: inner }) + '/*""*/' : inner;
};

// ---------- google-places.js ----------

test('parses Google search responses (plain and {"d": ...}-wrapped)', () => {
  const recs = [
    rec(1, 'Litsea Cuisine', 0.001, 0.002, ['Restaurant'], '3550 Victoria Park Ave Unit 100, North York, ON M2H 2E1'),
    rec(2, 'Tung’s Cantonese BBQ 大東燒味小炒', -0.001, 0.004, ['Chinese restaurant'], '3601 Victoria Park Ave #121 Scarborough, ON M1W 3Y3'),
  ];
  for (const wrapped of [false, true]) {
    const out = places.parseSearchResponse(body(recs, wrapped));
    assert.deepEqual(out.map((r) => r.name), ['Litsea Cuisine', 'Tung’s Cantonese BBQ 大東燒味小炒']);
    assert.equal(out[1].placeId, '0x2:0x2');
    assert.deepEqual(out[1].categories, ['Chinese restaurant']);
    assert.ok(Math.abs(out[0].latitude - (HERE.lat + 0.001)) < 1e-12);
  }
});

test('keeps restaurants / fast food / food courts / cafeterias; drops cafés, bakeries, non-food', () => {
  for (const cats of [
    ['Chinese restaurant'], ['Fast food restaurant', 'Cafe'], ['Food court'], ['Cafeteria'],
    ['Breakfast restaurant', 'Caterer'], ['Hong Kong style fast food restaurant'],
  ]) assert.ok(places.isWantedFoodPlace(cats), cats.join('/'));
  for (const cats of [
    ['Coffee shop', 'Breakfast restaurant'], ['Cafe', 'Restaurant'], ['Bakery', 'Chinese restaurant'],
    ['Donut shop', 'Fast food restaurant'], ['Cake shop'], ['Telecommunications service provider'],
    ['Caterer'], ['Event venue'], [],
  ]) assert.ok(!places.isWantedFoodPlace(cats), cats.join('/'));
});

test('house number + street from Google addresses', () => {
  const cases = {
    '3601 Victoria Park Ave #121 Scarborough, ON M1W 3Y3': '3601 Victoria Park Ave',
    '105 Gordon Baker Rd Uinit 110, North York, ON': '105 Gordon Baker Rd',
    '3330 Pharmacy Ave Unit K, Scarborough': '3330 Pharmacy Ave',
    '3555 Don Mills Rd., North York': '3555 Don Mills Rd',
    '2938A Finch Ave E, Toronto': '2938A Finch Ave E',
    '3601 Victoria Park Ave Scarborough, ON': '3601 Victoria Park Ave',
    'Unit 3 - 3601 Victoria Park Ave, Toronto': '3601 Victoria Park Ave',
    'and Finch, Victoria Park Ave, Scarborough': '',
    'Seneca College Newnham Campus, 1750 Finch Ave E': '',
  };
  for (const [addr, want] of Object.entries(cases)) assert.equal(places.streetPrefixFromAddress(addr), want, addr);
});

test('English store names, including mixed Chinese/English names', () => {
  assert.equal(places.englishName('McDonald’s'), "McDonald's");
  assert.equal(places.englishName('Tung’s Cantonese BBQ 大東燒味小炒'), "Tung's Cantonese BBQ");
  assert.equal(places.englishName('巡南记 Litsea Cuisine - 云南地域民族私房菜'), 'Litsea Cuisine');
  assert.equal(places.englishName('悦宴－苏青'), '');
  assert.equal(places.englishName('湘逢Hype湖南菜'), 'Hype');
});

test('only places inside the visible window count (not under the side panel)', () => {
  // zoom 16 at this latitude: ~1.72 m/px -> the 937x375 window is ~1.6 x 0.65 km
  assert.ok(places.inView(HERE.lat, HERE.lng, VIEW));
  assert.ok(!places.inView(HERE.lat + 0.01, HERE.lng, VIEW), '1.1 km north is outside');
  const west = HERE.lng - 0.005; // ~ -200 px from center -> x ~ 270
  assert.ok(places.inView(HERE.lat, west, VIEW));
  assert.ok(!places.inView(HERE.lat, west, { ...VIEW, hidden: [{ left: 0, top: 0, width: 400, height: 375 }] }),
    'covered by the panel');
});

test('selects the nearest wanted places in the window, nearest first', () => {
  const recs = [
    rec(1, 'Far Restaurant', 0.0015, 0.004, ['Restaurant'], '10 Main St, Toronto'),
    rec(2, 'Near Fast Food', 0.0002, 0.0002, ['Fast food restaurant'], '12 Main St, Toronto'),
    rec(3, 'Coffee', 0.0001, 0.0001, ['Coffee shop'], '14 Main St, Toronto'),
    rec(4, 'Out Of Window', 0.02, 0, ['Restaurant'], '99 Far Rd, Toronto'),
    rec(2, 'Near Fast Food', 0.0002, 0.0002, ['Fast food restaurant'], '12 Main St, Toronto'), // dup from another query
    rec(5, 'Mid Court', 0.001, 0, ['Food court'], '20 Main St, Toronto'),
  ];
  const out = plain(places.selectNearest(places.parseSearchResponse(body(recs)), VIEW, HERE, 20));
  assert.deepEqual(out.map((c) => c.name), ['Near Fast Food', 'Mid Court', 'Far Restaurant']);
  assert.equal(out[0].streetPrefix, '12 Main St');
  assert.equal(out[0].category, 'Fast food restaurant');
  assert.equal(plain(places.selectNearest(places.parseSearchResponse(body(recs)), VIEW, HERE, 2)).length, 2);
});

test('request is Google\'s own search for the current view (template, no session ids)', () => {
  const url = places.buildSearchUrl({ ...VIEW, w: 1200, h: 800 }, 'fast food', 60);
  assert.match(url, /^\/search\?tbm=map&authuser=0&hl=en&pb=!4m9!1m3!1d[\d.]+!2d-79\.3395!3d43\.8045!2m0!3m2!1i1200!2i800!4f13\.1!7i60!/);
  assert.match(url, /&q=fast%20food$/);
  assert.ok(!url.includes('!22m6'), 'per-session block removed');
  // altitude for zoom 16 / 375 px matches what Google itself sent (2811.99)
  assert.ok(Math.abs(places.viewAltitude(43.8045, 16, 375) - 2811.99) < 5);
});

test('fetchWindowFoodPlaces runs the three Google searches and merges them', async () => {
  const asked = [];
  const out = plain(await places.fetchWindowFoodPlaces(VIEW, HERE, 20, async (url, opts) => {
    asked.push(decodeURIComponent(url.split('&q=')[1]));
    assert.equal(opts.credentials, 'include');
    const q = decodeURIComponent(url.split('&q=')[1]);
    const recs = q === 'restaurants'
      ? [rec(1, 'R', 0.001, 0, ['Restaurant'], '1 A St, T')]
      : q === 'fast food' ? [rec(2, 'F', 0.0005, 0, ['Fast food restaurant'], '2 A St, T')]
        : [rec(3, 'C', 0.0007, 0, ['Food court'], '3 A St, T')];
    return { ok: true, text: async () => body(recs) };
  }));
  assert.deepEqual(asked.sort(), ['fast food', 'food court', 'restaurants']);
  assert.deepEqual(out.map((c) => c.name), ['F', 'C', 'R']);
  await assert.rejects(places.fetchWindowFoodPlaces(VIEW, HERE, 20, async () => ({ ok: true, text: async () => ")]}'\n[]" })),
    /no places/, 'format change is reported, not silently "0 matches"');
});

test('no third-party map data: OSM/Overpass/Nominatim are gone', () => {
  for (const s of ['overpass', 'nominatim', 'openstreetmap']) {
    assert.ok(!source.toLowerCase().includes(s), `background.js mentions ${s}`);
    assert.ok(!JSON.stringify(manifest).toLowerCase().includes(s), `manifest mentions ${s}`);
  }
  assert.deepEqual(manifest.content_scripts.find((c) => c.js.includes('content.js')).js, ['google-places.js', 'content.js']);
});

// ---------- MIS query planning (background.js) ----------

function loadPlanning() {
  const ctx = vm.createContext({ Math, Number });
  vm.runInContext(slice('// ---- Nearby food places ----', '/**\n * Parse MIS Customer'), ctx);
  return ctx;
}

test('MIS plan: house number -> address search, otherwise English name search', () => {
  const m = loadPlanning();
  const plans = plain(m.planMisQueries([
    { name: 'Litsea', englishName: 'Litsea Cuisine', streetPrefix: '3550 Victoria Park Ave' },
    { name: 'Hickory', englishName: 'Hickory House Restaurant', streetPrefix: '' },
    { name: 'Subway', englishName: 'Subway', streetPrefix: '' },
    { name: 'Subway', englishName: 'Subway', streetPrefix: '' },
    { name: '悦宴', englishName: '', streetPrefix: '' }, // nothing to search by
  ]));
  assert.deepEqual(plans.map((p) => [p.kind, p.keyword, p.candidates.length]), [
    ['address', '3550 Victoria Park Ave', 1],
    ['name', 'Hickory House Restaurant', 1],
    ['name', 'Subway', 2],
  ]);
});

test('name hits are narrowed to the same street, or accepted only when unambiguous', () => {
  const m = loadPlanning();
  const recs = [
    { code: 'A', address: '3600 Victoria Park Ave' },
    { code: 'B', address: '12 Yonge St' },
    { code: 'C', address: '99 Finch Ave E' },
    { code: 'D', address: '1 Bay St' },
  ];
  assert.deepEqual(plain(m.filterNameHits(recs, { street: 'Victoria Park Avenue' })).map((r) => r.code), ['A']);
  assert.deepEqual(plain(m.filterNameHits(recs, { street: 'Finch Ave E' })).map((r) => r.code), ['C']);
  assert.deepEqual(plain(m.filterNameHits(recs, { street: '' })), [], 'chain with 4 hits and no street: reject');
  assert.deepEqual(plain(m.filterNameHits(recs.slice(0, 2), { street: '' })).map((r) => r.code), ['A', 'B']);
});

test('page-provided candidates are sanitized', () => {
  const m = loadPlanning();
  const out = plain(m.sanitizeCandidates([
    { name: 'Ok', latitude: 1, longitude: 2, streetPrefix: '1 A St', extra: 'dropped' },
    { name: 'NoCoords' },
    null,
    { name: 42, latitude: 1, longitude: 2 },
  ]));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Ok');
  assert.equal(out[0].extra, undefined);
  assert.deepEqual(plain(m.sanitizeCandidates('nope')), []);
});

// ---------- MIS result cache ----------

function loadHandler({ loggedIn = true, misHtml, misUrl = 'https://mis.greenoilinc.com/index_intranet.php' } = {}) {
  const store = {};
  const misCalls = [];
  const state = { loggedIn };
  const cookies = () => (state.loggedIn ? [{ name: 'LOGCHECK', value: '1' }, { name: 'PHPSESSID', value: 'x' }] : []);
  const ctx = vm.createContext({
    console: { warn() {}, log() {} }, URLSearchParams, AbortSignal, Date, Math, Object, Promise, Number,
    setTimeout: (fn) => { fn(); return 0; },
    fetch: async (url) => {
      misCalls.push(String(url));
      return { ok: true, url: misUrl, text: async () => misHtml || '<table></table>' };
    },
    chrome: {
      storage: { local: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))),
        remove: async (k) => { delete store[k]; },
      } },
      cookies: {
        getAll: async () => cookies(),
        get: async () => cookies().find((c) => c.name === 'PHPSESSID') || null,
        onChanged: { addListener() {} },
      },
      tabs: { sendMessage: async () => {}, query() {} },
    },
    getOrInitColorRoutes: async () => ({ activeRoute: null }),
  });
  vm.runInContext(slice('function getHaversineDistKm', '\n}\n') + '\n}\n', ctx);
  vm.runInContext(slice('let _cachedMisAuth', '// Runtime Message Dispatcher'), ctx);
  const candidates = Array.from({ length: 20 }, (_, i) => ({
    name: `R${i}`, englishName: `R${i} Kitchen`, streetPrefix: `${100 + i} Main St`, street: 'Main St',
    displayName: `${100 + i} Main St, Toronto`, latitude: HERE.lat + 0.0001 * i, longitude: HERE.lng,
  }));
  const scan = (extra = {}) => vm.runInContext('handleScanAndMatchMis', ctx)(
    { lat: HERE.lat, lng: HERE.lng, candidates, ...extra }, {});
  return { ctx, store, misCalls, state, scan };
}

test('second scan of the same area is served from the MIS cache', async () => {
  const h = loadHandler();
  const r1 = await h.scan();
  assert.equal(r1.success, true);
  assert.equal(r1.totalScanned, 20);
  assert.equal(r1.cachedQueries, 0);
  const firstCalls = h.misCalls.length;
  assert.equal(firstCalls, 20, 'one MIS query per address');
  assert.ok(h.store.gce_mis_cache);

  const r2 = await h.scan();
  assert.equal(h.misCalls.length, firstCalls, 'no new MIS requests');
  assert.equal(r2.cachedQueries, r2.totalQueries);

  await h.scan({ forceRefresh: true });
  assert.equal(h.misCalls.length, firstCalls * 2, 'Shift+click re-queries everything');
});

test('logging out of MIS wipes cached customer data', async () => {
  const h = loadHandler();
  await h.scan();
  assert.ok(h.store.gce_mis_cache);
  h.state.loggedIn = false;
  const r = await h.scan();
  assert.equal(r.notLoggedIn, true, 'cache is not served while logged out');
  assert.equal(h.store.gce_mis_cache, undefined, 'customer cache deleted');
});

test('an MIS login page (expired session) is never cached as "no customers"', async () => {
  const h = loadHandler({ misHtml: '<form><input type="password" name="pw"></form>' });
  await h.scan();
  assert.deepEqual(Object.keys(h.store.gce_mis_cache || {}), []);
  const h2 = loadHandler({ misUrl: 'https://mis.greenoilinc.com/login_intranet.php' });
  await h2.scan();
  assert.deepEqual(Object.keys(h2.store.gce_mis_cache || {}), []);
});

test('cache entries expire after 30 days and are capped', () => {
  const h = loadHandler();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const prune = vm.runInContext('pruneCache', h.ctx);
  assert.deepEqual(Object.keys(plain(prune({ fresh: { t: now - 29 * day }, old: { t: now - 31 * day }, newest: { t: now } }, 1, now))), ['newest']);
  assert.deepEqual(Object.keys(plain(prune({ fresh: { t: now - 29 * day }, old: { t: now - 31 * day } }, 10, now))), ['fresh']);
});
