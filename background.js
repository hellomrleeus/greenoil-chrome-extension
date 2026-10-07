/**
 * Green Oil Chrome Extension - Background Service Worker (ES module)
 * Manages 5-color route palette persistence, dynamic badge color, Google Maps
 * theme synchronization, and the 探索 jev pipeline.
 * Worker API calls shared with the popup go through api.js (GreenOilApi).
 */

import { GreenOilApi } from "./api.js";
import { createRouteStore } from "./route-store.js";

const DEFAULT_ORIGIN = "Green Oil Inc. 4490 Chesswood Dr Unit 3, North York, ON M3J 2B9";
const WORKER_URL = "https://greenoil-api.ydxhjw4j5w.workers.dev";

// 5 Dedicated Color Routes
const COLOR_ROUTES_DEF = {
  route_1: {
    id: "route_1",
    color: "#059669", // Emerald Green (Signature)
    hoverColor: "#047857",
    lightColor: "#ecfdf5",
    borderColor: "#10b981",
    textColor: "#065f46",
    name: "绿线",
    origin: DEFAULT_ORIGIN,
    waypoints: []
  },
  route_2: {
    id: "route_2",
    color: "#2563eb", // Royal Blue
    hoverColor: "#1d4ed8",
    lightColor: "#eff6ff",
    borderColor: "#3b82f6",
    textColor: "#1e40af",
    name: "蓝线",
    origin: DEFAULT_ORIGIN,
    waypoints: []
  },
  route_3: {
    id: "route_3",
    color: "#d97706", // Amber Orange
    hoverColor: "#b45309",
    lightColor: "#fffbeb",
    borderColor: "#f59e0b",
    textColor: "#92400e",
    name: "橙线",
    origin: DEFAULT_ORIGIN,
    waypoints: []
  },
  route_4: {
    id: "route_4",
    color: "#e11d48", // Crimson Rose
    hoverColor: "#be123c",
    lightColor: "#fff1f2",
    borderColor: "#f43f5e",
    textColor: "#9f1239",
    name: "红线",
    origin: DEFAULT_ORIGIN,
    waypoints: []
  },
  route_5: {
    id: "route_5",
    color: "#7c3aed", // Violet Purple
    hoverColor: "#6d28d9",
    lightColor: "#f5f3ff",
    borderColor: "#8b5cf6",
    textColor: "#5b21b6",
    name: "紫线",
    origin: DEFAULT_ORIGIN,
    waypoints: []
  }
};

const DEFAULT_ACTIVE_ROUTE_ID = "route_1";

// Waypoint lists come only from the cloud API (route-store.js); the only
// local route state is which colour route is active.
const routeStore = createRouteStore({
  api: GreenOilApi,
  defs: COLOR_ROUTES_DEF,
  getToken: async () => (await chrome.storage.local.get("authToken")).authToken || ""
});

// Older builds kept the lists in chrome.storage.local ("gce_color_routes").
// Hand that copy to the cloud once (only if the cloud is empty), then drop it.
let legacyRoutesAdopted = null;
function adoptLegacyRoutes() {
  if (!legacyRoutesAdopted) {
    legacyRoutesAdopted = (async () => {
      const { gce_color_routes: legacy } = await chrome.storage.local.get("gce_color_routes");
      if (!legacy) return;
      if (await routeStore.adoptLegacy(legacy)) await chrome.storage.local.remove("gce_color_routes");
    })().catch((err) => {
      legacyRoutesAdopted = null; // retry on the next read
      console.warn("Legacy route upload failed:", err);
    });
  }
  return legacyRoutesAdopted;
}

async function getActiveRouteId() {
  const { gce_active_route_id: id } = await chrome.storage.local.get("gce_active_route_id");
  return COLOR_ROUTES_DEF[id] ? id : DEFAULT_ACTIVE_ROUTE_ID;
}

/** Fresh routes from the API plus the locally selected active route. */
async function getOrInitColorRoutes() {
  await adoptLegacyRoutes();
  const [{ routes }, activeId] = await Promise.all([routeStore.load(), getActiveRouteId()]);
  return { routes, activeId, activeRoute: routes[activeId] };
}

/**
 * Read-modify-write against the API. fn(routes, activeId, activeRoute)
 * edits in place (return false to skip saving). Maps tabs and the badge
 * follow the saved lists.
 */
async function mutateRoutes(fn) {
  await adoptLegacyRoutes();
  const activeId = await getActiveRouteId();
  const out = await routeStore.mutate((routes) => fn(routes, activeId, routes[activeId]));
  if (out.saved) {
    await updateBadge({ routes: out.routes, activeId });
    await broadcastRoutesChanged();
  }
  return { ...out, activeId, activeRoute: out.routes[activeId] };
}

/**
 * Update the toolbar extension badge count and badge background color matching active route color
 */
async function updateBadge(known) {
  try {
    const { activeRoute } = known
      ? { activeRoute: known.routes[known.activeId] }
      : await getOrInitColorRoutes();
    const count = activeRoute && Array.isArray(activeRoute.waypoints) ? activeRoute.waypoints.length : 0;
    const badgeColor = activeRoute ? activeRoute.color : "#059669";

    await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    await chrome.action.setBadgeText({
      text: count > 0 ? String(count) : ""
    });
  } catch (err) {
    console.warn("Failed to update badge:", err);
  }
}

