const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const places = require('../google-places.js');
const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
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
  const inner = ")]}'\n" + JSON.stringify(['restaurants', records.map((r) => [null, r])]);
  return wrapped ? JSON.stringify({ c: 0, d: inner }) + '/*""*/' : inner;
};

// ---------- google-places.js: search ----------

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
  };
  for (const [addr, want] of Object.entries(cases)) assert.equal(places.streetPrefixFromAddress(addr), want, addr);
});

test('English store names, including mixed Chinese/English names', () => {
  assert.equal(places.englishName('McDonald’s'), "McDonald's");
  assert.equal(places.englishName('Tung’s Cantonese BBQ 大東燒味小炒'), "Tung's Cantonese BBQ");
  assert.equal(places.englishName('巡南记 Litsea Cuisine - 云南地域民族私房菜'), 'Litsea Cuisine');
  assert.equal(places.englishName('悦宴－苏青'), '');
});

test('only places inside the visible window count (not under the side panel)', () => {
  assert.ok(places.inView(HERE.lat, HERE.lng, VIEW));
  assert.ok(!places.inView(HERE.lat + 0.01, HERE.lng, VIEW), '1.1 km north is outside');
  const west = HERE.lng - 0.005;
  assert.ok(places.inView(HERE.lat, west, VIEW));
  assert.ok(!places.inView(HERE.lat, west, { ...VIEW, hidden: [{ left: 0, top: 0, width: 400, height: 375 }] }));
});

test('search request: Google\'s own template, paged with !8i, no session ids', () => {
  const url = places.buildSearchUrl({ ...VIEW, w: 1200, h: 800 }, 'fast food', 20, 40);
  assert.match(url, /^\/search\?tbm=map&authuser=0&hl=en&pb=!4m9!1m3!1d[\d.]+!2d-79\.3395!3d43\.8045!2m0!3m2!1i1200!2i800!4f13\.1!7i20!8i40!/);
  assert.match(url, /&q=fast%20food$/);
  assert.ok(!places.buildSearchUrl(VIEW, 'x', 20, 0).includes('!8i'), 'first page has no offset');
  assert.ok(!url.includes('!22m6'), 'per-session block removed');
  assert.ok(Math.abs(places.viewAltitude(43.8045, 16, 375) - 2811.99) < 5);
});

test('fetchWindowPlaces pages through every query, streams new in-window places, no limit', async () => {
  const asked = [];
  const many = Array.from({ length: 45 }, (_, i) => rec(100 + i, `R${i}`, 0.00002 * i, 0, ['Restaurant'], `${i} A St, T`));
  const streamed = [];
  const total = await places.fetchWindowPlaces(VIEW, {
    fetchImpl: async (url) => {
      const q = decodeURIComponent(url.split('&q=')[1]);
      const off = Number((url.match(/!8i(\d+)/) || [0, 0])[1]);
      asked.push(`${q}@${off}`);
      let page = [];
      if (q === 'restaurants') page = many.slice(off, off + 20);
      if (q === 'fast food' && off === 0) {
        page = [rec(100, 'R0', 0, 0, ['Restaurant'], '0 A St, T'), // already seen
          rec(2, 'Fries', 0.0003, 0, ['Fast food restaurant'], '2 B St, T'),
          rec(3, 'Coffee', 0.0003, 0, ['Coffee shop'], '3 B St, T'),
          rec(4, 'Far', 0.03, 0, ['Restaurant'], '4 B St, T')];
      }
      return { ok: true, text: async () => body(page) };
    },
    onPlaces: (batch) => streamed.push(batch.map((p) => p.name)),
  });
  assert.deepEqual(asked, ['restaurants@0', 'restaurants@20', 'restaurants@40', 'fast food@0', 'food court@0']);
  const names = streamed.flat();
  assert.equal(names.length, 46, 'all 45 restaurants + Fries (no 20-place cap)');
  assert.ok(names.includes('Fries') && !names.includes('Coffee') && !names.includes('Far'));
  assert.equal(new Set(names).size, names.length, 'each place streamed once');
  assert.equal(streamed.length, 4, 'one onPlaces call per page with new places');
  assert.equal(total, 48, "unique results seen (incl. filtered ones)");
  await assert.rejects(places.fetchWindowPlaces(VIEW, { fetchImpl: async () => ({ ok: true, text: async () => ")]}'\n[]" }) }),
    /no places/, 'format change is reported');
});

