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

test('window lister: 20 at a time, pages fetched only as needed, nearest first, resumable', async () => {
  const asked = [];
  // 45 restaurants spread north of the center (index = distance order), then fast food
  const many = Array.from({ length: 45 }, (_, i) => rec(100 + i, `R${i}`, 0.00002 * (45 - i), 0, ['Restaurant'], `${i} A St, T`));
  const fetchImpl = async (url) => {
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
  };
  const lister = places.createWindowLister(VIEW, { fetchImpl });

  const b1 = await lister.next(20);
  assert.deepEqual(asked, ['restaurants@0'], 'first batch: one result page only');
  assert.equal(b1.length, 20);
  assert.equal(b1[0].name, 'R19', 'nearest to the window center first');
  assert.ok(!lister.exhausted);

  const b2 = await lister.next(20);
  assert.deepEqual(asked, ['restaurants@0', 'restaurants@20']);
  assert.equal(b2.length, 20);

  const b3 = await lister.next(20);
  assert.deepEqual(b3.map((p) => p.name).sort(), ['Fries', 'R40', 'R41', 'R42', 'R43', 'R44'].sort(),
    'rest of the window: no coffee, nothing outside the window, no repeats');
  assert.equal(lister.exhausted, true);
  assert.deepEqual(await lister.next(20), []);
  const all = [...b1, ...b2, ...b3].map((p) => p.placeId);
  assert.equal(new Set(all).size, all.length, 'each place returned once');

  const empty = places.createWindowLister(VIEW, { fetchImpl: async () => ({ ok: true, text: async () => ")]}'\n[]" }) });
  await assert.rejects(empty.next(20), /no places/, 'format change is reported');
});