/** Waypoint lists changed in the cloud: Maps tabs redraw their pins. */
async function broadcastRoutesChanged() {
  try {
    const tabs = await chrome.tabs.query({ url: ["*://*.google.com/maps/*", "*://*.google.ca/maps/*"] });
    for (const t of tabs) {
      if (t.id) chrome.tabs.sendMessage(t.id, { action: "routesChanged" }).catch(() => {});
    }
  } catch (_) {}
}

/**
 * Broadcast active theme changes to all open Google Maps tabs
 */
async function broadcastThemeChange(themeInfo) {
  try {
    const tabs = await chrome.tabs.query({ url: ["*://*.google.com/maps/*", "*://*.google.ca/maps/*"] });
    for (const t of tabs) {
      if (t.id) {
        chrome.tabs.sendMessage(t.id, {
          action: "themeColorChanged",
          theme: themeInfo
        }).catch(() => {});
      }
    }
  } catch (_) {}
}

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await updateBadge();
  } catch (e) {
    console.warn("onInstalled error:", e);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await updateBadge();
  } catch (e) {
    console.warn("onStartup error:", e);
  }
});

const GOOGLE_MAPS_URL_PATTERNS = [
  "https://google.com/maps/*",
  "https://www.google.com/maps/*",
  "https://google.ca/maps/*",
  "https://www.google.ca/maps/*"
];

function isGoogleMapsUrl(url) {
  try {
    const parsed = new URL(url);
    return ["google.com", "www.google.com", "google.ca", "www.google.ca"].includes(parsed.hostname)
      && parsed.pathname.startsWith("/maps/");
  } catch (_) {
    return false;
  }
}

// MAIN-world pin positioning + in-page navigation (see map-hook.js).
// Declared in the manifest for new pages; injected here for tabs that were
// open before the extension was installed or reloaded. Idempotent.
async function injectMapHook(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["pin-math.js", "map-hook.js"]
  });
}

async function ensureMapsContentScript(tabId) {
  try {
    const [{ result: alreadyInjected = false } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(
        window.__greenoil_injected__ &&
        chrome.runtime?.id &&
        document.documentElement.getAttribute("data-greenoil-owner")
      )
    });
    if (alreadyInjected) return;

    await injectMapHook(tabId);
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["google-places.js", "content.js"]
    });
  } catch (error) {
    console.warn("[GreenOil] Unable to ensure Maps content script:", error);
  }
}

// Manifest injection remains the normal path. This only repairs pages that were
// already open when the unpacked extension was reloaded or where Chrome skipped
// the declarative injection during a Maps navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isGoogleMapsUrl(tab.url)) {
    ensureMapsContentScript(tabId);
  }
});

chrome.tabs.query({ url: GOOGLE_MAPS_URL_PATTERNS }).then((tabs) => {
  for (const tab of tabs) {
    if (tab.id && isGoogleMapsUrl(tab.url)) ensureMapsContentScript(tab.id);
  }
}).catch(() => {});

/**
 * Smoothly pan Google Maps to a waypoint location without page refresh
 */
async function handlePanToWaypoint(wp) {
  if (!wp) return { success: false, error: "缺少地点数据" };

  // 1. Find all Google Maps tabs
  const mapTabs = await chrome.tabs.query({
    url: [
      "https://*.google.com/maps/*",
      "https://*.google.ca/maps/*",
      "https://*.google.co.uk/maps/*",
      "https://*.google.com.hk/maps/*",
      "https://*.google.com.tw/maps/*",
      "https://*.google.co.jp/maps/*"
    ]
  });

  // Find active tab in current window
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  let targetTab = null;

  if (activeTabs.length > 0 && activeTabs[0].url && (activeTabs[0].url.includes("/maps") || activeTabs[0].url.includes("google."))) {
    targetTab = activeTabs[0];
  } else if (mapTabs.length > 0) {
    targetTab = mapTabs[0];
    await chrome.tabs.update(targetTab.id, { active: true });
    if (targetTab.windowId) {
      await chrome.windows.update(targetTab.windowId, { focused: true });
    }
  }

  // Construct target URL path
  let targetPath = "";
  if (wp.mapsUrl && wp.mapsUrl.includes("/maps/")) {
    try {
      const u = new URL(wp.mapsUrl);
      targetPath = u.pathname + u.search + u.hash;
    } catch (_) {
      targetPath = wp.mapsUrl;
    }
  }

  if (!targetPath) {
    const lat = parseFloat(wp.latitude);
    const lng = parseFloat(wp.longitude);
    const cleanName = (wp.name || "").trim();
    if (!isNaN(lat) && !isNaN(lng)) {
      targetPath = `/maps/place/${encodeURIComponent(cleanName)}/@${lat},${lng},17z`;
    } else if (cleanName) {
      targetPath = `/maps/search/${encodeURIComponent(cleanName)}`;
    }
  }

  if (!targetTab) {
    // If no existing Google Maps tab is open, open a new one
    const fullUrl = targetPath.startsWith("http") ? targetPath : `https://www.google.com${targetPath}`;
    await chrome.tabs.create({ url: fullUrl, active: true });
    return { success: true, createdNewTab: true };
  }

  // 1. First try smooth in-page pan via message to content script
  try {
    const res = await chrome.tabs.sendMessage(targetTab.id, {
      action: "panToLocation",
      targetPath,
      waypoint: wp
    });
    if (res !== undefined) {
      return { success: true, panned: true };
    }
  } catch (_) {}

  // 2. Content script unreachable (e.g. tab predates an extension reload):
  //    navigate in-page through the MAIN-world map hook.
  try {
    await injectMapHook(targetTab.id);
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      world: "MAIN",
      func: (path, lat, lng) => {
        window.postMessage({ type: "GREENOIL_NAVIGATE", path, lat, lng }, "*");
        return { success: true };
      },
      args: [targetPath, wp.latitude ?? null, wp.longitude ?? null]
    });
    return { success: true, panned: true };
  } catch (err) {
    console.warn("[GreenOil] In-page navigation failed, falling back to tab update:", err);
  }

  // 3. Last resort fallback: Hard tab navigation
  const destination = new URL(targetPath, "https://www.google.com");
  if (!/^www\.google\.(com|ca)$/.test(destination.hostname) ||
      destination.protocol !== "https:" || !destination.pathname.startsWith("/maps/")) {
    return { success: false, error: "无效的 Google Maps 地址" };
  }
  await chrome.tabs.update(targetTab.id, { url: destination.href, active: true });
  return { success: true, navigated: true };
}