// ---------- google-places.js: details & rate limit ----------

function detailBody({ name = 'McDonald\'s', desc = 'Iconic fast-food burger & fries chain', owner = 'From the Big Mac to the Quarter Pounder, since 1967.', reviews = ['"Tasty hot fresh coffee and fast friendly service."'] } = {}) {
  const p = [];
  p[11] = name;
  p[13] = ['Fast food restaurant', 'Hamburger restaurant'];
  p[31] = [null, reviews.map((r) => [[null, null, null, null, 'x'], r])];
  p[32] = [[null, desc], [null, 'Classic, long-running fast-food chain known for its burgers & fries.']];
  p[154] = [[owner]];
  const d = [];
  d[6] = p;
  return ")]}'\n" + JSON.stringify(d);
}

test('detail page -> description, owner description, review snippets', () => {
  const d = places.parseDetailResponse(detailBody());
  assert.equal(d.name, "McDonald's");
  assert.match(d.description, /^Iconic fast-food burger & fries chain Classic/);
  assert.match(d.ownerDescription, /Big Mac/);
  assert.deepEqual(d.reviews, ['Tasty hot fresh coffee and fast friendly service.']);
  assert.equal(places.parseDetailResponse(")]}'\n[null]"), null);
  const url = places.buildDetailUrl('0x89d4d3006fc96651:0xb0f789e19baaebe1');
  assert.match(url, /^\/maps\/preview\/place\?authuser=0&hl=en&pb=!1m10!1s0x89d4d3006fc96651%3A0xb0f789e19baaebe1!3m8/);
  assert.ok(!url.includes('!14m3'), 'per-session block removed');
});

test('rate limiter: serial jobs, starts spaced by the interval, limiters independent', async () => {
  let clock = 0;
  const sleeps = [];
  const mk = () => places.createRateLimiter(1000, () => clock, async (ms) => { sleeps.push(ms); clock += ms; });
  const detail = mk();
  const starts = [];
  await Promise.all([1, 2, 3].map((i) => detail(async () => { starts.push([i, clock]); clock += 100; })));
  assert.deepEqual(starts, [[1, 0], [2, 1000], [3, 2000]]);
  const other = mk();
  const t0 = clock;
  await other(async () => {});
  assert.equal(clock, t0, 'a separate limiter does not wait for the first one');
});

// ---------- background.js: per-place MIS matching ----------

function loadMatching() {
  const ctx = vm.createContext({ Math, Number, Set });
  vm.runInContext(slice('// ---- 探索: per-place MIS matching ----', '/**\n * Parse MIS Customer'), ctx);
  return ctx;
}

test('MIS query per place: house number -> address, else English name', () => {
  const m = loadMatching();
  assert.deepEqual(plain(m.misQueryFor({ streetPrefix: '3550 Victoria Park Ave', englishName: 'Litsea' })), { kind: 'address', keyword: '3550 Victoria Park Ave' });
  assert.deepEqual(plain(m.misQueryFor({ streetPrefix: '', englishName: 'Hickory House' })), { kind: 'name', keyword: 'Hickory House' });
  assert.equal(m.misQueryFor({ streetPrefix: '', englishName: '' }), null);
});