test('sameView: small pans keep the exploration, a new area or zoom starts over', () => {
  assert.ok(places.sameView(VIEW, { ...VIEW }));
  assert.ok(places.sameView(VIEW, { ...VIEW, lng: VIEW.lng + 0.0005 }), '~40 px pan');
  assert.ok(!places.sameView(VIEW, { ...VIEW, lng: VIEW.lng + 0.01 }), 'moved ~800 px');
  assert.ok(!places.sameView(VIEW, { ...VIEW, zoom: 15 }), 'zoomed out');
  assert.ok(!places.sameView(null, VIEW));
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
  assert.deepEqual(plain(m.misQueryFor({ streetPrefix: '3550 Victoria Park Ave', englishName: 'Litsea' })), { kind: 'address', keyword: '3550 Victoria Park' },
    'street type dropped so "Ave" / "Avenue" / "AVE." in MIS all match');
  assert.equal(m.addressKeyword('2938A Finch Ave E'), '2938A Finch');
  assert.equal(m.addressKeyword('483 Bay St'), '483 Bay');
  assert.equal(m.addressKeyword('1 Yonge Street West'), '1 Yonge');
  assert.equal(m.addressKeyword('100 Queensway'), '100 Queensway');
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
  // the broader keyword ("3601 Victoria Park") must not match other house numbers
  const near = [{ code: 'N', name: 'SEAFOOD PRINCESS', address: '13601 Victoria Park Avenue' }];
  assert.equal(m.pickMisRecordForPlace(near, { name: 'Seafood Princess', englishName: 'Seafood Princess', streetPrefix: '3601 Victoria Park Ave', displayName: '3601 Victoria Park Ave' }, 'address'), null);
  const avenue = [{ code: 'V', name: 'SEAFOOD PRINCESS', address: '3601 VICTORIA PARK AVENUE' }];
  assert.equal(m.pickMisRecordForPlace(avenue, { name: 'Seafood Princess', englishName: 'Seafood Princess', streetPrefix: '3601 Victoria Park Ave', displayName: '3601 Victoria Park Ave' }, 'address').code, 'V');
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

test('login-page detection: a customer list with a password field is NOT the login page', () => {
  const h = loadHandlers();
  const isLogin = vm.runInContext('isMisLoginPage', h.ctx);
  const list = `<form><input name="key_word"></form><div id="pw"><input type="password" name="new_pw"></div><table>${misRow('GO1', 'A', '1 Main St')}</table>`;
  assert.equal(isLogin('https://mis.greenoilinc.com/index_intranet.php?view=customer_list', list), false);
  assert.equal(isLogin('https://mis.greenoilinc.com/index_intranet.php', '<form><input name="user"><input type="password" name="pw"></form>'), true);
  assert.equal(isLogin('https://mis.greenoilinc.com/login_intranet.php', ''), true);
  assert.equal(isLogin('https://mis.greenoilinc.com/index_intranet.php', '<table></table>'), false, 'empty list = no customers');
});

test('MIS results carry a diagnosis for the page console', async () => {
  const h = loadHandlers({ misHtml: `<table>${misRow('GO9', 'GOLDEN WOK', '3601 Victoria Park Ave Unit 5')}</table>` });
  const r = await h.run('handleExploreMatchMis', { sessionId: 's', place: { ...PLACE, displayName: '3601 Victoria Park Ave, Scarborough' } });
  assert.equal(r.customer, null);
  assert.equal(r.diag.keyword, '3601 Victoria Park');
  assert.equal(r.diag.records, 1);
  assert.match(r.diag.reason, /对应不上.*GOLDEN WOK/);
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
  const ctx = vm.createContext({
    console: { warn() {}, log() {} }, URLSearchParams, AbortSignal, Date, Math, Object, Promise, Number, Set, Map, JSON, Error,
    setTimeout: (fn) => { setImmediate(fn); return 0; }, // MIS 1/s waits run at once in tests
    WORKER_URL: 'https://worker.example',
    // api.js GreenOilApi (the popup's Worker client), used for the jev key
    GreenOilApi: {
      async getJevKey(token) {
        calls.jevKey = (calls.jevKey || []).concat(token);
        return token === 'op-token'
          ? { success: true, apiKey: 'jev-key-from-worker', key: 'jev-key-from-worker', jevKey: 'jev-key-from-worker' }
          : { error: 'Unauthorized', message: '未登录或凭据已过期' };
      },
    },
    fetch: async (url, opts) => {
      url = String(url);
      if (url.includes('api.typesafe.ai')) {
        const body = JSON.parse(opts.body);
        calls.jev.push({ url, auth: opts.headers.Authorization, body });
        return { ok: true, status: 200, json: async () => jevReply(body) };
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
  return { ctx, store, calls, state, run };
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

test('jev: without the operator login, fried judgement is disabled (pins stay grey, MIS unaffected)', async () => {
  const h = loadHandlers();
  delete h.store.authToken;
  const r = await h.run('handleExploreClassifyFried', { sessionId: 's', place: PLACE });
  assert.equal(r.success, false);
  assert.equal(r.disabled, true);
  assert.match(r.error, /登录/);
});

test('jev: TypeSafe System One request per place; only "fried" verdicts are cached', async () => {
  const h = loadHandlers({ jevReply: (body) => ({ answers: { fried: { noul: body.state.name.includes('Fried') ? 0.91 : 0.12 } }, usage: {} }) });
  const mk = (i, name) => ({ ...PLACE, placeId: `0x${i}:0x${i}`, name, categories: ['Chicken restaurant'], description: 'Crispy wings', reviews: ['great wings'] });
  const [a, b] = await Promise.all([
    h.run('handleExploreClassifyFried', { sessionId: 's', place: mk(1, 'Fried Chicken Hut') }),
    h.run('handleExploreClassifyFried', { sessionId: 's', place: mk(2, 'Sushi Bar') }),
  ]);
  assert.deepEqual([a.fried, a.probability, b.fried, b.probability], [true, 0.91, false, 0.12]);
  assert.equal(h.calls.jev.length, 2, 'one System One request per restaurant');
  const req = h.calls.jev[0];
  assert.equal(req.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(req.auth, 'Bearer jev-key-from-worker');
  assert.deepEqual(h.calls.jevKey, ['op-token'], 'key fetched once via GreenOilApi.getJevKey(token)');
  assert.equal(req.body.model, 'jev-latest');
  assert.equal(req.body.questions.fried.type, 'noul');
  assert.deepEqual(req.body.state.review_snippets, ['great wings']);
  assert.ok(h.store.gce_fried_cache['0x1:0x1']);
  assert.equal(h.store.gce_fried_cache['0x2:0x2'], undefined, 'non-fried not cached');

  const probe = await h.run('handleExploreClassifyFried', { sessionId: 's', place: mk(1, 'Fried Chicken Hut'), cacheOnly: true });
  assert.deepEqual([probe.fried, probe.cached], [true, true]);
  const miss = await h.run('handleExploreClassifyFried', { sessionId: 's', place: mk(2, 'Sushi Bar'), cacheOnly: true });
  assert.equal(miss.miss, true);
  assert.equal(h.calls.jev.length, 2, 'probes never call jev');
});

test('jev: an expired operator login is reported as disabled', async () => {
  const h = loadHandlers();
  h.store.authToken = 'expired';
  const r = await h.run('handleExploreClassifyFried', { sessionId: 's', place: PLACE });
  assert.deepEqual([r.success, r.disabled, r.error], [false, true, '未登录或凭据已过期']);
});

test('background is an ES module that reuses api.js for the jev key', () => {
  assert.equal(manifest.background.type, 'module');
  assert.match(source, /^import \{ GreenOilApi \} from "\.\/api\.js";$/m);
  assert.match(source, /GreenOilApi\.getJevKey\(authToken\)/);
  assert.ok(!source.includes('/api/jev/key'), 'no duplicate Worker call');
  const api = fs.readFileSync(path.join(__dirname, '../api.js'), 'utf8');
  assert.match(api, /async getJevKey\(token\)/);
});

test('jev reply parsing', () => {
  const h = loadHandlers();
  const prob = vm.runInContext('friedProbability', h.ctx);
  assert.equal(prob({ answers: { fried: { noul: 0.87 } } }), 0.87);
  assert.equal(prob({ answers: { fried: { value: true } } }), 1);
  assert.equal(prob({ answers: {} }), null);
  assert.equal(prob(null), null);
});

test('place tags: cached MIS match (login-gated) and cached fried verdict by place id', async () => {
  const h = loadHandlers({ misHtml: `<table>${misRow('GO1', 'SEAFOOD PRINCESS', '3601 Victoria Park Ave')}</table>` });
  await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  h.store.gce_fried_cache = { '0xa:0xa': { t: Date.now(), probability: 0.8 }, '0xf:0xf': { t: Date.now(), probability: 0.93 } };
  const a = await h.run('handleGetPlaceTags', { placeId: '0xa:0xa' });
  assert.deepEqual([a.customer.code, a.fried, a.probability], ['GO1', true, 0.8]);
  const f = await h.run('handleGetPlaceTags', { placeId: '0xf:0xf' });
  assert.deepEqual([f.customer, f.fried, f.probability], [null, true, 0.93]);
  const none = await h.run('handleGetPlaceTags', { placeId: '0xz:0xz' });
  assert.deepEqual([none.customer, none.fried], [null, false]);
  h.state.loggedIn = false;
  const out = await h.run('handleGetPlaceTags', { placeId: '0xa:0xa' });
  assert.equal(out.customer, null, 'no customer data while logged out');
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
  for (const a of ['exploreMatchMis', 'exploreClassifyFried', 'exploreCancel', 'getPlaceTags']) assert.ok(source.includes(`"${a}"`), a);
  assert.ok(!source.includes('scanAndMatchMis'), 'old nearest-20 flow removed');
});

test('content.js: batches of 20, lazy details, MIS and jev in parallel, derived pin state', () => {
  assert.match(content, /EXPLORE_BATCH_SIZE = 20/);
  assert.match(content, /lister\.next\(EXPLORE_BATCH_SIZE/);
  assert.match(content, /text = "继续探索"/);
  assert.ok(!content.includes('匹配MIS'), 'button renamed');
  assert.match(content, /createRateLimiter\(1000\)/, 'detail pages 1/s');
  assert.match(content, /view,\s+\/\/ snapshot/);
  // details are fetched inside the per-place judgement, never for the list
  const proc = content.slice(content.indexOf('async function exploreProcessPlace'), content.indexOf('async function runExploreBatch'));
  assert.match(proc, /fetchPlaceDetail/);
  assert.ok(!content.slice(content.indexOf('async function runExploreBatch'), content.indexOf('async function handleExploreClick')).includes('fetchPlaceDetail'));
  // MIS is not awaited before the fried judgement starts, and neither skips the other
  assert.match(proc, /await Promise\.allSettled\(\[mis, fried\]\)/);
  assert.ok(!/entry\.state === "mis"/.test(proc), 'jev is not skipped because of MIS');
  // pin colour is derived from both results (order-independent)
  assert.match(content, /function exploreState\(entry\) \{\s+if \(entry\.customer\) return "mis";\s+if \(entry\.fried\) return "fried";\s+return "candidate";/);
  assert.match(proc, /const live = \(\) => session === explore && !session\.cancelled/, 'stale results dropped');
  const click = content.slice(content.indexOf('async function handleExploreClick'), content.indexOf('function setExploreButtonAuth'));
  assert.ok(!click.includes('openMisModal'), 'no modal popup after exploring');
  assert.match(content, /function isOnRoute/);
});

test('content.js: one name tag, MIS签约 > 油炸, exact place id (no loose name/150 m matching)', () => {
  assert.match(content, /const kind = info\?\.customer \? "mis" : info\?\.fried \? "fried" : ""/);
  assert.match(content, /action: "getPlaceTags"/);
  assert.ok(!content.includes('findMatchedMisCustomer'), 'old loose matcher removed');
  assert.ok(!content.includes('< 0.15)'), 'no 150 m proximity match');
  const css = fs.readFileSync(path.join(__dirname, '../content.css'), 'utf8');
  assert.match(css, /\.greenoil-heading-tag \{[^}]*height: 20px/s);
  assert.match(css, /\.greenoil-heading-tag\.is-mis/);
  assert.match(css, /\.greenoil-heading-tag\.is-fried/);
});