// ==========================================
// 探索: result caches & fried-food judgement
// ==========================================

// ---- Local result caches (chrome.storage.local) ----
// Positive results ("matched" places): places jev judged to serve fried
// food. Negative results live in the checked-place cache below.
// A fried verdict is reused for CACHE_FRESH_MS (7 days; menus change
// slowly): within it a click answers from the cache. After that the place
// is queried again on the next click, but its pin (and name tag) keeps
// showing the last known result until CACHE_KEEP_MS.
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_FRESH_MS = { f: 7 * DAY_MS };     // reused without a new query
const CACHE_KEEP_MS = 30 * DAY_MS;                        // still drawn on the map
const FRIED_CACHE_KEY = "gce_fried_cache";                // {placeId: {t}}
const FRIED_CACHE_MAX = 5000;

async function readCache(key) {
  const data = await chrome.storage.local.get(key);
  return data[key] || {};
}

/** Recent enough to reuse instead of querying again. */
function freshEntry(entry, kind, now) {
  return entry && now - entry.t < CACHE_FRESH_MS[kind] ? entry : null;
}

/** Recent enough to draw as a pin / name tag. */
function keptEntry(entry, now) {
  return entry && now - entry.t < CACHE_KEEP_MS ? entry : null;
}

/** Drop entries past CACHE_KEEP_MS and keep the newest `max`. */
function pruneCache(map, max, now) {
  return Object.fromEntries(
    Object.entries(map)
      .filter(([, e]) => keptEntry(e, now))
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, max)
  );
}

// The MIS matching feature is gone: drop the customer data it cached.
Promise.resolve(chrome.storage?.local?.remove(["gce_mis_match_cache", "gce_mis_cache"])).catch(() => {});

async function cachePositive(key, placeId, value, max) {
  const now = Date.now();
  const map = await readCache(key);
  map[placeId] = { t: now, ...value };
  await chrome.storage.local.set({ [key]: pruneCache(map, max, now) });
}

async function removeCacheEntry(key, placeId) {
  const map = await readCache(key);
  if (!Object.prototype.hasOwnProperty.call(map, placeId)) return;
  delete map[placeId];
  await chrome.storage.local.set({ [key]: map });
}

// ---- Checked-place cache (grey pins) ----
// Places checked with a negative result: jev found no fried food (f). While
// fresh (CACHE_FRESH_MS[kind]) a click on 探索 skips them, so each click
// takes the nearest unchecked places in the window; grey pins stay until
// CACHE_KEEP_MS. Errors are never recorded (retried next click);
// Shift+click re-checks everything. Stored per map tile (~7 km, zoom 12):
// a lookup or write touches only the tiles around the map window, never
// one ever-growing blob. The index lists the tiles and caps the total.
const SEEN_TILE_ZOOM = 12;
const SEEN_KEY_PREFIX = "gce_seen:";                      // gce_seen:<x>:<y> -> {placeId: {n, a, o, f?}}
const SEEN_INDEX_KEY = "gce_seen_tiles";                  // {tileKey: {t, c}}
const SEEN_TILE_MAX = 2000;
const SEEN_TOTAL_MAX = 40000;
const SEEN_KIND = { fried: "f" };
let _seenChain = Promise.resolve();

/** Web Mercator world coordinates in [0, 1] (Google's map projection). */
function worldPoint(lat, lng) {
  const s = Math.max(-0.9999, Math.min(0.9999, Math.sin((lat * Math.PI) / 180)));
  return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
}

function seenTile(lat, lng) {
  const n = 2 ** SEEN_TILE_ZOOM;
  const w = worldPoint(lat, lng);
  const clamp = (v) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
  return { x: clamp(w.x), y: clamp(w.y) };
}

function seenTileKey(lat, lng) {
  const t = seenTile(lat, lng);
  return `${SEEN_KEY_PREFIX}${t.x}:${t.y}`;
}

/** Keys of the stored tiles (from the index) overlapping {south, west, north, east}. */
function seenTileKeysIn(index, b) {
  const a = seenTile(b.north, b.west);
  const z = seenTile(b.south, b.east);
  return Object.keys(index).filter((key) => {
    const [x, y] = key.slice(SEEN_KEY_PREFIX.length).split(":").map(Number);
    return x >= a.x && x <= z.x && y >= a.y && y <= z.y;
  });
}