test('the MIS customer is tied to THIS place (unit, name, single tenant)', () => {
  const m = loadMatching();
  const plaza = [
    { code: 'A', name: 'SEAFOOD PRINCESS INC', address: '3601 Victoria Park Ave Unit 100', sts: 'A' },
    { code: 'B', name: 'TUNGS BBQ', address: '3601 Victoria Park Ave #121', sts: 'A' },
    { code: 'C', name: 'GOLDEN WOK', address: '3601 Victoria Park Ave Unit 5', sts: 'A' },
  ];
  // same unit number wins even when names differ (Chinese Google name)
  assert.equal(m.pickMisRecordForPlace(plaza, { name: '大東燒味', englishName: '', displayName: '3601 Victoria Park Ave #121 Scarborough' }, 'address').code, 'B');
  // name match when Google has no unit
  assert.equal(m.pickMisRecordForPlace(plaza, { name: 'Seafood Princess', englishName: 'Seafood Princess', displayName: '3601 Victoria Park Ave, Scarborough' }, 'address').code, 'A');
  // a plaza tenant with neither unit nor name match is NOT attached to someone else's account
  assert.equal(m.pickMisRecordForPlace(plaza, { name: 'Pho Hung', englishName: 'Pho Hung', displayName: '3601 Victoria Park Ave, Scarborough' }, 'address'), null);
  // single customer at a single-tenant address
  const single = [{ code: 'S', name: 'YUE YAN RESTAURANT', address: '3560 Victoria Park Ave' }];
  assert.equal(m.pickMisRecordForPlace(single, { name: '悦宴', englishName: '', displayName: '3560 Victoria Park Ave, North York' }, 'address').code, 'S');
  // ...but not when the Google place is a unit in a plaza
  assert.equal(m.pickMisRecordForPlace(single, { name: '悦宴', englishName: '', displayName: '3560 Victoria Park Ave #1, North York' }, 'address'), null);
  // name search: same street required
  const chain = [{ code: 'X', name: 'SUBWAY', address: '12 Yonge St' }, { code: 'Y', name: 'SUBWAY', address: '1760 Finch Ave E' }];
  assert.equal(m.pickMisRecordForPlace(chain, { name: 'Subway', englishName: 'Subway', street: 'Finch Ave E', displayName: '' }, 'name').code, 'Y');
});

test('name / unit helpers', () => {
  const m = loadMatching();
  assert.equal(m.nameScore('Seafood Princess Inc', 'Seafood Princess'), 1);
  assert.equal(m.nameScore('Golden Wok Restaurant', 'Seafood Princess'), 0);
  assert.equal(m.unitOf('3601 Victoria Park Ave #121 Scarborough'), '121');
  assert.equal(m.unitOf('105 Gordon Baker Rd Uinit 110, North York'), '110');
  assert.equal(m.unitOf('3330 Pharmacy Ave Unit K, Scarborough'), 'k');
  assert.equal(m.unitOf('3560 Victoria Park Ave, North York'), '');
});

test('page-provided places are sanitized', () => {
  const m = loadMatching();
  const p = plain(m.sanitizeExplorePlace({ placeId: '0x1:0x1', name: 'Ok', latitude: 1, longitude: 2, reviews: ['a', 5, 'b'], extra: 'x' }));
  assert.equal(p.name, 'Ok');
  assert.deepEqual(p.reviews, ['a', 'b']);
  assert.equal(p.extra, undefined);
  assert.equal(m.sanitizeExplorePlace({ name: 'no id' }), null);
});

// ---------- background.js: 探索 handlers (MIS queue, positive-only cache, jev) ----------

function loadHandlers({ loggedIn = true, misHtml, misUrl = 'https://mis.greenoilinc.com/index_intranet.php', jevReply } = {}) {
  const store = {};
  const calls = { mis: [], jev: [] };
  const state = { loggedIn, misHtml, misInFlight: 0, misMaxInFlight: 0 };
  const cookies = () => (state.loggedIn ? [{ name: 'LOGCHECK', value: '1' }, { name: 'PHPSESSID', value: 'x' }] : []);
  const timers = [];
  const ctx = vm.createContext({
    console: { warn() {}, log() {} }, URLSearchParams, AbortSignal, Date, Math, Object, Promise, Number, Set, Map, JSON, Error,
    // The jev batching timer is flushed by the test; every other wait (MIS 1/s) runs at once.
    setTimeout: (fn, ms) => { if (ms === 700) timers.push(fn); else setImmediate(fn); return timers.length; },
    WORKER_URL: 'https://worker.example',
    fetch: async (url, opts) => {
      url = String(url);
      if (url.includes('/api/jev/key')) return { ok: true, json: async () => ({ success: true, key: 'k' }) };
      if (url.includes('jev.example')) {
        calls.jev.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: jevReply(JSON.parse(JSON.parse(opts.body).messages[1].content)) } }] }) };
      }
      calls.mis.push(url);
      state.misInFlight++;
      state.misMaxInFlight = Math.max(state.misMaxInFlight, state.misInFlight);
      await new Promise((r) => setImmediate(r));
      state.misInFlight--;
      return { ok: true, url: misUrl, text: async () => state.misHtml || '<table></table>' };
    },
    chrome: {
      storage: {
        local: {
          get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : Object.fromEntries(k.map((x) => [x, store[x]]))),
          set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))),
          remove: async (k) => { for (const x of [].concat(k)) delete store[x]; },
        },
        onChanged: { addListener() {} },
      },
      cookies: {
        getAll: async () => cookies(),
        get: async () => cookies().find((c) => c.name === 'PHPSESSID') || null,
        onChanged: { addListener() {} },
      },
      tabs: { sendMessage: async () => {}, query() {} },
    },
  });
  store.authToken = 'op-token';
  vm.runInContext(slice('let _cachedMisAuth', '// Runtime Message Dispatcher'), ctx);
  const run = (name, msg) => vm.runInContext(name, ctx)(msg);
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  return { ctx, store, calls, state, run, flushTimers };
}

