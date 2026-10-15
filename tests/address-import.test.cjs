const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseAddressLines, planImport, toWaypoint } = require('../address-import.js');
const places = require('../google-places.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// A place record the way Google's search response nests it:
// [2] address lines, [9] [_, _, lat, lng], [10] id, [11] name, [39] address.
function record({ name, lat, lng, id = '0x882b2d:0xabc123', address = '' }) {
  const r = new Array(40).fill(null);
  r[2] = address ? [address.split(',')[0]] : null;
  r[9] = [null, null, lat, lng];
  r[10] = id;
  r[11] = name;
  r[39] = address;
  return r;
}
const searchBody = (...recs) => ")]}'\n" + JSON.stringify([['query', recs.map(r => [null, r])]]);
const fakeFetch = (body, calls = []) => async (url, opts) => {
  calls.push({ url, opts });
  return { ok: true, text: async () => body };
};

const VIEW = { lat: 43.7686, lng: -79.4674, zoom: 12, w: 1024, h: 768 };

test('parseAddressLines: one per line, list markers / blanks / repeats dropped', () => {
  const text = [
    '1. 4490 Chesswood Dr, North York',
    '',
    '  - Tim Hortons,   4400 Dufferin St  ',
    '4490 chesswood dr, north york',
    'ab',
    '• 100 Queen St W, Toronto',
  ].join('\r\n');
  assert.deepEqual(parseAddressLines(text), [
    '4490 Chesswood Dr, North York',
    'Tim Hortons, 4400 Dufferin St',
    '100 Queen St W, Toronto',
  ]);
  // A house number on its own is part of the address, not a list marker.
  assert.deepEqual(parseAddressLines('4490 Chesswood Dr'), ['4490 Chesswood Dr']);
});

test('lookupAddress: searches around the map view and returns the first place', async () => {
  const calls = [];
  const body = searchBody(
    record({ name: '4490 Chesswood Dr', lat: 43.7686, lng: -79.4674, id: '0x882b2d:0x1f2e', address: '4490 Chesswood Dr, North York, ON M3J 2B9' }),
    record({ name: 'Other', lat: 1, lng: 2 })
  );
  const place = await places.lookupAddress('4490 Chesswood Dr', VIEW, fakeFetch(body, calls));
  assert.deepEqual(place, {
    name: '4490 Chesswood Dr',
    address: '4490 Chesswood Dr, North York, ON M3J 2B9',
    latitude: 43.7686,
    longitude: -79.4674,
    placeId: 'cid_1f2e',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/search\?tbm=map&/);
  assert.match(calls[0].url, /&q=4490%20Chesswood%20Dr$/);
  assert.match(calls[0].url, /!2d-79\.4674!3d43\.7686/);
  assert.equal(calls[0].opts.credentials, 'include');
});

test('lookupAddress: nothing found -> null; HTTP error -> throws', async () => {
  assert.equal(await places.lookupAddress('nowhere', VIEW, fakeFetch(searchBody())), null);
  assert.equal(await places.lookupAddress('   ', VIEW, fakeFetch(searchBody())), null);
  await assert.rejects(
    places.lookupAddress('x', VIEW, async () => ({ ok: false, status: 429 })),
    /HTTP 429/
  );
});

test('planImport: adds found places, skips ones already in any route, reports the rest', () => {
  const routes = {
    route_1: { name: '绿线', waypoints: [{ name: 'Tim Hortons', address: '4400 Dufferin St', placeId: 'cid_aa' }] },
    route_2: { name: '蓝线', waypoints: [{ name: 'Pizza Pizza', address: '1 King St', placeId: 'cid_bb' }] },
  };
  const results = [
    { query: 'a', place: { name: 'New Place', address: '9 Main St', latitude: 43.7, longitude: -79.4, placeId: 'cid_cc' } },
    { query: 'b', place: { name: 'Tim Hortons (Dufferin)', address: 'x', latitude: 43.7, longitude: -79.4, placeId: 'cid_aa' } },
    { query: 'c', place: { name: 'pizza pizza', address: '1 King St', latitude: 43.6, longitude: -79.3, placeId: '' } },
    { query: 'd', place: null },
    { query: 'e', error: 'Google search HTTP 429' },
    { query: 'f', place: { name: 'New Place', address: '9 Main St', latitude: 43.7, longitude: -79.4, placeId: 'cid_cc' } },
  ];
  const plan = planImport(results, routes);
  assert.deepEqual(plan.add.map(w => w.name), ['New Place']);
  assert.deepEqual(plan.duplicates, [
    { query: 'b', name: 'Tim Hortons (Dufferin)', routeName: '绿线' },
    { query: 'c', name: 'pizza pizza', routeName: '蓝线' },
    { query: 'f', name: 'New Place', routeName: '' },
  ]);
  assert.deepEqual(plan.notFound, ['d']);
  assert.deepEqual(plan.failed, [{ query: 'e', error: 'Google search HTTP 429' }]);
});

test('toWaypoint: the shape routes store, with numeric coordinates', () => {
  const w = toWaypoint({ name: 'A', address: 'B', latitude: '43.5', longitude: '-79.5', placeId: 'cid_1' });
  assert.deepEqual(w, {
    name: 'A', address: 'B', latitude: 43.5, longitude: -79.5, openingHours: '', phone: '',
    placeId: 'cid_1', mapsUrl: 'https://www.google.com/maps/search/?api=1&query=43.5,-79.5',
  });
});

test('popup wires the 导入地址 button, modal and the Maps-tab lookup', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const content = read('content.js');
  assert.ok(html.includes('id="btnImportAddresses"'));
  assert.ok(html.includes('id="importModal"'));
  assert.ok(html.indexOf('src="address-import.js"') < html.indexOf('src="popup.js"'), 'module loads before popup.js');
  assert.ok(popup.includes('action: "lookupAddresses"'));
  assert.ok(popup.includes('planImport(resp.results, this.colorRoutes)'));
  assert.ok(content.includes('message.action === "lookupAddresses"'));
  assert.ok(content.includes('placesApi.lookupAddress(query, view)'));
});