function sanitizeBounds(b) {
  if (!b) return null;
  const v = [b.south, b.west, b.north, b.east];
  if (!v.every(Number.isFinite) || b.south > b.north || b.west > b.east) return null;
  return { south: b.south, west: b.west, north: b.north, east: b.east };
}

function inBounds(b, lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

function freshSeen(entry, kind, now) {
  return Boolean(entry && entry[kind] && now - entry[kind] < CACHE_FRESH_MS[kind]);
}

function keptSeen(entry, kind, now) {
  return Boolean(entry && entry[kind] && now - entry[kind] < CACHE_KEEP_MS);
}

/** Drop marks past CACHE_KEEP_MS and empty entries; keep the newest SEEN_TILE_MAX. */
function pruneSeenTile(tile, now) {
  const kept = [];
  for (const [id, e] of Object.entries(tile)) {
    const f = keptSeen(e, "f", now) ? e.f : 0;
    if (!f) continue;
    const out = { n: e.n, a: e.a, o: e.o };
    if (f) out.f = f;
    kept.push([id, out, f]);
  }
  kept.sort((x, y) => y[2] - x[2]);
  return Object.fromEntries(kept.slice(0, SEEN_TILE_MAX).map(([id, e]) => [id, e]));
}

/** Tiles to drop: expired, or the oldest once the total exceeds the cap. */
function seenTilesToDrop(index, now) {
  const drop = [];
  let total = 0;
  for (const [key, e] of Object.entries(index).sort((a, b) => b[1].t - a[1].t)) {
    total += e.c || 0;
    if (!e.c || now - e.t >= CACHE_KEEP_MS || total > SEEN_TOTAL_MAX) drop.push(key);
  }
  return drop;
}

/** Record (on=true) or clear a negative result of `kind` for a place. */
function setChecked(place, kind, on) {
  if (!place?.placeId || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
    return Promise.resolve();
  }
  const run = _seenChain.then(async () => {
    const now = Date.now();
    const key = seenTileKey(place.latitude, place.longitude);
    const data = await chrome.storage.local.get([key, SEEN_INDEX_KEY]);
    const tile = data[key] || {};
    const prev = tile[place.placeId];
    if (!on && !prev?.[kind]) return;
    tile[place.placeId] = {
      ...(prev || {}), n: String(place.name || "").slice(0, 120),
      a: Math.round(place.latitude * 1e6) / 1e6, o: Math.round(place.longitude * 1e6) / 1e6,
      [kind]: on ? now : 0
    };
    const pruned = pruneSeenTile(tile, now);
    const index = data[SEEN_INDEX_KEY] || {};
    index[key] = { t: now, c: Object.keys(pruned).length };
    const drop = seenTilesToDrop(index, now);
    for (const k of drop) delete index[k];
    const write = { [SEEN_INDEX_KEY]: index };
    if (!drop.includes(key)) write[key] = pruned;
    await chrome.storage.local.set(write);
    if (drop.length) await chrome.storage.local.remove(drop);
  });
  _seenChain = run.catch(() => {});
  return run;
}

/** [[placeId, entry]] with a negative mark (kept, not only fresh) inside the bounds. */
async function readChecked(bounds, now) {
  const index = (await chrome.storage.local.get(SEEN_INDEX_KEY))[SEEN_INDEX_KEY] || {};
  const keys = seenTileKeysIn(index, bounds);
  if (!keys.length) return [];
  const data = await chrome.storage.local.get(keys);
  const out = [];
  for (const key of keys) {
    for (const [id, e] of Object.entries(data[key] || {})) {
      if (keptSeen(e, "f", now) && inBounds(bounds, e.a, e.o)) out.push([id, e]);
    }
  }
  return out;
}

/**
 * Place ids inside the bounds that `kind` (fried) already has a
 * result for, positive or negative: the next click skips them.
 */
async function handleGetCheckedPlaceIds(message) {
  const bounds = sanitizeBounds(message.bounds);
  const kind = SEEN_KIND[message.kind];
  if (!bounds || !kind) return { success: false, error: "bad request" };
  const now = Date.now();
  const ids = new Set();
  for (const [id, e] of await readChecked(bounds, now)) {
    if (freshSeen(e, kind, now)) ids.add(id);
  }
  for (const [id, e] of Object.entries(await readCache(FRIED_CACHE_KEY))) {
    if (freshEntry(e, "f", now) && inBounds(bounds, e.latitude, e.longitude)) ids.add(id);
  }
  return { success: true, ids: [...ids] };
}

// ---- 探索: place input ----
// Place fields arrive from the page: keep only well-formed ones.
function sanitizeExplorePlace(p) {
  if (!p || typeof p.placeId !== "string" || typeof p.name !== "string") return null;
  const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
  const list = (v, n, max) => (Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, n).map(x => x.slice(0, max)) : []);
  return {
    placeId: str(p.placeId, 80),
    name: str(p.name),
    englishName: str(p.englishName),
    street: str(p.street),
    streetPrefix: str(p.streetPrefix),
    displayName: str(p.displayName, 300),
    categories: list(p.categories, 10, 80),
    description: str(p.description, 600),
    ownerDescription: str(p.ownerDescription, 600),
    reviews: list(p.reviews, 5, 300),
    latitude: Number.isFinite(p.latitude) ? p.latitude : null,
    longitude: Number.isFinite(p.longitude) ? p.longitude : null
  };
}

