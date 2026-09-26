/**
 * Green Oil — restaurants in the current map window, from Google Maps itself.
 *
 * Runs in the Maps page (content-script world, before content.js) and in
 * node tests. Two same-origin requests, both the ones Google Maps makes
 * itself (the user's own session):
 *
 *   /search?tbm=map         the "Restaurants" chip for a map view, paged
 *                           (!7i page size, !8i offset) -> name, categories,
 *                           address with house number, coordinates, id
 *   /maps/preview/place     a place's detail panel -> Google's description,
 *                           the owner's description, review snippets
 *
 * The `pb` parameters are Google's own templates captured from real
 * requests with the per-session blocks removed; only the view / offset /
 * place id are substituted. Any format change makes the parsers find
 * nothing, which callers report instead of silently showing "0 results".
 */
(function () {
  "use strict";

  const PB_TEMPLATE =
    "!4m9!1m3!1d2811.9875804429944!2d-79.3395!3d43.8045!2m0!3m2!1i937!2i375!4f13.1!7i20!10b1" +
    "!12m25!1m5!18b1!30b1!31m1!1b1!34e1!2m4!5m1!6e2!20e3!39b1!10b1!12b1!13b1!16b1!17m1!3e1!20m3" +
    "!5e2!6b1!14b1!46m1!1b0!96b1!99b1!19m4!2m3!1i360!2i120!4i8!20m65!2m2!1i203!2i100!3m2!2i4!5b1" +
    "!6m6!1m2!1i86!2i86!1m2!1i408!2i240!7m33!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3" +
    "!1m3!1e8!2b0!3e3!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!1m3!1e9!2b1!3e2!2b1" +
    "!9b0!15m16!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20" +
    "!24m109!1m27!13m9!2b1!3b1!4b1!6i1!8b1!9b1!14b1!20b1!25b1!18m16!3b1!4b1!5b1!6b1!9b1!13b1" +
    "!14b1!17b1!20b1!21b1!22b1!32b1!33m1!1b1!34b1!36e2!10m1!8e3!11m1!3e1!17b1!20m2!1e3!1e6" +
    "!24b1!25b1!26b1!27b1!29b1!30m1!2b1!36b1!37b1!39m3!2m2!2i1!3i1!43b1!52b1!54m1!1b1!55b1" +
    "!56m1!1b1!61m2!1m1!1e1!65m5!3m4!1m3!1m2!1i224!2i298!72m22!1m8!2b1!5b1!7b1!12m4!1b1!2b1" +
    "!4m1!1e1!4b1!8m10!1m6!4m1!1e1!4m1!1e3!4m1!1e4" +
    "!3sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts!6m1!1e1!9b1" +
    "!89b1!90m2!1m1!1e2!98m3!1b1!2b1!3b1!103b1!113b1!114m3!1b1!2m1!1b1!117b1!122m1!1b1!126b1" +
    "!127b1!128m1!1b1!26m4!2m3!1i80!2i92!4i8!30m28!1m6!1m2!1i0!2i0!2m2!1i530!2i375!1m6!1m2" +
    "!1i887!2i0!2m2!1i937!2i375!1m6!1m2!1i0!2i0!2m2!1i937!2i20!1m6!1m2!1i0!2i355!2m2!1i937" +
    "!2i375!34m19!2b1!3b1!4b1!6b1!8m6!1b1!3b1!4b1!5b1!6b1!7b1!9b1!12b1!14b1!20b1!23b1!25b1" +
    "!26b1!31b1!37m1!1e81!42b1!47m0!49m10!3b1!6m2!1b1!2b1!7m2!1e3!2b1!8b1!9b1!10e2!50m4!2e2" +
    "!3m2!1b1!3b1!67m5!7b1!10b1!14b1!15m1!1b0!69i797!77b1";

  // Place detail panel; {PLACE_ID} is substituted.
  const DETAIL_PB_TEMPLATE =
    "!1m10!1s{PLACE_ID}!3m8!1m3!1d2879.500139852996!2d-79.335716!3d43.8039843!3m2!1i1024!2i768" +
    "!4f13.1!12m4!2m3!1i360!2i120!4i8!13m57!2m2!1i203!2i100!3m2!2i4!5b1!6m6!1m2!1i86!2i86!1m2" +
    "!1i408!2i240!7m33!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e10" +
    "!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!1m3!1e9!2b1!3e2!2b1!9b0!15m8!1m7!1m2!1m1!1e2" +
    "!2m2!1i195!2i195!3i20!15m108!1m26!13m9!2b1!3b1!4b1!6i1!8b1!9b1!14b1!20b1!25b1!18m15!3b1" +
    "!4b1!5b1!6b1!13b1!14b1!17b1!21b1!22b1!30b1!32b1!33m1!1b1!34b1!36e2!10m1!8e3!11m1!3e1!17b1" +
    "!20m2!1e3!1e6!24b1!25b1!26b1!27b1!29b1!30m1!2b1!36b1!37b1!39m3!2m2!2i1!3i1!43b1!52b1!54m1" +
    "!1b1!55b1!56m1!1b1!61m2!1m1!1e1!65m5!3m4!1m3!1m2!1i224!2i298!72m22!1m8!2b1!5b1!7b1!12m4" +
    "!1b1!2b1!4m1!1e1!4b1!8m10!1m6!4m1!1e1!4m1!1e3!4m1!1e4" +
    "!3sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts!6m1!1e1!9b1" +
    "!89b1!90m2!1m1!1e2!98m3!1b1!2b1!3b1!103b1!113b1!114m3!1b1!2m1!1b1!117b1!122m1!1b1!126b1" +
    "!127b1!128m1!1b1!21m0!22m1!1e81!30m8!3b1!6m2!1b1!2b1!7m2!1e3!2b1!9b1!34m5!7b1!10b1!14b1" +
    "!15m1!1b0!37i797";

  // Google's own "Restaurants", "Fast food" and "Food court" searches.
  const QUERIES = ["restaurants", "fast food", "food court"];
  const PAGE_SIZE = 20;
  const MAX_PAGES_PER_QUERY = 15; // 300 results per query
  // Kept when any Google category is a restaurant, fast food, food court,
  // cafeteria or canteen ("Chinese restaurant", "Fast food restaurant", ...)
  const FOOD_CATEGORY_RE = /restaurant|fast food|food court|cafeteria|canteen/i;
  // ...unless the primary category is a café or bakery. Word boundaries keep
  // "Cafeteria" (a canteen) while dropping "Cafe" / "Coffee shop".
  const EXCLUDED_PRIMARY_RE = /\b(coffee|caf[eé]|espresso|bakery|bakeries|pastry|p[aâ]tisserie|donuts?|doughnuts?|cakes?|cookies?)\b/i;
  const FOV_DEG = 13.1;

  // ---- geometry ----

  function worldX(lng) {
    return (lng + 180) / 360;
  }

  function worldY(lat) {
    let s = Math.sin((lat * Math.PI) / 180);
    s = Math.max(-0.9999, Math.min(0.9999, s));
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }

  /** Camera altitude (m) Google uses for a view of `h` CSS px at `zoom`. */
  function viewAltitude(lat, zoom, h) {
    const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    return (h * metersPerPx) / 2 / Math.tan(((FOV_DEG / 2) * Math.PI) / 180);
  }

  /**
   * Canvas-local px of a point for view {lat, lng, zoom, w, h}
   * (Google's URL camera is the full map canvas center).
   */
  function viewPoint(lat, lng, view) {
    const s = 256 * Math.pow(2, view.zoom);
    return {
      x: view.w / 2 + (worldX(lng) - worldX(view.lng)) * s,
      y: view.h / 2 + (worldY(lat) - worldY(view.lat)) * s,
    };
  }

  /** Inside the visible map: within the canvas and not under `view.hidden` rects. */
  function inView(lat, lng, view) {
    const p = viewPoint(lat, lng, view);
    if (p.x < 0 || p.y < 0 || p.x > view.w || p.y > view.h) return false;
    return !(view.hidden || []).some(r =>
      p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height);
  }

  // ---- request / response ----

  function buildSearchPb(view, count, offset) {
    const w = Math.max(1, Math.round(view.w));
    const h = Math.max(1, Math.round(view.h));
    return PB_TEMPLATE
      .replace(/!1d[-\d.]+/, `!1d${viewAltitude(view.lat, view.zoom, h)}`)
      .replace(/!2d[-\d.]+/, `!2d${view.lng}`)
      .replace(/!3d[-\d.]+/, `!3d${view.lat}`)
      .replace(/!3m2!1i\d+!2i\d+/, `!3m2!1i${w}!2i${h}`)
      .replace(/!7i\d+/, offset ? `!7i${count}!8i${offset}` : `!7i${count}`);
  }

  function buildSearchUrl(view, query, count, offset) {
    const params = `tbm=map&authuser=0&hl=en&pb=${buildSearchPb(view, count, offset)}&q=${encodeURIComponent(query)}`;
    return `/search?${params}`;
  }

  function buildDetailUrl(placeId) {
    const pb = DETAIL_PB_TEMPLATE.replace("{PLACE_ID}", placeId);
    return `/maps/preview/place?authuser=0&hl=en&pb=${encodeURIComponent(pb).replace(/%21/g, "!")}`;
  }

  /** Google's ")]}'"-guarded JSON (optionally wrapped in {"d": ...}) -> data. */
  function decodeSearchBody(text) {
    let t = String(text || "");
    const cut = t.indexOf('/*""*/');
    if (cut > 0) t = t.slice(0, cut);
    t = t.trim();
    if (t.startsWith("{")) t = JSON.parse(t).d;
    return JSON.parse(String(t).replace(/^\)\]\}'\s*/, ""));
  }

  /**
   * Place records in a search response. A record is the array Google uses
   * for a place: [2] address lines, [9] [_, _, lat, lng], [10] place id,
   * [11] name, [13] categories, [39] full address.
   */
  function parseSearchResponse(text) {
    const data = decodeSearchBody(text);
    const out = [];
    const walk = (x, depth) => {
      if (depth > 8 || !Array.isArray(x)) return;
      const pos = x[9];
      if (Array.isArray(pos) && typeof pos[2] === "number" && typeof pos[3] === "number" &&
          typeof x[11] === "string" && x[11]) {
        out.push({
          placeId: typeof x[10] === "string" ? x[10] : "",
          name: x[11],
          latitude: pos[2],
          longitude: pos[3],
          categories: Array.isArray(x[13]) ? x[13].filter(c => typeof c === "string") : [],
          address: typeof x[39] === "string" ? x[39] : "",
          addressLines: Array.isArray(x[2]) ? x[2].filter(l => typeof l === "string") : [],
        });
        return;
      }
      for (const y of x) walk(y, depth + 1);
    };
    walk(data, 0);
    return out;
  }

  function isWantedFoodPlace(categories) {
    const cats = categories || [];
    if (!cats.some(c => FOOD_CATEGORY_RE.test(c))) return false;
    return !EXCLUDED_PRIMARY_RE.test(cats[0] || "");
  }

  // ---- candidates for MIS matching ----

  const STREET_TYPE_RE = /^(ave|avenue|st|street|rd|road|blvd|boulevard|dr|drive|cres|crescent|ct|crt|court|pl|place|ln|lane|pkwy|parkway|hwy|highway|way|terr|terrace|sq|square|cir|circle|gate|trail|line|sideroad|gdns|gardens|mall|plaza)$/i;
  const DIRECTION_RE = /^(e|w|n|s|east|west|north|south)$/i;
  const UNIT_RE = /^(#.*|unit|uinit|ste|suite|bldg|building)$/i;

  /**
   * "3601 Victoria Park Ave #121 Scarborough, ON ..." -> "3601 Victoria Park Ave"
   * (house number + street, up to the street type and direction; units and
   * city dropped; "" when the address has no house number).
   */
  function streetPrefixFromAddress(address) {
    const first = String(address || "").split(",")[0]
      .replace(/^(?:unit|ste|suite|#)\s*[\w-]+\s*[-–]\s*/i, "")
      .trim();
    const tokens = first.split(/\s+/);
    if (!/^\d+[A-Za-z]?(?:-\d+)?$/.test(tokens[0] || "")) return "";
    const street = [];
    for (let i = 1; i < tokens.length && street.length < 6; i++) {
      const t = tokens[i].replace(/\.$/, "");
      if (UNIT_RE.test(t)) break;
      street.push(t);
      if (STREET_TYPE_RE.test(t)) {
        if (DIRECTION_RE.test((tokens[i + 1] || "").replace(/\.$/, ""))) {
          street.push(tokens[i + 1].replace(/\.$/, ""));
        }
        break;
      }
    }
    return street.length ? `${tokens[0]} ${street.join(" ")}` : "";
  }

  /** English store name: the whole name if Latin, else its longest Latin run. */
  function englishName(name) {
    const n = String(name || "").replace(/’/g, "'").replace(/\s+/g, " ").trim();
    const latin = /^[\x20-\x7EÀ-ɏ]+$/;
    if (n.length >= 3 && latin.test(n) && /[A-Za-z]/.test(n)) return n;
    const runs = n.match(/[A-Za-zÀ-ɏ][A-Za-z0-9À-ɏ '&.-]*[A-Za-z0-9.]/g) || [];
    const best = runs.map(r => r.trim()).sort((a, b) => b.length - a.length)[0] || "";
    return best.replace(/[^A-Za-z]/g, "").length >= 4 ? best : "";
  }

  /** Search record -> explore place (what the pins and MIS matching use). */
  function toPlace(rec) {
    const streetPrefix = streetPrefixFromAddress(rec.address || rec.addressLines[0]);
    return {
      placeId: rec.placeId,
      name: rec.name,
      englishName: englishName(rec.name),
      street: streetPrefix.replace(/^\S+\s+/, ""),
      streetPrefix: /^\d/.test(streetPrefix) ? streetPrefix : "",
      displayName: rec.address,
      categories: rec.categories,
      latitude: rec.latitude,
      longitude: rec.longitude,
    };
  }

  /**
   * Every wanted food place inside `view`, streamed: onPlaces(newPlaces) is
   * called after each result page with the places not seen before. Pages
   * go through `schedule` (a rate limiter). Resolves with the total count;
   * throws if Google returned no parsable records at all.
   */
  async function fetchWindowPlaces(view, { onPlaces, schedule, fetchImpl, isCancelled } = {}) {
    const doFetch = fetchImpl || fetch;
    const run = schedule || ((fn) => fn());
    const seen = new Set();
    let parsedAny = false;
    for (const q of QUERIES) {
      for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
        if (isCancelled && isCancelled()) return seen.size;
        const text = await run(async () => {
          const resp = await doFetch(buildSearchUrl(view, q, PAGE_SIZE, page * PAGE_SIZE), { credentials: "include" });
          if (!resp.ok) throw new Error(`Google search HTTP ${resp.status}`);
          return resp.text();
        });
        const records = parseSearchResponse(text);
        if (records.length) parsedAny = true;
        const fresh = [];
        for (const rec of records) {
          const key = rec.placeId || `${rec.name}@${rec.latitude.toFixed(5)},${rec.longitude.toFixed(5)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (isWantedFoodPlace(rec.categories) && inView(rec.latitude, rec.longitude, view)) {
            fresh.push(toPlace(rec));
          }
        }
        if (fresh.length && onPlaces) onPlaces(fresh);
        if (records.length < PAGE_SIZE) break; // last page
      }
    }
    if (!parsedAny) throw new Error("Google search returned no places (format changed?)");
    return seen.size;
  }

  // ---- place details (for the fried-food judgement) ----

  function collectStrings(node, depth, out) {
    if (depth > 6 || node == null) return out;
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) for (const x of node) collectStrings(x, depth + 1, out);
    return out;
  }

  function cleanSnippet(s) {
    return String(s || "").replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
  }

  /**
   * Detail response -> {name, categories, description, ownerDescription,
   * reviews[]}. Record indices: [11] name, [13] categories, [32] Google's
   * summaries, [154] owner description, [31][1][i][1] review snippets.
   */
  function parseDetailResponse(text) {
    const data = JSON.parse(String(text || "").replace(/^\)\]\}'\s*/, ""));
    const p = Array.isArray(data) ? data[6] : null;
    if (!Array.isArray(p) || typeof p[11] !== "string") return null;
    const isProse = (s) => typeof s === "string" && s.length >= 12 && /\s/.test(s) && !/^https?:/.test(s);
    const description = [...new Set((Array.isArray(p[32]) ? p[32] : [])
      .map(x => Array.isArray(x) ? x[1] : null).filter(isProse))].join(" ");
    const ownerDescription = collectStrings(p[154], 0, []).filter(isProse).slice(0, 1).join(" ");
    const reviews = (Array.isArray(p[31]) && Array.isArray(p[31][1]) ? p[31][1] : [])
      .map(r => Array.isArray(r) ? cleanSnippet(r[1]) : "")
      .filter(isProse)
      .slice(0, 5);
    return {
      name: p[11],
      categories: Array.isArray(p[13]) ? p[13].filter(c => typeof c === "string") : [],
      description,
      ownerDescription,
      reviews,
    };
  }

  async function fetchPlaceDetail(placeId, fetchImpl) {
    const resp = await (fetchImpl || fetch)(buildDetailUrl(placeId), { credentials: "include" });
    if (!resp.ok) throw new Error(`Google place HTTP ${resp.status}`);
    return parseDetailResponse(await resp.text());
  }

  // ---- rate limiting ----

  /**
   * Serial scheduler: jobs run one at a time, starts spaced >= intervalMs.
   * Each limiter is independent (Google details vs. MIS have their own).
   */
  function createRateLimiter(intervalMs, now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms))) {
    let chain = Promise.resolve();
    let last = -Infinity;
    return function schedule(job) {
      const run = chain.then(async () => {
        const wait = last + intervalMs - now();
        if (wait > 0) await sleep(wait);
        last = now();
        return job();
      });
      chain = run.catch(() => {});
      return run;
    };
  }

  const api = {
    QUERIES,
    viewAltitude,
    viewPoint,
    inView,
    buildSearchPb,
    buildSearchUrl,
    buildDetailUrl,
    parseSearchResponse,
    parseDetailResponse,
    isWantedFoodPlace,
    streetPrefixFromAddress,
    englishName,
    toPlace,
    fetchWindowPlaces,
    fetchPlaceDetail,
    createRateLimiter,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else if (typeof window !== "undefined") {
    window.__greenoil_places = api;
  }
})();
