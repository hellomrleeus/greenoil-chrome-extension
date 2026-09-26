const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

function load(fetchImpl) {
  const ctx = vm.createContext({
    console: { warn() {}, log() {} }, URLSearchParams, AbortSignal, Date, Math,
    setTimeout: (fn) => { fn(); return 0; },
    fetch: fetchImpl || (async () => { throw new Error('no network in tests'); }),
  });
  vm.runInContext(slice('function getHaversineDistKm', '\n}\n') + '\n}\n', ctx);
  vm.runInContext(slice('// ---- Nearby food places', '/**\n * Parse MIS Customer'), ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

const HERE = { lat: 43.8045, lng: -79.3395 };
const node = (id, dLat, tags) => ({ type: 'node', id, lat: HERE.lat + dLat, lon: HERE.lng, tags });

test('Overpass results are sorted nearest-first and deduplicated', () => {
  const m = load();
  const out = m.parseOverpassFood([
    node(1, 0.009, { amenity: 'restaurant', name: 'Far' }),
    node(2, 0.001, { amenity: 'fast_food', name: 'Near', 'addr:housenumber': '3600', 'addr:street': 'Victoria Park Avenue' }),
    { type: 'way', id: 3, center: { lat: HERE.lat + 0.004, lon: HERE.lng }, tags: { amenity: 'food_court', name: 'Mid Court' } },
    node(4, 0.0011, { amenity: 'restaurant', name: 'near' }), // same place mapped twice (< 30 m)
  ], HERE.lat, HERE.lng);
  assert.deepEqual(out.map((c) => c.name), ['Near', 'Mid Court', 'Far']);
  assert.equal(out[0].streetPrefix, '3600 Victoria Park Avenue');
  assert.ok(out[0].distanceKm < out[1].distanceKm && out[1].distanceKm < out[2].distanceKm);
});

test('cafés and bakeries are excluded; fast food and canteens are kept', () => {
  const m = load();
  assert.ok(m.buildOverpassQuery(1, 2, 1000).includes('restaurant|fast_food|food_court|canteen'));
  assert.ok(!/cafe/.test(m.buildOverpassQuery(1, 2, 1000)), 'amenity=cafe never queried');
  for (const c of ['coffee_shop', 'burger;coffee_shop', 'bakery', 'donut', 'cake', 'cookies']) {
    assert.ok(m.isExcludedCuisine(c), c);
  }
  for (const c of ['burger', 'chinese;noodle', '', undefined]) assert.ok(!m.isExcludedCuisine(c), String(c));
  const out = m.parseOverpassFood([
    node(1, 0.001, { amenity: 'fast_food', name: 'Tim Hortons', cuisine: 'coffee_shop;donut' }),
    node(2, 0.002, { amenity: 'canteen', name: 'Staff Canteen' }),
    node(3, 0.003, { amenity: 'fast_food', name: 'Burger Place', cuisine: 'burger' }),
  ], HERE.lat, HERE.lng);
  assert.deepEqual(out.map((c) => c.name), ['Staff Canteen', 'Burger Place']);
});

test('englishName prefers name:en, accepts Latin names, rejects non-Latin', () => {
  const m = load();
  assert.equal(m.englishName({ name: '老四川', 'name:en': 'Old Sichuan' }), 'Old Sichuan');
  assert.equal(m.englishName({ name: 'Pepper Meets Pepper' }), 'Pepper Meets Pepper');
  assert.equal(m.englishName({ name: 'Shopsy’s' }), "Shopsy's");
  assert.equal(m.englishName({ name: 'Café Crêpe' }), 'Café Crêpe');
  assert.equal(m.englishName({ name: '老四川' }), '');
  assert.equal(m.englishName({ name: 'KFC' }), 'KFC');
  assert.equal(m.englishName({ name: 'A1' }), '', 'too short');
});

test('MIS plan: house number -> address search, otherwise English name search', () => {
  const m = load();
  const plans = plain(m.planMisQueries([
    { name: 'Litsea', englishName: 'Litsea Cuisine', streetPrefix: '3550 Victoria Park Avenue' },
    { name: 'Hickory', englishName: 'Hickory House Restaurant', streetPrefix: '' },
    { name: 'Subway', englishName: 'Subway', streetPrefix: '' },
    { name: 'Subway', englishName: 'Subway', streetPrefix: '' },
    { name: '老四川', englishName: '', streetPrefix: '' }, // nothing to search by
  ]));
  assert.deepEqual(plans.map((p) => [p.kind, p.keyword, p.candidates.length]), [
    ['address', '3550 Victoria Park Avenue', 1],
    ['name', 'Hickory House Restaurant', 1],
    ['name', 'Subway', 2],
  ]);
});

test('name hits are narrowed to the same street, or accepted only when unambiguous', () => {
  const m = load();
  const recs = [
    { code: 'A', address: '3600 Victoria Park Ave' },
    { code: 'B', address: '12 Yonge St' },
    { code: 'C', address: '99 Finch Ave E' },
    { code: 'D', address: '1 Bay St' },
  ];
  assert.deepEqual(plain(m.filterNameHits(recs, { street: 'Victoria Park Avenue' })).map((r) => r.code), ['A'],
    'Avenue/Ave normalized');
  assert.deepEqual(plain(m.filterNameHits(recs, { street: 'Finch Avenue East' })).map((r) => r.code), ['C']);
  assert.deepEqual(plain(m.filterNameHits(recs, { street: '' })), [], 'chain with 4 hits and no street: reject');
  assert.deepEqual(plain(m.filterNameHits(recs.slice(0, 2), { street: '' })).map((r) => r.code), ['A', 'B']);
});

test('falls back to Nominatim (sorted by distance) when Overpass is down', async () => {
  const calls = [];
  const m = load(async (url) => {
    calls.push(String(url));
    if (String(url).includes('overpass')) return { ok: false, status: 504 };
    const q = new URL(url).searchParams.get('q');
    const base = { restaurant: [0.004, 0.001], 'fast food': [0.002], 'food court': [] }[q];
    return {
      ok: true,
      json: async () => base.map((d, i) => ({
        name: `${q} ${i}`, lat: String(HERE.lat + d), lon: String(HERE.lng),
        address: { house_number: '10', road: 'Main Street' }, namedetails: {}, extratags: {},
      })),
    };
  });
  const out = plain(await m.fetchNearbyRestaurants(HERE.lat, HERE.lng, 2));
  assert.deepEqual(out.map((c) => c.name), ['restaurant 1', 'fast food 0']);
  assert.ok(calls.some((u) => u.includes('overpass')), 'tried Overpass first');
  assert.ok(calls.some((u) => u.includes('nominatim') && u.includes('bounded=1')));
});

test('uses Overpass alone when it already has enough places', async () => {
  const calls = [];
  const els = Array.from({ length: 25 }, (_, i) => node(i, 0.0001 * (25 - i), { amenity: 'restaurant', name: `R${i}` }));
  const m = load(async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ elements: els }) };
  });
  const out = plain(await m.fetchNearbyRestaurants(HERE.lat, HERE.lng, 20));
  assert.equal(out.length, 20);
  assert.equal(out[0].name, 'R24', 'nearest first');
  assert.equal(calls.length, 1, 'one radius was enough, no fallback');
});