const misRow = (code, name, address) =>
  `<tr><td>1</td><td><b class='customer-info-detail'>${name}</b></td><td>${code}</td><td>${address}</td><td>Toronto</td><td>Cash</td><td>1</td><td>box</td><td>Bob</td><td>416</td><td>A</td><td></td><td></td></tr>`;

const PLACE = { placeId: '0xa:0xa', name: 'Seafood Princess', englishName: 'Seafood Princess', streetPrefix: '3601 Victoria Park Ave', street: 'Victoria Park Ave', displayName: '3601 Victoria Park Ave, Scarborough', latitude: 43.8, longitude: -79.3 };

test('MIS match: queried once, cached only when matched, served from cache next time', async () => {
  const h = loadHandlers({ misHtml: `<table>${misRow('GO1', 'SEAFOOD PRINCESS', '3601 Victoria Park Ave')}</table>` });
  const r1 = await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  assert.equal(r1.customer.code, 'GO1');
  assert.equal(r1.customer.placeId, '0xa:0xa');
  assert.equal(h.calls.mis.length, 1);
  assert.ok(h.store.gce_mis_match_cache['0xa:0xa']);

  const r2 = await h.run('handleExploreMatchMis', { sessionId: 's2', place: PLACE });
  assert.equal(r2.cached, true);
  assert.equal(h.calls.mis.length, 1, 'no MIS request for a cached match');

  // no match -> nothing stored, asked again next time
  const other = { ...PLACE, placeId: '0xb:0xb', name: 'Pho Hung', englishName: 'Pho Hung', streetPrefix: '9 Other St' };
  h.state.misHtml = '<table></table>';
  assert.equal((await h.run('handleExploreMatchMis', { sessionId: 's', place: other })).customer, null);
  assert.equal(h.store.gce_mis_match_cache['0xb:0xb'], undefined);
  await h.run('handleExploreMatchMis', { sessionId: 's3', place: { ...other } });
  assert.equal(h.calls.mis.length, 2, 'memoized keyword within 10 min, but never persisted');
});

test('MIS queue runs one request at a time; cancelled sessions are skipped', async () => {
  const h = loadHandlers();
  const ps = [1, 2, 3].map((i) => h.run('handleExploreMatchMis', { sessionId: 'a', place: { ...PLACE, placeId: `0x${i}:0x${i}`, streetPrefix: `${i} Main St` } }));
  await Promise.all(ps);
  assert.equal(h.state.misMaxInFlight, 1);
  assert.equal(h.calls.mis.length, 3);
  vm.runInContext('_cancelledSessions', h.ctx).add('dead');
  const r = await h.run('handleExploreMatchMis', { sessionId: 'dead', place: { ...PLACE, placeId: '0x9:0x9', streetPrefix: '9 Main St' } });
  assert.equal(r.cancelled, true);
  assert.equal(h.calls.mis.length, 3);
});

test('logout wipes cached customers; expired-session login page is an error, not "no match"', async () => {
  const h = loadHandlers({ misHtml: `<table>${misRow('GO1', 'SEAFOOD PRINCESS', '3601 Victoria Park Ave')}</table>` });
  await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  h.state.loggedIn = false;
  assert.equal((await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE })).notLoggedIn, true);
  assert.equal(h.store.gce_mis_match_cache, undefined);

  const h2 = loadHandlers({ misHtml: '<form><input type="password"></form>' });
  const r = await h2.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  assert.equal(r.success, false);
  assert.equal(h2.store.gce_mis_match_cache, undefined);
});

