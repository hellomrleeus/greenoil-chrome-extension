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

test('window lister: up to 20 per batch, streamed per page, no forced filling, resumable', async () => {
  const asked = [];
  // 45 in-window restaurants on page 1 (index = distance order), then only far-away results
  const near = Array.from({ length: 45 }, (_, i) => rec(100 + i, `R${i}`, 0.00002 * (45 - i), 0, ['Restaurant'], `${i} A St, T`));
  const far = Array.from({ length: 60 }, (_, i) => rec(500 + i, `Far${i}`, 0.05, 0, ['Restaurant'], `${i} Z St, T`));
  const fetchImpl = async (url) => {
    const q = decodeURIComponent(url.split('&q=')[1]);
    const off = Number((url.match(/!8i(\d+)/) || [0, 0])[1]);
    assert.match(url, /!7i60/, '60 results per request');
    asked.push(`${q}@${off}`);
    let page = [];
    if (q === 'restaurants' && off === 0) page = [...near, ...far.slice(0, 15)];
    if (q === 'restaurants' && off === 60) page = far;          // outside the window: stop this query
    if (q === 'fast food' && off === 0) {
      page = [rec(100, 'R0', 0, 0, ['Restaurant'], '0 A St, T'), // already returned
        rec(2, 'Fries', 0.0003, 0, ['Fast food restaurant'], '2 B St, T'),
        rec(3, 'Coffee', 0.0003, 0, ['Coffee shop'], '3 B St, T')];
    }
    return { ok: true, text: async () => body(page) };
  };
  const lister = places.createWindowLister(VIEW, { fetchImpl });

  const chunks = [];
  const b1 = await lister.next(20, { onChunk: (c) => chunks.push(c.map((p) => p.name)) });
  assert.deepEqual(asked, ['restaurants@0'], 'one request for the first batch');
  assert.equal(b1.length, 20);
  assert.equal(b1[0].name, 'R44', 'nearest to the window center first');
  assert.deepEqual(chunks, [b1.map((p) => p.name)], 'streamed as the page arrived');

  const b2 = await lister.next(20);
  assert.deepEqual(asked, ['restaurants@0'], 'second batch served from the same page');
  assert.equal(b2.length, 20);

  const b3 = await lister.next(20);
  assert.deepEqual(asked, ['restaurants@0', 'restaurants@60', 'fast food@0', 'food court@0'],
    'a page entirely outside the window ends that query (no paging further out)');
  assert.deepEqual(b3.map((p) => p.name).sort(), ['Fries', 'R0', 'R1', 'R2', 'R3', 'R4'].sort(),
    'only 6 left: returned without forcing 20; no coffee, nothing outside, no repeats');
  assert.equal(lister.exhausted, true);
  assert.deepEqual(await lister.next(20), []);

  const empty = places.createWindowLister(VIEW, { fetchImpl: async () => ({ ok: true, text: async () => ")]}'\n[]" }) });
  await assert.rejects(empty.next(20), /no places/, 'format change is reported');
});

test('window lister: a zoomed-in window needs only one request per query', async () => {
  const asked = [];
  const lister = places.createWindowLister(VIEW, {
    fetchImpl: async (url) => {
      asked.push(url.split('&q=')[1]);
      // 4 places in the window, the rest of the page far away (like a single plaza at zoom 18)
      const page = [rec(1, 'A', 0, 0, ['Restaurant'], '1 A St'), rec(2, 'B', 0.0001, 0, ['Restaurant'], '2 A St'),
        rec(3, 'C', 0.0002, 0, ['Restaurant'], '3 A St'), rec(4, 'D', -0.0001, 0, ['Restaurant'], '4 A St'),
        ...Array.from({ length: 56 }, (_, i) => rec(900 + i, `X${i}`, 0.05, 0, ['Restaurant'], 'far'))];
      return { ok: true, text: async () => body(url.includes('!8i') ? [] : page) };
    },
  });
  const b = await lister.next(20);
  assert.equal(b.length, 4, 'not forced to 20');
  assert.ok(asked.length <= 6, `few requests (${asked.length})`);
});