// ---- 探索 sessions ----
const _cancelledSessions = new Set();

// ---- 探索: fried-food judgement with the jev model ----
// jev (TypeSafe System One) is a structured-decision model, not a chat
// model: POST /v1/systemone with a `state` (the restaurant's text) and
// typed `questions`. A "noul" question returns the probability of "yes".
// The key comes from GreenOilApi.getJevKey (api.js, operator token
// saved by the popup login). Details arrive at most 1/s, so one request
// per restaurant, one at a time.
const JEV_API = {
  url: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest"
};
const FRIED_THRESHOLD = 0.5;
let _jevKey = null;
let _jevChain = Promise.resolve();

// A different (or no) operator login invalidates the fetched key.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.authToken) _jevKey = null;
});

async function getJevKey() {
  if (_jevKey) return _jevKey;
  const { authToken } = await chrome.storage.local.get("authToken");
  if (!authToken) {
    const err = new Error("请先在扩展弹窗中登录 Green Oil 账号");
    err.disabled = true;
    throw err;
  }
  const data = (await GreenOilApi.getJevKey(authToken)) || {};
  const key = data.key || data.apiKey || data.jevKey;
  if (!key) {
    const err = new Error(data.message || data.error || "获取 JEV Key 失败");
    err.disabled = data.error === "Unauthorized"; // login expired: needs the popup again
    throw err;
  }
  _jevKey = key;
  return key;
}

/** System One request: the restaurant as `state`, one yes/no question. */
function friedRequest(place) {
  return {
    model: JEV_API.model,
    state: {
      name: place.name,
      categories: place.categories,
      description: place.description,
      owner_description: place.ownerDescription,
      review_snippets: place.reviews
    },
    questions: {
      fried: {
        type: "noul",
        instructions:
          "Does this restaurant serve deep-fried food, i.e. does it operate a deep fryer? " +
          "Examples: fried chicken, french fries, wings, tempura, fish and chips, spring rolls, " +
          "katsu, deep-fried dim sum, onion rings. Stir-frying or pan-frying alone does not count.",
        criteria: {
          true: "Deep-fried dishes are very likely on the menu (from the cuisine, description or reviews).",
          false: "No sign of deep-fried dishes; the cuisine is typically not deep-fried."
        }
      }
    }
  };
}

function answerProbability(data, key) {
  const a = data && data.answers && data.answers[key];
  if (!a) return null;
  for (const v of [a.noul, a.probability, a.value]) {
    if (typeof v === "number" && v >= 0 && v <= 1) return v;
    if (typeof v === "boolean") return v ? 1 : 0;
  }
  return null;
}

/** Probability of "yes" from a System One reply, or null. */
function friedProbability(data) {
  return answerProbability(data, "fried");
}

async function callJev(body) {
  let key = await getJevKey();
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(JEV_API.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    if (resp.status === 401 && attempt === 0) {
      _jevKey = null; // rotated on the Worker: fetch it again once
      key = await getJevKey();
      continue;
    }
    if (!resp.ok) throw new Error(`jev HTTP ${resp.status}`);
    return resp.json();
  }
  throw new Error("jev 鉴权失败");
}

/** {fried, probability} for one place; only "fried" is cached. */
async function handleExploreClassifyFried(message) {
  const place = sanitizeExplorePlace(message.place);
  if (!place) return { success: false, error: "bad place" };
  if (!message.forceRefresh) {
    const hit = freshEntry((await readCache(FRIED_CACHE_KEY))[place.placeId], "f", Date.now());
    if (hit) return { success: true, fried: true, cached: true };
  }
  // Probe only: lets the page skip the detail-page request for cached places.
  if (message.cacheOnly) return { success: true, fried: null, miss: true };

  const run = _jevChain.then(async () => {
    if (_cancelledSessions.has(message.sessionId)) return { success: false, cancelled: true };
    try {
      const probability = friedProbability(await callJev(friedRequest(place)));
      if (probability === null) return { success: false, error: "jev 返回格式无法识别" };
      const fried = probability >= FRIED_THRESHOLD;
      if (fried) {
        await cachePositive(FRIED_CACHE_KEY, place.placeId, {
          probability, name: place.name, latitude: place.latitude, longitude: place.longitude
        }, FRIED_CACHE_MAX);
      } else {
        await removeCacheEntry(FRIED_CACHE_KEY, place.placeId); // an older "fried" no longer holds
      }
      await setChecked(place, "f", !fried);
      return { success: true, fried, probability };
    } catch (err) {
      return { success: false, disabled: Boolean(err.disabled), error: err.message };
    }
  });
  _jevChain = run.catch(() => {});
  return run;
}

/**
 * Tags for a place page (name badge): cached fried verdict. Same data as the 探索 pins, keyed by place id.
 */
async function handleGetPlaceTags(message) {
  const placeId = typeof message.placeId === "string" ? message.placeId.slice(0, 80) : "";
  if (!placeId) return { success: false };
  const now = Date.now();
  const fried = keptEntry((await readCache(FRIED_CACHE_KEY))[placeId], now);
  return { success: true, fried: Boolean(fried), probability: fried?.probability ?? null };
}