test('jev: disabled until configured (pins stay grey, MIS unaffected)', async () => {
  const h = loadHandlers();
  const p = h.run('handleExploreClassifyFried', { sessionId: 's', place: PLACE });
  await new Promise((r) => setImmediate(r)); // handler awaits the cache before queueing
  h.flushTimers();
  const r = await p;
  assert.equal(r.success, false);
  assert.equal(r.disabled, true);
});

test('jev: places are batched, only "fried" verdicts are cached', async () => {
  const h = loadHandlers({
    jevReply: (items) => JSON.stringify({ results: items.map((it) => ({ id: it.id, fried: it.name.includes('Fried') })) }),
  });
  vm.runInContext('JEV_API.url = "https://jev.example/v1/chat/completions"; JEV_API.model = "m";', h.ctx);
  const mk = (i, name) => ({ ...PLACE, placeId: `0x${i}:0x${i}`, name, reviews: ['great wings'] });
  const ps = [h.run('handleExploreClassifyFried', { sessionId: 's', place: mk(1, 'Fried Chicken Hut') }),
    h.run('handleExploreClassifyFried', { sessionId: 's', place: mk(2, 'Sushi Bar') })];
  await new Promise((r) => setImmediate(r));
  h.flushTimers();
  const [a, b] = await Promise.all(ps);
  assert.equal(h.calls.jev.length, 1, 'one jev call for the batch');
  assert.equal(h.calls.jev[0].model, 'm');
  assert.deepEqual([a.fried, b.fried], [true, false]);
  assert.ok(h.store.gce_fried_cache['0x1:0x1']);
  assert.equal(h.store.gce_fried_cache['0x2:0x2'], undefined, 'non-fried not cached');

  const probe = await h.run('handleExploreClassifyFried', { sessionId: 's', place: mk(1, 'Fried Chicken Hut'), cacheOnly: true });
  assert.deepEqual([probe.fried, probe.cached], [true, true]);
  const miss = await h.run('handleExploreClassifyFried', { sessionId: 's', place: mk(2, 'Sushi Bar'), cacheOnly: true });
  assert.equal(miss.miss, true);
  assert.equal(h.calls.jev.length, 1);
});

test('jev reply parsing tolerates code fences and junk', () => {
  const h = loadHandlers();
  const parse = vm.runInContext('parseFriedReply', h.ctx);
  assert.deepEqual([...parse('```json\n{"results":[{"id":"a","fried":true},{"id":"b","fried":"yes"}]}\n```')], [['a', true]]);
  assert.equal(parse('no json').size, 0);
});

test('cache entries expire after 30 days and are capped', () => {
  const h = loadHandlers();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const prune = vm.runInContext('pruneCache', h.ctx);
  assert.deepEqual(Object.keys(plain(prune({ fresh: { t: now - 29 * day }, old: { t: now - 31 * day }, newest: { t: now } }, 1, now))), ['newest']);
});

// ---------- wiring ----------

test('no third-party map data; explore handlers wired', () => {
  for (const s of ['overpass', 'nominatim', 'openstreetmap']) {
    assert.ok(!source.toLowerCase().includes(s), `background.js mentions ${s}`);
    assert.ok(!JSON.stringify(manifest).toLowerCase().includes(s), `manifest mentions ${s}`);
  }
  assert.deepEqual(manifest.content_scripts.find((c) => c.js.includes('content.js')).js, ['google-places.js', 'content.js']);
  for (const a of ['exploreMatchMis', 'exploreClassifyFried', 'exploreCancel']) assert.ok(source.includes(`"${a}"`), a);
  assert.ok(!source.includes('scanAndMatchMis'), 'old nearest-20 flow removed');
});

test('content.js: 探索 button, window snapshot, independent Google limiters, no auto modal', () => {
  assert.match(content, /misLabel\.textContent = explore && !explore\.finished \? "探索中\.\.\." : "探索"/);
  assert.ok(!content.includes('匹配MIS'), 'button renamed');
  assert.match(content, /createRateLimiter\(1000\)/, 'detail pages 1/s');
  assert.match(content, /view,\s+\/\/ snapshot/);
  const start = content.indexOf('async function handleExploreClick');
  const end = content.indexOf('function setExploreButtonAuth');
  assert.ok(!content.slice(start, end).includes('openMisModal'), 'no modal popup after exploring');
  assert.match(content, /EXPLORE_RANK = \{ candidate: 0, fried: 1, mis: 2 \}/);
  assert.match(content, /function isOnRoute/);
});