test('window lister: excluded (already checked) places are skipped and do not count toward n', async () => {
  const page = Array.from({ length: 30 }, (_, i) => rec(100 + i, `R${i}`, 0.00002 * i, 0, ['Restaurant'], `${i} A St, T`));
  page.push(rec(99, 'Coffee', 0, 0, ['Coffee shop'], '99 A St, T'));
  const asked = [];
  const lister = places.createWindowLister(VIEW, {
    fetchImpl: async (url) => { asked.push(url); return { ok: true, text: async () => body(url.includes('!8i') ? [] : page) }; },
    exclude: (p) => { asked.push(`x:${p.name}`); return Number(p.name.slice(1)) < 15; },
  });
  const b = await lister.next(20);
  assert.deepEqual(b.map((p) => p.name), Array.from({ length: 15 }, (_, i) => `R${15 + i}`),
    'the nearest 15 were checked before: the batch is the next unchecked ones');
  assert.ok(!asked.includes('x:Coffee'), 'exclude only sees wanted food places');
});

test('viewBounds / boundsContain: the lat/lng box of the map window', () => {
  const b = places.viewBounds(VIEW);
  assert.ok(b.south < VIEW.lat && VIEW.lat < b.north && b.west < VIEW.lng && VIEW.lng < b.east);
  assert.ok(places.inView(b.north - 1e-6, b.west + 1e-6, VIEW), 'corner is inside the window');
  assert.ok(!places.inView(b.north + 1e-4, VIEW.lng, VIEW), 'just outside');
  const big = places.viewBounds(VIEW, 3);
  assert.ok(places.boundsContain(big, b));
  assert.ok(places.boundsContain(big, places.viewBounds({ ...VIEW, lng: VIEW.lng + 0.005 })), 'small pan stays inside the loaded area');
  assert.ok(!places.boundsContain(big, places.viewBounds({ ...VIEW, lng: VIEW.lng + 0.05 })), 'a new area does not');
  assert.ok(!places.boundsContain(null, b));
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

test('MIS candidate collection accepts one/object or arrays and deduplicates customer codes', () => {
  const m = loadMatching();
  const place = { name: 'New Restaurant', englishName: 'New Restaurant', streetPrefix: '10 Main St', displayName: '10 Main St' };
  const one = { code: 'A', name: 'OLD TENANT', address: '10 Main Street', sts: 'I' };
  assert.deepEqual(plain(m.misCandidatesForPlace(one, place, 'address')).map(x => x.code), ['A']);
  const many = [one, { ...one, name: 'ACTIVE DUPLICATE', sts: 'A' }, { code: 'B', name: 'OTHER', address: '10 Main St', sts: 'A' }];
  const out = plain(m.misCandidatesForPlace(many, place, 'address'));
  assert.deepEqual(out.map(x => x.code).sort(), ['A', 'B']);
  assert.equal(out.find(x => x.code === 'A').name, 'ACTIVE DUPLICATE');
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
  assert.equal(r.candidate.code, 'GO9');
  assert.equal(r.diag.keyword, '3601 Victoria Park');
  assert.equal(r.diag.records, 1);
  assert.equal(r.diag.candidates, 1);
  assert.match(r.diag.reason, /等待 JEV 是否校验/);
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
        return { ok: true, status: 200, json: async () => jevReply
          ? jevReply(body)
          : { answers: { same_business: { noul: 0.92 }, fried: { noul: 0.12 } } } };
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

test('MIS match: candidate is cached only after JEV confirms the current business', async () => {
  const h = loadHandlers({ misHtml: `<table>${misRow('GO1', 'SEAFOOD PRINCESS', '3601 Victoria Park Ave')}</table>` });
  const r1 = await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  assert.equal(r1.candidate.code, 'GO1');
  assert.equal(r1.candidate.placeId, '0xa:0xa');
  assert.equal(h.calls.mis.length, 1);
  assert.equal(h.store.gce_mis_match_cache, undefined, 'raw MIS result is not trusted or cached');

  const checked = await h.run('handleExploreValidateMis', {
    sessionId: 's', place: { ...PLACE, categories: ['Seafood restaurant'], reviews: ['Still open'] }, customer: r1.candidate
  });
  assert.deepEqual([checked.matches, checked.customer.code, checked.probability], [true, 'GO1', 0.92]);
  assert.ok(h.store.gce_mis_match_cache['0xa:0xa']);
  assert.equal(h.store.gce_mis_match_cache['0xa:0xa'].jevVerified, true);

  const r2 = await h.run('handleExploreMatchMis', { sessionId: 's2', place: PLACE });
  assert.equal(r2.cached, true);
  assert.equal(r2.verified, true);
  assert.equal(r2.customer.code, 'GO1');
  assert.equal(h.calls.mis.length, 1, 'no MIS request for a cached match');

  // no match -> nothing stored, asked again next time
  const other = { ...PLACE, placeId: '0xb:0xb', name: 'Pho Hung', englishName: 'Pho Hung', streetPrefix: '9 Other St' };
  h.state.misHtml = '<table></table>';
  assert.equal((await h.run('handleExploreMatchMis', { sessionId: 's', place: other })).customer, null);
  assert.equal(h.store.gce_mis_match_cache['0xb:0xb'], undefined);
  await h.run('handleExploreMatchMis', { sessionId: 's3', place: { ...other } });
  assert.equal(h.calls.mis.length, 2, 'memoized keyword within 10 min, but never persisted');
});

test('MIS JEV check rejects a previous tenant at the same address', async () => {
  const h = loadHandlers({
    misHtml: `<table>${misRow('OLD1', 'OLD GOLDEN WOK', '3601 Victoria Park Ave')}</table>`,
    jevReply: (body) => {
      assert.equal(body.state.google_place.name, 'Seafood Princess');
      assert.equal(body.state.mis_customer.name, 'OLD GOLDEN WOK');
      assert.match(body.questions.same_business.instructions, /address alone is not sufficient/i);
      return { answers: { same_business: { noul: 0.08 } } };
    },
  });
  const found = await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  const checked = await h.run('handleExploreValidateMis', {
    sessionId: 's', place: { ...PLACE, categories: ['Seafood restaurant'], reviews: ['new restaurant'] }, customer: found.candidate
  });
  assert.deepEqual([checked.matches, checked.customer, checked.probability], [false, null, 0.08]);
  assert.equal(h.store.gce_mis_match_cache, undefined, 'rejected tenant is never cached');
});

test('multiple MIS rows use one JEV choice request and cache the selected customer', async () => {
  const h = loadHandlers({
    misHtml: `<table>${misRow('OLD1', 'OLD TENANT', '3601 Victoria Park Ave')}${misRow('GO2', 'SEAFOOD PRINCESS', '3601 Victoria Park Ave')}</table>`,
    jevReply: (body) => {
      assert.equal(body.questions.same_business.type, 'choice');
      assert.deepEqual(body.state.mis_candidates.map(x => x.key), ['candidate_1', 'candidate_2']);
      assert.ok(body.questions.same_business.criteria.none_of_above);
      return { answers: { same_business: {
        type: 'choice', choice: 'candidate_1', confidence: 0.91,
        probabilities: { candidate_1: 0.82, candidate_2: 0.11, none_of_above: 0.07 },
      } } };
    },
  });
  const found = await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  assert.equal(found.candidate, undefined);
  assert.equal(found.candidates.length, 2);
  const expectedCode = found.candidates[0].code;
  const checked = await h.run('handleExploreValidateMis', {
    sessionId: 's', place: PLACE, customers: found.candidates
  });
  assert.deepEqual([checked.matches, checked.mode, checked.customer.code, checked.probability],
    [true, 'choice', expectedCode, 0.82]);
  assert.equal(h.store.gce_mis_match_cache['0xa:0xa'].customer.code, expectedCode);
  assert.equal(h.calls.jev.length, 1);
});

test('multiple-choice MIS validation rejects none-of-above and ambiguous winners', async () => {
  let reply = 'none';
  const h = loadHandlers({ jevReply: () => ({ answers: { same_business: reply === 'none'
    ? { type: 'choice', choice: 'none_of_above', confidence: 0.93,
      probabilities: { candidate_1: 0.05, candidate_2: 0.05, none_of_above: 0.9 } }
    : { type: 'choice', choice: 'candidate_1', confidence: 0.9,
      probabilities: { candidate_1: 0.55, candidate_2: 0.4, none_of_above: 0.05 } } } }) });
  const customers = [
    { ...PLACE, code: 'A', name: 'A', address: PLACE.displayName },
    { ...PLACE, code: 'B', name: 'B', address: PLACE.displayName },
  ];
  const none = await h.run('handleExploreValidateMis', { sessionId: 's1', place: PLACE, customers });
  assert.deepEqual([none.matches, none.selection, none.ambiguous], [false, 'none_of_above', false]);
  reply = 'ambiguous';
  const ambiguous = await h.run('handleExploreValidateMis', { sessionId: 's2', place: PLACE, customers });
  assert.deepEqual([ambiguous.matches, ambiguous.selection, ambiguous.ambiguous], [false, 'candidate_1', true]);
  assert.ok(Math.abs(ambiguous.margin - 0.15) < 1e-9);
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
  const found = await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  await h.run('handleExploreValidateMis', { sessionId: 's', place: PLACE, customer: found.candidate });
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

test('resident pins: every cached match with coordinates; MIS only while logged in', async () => {
  const h = loadHandlers({
    misHtml: `<table>${misRow('GO1', 'SEAFOOD PRINCESS', '3601 Victoria Park Ave')}</table>`,
    jevReply: (body) => ({ answers: body.questions.same_business
      ? { same_business: { noul: 0.94 } }
      : { fried: { noul: 0.9 } } }),
  });
  const found = await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  await h.run('handleExploreValidateMis', { sessionId: 's', place: PLACE, customer: found.candidate });
  const friedPlace = { ...PLACE, placeId: '0xf:0xf', name: 'Wings Hut', latitude: 43.81, longitude: -79.31 };
  await h.run('handleExploreClassifyFried', { sessionId: 's', place: friedPlace });
  assert.deepEqual(plain(h.store.gce_fried_cache['0xf:0xf']).name, 'Wings Hut', 'fried cache keeps name + coordinates');
  h.store.gce_fried_cache['0xold:0xold'] = { t: Date.now(), probability: 0.7 }; // pre-coordinates entry: skipped

  const r = plain(await h.run('handleGetMatchedPlaces', {}));
  const byId = Object.fromEntries(r.places.map((p) => [p.placeId, p]));
  assert.deepEqual(Object.keys(byId).sort(), ['0xa:0xa', '0xf:0xf']);
  assert.equal(byId['0xa:0xa'].customer.code, 'GO1');
  assert.deepEqual([byId['0xf:0xf'].fried, byId['0xf:0xf'].latitude, byId['0xf:0xf'].customer], [true, 43.81, null]);

  h.state.loggedIn = false;
  const out = plain(await h.run('handleGetMatchedPlaces', {}));
  assert.deepEqual(out.places.map((p) => p.placeId), ['0xf:0xf'], 'no MIS customers while logged out');
});

test('checked cache: negative results are recorded per action; errors are not', async () => {
  const h = loadHandlers({
    misHtml: `<table>${misRow('OLD1', 'OLD GOLDEN WOK', '3601 Victoria Park Ave')}</table>`,
    jevReply: (body) => ({ answers: body.questions.same_business
      ? { same_business: { noul: 0.08 } }
      : { fried: { noul: body.state.name.includes('Fried') ? 0.9 : 0.1 } } }),
  });
  const sushi = { ...PLACE, placeId: '0xs:0xs', name: 'Sushi Bar', streetPrefix: '', englishName: '' };
  const fried = { ...PLACE, placeId: '0xf:0xf', name: 'Fried Hut', latitude: 43.8001 };
  await h.run('handleExploreClassifyFried', { sessionId: 's', place: sushi });
  await h.run('handleExploreClassifyFried', { sessionId: 's', place: fried });
  await h.run('handleExploreMatchMis', { sessionId: 's', place: sushi });            // no MIS query possible
  const found = await h.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  await h.run('handleExploreValidateMis', { sessionId: 's', place: PLACE, customer: found.candidate }); // JEV rejects

  const tiles = Object.keys(h.store).filter((k) => k.startsWith('gce_seen:'));
  assert.equal(tiles.length, 1, 'all three places share one ~7 km tile');
  const tile = plain(h.store[tiles[0]]);
  assert.deepEqual(Object.keys(tile).sort(), ['0xa:0xa', '0xs:0xs']);
  assert.ok(tile['0xs:0xs'].f && tile['0xs:0xs'].m, 'sushi: no fried food, no MIS customer');
  assert.ok(tile['0xa:0xa'].m && !tile['0xa:0xa'].f, 'rejected tenant: MIS checked only');
  assert.deepEqual(plain(h.store.gce_seen_tiles)[tiles[0]].c, 2, 'index keeps the per-tile count');

  const bounds = { south: 43.79, west: -79.31, north: 43.81, east: -79.29 };
  const ids = async (kind, b = bounds) => plain(await h.run('handleGetCheckedPlaceIds', { kind, bounds: b })).ids.sort();
  assert.deepEqual(await ids('fried'), ['0xf:0xf', '0xs:0xs'], '探索 skips positives and negatives');
  assert.deepEqual(await ids('mis'), ['0xa:0xa', '0xs:0xs']);
  assert.deepEqual(await ids('fried', { south: 44, west: -80, north: 44.1, east: -79.9 }), [], 'only inside the window');

  const r = plain(await h.run('handleGetMatchedPlaces', { bounds, checked: true }));
  const byId = Object.fromEntries(r.places.map((p) => [p.placeId, p]));
  assert.deepEqual([byId['0xf:0xf'].fried, byId['0xf:0xf'].checked], [true, undefined], 'positive wins over grey');
  assert.deepEqual([byId['0xs:0xs'].checked, byId['0xs:0xs'].name, byId['0xs:0xs'].latitude], [true, 'Sushi Bar', 43.8]);
  const noGrey = plain(await h.run('handleGetMatchedPlaces', { bounds }));
  assert.deepEqual(noGrey.places.map((p) => p.placeId), ['0xf:0xf'], 'grey pins only on request');

  // A later positive clears the negative mark of the same action.
  let noul = 0.1;
  const h2 = loadHandlers({ jevReply: () => ({ answers: noul == null ? {} : { fried: { noul } } }) });
  await h2.run('handleExploreClassifyFried', { sessionId: 's', place: sushi });
  const key = Object.keys(h2.store).find((k) => k.startsWith('gce_seen:'));
  assert.ok(h2.store[key]['0xs:0xs'].f);
  noul = 0.8; // Shift+click re-check now says fried
  await h2.run('handleExploreClassifyFried', { sessionId: 's', place: sushi, forceRefresh: true });
  assert.equal(h2.store[key], undefined, 'grey mark cleared (empty tile dropped)');
  assert.ok(h2.store.gce_fried_cache['0xs:0xs']);
  noul = null; // unreadable reply: an error, not a verdict
  const err = await h2.run('handleExploreClassifyFried', { sessionId: 's', place: { ...sushi, placeId: '0xe:0xe' } });
  assert.equal(err.success, false);
  assert.ok(!Object.keys(h2.store).some((k) => k.startsWith('gce_seen:')), 'errors are never recorded');
});

test('checked cache: marks are kept 30 days for display; tiles and total are capped', () => {
  const h = loadHandlers();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const prune = vm.runInContext('pruneSeenTile', h.ctx);
  const out = plain(prune({
    a: { n: 'A', a: 1, o: 1, f: now - 29 * day, m: now - 31 * day },
    b: { n: 'B', a: 1, o: 1, m: now - 31 * day },
    c: { n: 'C', a: 1, o: 1, m: now - 2 * day },
  }, now));
  assert.deepEqual(out, { c: { n: 'C', a: 1, o: 1, m: now - 2 * day }, a: { n: 'A', a: 1, o: 1, f: now - 29 * day } });
  const drop = vm.runInContext('seenTilesToDrop', h.ctx);
  assert.deepEqual(plain(drop({ new: { t: now, c: 30000 }, mid: { t: now - day, c: 9000 }, old: { t: now - 2 * day, c: 5000 },
    expired: { t: now - 31 * day, c: 1 } }, now)).sort(), ['expired', 'old'], 'oldest tiles go once the total passes 40000');
  const keysIn = vm.runInContext('seenTileKeysIn', h.ctx);
  const here = vm.runInContext('seenTileKey', h.ctx)(43.8, -79.3);
  const east = vm.runInContext('seenTileKey', h.ctx)(43.8, -79.0);
  const index = { [here]: {}, [east]: {}, 'gce_seen:10:10': {} };
  assert.deepEqual(plain(keysIn(index, { south: 43.79, west: -79.31, north: 43.81, east: -79.29 })), [here],
    'only stored tiles in range are read, however far the map is zoomed out');
});

test('results are reused (fried 7 days, MIS 1 day), then queried again but still drawn', async () => {
  const day = 24 * 60 * 60 * 1000;
  let noul = 0.9;
  const h = loadHandlers({ jevReply: () => ({ answers: { fried: { noul } } }) });
  const wings = { ...PLACE, placeId: '0xw:0xw', name: 'Wings' };
  const sushi = { ...PLACE, placeId: '0xs:0xs', name: 'Sushi', latitude: 43.8002 };
  await h.run('handleExploreClassifyFried', { sessionId: 's', place: wings });
  noul = 0.1;
  await h.run('handleExploreClassifyFried', { sessionId: 's', place: sushi });
  const bounds = { south: 43.79, west: -79.31, north: 43.81, east: -79.29 };
  const ids = async () => plain(await h.run('handleGetCheckedPlaceIds', { kind: 'fried', bounds })).ids.sort();
  assert.deepEqual(await ids(), ['0xs:0xs', '0xw:0xw'], 'fresh: both skipped');

  // Two days later: fried verdicts are still reused.
  h.store.gce_fried_cache['0xw:0xw'].t -= 2 * day;
  const key = Object.keys(h.store).find((k) => k.startsWith('gce_seen:'));
  h.store[key]['0xs:0xs'].f -= 2 * day;
  assert.deepEqual(await ids(), ['0xs:0xs', '0xw:0xw'], 'fried: fresh for 7 days');
  // Eight days later.
  h.store.gce_fried_cache['0xw:0xw'].t -= 6 * day;
  h.store[key]['0xs:0xs'].f -= 6 * day;
  assert.deepEqual(await ids(), [], 'stale: a click queries them again');
  const shown = plain(await h.run('handleGetMatchedPlaces', { bounds, checked: true }));
  assert.deepEqual(shown.places.map((p) => [p.placeId, p.fried, Boolean(p.checked)]).sort(),
    [['0xs:0xs', false, true], ['0xw:0xw', true, false]], 'stale results are still drawn');
  assert.equal(plain(await h.run('handleGetPlaceTags', { placeId: '0xw:0xw' })).fried, true, 'and still tagged');
  const probe = await h.run('handleExploreClassifyFried', { sessionId: 's', place: wings, cacheOnly: true });
  assert.equal(probe.miss, true, 'no cached answer once stale');

  // The re-check now says "not fried": the stale orange pin must not win.
  const jevCalls = h.calls.jev.length;
  await h.run('handleExploreClassifyFried', { sessionId: 's', place: wings });
  assert.equal(h.calls.jev.length, jevCalls + 1);
  assert.equal(h.store.gce_fried_cache['0xw:0xw'], undefined);
  const after = plain(await h.run('handleGetMatchedPlaces', { bounds, checked: true }));
  assert.deepEqual(after.places.find((p) => p.placeId === '0xw:0xw').checked, true, 'now grey');

  // MIS results: 1 day.
  const m = loadHandlers({ misHtml: '<table></table>' });
  await m.run('handleExploreMatchMis', { sessionId: 's', place: PLACE });
  const misIds = async () => plain(await m.run('handleGetCheckedPlaceIds', { kind: 'mis', bounds })).ids;
  assert.deepEqual(await misIds(), ['0xa:0xa']);
  const mKey = Object.keys(m.store).find((k) => k.startsWith('gce_seen:'));
  m.store[mKey]['0xa:0xa'].m -= 2 * day;
  assert.deepEqual(await misIds(), [], 'MIS: queried again after 1 day');
  const misShown = plain(await m.run('handleGetMatchedPlaces', { bounds, checked: true }));
  assert.deepEqual(misShown.places.map((p) => [p.placeId, p.checked]), [['0xa:0xa', true]], 'but still drawn grey');
});

test('zoomed out: resident places come back grid-clustered', async () => {
  const h = loadHandlers({ jevReply: (body) => ({ answers: { fried: { noul: body.state.name.startsWith('F') ? 0.9 : 0.1 } } }) });
  const mk = (id, name, lat, lng) => ({ ...PLACE, placeId: `0x${id}:0x${id}`, name, latitude: lat, longitude: lng });
  for (const p of [mk(1, 'F1', 43.8, -79.3), mk(2, 'G2', 43.8003, -79.3002), mk(3, 'G3', 43.8001, -79.3001),
    mk(4, 'F4', 43.9, -79.1)]) {
    await h.run('handleExploreClassifyFried', { sessionId: 's', place: p });
  }
  const bounds = { south: 43.7, west: -79.5, north: 44, east: -79 };
  const r = plain(await h.run('handleGetMatchedPlaces', { bounds, checked: true, cluster: { zoom: 11, cellPx: 72 } }));
  assert.equal(r.clusters.length, 1);
  const c = r.clusters[0];
  assert.deepEqual([c.count, c.mis, c.fried, c.checked], [3, 0, 1, 2]);
  assert.ok(Math.abs(c.latitude - 43.80013) < 1e-4, 'placed at the mean position');
  assert.deepEqual(r.places.map((p) => p.placeId), ['0x4:0x4'], 'a place alone in its cell stays a pin');
  const zoomedIn = plain(await h.run('handleGetMatchedPlaces', { bounds, checked: true, cluster: { zoom: 18, cellPx: 72 } }));
  assert.equal(zoomedIn.clusters.length, 0, 'cells shrink as the zoom grows');
  const plainPins = plain(await h.run('handleGetMatchedPlaces', { bounds, checked: true }));
  assert.equal(plainPins.clusters, undefined);
  assert.equal(plainPins.places.length, 4);
  // A running 探索 draws its own pins: those places are left out, not counted twice.
  const running = plain(await h.run('handleGetMatchedPlaces',
    { bounds, checked: true, cluster: { zoom: 11, cellPx: 72 }, exclude: ['0x1:0x1', '0x2:0x2'] }));
  assert.equal(running.clusters.length, 0);
  assert.deepEqual(running.places.map((p) => p.placeId).sort(), ['0x3:0x3', '0x4:0x4']);
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
  for (const a of ['exploreMatchMis', 'exploreValidateMis', 'exploreClassifyFried', 'exploreCancel', 'getPlaceTags', 'getMatchedPlaces', 'getCheckedPlaceIds']) assert.ok(source.includes(`"${a}"`), a);
  assert.ok(!source.includes('scanAndMatchMis'), 'old nearest-20 flow removed');
});

test('content.js: separate 探索/MIS actions skip checked places and share Google place details', () => {
  assert.match(content, /EXPLORE_BATCH_SIZE = 20/);
  assert.match(content, /lister\.next\(EXPLORE_BATCH_SIZE/);
  assert.match(content, /"greenoil-explore-btn"/);
  assert.match(content, /"greenoil-match-mis-btn"/);
  assert.match(content, /"匹配MIS"/);
  assert.match(content, /createRateLimiter\(1000\)/, 'detail pages 1/s');
  assert.match(content, /view,\s+\/\/ snapshot/);
  const detail = content.slice(content.indexOf('async function detailedPlace'), content.indexOf('async function processFriedPlace'));
  assert.match(detail, /detailMemo\.has\(id\)/, 'details survive across clicks');
  assert.match(detail, /entry\.detailLoaded/);
  assert.match(detail, /entry\.detailPromise/);
  assert.equal((detail.match(/fetchPlaceDetail/g) || []).length, 1, 'one shared detail loader');
  const fried = content.slice(content.indexOf('async function processFriedPlace'), content.indexOf('async function processMisPlace'));
  const mis = content.slice(content.indexOf('async function processMisPlace'), content.indexOf('function addExplorePlaces'));
  assert.match(fried, /detailedPlace\(session, entry\)/);
  assert.match(mis, /if \(!candidates\.length\)/, 'MIS without a candidate never loads details');
  assert.match(mis, /detailedPlace\(session, entry\)/, 'MIS candidate reuses the shared detail');
  assert.match(mis, /action: "exploreValidateMis"/);
  const batch = content.slice(content.indexOf('async function runActionBatch'), content.indexOf('async function handleExploreClick'));
  assert.match(batch, /if \(!force\) \{\s+const r = await bgMessage\(\{ action: "getCheckedPlaceIds", kind: action/, 'Shift+click re-checks everything');
  assert.ok(batch.indexOf('getCheckedPlaceIds') < batch.indexOf('session.lister.next'), 'checked ids known before searching');
  assert.match(batch, /exclude: \(place\) =>/);
  assert.ok(!content.includes('继续探索') && !content.includes('继续匹配') && !content.includes('sameView'), 'no continue-session logic');
  // pin colour is derived from both results (order-independent)
  assert.match(content, /function exploreState\(entry\) \{\s+if \(entry\.customer\) return "mis";\s+if \(entry\.fried\) return "fried";\s+return "candidate";/);
  assert.match(fried, /const live = \(\) => session === explore && !session\.cancelled/, 'stale results dropped');
  const click = content.slice(content.indexOf('async function handleExploreClick'), content.indexOf('function setMisButtonAuth'));
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

test('resident pins layer + popup toggle (default on)', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '../popup.html'), 'utf8');
  const popupJs = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../content.css'), 'utf8');
  assert.match(popupHtml, /<input type="checkbox" id="toggleMatchedPins" class="custom-checkbox" checked>/);
  assert.match(popupHtml, /地图显示已匹配商家/);
  assert.match(popupJs, /gce_show_matched !== false/, 'default checked');
  assert.match(popupJs, /set\(\{ gce_show_matched: this\.elToggleMatchedPins\.checked \}\)/);
  assert.match(content, /\["greenoil-pins-matched", "greenoil-pins-explore", "greenoil-pins-route"\]/);
  assert.match(content, /changes\.gce_show_matched/);
  assert.match(content, /explore\.places\.has\(m\.place\.placeId\)\) \|\| isOnRoute\(m\.place\)/, 'no duplicate pins; waypoint wins');
  assert.match(content, /const known = matched\.get\(place\.placeId\)/, 'explore starts from known matches');
  assert.match(content, /for \(const id of \["greenoil-pins-matched", "greenoil-pins-explore"\]\)/);
  assert.match(css, /\.greenoil-matched-off \.greenoil-explore-pin\[data-state="mis"\]/);
  assert.match(css, /\.greenoil-matched-off \.greenoil-explore-pin\[data-state="fried"\]/);
  assert.doesNotMatch(css, /#greenoil-pins-matched\.greenoil-matched-off \{ display: none/);
  // grey pins: own toggle, loaded per viewport and capped
  assert.match(popupHtml, /<input type="checkbox" id="toggleCheckedPins" class="custom-checkbox" checked>/);
  assert.match(popupJs, /gce_show_checked !== false/);
  assert.match(content, /changes\.gce_show_checked/);
  assert.match(css, /\.greenoil-checked-off \.greenoil-explore-pin\[data-state="candidate"\] \{\s+display: none !important/);
  assert.match(content, /action: "getMatchedPlaces", bounds: area\.bounds, checked: area\.checked, checkedMax: CHECKED_MAX/);
  assert.match(content, /if \(!entry\.customer && !entry\.fried && !entry\.checked\)/, 'checked places stay as grey resident pins');
  // zoomed out: clusters, drawn by map-hook below the pins' zoom limit
  assert.match(content, /cluster: area\.cluster \? \{ zoom: area\.zoom, cellPx: CLUSTER_CELL_PX \} : null/);
  assert.match(content, /const cluster = view\.zoom < CLUSTER_BELOW_ZOOM/);
  assert.match(content, /el\.dataset\.greenoilMinZoom = String\(CLUSTER_MIN_ZOOM\)/);
  const hook = fs.readFileSync(path.join(__dirname, '../map-hook.js'), 'utf8');
  assert.match(hook, /getAttribute\("data-greenoil-min-zoom"\)/);
  assert.match(hook, /if \(!visible \|\| zoom < p\.minZoom\)/);
  assert.match(css, /\.greenoil-cluster-body \{[^}]*transform: translate\(-50%, -50%\)/s, 'clusters centered on their anchor');
  // fresh 探索 results follow the same clustering as cached ones
  assert.match(content, /function sessionPinsShown\(\) \{\s+return Boolean\(explore && explore\.places\.size\) && \(Boolean\(explore\.runningAction\) \|\| !residentArea\?\.cluster\);/);
  assert.match(content, /function upsertMatched\(entry\) \{[^}]*if \(residentArea\?\.cluster\) return;/, 'no page-made singles on a clustered map');
  assert.match(content, /const exclude = area\?\.cluster && explore\?\.runningAction \? \[\.\.\.explore\.places\.keys\(\)\] : \[\]/);
  const batchFn = content.slice(content.indexOf('async function runActionBatch'), content.indexOf('async function handleExploreClick'));
  assert.equal((batchFn.match(/settleExplorePins\(\)/g) || []).length, 2, 'every finished batch folds into the clusters');
  assert.match(css, /#greenoil-pins-explore\.greenoil-folded \{ display: none/);
});