/**
 * Grid clustering for a zoomed-out map: places sharing a `cellPx` square
 * of the world at `zoom` become one cluster {latitude, longitude (mean),
 * count, fried, checked}; a place alone in its cell stays a place.
 * The grid is fixed to the world, so panning does not reshuffle clusters.
 */
function clusterPlaces(places, zoom, cellPx) {
  const n = (256 * 2 ** zoom) / cellPx;
  const cells = new Map();
  for (const p of places) {
    const w = worldPoint(p.latitude, p.longitude);
    const key = `${Math.floor(w.x * n)}:${Math.floor(w.y * n)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
  }
  const singles = [];
  const clusters = [];
  for (const list of cells.values()) {
    if (list.length === 1) {
      singles.push(list[0]);
      continue;
    }
    const c = { latitude: 0, longitude: 0, count: list.length, fried: 0, checked: 0 };
    for (const p of list) {
      c.latitude += p.latitude / list.length;
      c.longitude += p.longitude / list.length;
      if (p.fried) c.fried++;
      else c.checked++;
    }
    clusters.push(c);
  }
  return { places: singles, clusters };
}

/**
 * Places for the resident map pins: fried places from the positive cache, then — with `checked` —
 * the grey checked places. With `bounds`, only places inside them (the
 * page loads the area around the map window, not the whole cache).
 * Without `cluster`, at most `checkedMax` grey places, nearest the center:
 * {places}. With `cluster` ({zoom, cellPx}, a zoomed-out map), every place
 * in the bounds, grid-clustered: {places (alone in their cell), clusters}.
 * `exclude`: place ids the page is drawing itself (a running 探索), left out
 * so they are not counted twice.
 * places: [{placeId, name, latitude, longitude, fried, checked?}]
 */
async function handleGetMatchedPlaces(message = {}) {
  const now = Date.now();
  const bounds = sanitizeBounds(message.bounds);
  const cz = Number(message.cluster?.zoom);
  const cell = Number(message.cluster?.cellPx);
  const cluster = bounds && Number.isFinite(cz) && cz >= 0 && cz <= 22 && cell >= 16 && cell <= 512;
  const within = (lat, lng) => bounds ? inBounds(bounds, lat, lng) : Number.isFinite(lat) && Number.isFinite(lng);
  const byId = new Map();
  for (const [placeId, e] of Object.entries(await readCache(FRIED_CACHE_KEY))) {
    if (!keptEntry(e, now) || !within(e.latitude, e.longitude)) continue;
    byId.set(placeId, { placeId, name: e.name || "", latitude: e.latitude, longitude: e.longitude,
      fried: true, probability: e.probability ?? null });
  }
  if (message.checked && bounds) {
    const cy = (bounds.south + bounds.north) / 2;
    const cx = (bounds.west + bounds.east) / 2;
    const k = Math.cos((cy * Math.PI) / 180);
    let grey = (await readChecked(bounds, now)).filter(([id]) => !byId.has(id));
    if (!cluster) {
      grey = grey.map(([id, e]) => [id, e, (e.a - cy) ** 2 + ((e.o - cx) * k) ** 2])
        .sort((a, b) => a[2] - b[2])
        .slice(0, Math.max(0, Math.min(2000, Number(message.checkedMax) || 600)));
    }
    for (const [placeId, e] of grey) {
      byId.set(placeId, { placeId, name: e.n || "", latitude: e.a, longitude: e.o,
        fried: false, probability: null, checked: true });
    }
  }
  if (Array.isArray(message.exclude)) {
    for (const id of message.exclude.slice(0, 500)) byId.delete(id);
  }
  if (cluster) return { success: true, ...clusterPlaces([...byId.values()], cz, cell) };
  return { success: true, places: [...byId.values()] };
}

const ROUTE_READ_ACTIONS = new Set([
  "getActiveTheme", "setActiveRoute", "checkPlaceStatus", "getRouteWaypoints", "getRoutes"
]);

// Runtime Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      // Only route messages read the lists (one API request each).
      let routes, activeId, activeRoute;
      if (ROUTE_READ_ACTIONS.has(message.action)) {
        ({ routes, activeId, activeRoute } = await getOrInitColorRoutes());
      }

      // Popup: fresh lists for rendering / its edits (whole-list replace).
      if (message.action === "getRoutes") {
        sendResponse({ success: true, routes, activeRouteId: activeId });
        return;
      }
      if (message.action === "saveRoutes") {
        const out = await mutateRoutes((fresh) => {
          for (const key of Object.keys(COLOR_ROUTES_DEF)) {
            const next = message.routes?.[key];
            if (!next) continue;
            fresh[key].name = next.name || fresh[key].name;
            fresh[key].origin = next.origin || fresh[key].origin;
            fresh[key].waypoints = Array.isArray(next.waypoints) ? next.waypoints : [];
          }
        });
        sendResponse({ success: true, routes: out.routes });
        return;
      }

      // 1. Get current active theme
      if (message.action === "getActiveTheme") {
        sendResponse({
          success: true,
          activeRouteId: activeId,
          theme: activeRoute,
          routes
        });
        return;
      }

      // 2. Set active color route
      if (message.action === "setActiveRoute") {
        const newRouteId = message.routeId;
        if (routes[newRouteId]) {
          await chrome.storage.local.set({ gce_active_route_id: newRouteId });
          await updateBadge({ routes, activeId: newRouteId });
          await broadcastThemeChange(routes[newRouteId]);
          sendResponse({ success: true, activeRoute: routes[newRouteId] });
        } else {
          sendResponse({ success: false, error: "Invalid route ID" });
        }
        return;
      }

function getHaversineDistKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPlaceMatch(w, q) {
  if (!w || !q) return false;

  const wName = (w.name || "").trim().toLowerCase();
  const qName = (q.name || "").trim().toLowerCase();

  // Reject generic or placeholder names
  if (!qName || qName === "selected location" || qName.length < 2) return false;
  if (!wName || wName === "selected location" || wName.length < 2) return false;

  // 1. CID / Place ID Match: ONLY valid when names are consistent
  const wPid = w.placeId || w.id || "";
  const qPid = q.placeId || q.id || "";
  if (wPid && qPid && wPid === qPid && !wPid.startsWith("custom_")) {
    const consistent = wName === qName || wName.includes(qName) || qName.includes(wName);
    if (consistent) return true;
  }

  // 2. Exact Name Match
  if (wName === qName) return true;

  // 3. English Name Match
  const wEn = (w.nameEn || "").trim().toLowerCase();
  const qEn = (q.nameEn || "").trim().toLowerCase();
  if (wEn && (wEn === qName || wEn === qEn)) return true;
  if (qEn && (qEn === wName || qEn === wEn)) return true;

  // 4. Substring Name Match with Address or Coordinate corroboration
  const wAddr = (w.address || "").trim().toLowerCase();
  const qAddr = (q.address || "").trim().toLowerCase();
  const nameSub = wName.includes(qName) || qName.includes(wName);

  if (nameSub) {
    if (wAddr && qAddr && (wAddr.includes(qAddr) || qAddr.includes(wAddr))) {
      return true;
    }
    if (w.latitude && q.latitude && w.longitude && q.longitude) {
      const d = getHaversineDistKm(parseFloat(w.latitude), parseFloat(w.longitude), parseFloat(q.latitude), parseFloat(q.longitude));
      if (d < 0.25) return true;
    }
  }

  return false;
}

      // 3. Check place status across ALL 5 color routes
      if (message.action === "checkPlaceStatus") {
        const queryPlace = {
          placeId: message.placeId,
          name: message.name,
          nameEn: message.nameEn,
          address: message.address,
          latitude: message.latitude,
          longitude: message.longitude
        };

        let foundInRoute = null;

        // Check active route first
        if (activeRoute && Array.isArray(activeRoute.waypoints)) {
          if (activeRoute.waypoints.some(w => isPlaceMatch(w, queryPlace))) {
            foundInRoute = activeRoute;
          }
        }

        // Check remaining routes if not in active route
        if (!foundInRoute) {
          for (const key of Object.keys(routes)) {
            if (key === activeId) continue;
            const r = routes[key];
            if (r && Array.isArray(r.waypoints) && r.waypoints.some(w => isPlaceMatch(w, queryPlace))) {
              foundInRoute = r;
              break;
            }
          }
        }

        if (foundInRoute) {
          const matchIdx = foundInRoute.waypoints.findIndex(w => isPlaceMatch(w, queryPlace));
          sendResponse({
            inRoute: true,
            belongRouteId: foundInRoute.id,
            belongRouteName: foundInRoute.name,
            belongTheme: foundInRoute,
            stopIndex: matchIdx,
            stopNumber: matchIdx >= 0 ? matchIdx + 1 : null,
            waypoints: foundInRoute.waypoints,
            activeRouteId: activeId,
            activeTheme: activeRoute
          });
        } else {
          sendResponse({
            inRoute: false,
            activeRouteId: activeId,
            activeTheme: activeRoute
          });
        }
        return;
      }

      // 4. Add waypoint into active color route
      if (message.action === "addWaypoint") {
        const wp = message.waypoint;
        if (!wp || !wp.name) {
          sendResponse({ success: false, error: "缺少有效的地点信息" });
          return;
        }

        let reply = null;
        const out = await mutateRoutes((routes, activeId, activeRoute) => {
          if (!Array.isArray(activeRoute.waypoints)) activeRoute.waypoints = [];

          // Already in the active route
          if (activeRoute.waypoints.some(w => isPlaceMatch(w, wp))) {
            reply = { success: false, alreadyExists: true, theme: activeRoute, belongTheme: activeRoute };
            return false;
          }

          // Already in another route
          for (const key of Object.keys(routes)) {
            if (key === activeId) continue;
            const r = routes[key];
            if (r && Array.isArray(r.waypoints) && r.waypoints.some(w => isPlaceMatch(w, wp))) {
              reply = { success: false, alreadyExistsInOther: true, belongRouteName: r.name, belongTheme: r };
              return false;
            }
          }

          activeRoute.waypoints.push(wp);
        });

        sendResponse(reply || {
          success: true,
          count: out.activeRoute.waypoints.length,
          theme: out.activeRoute
        });
        return;
      }

      // 5. Update badge
      if (message.action === "updateBadge") {
        await updateBadge();
        sendResponse({ success: true });
        return;
      }

      // 6. Clear active route waypoints
      if (message.action === "clearActiveRoute") {
        await mutateRoutes((routes, activeId, activeRoute) => { activeRoute.waypoints = []; });
        sendResponse({ success: true });
        return;
      }

      // 7. Update waypoints (reorder, delete, lock, sort)
      if (message.action === "updateRouteWaypoints") {
        await mutateRoutes((routes, activeId, activeRoute) => {
          activeRoute.waypoints = Array.isArray(message.waypoints) ? message.waypoints : [];
        });
        sendResponse({ success: true });
        return;
      }

      // 8. Smooth pan Google Maps to waypoint without reloading page
      if (message.action === "panToWaypoint") {
        const result = await handlePanToWaypoint(message.waypoint);
        sendResponse(result);
        return;
      }

      // 8b. Inject the MAIN-world map hook into a tab that was open before
      // the extension loaded (the hook itself is idempotent).
      if (message.action === "injectMapHook") {
        const tabId = sender?.tab?.id;
        if (tabId) {
          try {
            await injectMapHook(tabId);
            sendResponse({ success: true });
          } catch (err) {
            sendResponse({ success: false, error: err.message });
          }
        } else {
          sendResponse({ success: false, error: "no tab" });
        }
        return;
      }

      // 10. 探索: fried-food judgement / cancel
      if (message.action === "exploreClassifyFried") {
        sendResponse(await handleExploreClassifyFried(message));
        return;
      }
      if (message.action === "getMatchedPlaces") {
        sendResponse(await handleGetMatchedPlaces(message));
        return;
      }
      if (message.action === "getCheckedPlaceIds") {
        sendResponse(await handleGetCheckedPlaceIds(message));
        return;
      }
      if (message.action === "getPlaceTags") {
        sendResponse(await handleGetPlaceTags(message));
        return;
      }
      if (message.action === "exploreCancel") {
        if (message.sessionId) _cancelledSessions.add(message.sessionId);
        sendResponse({ success: true });
        return;
      }

      // 11. Get current active route waypoints for pins overlay
      if (message.action === "getRouteWaypoints") {
        sendResponse({
          success: true,
          activeRouteId: activeId,
          activeTheme: activeRoute,
          waypoints: activeRoute?.waypoints || []
        });
        return;
      }

      // 13. Update waypoint coordinates if more accurate ones are found
      if (message.action === "updateWaypointCoordinates") {
        const { name, latitude, longitude } = message;
        if (!name || typeof latitude !== "number" || typeof longitude !== "number") {
          sendResponse({ success: false });
          return;
        }
        const out = await mutateRoutes((routes) => {
          let updated = false;
          for (const key of Object.keys(routes)) {
            const r = routes[key];
            if (!Array.isArray(r.waypoints)) continue;
            for (const wp of r.waypoints) {
              if (wp.name === name || isPlaceMatch(wp, { name })) {
                if (wp.latitude !== latitude || wp.longitude !== longitude) updated = true;
                wp.latitude = latitude;
                wp.longitude = longitude;
              }
            }
          }
          return updated;
        });
        sendResponse({ success: out.saved });
        return;
      }

      // 14. Fetch newly opened restaurants (DineSafe, authenticated)
      if (message.action === "getNewlyOpenedRestaurants") {
        const token = (await chrome.storage.local.get("authToken")).authToken || "";
        if (!token) {
          sendResponse({ success: false, unauthorized: true, error: "未登录或登录已过期，请在扩展弹窗中登录 Green Oil 账号" });
          return;
        }
        const period = message.period || "week";
        const res = await GreenOilApi.getNewlyOpenedRestaurants(token, period, message.options);
        if (res.unauthorized) {
          sendResponse({ success: false, unauthorized: true, error: "登录态已过期，请在扩展弹窗中重新登录" });
          return;
        }
        if (res.success && Array.isArray(res.data)) {
          await chrome.storage.local.set({
            gce_new_restaurants_cache: res.data,
            gce_new_restaurants_period: period,
            gce_new_restaurants_updated: Date.now()
          });
        }
        sendResponse(res);
        return;
      }

      // 15. Get cached newly opened restaurants for map pin rendering (requires authentication and 24h expiry check)
      if (message.action === "getCachedNewRestaurants") {
        const stored = await chrome.storage.local.get([
          "authToken",
          "gce_new_restaurants_cache",
          "gce_show_new_restaurants",
          "gce_new_restaurants_period",
          "gce_new_restaurants_updated"
        ]);
        if (!stored.authToken) {
          sendResponse({
            success: true,
            restaurants: [],
            showOnMap: false,
            period: "week",
            unauthorized: true
          });
          return;
        }
        const CACHE_TTL_24H = 24 * 60 * 60 * 1000;
        const isNotExpired = typeof stored.gce_new_restaurants_updated === "number" &&
          (Date.now() - stored.gce_new_restaurants_updated < CACHE_TTL_24H);

        sendResponse({
          success: true,
          restaurants: isNotExpired ? (stored.gce_new_restaurants_cache || []) : [],
          showOnMap: stored.gce_show_new_restaurants !== false,
          period: stored.gce_new_restaurants_period || "week",
          expired: !isNotExpired
        });
        return;
      }

      // 16. Get current authentication status
      if (message.action === "getAuthStatus") {
        const { authToken, authUser } = await chrome.storage.local.get(["authToken", "authUser"]);
        sendResponse({
          success: true,
          isLoggedIn: Boolean(authToken),
          authUser: authUser || ""
        });
        return;
      }

      sendResponse({ success: false, error: "未知操作" });
    } catch (err) {
      if (!err.unauthorized) console.error("Runtime message handler error:", err);
      sendResponse({ success: false, error: err.message, unauthorized: Boolean(err.unauthorized) });
    }
  })();

  return true;
});
