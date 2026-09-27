/**
 * Green Oil Chrome Extension - Background Service Worker (ES module)
 * Manages 5-color route palette persistence, dynamic badge color, Google Maps
 * theme synchronization, and the 探索 MIS / jev pipeline.
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
// MIS System Integration & Silent Nearby Match
// ==========================================

let _cachedMisAuth = { loggedIn: false, checkedAt: 0 };
let _lastMisRequestTime = 0;

/**
 * Throttle all requests to MIS system to strictly 1 request per second (1000ms delay)
 * Protects the company MIS internal server from sudden traffic bursts.
 */
async function rateLimitMisRequest() {
  const now = Date.now();
  const elapsed = now - _lastMisRequestTime;
  if (elapsed < 1000) {
    const waitMs = 1000 - elapsed;
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  _lastMisRequestTime = Date.now();
}

// ---- Local result caches (chrome.storage.local) ----
// Positive results ("matched" places): an MIS customer matched to a
// Google place, and places jev judged to serve fried food. Negative
// results live in the checked-place cache below.
// Every result is reused for CACHE_FRESH_MS of its kind — MIS 1 day (new
// customers are signed often), jev fried verdict 7 days (menus change
// slowly): within it a click skips the place / answers from the cache.
// After that the place is queried again on the next click, but its pin
// (and name tag) keeps showing the last known result until CACHE_KEEP_MS.
// MIS customer records are company data: only read while the MIS login is
// valid, wiped as soon as a logout is detected (see checkMisAuth).
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_FRESH_MS = { m: DAY_MS, f: 7 * DAY_MS };     // reused without a new query
const CACHE_KEEP_MS = 30 * DAY_MS;                        // still drawn on the map
const MIS_CACHE_KEY = "gce_mis_match_cache";              // {placeId: {t, customer}}
const LEGACY_MIS_CACHE_KEY = "gce_mis_cache";             // old per-keyword cache
const FRIED_CACHE_KEY = "gce_fried_cache";                // {placeId: {t}}
const MIS_CACHE_MAX = 3000;
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

async function clearMisCache() {
  await chrome.storage.local.remove([MIS_CACHE_KEY, LEGACY_MIS_CACHE_KEY]);
}

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
// Places checked with a negative result: jev found no fried food (f), or
// MIS has no customer for them / JEV rejected every candidate (m). While
// fresh (CACHE_FRESH_MS[kind]) a click on 探索 / 匹配MIS skips them, so each click
// takes the nearest unchecked places in the window; grey pins stay until
// CACHE_KEEP_MS. Errors are never recorded (retried next click);
// Shift+click re-checks everything. Stored per map tile (~7 km, zoom 12):
// a lookup or write touches only the tiles around the map window, never
// one ever-growing blob. The index lists the tiles and caps the total.
const SEEN_TILE_ZOOM = 12;
const SEEN_KEY_PREFIX = "gce_seen:";                      // gce_seen:<x>:<y> -> {placeId: {n, a, o, f?, m?}}
const SEEN_INDEX_KEY = "gce_seen_tiles";                  // {tileKey: {t, c}}
const SEEN_TILE_MAX = 2000;
const SEEN_TOTAL_MAX = 40000;
const SEEN_KIND = { fried: "f", mis: "m" };
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
    const m = keptSeen(e, "m", now) ? e.m : 0;
    if (!f && !m) continue;
    const out = { n: e.n, a: e.a, o: e.o };
    if (f) out.f = f;
    if (m) out.m = m;
    kept.push([id, out, Math.max(f, m)]);
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
      if ((keptSeen(e, "f", now) || keptSeen(e, "m", now)) && inBounds(bounds, e.a, e.o)) out.push([id, e]);
    }
  }
  return out;
}

/**
 * Place ids inside the bounds that `kind` (fried | mis) already has a
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
  if (kind === "f") {
    for (const [id, e] of Object.entries(await readCache(FRIED_CACHE_KEY))) {
      if (freshEntry(e, "f", now) && inBounds(bounds, e.latitude, e.longitude)) ids.add(id);
    }
  } else if ((await checkMisAuth(true)).loggedIn) {
    for (const [id, e] of Object.entries(await readCache(MIS_CACHE_KEY))) {
      const c = freshEntry(e, "m", now)?.jevVerified === true ? e.customer : null;
      if (c && inBounds(bounds, c.latitude, c.longitude)) ids.add(id);
    }
  }
  return { success: true, ids: [...ids] };
}

/**
 * Check if the user is authenticated in the MIS system
 */
async function checkMisAuth(force = false) {
  const now = Date.now();
  if (!force && (now - _cachedMisAuth.checkedAt < 5000)) {
    return _cachedMisAuth;
  }

  try {
    const cookies = await chrome.cookies.getAll({ domain: "mis.greenoilinc.com" }).catch(() => []);
    const logcheckCookie = cookies.find(c => c.name === "LOGCHECK");
    const phpsessidCookie = cookies.find(c => c.name === "PHPSESSID");

    const isAuthed = Boolean(logcheckCookie && logcheckCookie.value === "1");

    _cachedMisAuth = {
      loggedIn: isAuthed,
      checkedAt: now,
      logcheck: logcheckCookie?.value || "",
      hasPhpsessid: Boolean(phpsessidCookie?.value)
    };
    // Logged out (incl. session cookies gone after a browser restart):
    // cached customer data must not outlive the MIS session.
    if (!isAuthed) await clearMisCache().catch(() => {});
    return _cachedMisAuth;
  } catch (err) {
    console.warn("[GreenOil MIS] checkMisAuth error:", err);
    _cachedMisAuth = { loggedIn: false, checkedAt: now, error: err.message };
    return _cachedMisAuth;
  }
}

// Real-time cookie listener: Broadcast auth state changes to all Maps tabs
chrome.cookies.onChanged.addListener((changeInfo) => {
  const dom = changeInfo.cookie?.domain || "";
  if (dom.includes("greenoilinc.com")) {
    _cachedMisAuth = { loggedIn: false, checkedAt: 0 };
    checkMisAuth(true).then((auth) => {
      chrome.tabs.query({ url: ["https://*.google.com/maps/*", "https://*.google.ca/maps/*"] }, (tabs) => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: "misAuthChanged", auth }).catch(() => {}));
      });
    }).catch(() => {});
  }
});

// ---- 探索: per-place MIS matching ----
// The page (google-places.js) finds every restaurant in the map window and
// asks, place by place, whether it is an MIS customer. A place with a house
// number is looked up by "number + street"; otherwise by its English name.
// The MIS hits are then tied to THIS place: same unit number, or a name
// match, or the only customer at a single-tenant address.

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

const STREET_SUFFIX_RE = /^(ave|avenue|st|street|rd|road|blvd|boulevard|dr|drive|cres|crescent|ct|crt|court|pl|place|ln|lane|pkwy|parkway|hwy|highway|way|terr|terrace|sq|square|cir|circle|e|w|n|s|east|west|north|south)\.?$/i;

/**
 * "3601 Victoria Park Ave" -> "3601 Victoria Park": MIS may write the same
 * street as "Ave", "Avenue" or "AVE.", so the keyword stops before the
 * street type / direction (the house number is checked on the results).
 */
function addressKeyword(streetPrefix) {
  const tokens = String(streetPrefix || "").trim().split(/\s+/);
  while (tokens.length > 2 && STREET_SUFFIX_RE.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

function houseNumberOf(address) {
  const m = String(address || "").replace(/^(?:unit|ste|suite|#)\s*[\w-]+\s*[-–]\s*/i, "").trim().match(/^(\d+[a-z]?)\b/i);
  return m ? m[1].toLowerCase() : "";
}

/** How to look this place up in MIS: {kind, keyword} or null. */
function misQueryFor(place) {
  if (place.streetPrefix && /^\d/.test(place.streetPrefix)) {
    return { kind: "address", keyword: addressKeyword(place.streetPrefix) };
  }
  if (place.englishName && place.englishName.trim().length >= 3) {
    return { kind: "name", keyword: place.englishName.trim() };
  }
  return null;
}

const NAME_MATCH_MAX_HITS = 3;

function normalizeStreetKey(street) {
  return String(street || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|crescent|cres|court|ct|place|pl|lane|ln|parkway|pkwy|highway|hwy|way|terrace|square|sq|east|west|north|south|e|w|n|s)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Narrow a name search's MIS hits to the place's own street. */
function filterNameHits(records, place) {
  const streetKey = normalizeStreetKey(place.street);
  if (streetKey) {
    return records.filter(r => normalizeStreetKey(r.address).includes(streetKey));
  }
  return records.length <= NAME_MATCH_MAX_HITS ? records : [];
}

const NAME_STOPWORDS = new Set(["the", "and", "of", "restaurant", "restaurants", "inc", "ltd", "limited", "co", "corp", "corporation", "company", "cuisine", "kitchen", "food", "foods"]);

function nameTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9一-鿿]+/)
    .filter(t => t.length >= 2 && !NAME_STOPWORDS.has(t));
}

/** Overlap coefficient of the two names' significant words (0..1). */
function nameScore(a, b) {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / Math.min(A.size, B.size);
}

/** "3601 Victoria Park Ave #121" / "Unit 121" / "Suite K" -> "121" / "k" */
function unitOf(address) {
  const m = String(address || "").split(",")[0].match(/(?:#|\b(?:unit|uinit|ste|suite)\s*#?)\s*([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : "";
}

const MIS_CANDIDATE_MAX = 255;

/**
 * All plausible MIS rows for this Google place, deduplicated by customer
 * code and ranked so the strongest local signals appear first. JEV makes
 * the final decision; these rules only keep unrelated addresses out.
 */
function misCandidatesForPlace(records, place, kind) {
  const input = Array.isArray(records) ? records : records ? [records] : [];
  let pool = input.filter(r => r && r.code);
  if (kind === "name") pool = filterNameHits(pool, place);
  if (kind === "address") {
    const number = houseNumberOf(place.streetPrefix || place.displayName);
    pool = pool.filter(r => houseNumberOf(r.address) === number);
  }

  const byCode = new Map();
  for (const record of pool) {
    const key = String(record.code).trim().toUpperCase();
    if (!key) continue;
    const previous = byCode.get(key);
    if (!previous || (previous.sts !== "A" && record.sts === "A")) byCode.set(key, record);
  }

  const placeUnit = unitOf(place.displayName);
  return [...byCode.values()]
    .map(r => ({
      r,
      unit: Boolean(placeUnit) && unitOf(r.address) === placeUnit,
      name: Math.max(nameScore(r.name, place.englishName), nameScore(r.name, place.name))
    }))
    .sort((a, b) => (b.unit - a.unit) || (b.name - a.name) ||
      ((b.r.sts === "A") - (a.r.sts === "A")))
    .slice(0, MIS_CANDIDATE_MAX)
    .map(x => x.r);
}

/** The MIS customer that is this Google place, or null. */
function pickMisRecordForPlace(records, place, kind) {
  const pool = misCandidatesForPlace(records, place, kind);
  if (!pool.length) return null;
  const placeUnit = unitOf(place.displayName);
  const scored = pool.map(r => ({
    r,
    unit: Boolean(placeUnit) && unitOf(r.address) === placeUnit,
    name: Math.max(nameScore(r.name, place.englishName), nameScore(r.name, place.name))
  }));
  scored.sort((a, b) => (b.unit - a.unit) || (b.name - a.name) ||
    ((b.r.sts === "A") - (a.r.sts === "A")));
  const best = scored[0];
  if (best.unit || best.name >= 0.5) return best.r;
  // Single customer at an address without units (standalone building).
  if (kind === "address" && pool.length === 1 && !placeUnit && !unitOf(best.r.address)) return best.r;
  return null;
}

/**
 * Parse MIS Customer List HTML into structured records
 */
function parseMisCustomerHtml(html) {
  const customers = [];
  if (!html) return customers;

  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    if (!tr.includes("customer-info-detail")) continue;
    const tdMatches = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (tdMatches.length < 10) continue;

    const rawTds = tdMatches.map(td => td.replace(/^<td[^>]*>/i, "").replace(/<\/td>$/i, "").trim());
    const cleanTds = rawTds.map(td => td.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#10067;/g, "").replace(/\s+/g, " ").trim());

    // Extract bold customer name
    const nameMatch = rawTds[1].match(/<b[^>]*class=['"]customer-info-detail['"][^>]*>([\s\S]*?)<\/b>/i);
    const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, "").trim() : cleanTds[1];

    // Extract container chip info
    let containerRaw = rawTds[7] || "";
    let containerText = cleanTds[7] || "";

    customers.push({
      no: cleanTds[0] || "",
      name: name,
      code: cleanTds[2] || "",
      address: cleanTds[3] || "",
      city: cleanTds[4] || "",
      payment: cleanTds[5] || "",
      rate: cleanTds[6] || "",
      container: containerText,
      containerRaw: containerRaw,
      driver: cleanTds[8] || "",
      phone: cleanTds[9] || "",
      sts: cleanTds[10] || "A",
      contract: cleanTds[11] || "",
      inactive: cleanTds[12] || ""
    });
  }
  return customers;
}

// An expired session is answered with the login form (HTTP 200), which
// would otherwise parse as "no customers". A real customer list page can
// also contain a password field (e.g. a change-password dialog), so only a
// page WITHOUT the customer list / search form counts as the login page.
function isMisLoginPage(url, html) {
  if (/login/i.test(String(url || ""))) return true;
  const h = String(html || "");
  const isListPage = /customer-info-detail|customer_list|name=["']?key_word/i.test(h);
  return !isListPage && /<input[^>]+type=["']?password/i.test(h);
}

/**
 * Query MIS for a single prefix keyword
 */
// Returns the parsed records, or null when the query failed (network error,
// HTTP error, or MIS answered with its login page). null is never cached.
async function queryMisPrefix(prefix, phpsessid) {
  if (!prefix || prefix.trim().length < 2) return [];
  try {
    const url = `https://mis.greenoilinc.com/index_intranet.php?view=customer_list&switched=&page=1&column=&sorting_type=&switch=&key_word=${encodeURIComponent(prefix.trim())}&cstatus=T&cistop=T`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      method: "GET",
      credentials: "include"
    });

    if (!resp.ok) return null;
    const html = await resp.text();
    if (isMisLoginPage(resp.url, html)) return null;
    return parseMisCustomerHtml(html);
  } catch (e) {
    console.warn(`[GreenOil MIS] queryMisPrefix failed for "${prefix}":`, e);
    return null;
  }
}

// ---- 探索 sessions & queues ----
// MIS: one serial queue, strictly 1 request per second (rateLimitMisRequest).
// A keyword's MIS answer is memoized in memory for the session (several
// places can share an address); only matches reach chrome.storage.
let _misChain = Promise.resolve();
const _cancelledSessions = new Set();
const _misKeywordMemo = new Map(); // keyword -> {t, records}
const MIS_MEMO_TTL_MS = 10 * 60 * 1000;

function enqueueMis(job) {
  const run = _misChain.then(job);
  _misChain = run.catch(() => {});
  return run;
}

async function misRecordsFor(query, phpsessid) {
  const key = `${query.kind}:${query.keyword.toLowerCase()}`;
  const memo = _misKeywordMemo.get(key);
  if (memo && Date.now() - memo.t < MIS_MEMO_TTL_MS) return memo.records;
  await rateLimitMisRequest();
  const records = await queryMisPrefix(query.keyword, phpsessid);
  if (records) _misKeywordMemo.set(key, { t: Date.now(), records });
  return records;
}

/**
 * Find an MIS candidate for this Google place. A fresh MIS candidate is not
 * persisted until JEV confirms that it is still the business currently shown
 * by Google Maps (the address may now have a different restaurant tenant).
 */
async function handleExploreMatchMis(message) {
  const place = sanitizeExplorePlace(message.place);
  if (!place) return { success: false, error: "bad place" };
  const auth = await checkMisAuth(true);
  if (!auth.loggedIn) return { success: false, notLoggedIn: true };

  if (!message.forceRefresh) {
    const hit = freshEntry((await readCache(MIS_CACHE_KEY))[place.placeId], "m", Date.now());
    if (hit?.jevVerified === true) {
      return { success: true, customer: hit.customer, cached: true, verified: true,
        probability: hit.jevProbability ?? null };
    }
    // Entries created by an older extension version still need the new JEV
    // tenant check before they can be trusted or shown again.
    if (hit?.customer) {
      return { success: true, candidate: hit.customer, cached: true, needsValidation: true };
    }
  }
  const query = misQueryFor(place);
  if (!query) {
    await removeCacheEntry(MIS_CACHE_KEY, place.placeId);
    await setChecked(place, "m", true);
    return { success: true, customer: null, diag: { reason: "无地址门牌号也无英文店名" } };
  }

  return enqueueMis(async () => {
    if (_cancelledSessions.has(message.sessionId)) return { success: false, cancelled: true };
    const phpsessid = (await chrome.cookies.get({ url: "https://mis.greenoilinc.com", name: "PHPSESSID" }))?.value || "";
    const result = await misRecordsFor(query, phpsessid);
    const records = Array.isArray(result) ? result : result ? [result] : result;
    const diag = { kind: query.kind, keyword: query.keyword, records: records ? records.length : null };
    if (!records) return { success: false, error: "MIS 查询失败", diag: { ...diag, reason: "请求失败或被判定为登录页" } };
    const candidates = misCandidatesForPlace(records, place, query.kind);
    if (!candidates.length) {
      await removeCacheEntry(MIS_CACHE_KEY, place.placeId);
      await setChecked(place, "m", true);
      const reason = records.length
        ? `MIS 有 ${records.length} 条记录但对应不上这家店（${records.slice(0, 3).map(r => `${r.name} / ${r.address}`).join("；")}）`
        : "MIS 无记录";
      return { success: true, customer: null, diag: { ...diag, reason } };
    }
    const customers = candidates.map(rec => ({
      ...rec,
      latitude: place.latitude,
      longitude: place.longitude,
      placeId: place.placeId,
      matchedBy: query.kind,
      matchedPrefix: query.keyword,
      matchedCandidateName: place.name
    }));
    const reason = customers.length === 1
      ? `MIS 候选 ${customers[0].name} (${customers[0].code})，等待 JEV 是否校验`
      : `MIS 返回 ${customers.length} 个候选，等待 JEV 单选校验`;
    return {
      success: true,
      candidate: customers.length === 1 ? customers[0] : undefined,
      candidates: customers,
      needsValidation: true,
      diag: { ...diag, candidates: customers.length, reason }
    };
  });
}

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
const MIS_MATCH_THRESHOLD = 0.65;
const MIS_CHOICE_CONFIDENCE_THRESHOLD = 0.65;
const MIS_CHOICE_MARGIN = 0.15;
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

/** Ask JEV whether the MIS row is the current tenant shown by Google Maps. */
function misMatchRequest(place, customer) {
  return {
    model: JEV_API.model,
    state: {
      google_place: {
        name: place.name,
        english_name: place.englishName,
        address: place.displayName,
        categories: place.categories,
        description: place.description,
        owner_description: place.ownerDescription,
        review_snippets: place.reviews
      },
      mis_customer: {
        name: customer.name,
        address: customer.address,
        city: customer.city,
        status: customer.sts
      }
    },
    questions: {
      same_business: {
        type: "noul",
        instructions:
          "Is the MIS customer record the same restaurant business that is currently shown in the Google Maps place? " +
          "A matching street address alone is not sufficient because the restaurant tenant may have changed. " +
          "Use the business names, unit/address, cuisine/categories, descriptions and recent review snippets. " +
          "Return false when the MIS record is likely a previous tenant or a different business at the same address.",
        criteria: {
          true: "The evidence indicates the MIS customer and current Google Maps restaurant are the same operating business.",
          false: "The evidence indicates a different/currently replaced restaurant, or is too conflicting to identify them as the same business."
        }
      }
    }
  };
}

/** Ask JEV to choose one MIS row, or explicitly choose none of them. */
function misChoiceRequest(place, customers) {
  const keyed = customers.map((customer, index) => ({
    key: `candidate_${index + 1}`,
    customer
  }));
  const criteria = Object.fromEntries(keyed.map(({ key, customer }) => [key,
    `This is the current Google Maps restaurant: MIS code ${customer.code}, name ${customer.name}, ` +
    `address ${customer.address}${customer.city ? `, ${customer.city}` : ""}, status ${customer.sts || "unknown"}.`
  ]));
  criteria.none_of_above =
    "None of the MIS records is the restaurant currently shown by Google Maps; they may be previous tenants or different units/businesses.";

  return {
    body: {
      model: JEV_API.model,
      state: {
        google_place: {
          name: place.name,
          english_name: place.englishName,
          address: place.displayName,
          categories: place.categories,
          description: place.description,
          owner_description: place.ownerDescription,
          review_snippets: place.reviews
        },
        mis_candidates: keyed.map(({ key, customer }) => ({
          key, code: customer.code, name: customer.name, address: customer.address,
          city: customer.city, status: customer.sts
        }))
      },
      questions: {
        same_business: {
          type: "choice",
          instructions:
            "Choose the one MIS customer record that represents the restaurant currently shown by Google Maps. " +
            "A matching street address alone is not sufficient because restaurant tenants and units may differ or change. " +
            "Use the business name, unit/address, cuisine/categories, descriptions and recent review snippets. " +
            "Choose none_of_above when no candidate is clearly the same current business.",
          criteria
        }
      }
    },
    keyed
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

function choiceAnswer(data, key) {
  const answer = data && data.answers && data.answers[key];
  if (!answer || typeof answer.choice !== "string" ||
    !answer.probabilities || typeof answer.probabilities !== "object") return null;
  const confidence = Number(answer.confidence);
  const probabilities = Object.fromEntries(Object.entries(answer.probabilities)
    .filter(([, value]) => typeof value === "number" && value >= 0 && value <= 1));
  return {
    choice: answer.choice,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    probabilities
  };
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

function sanitizeMisCandidate(c) {
  if (!c || typeof c.code !== "string" || typeof c.name !== "string") return null;
  const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    no: str(c.no, 40), name: str(c.name), code: str(c.code, 80),
    address: str(c.address, 300), city: str(c.city, 120), payment: str(c.payment, 80),
    rate: str(c.rate, 80), container: str(c.container, 200), containerRaw: str(c.containerRaw, 1000),
    driver: str(c.driver, 120), phone: str(c.phone, 80), sts: str(c.sts, 20),
    contract: str(c.contract, 120), inactive: str(c.inactive, 120),
    matchedBy: str(c.matchedBy, 20), matchedPrefix: str(c.matchedPrefix),
    matchedCandidateName: str(c.matchedCandidateName), placeId: str(c.placeId, 80),
    latitude: Number.isFinite(c.latitude) ? c.latitude : null,
    longitude: Number.isFinite(c.longitude) ? c.longitude : null
  };
}

/** JEV tenant check: one candidate uses noul; multiple use a single choice. */
async function handleExploreValidateMis(message) {
  const place = sanitizeExplorePlace(message.place);
  const rawCandidates = Array.isArray(message.customers) ? message.customers :
    message.customer ? [message.customer] : [];
  const byCode = new Map();
  for (const raw of rawCandidates) {
    const candidate = sanitizeMisCandidate(raw);
    if (!candidate || candidate.placeId !== place?.placeId) continue;
    const key = candidate.code.trim().toUpperCase();
    if (key && !byCode.has(key)) byCode.set(key, candidate);
  }
  const customers = [...byCode.values()].slice(0, MIS_CANDIDATE_MAX);
  if (!place || !customers.length) {
    return { success: false, error: "bad MIS validation input" };
  }
  if (!(await checkMisAuth(true)).loggedIn) return { success: false, notLoggedIn: true };

  const run = _jevChain.then(async () => {
    if (_cancelledSessions.has(message.sessionId)) return { success: false, cancelled: true };
    try {
      let customer = null;
      let probability = null;
      let confidence = null;
      let margin = null;
      let ambiguous = false;
      let mode = "noul";
      let selection = null;

      if (customers.length === 1) {
        probability = answerProbability(await callJev(misMatchRequest(place, customers[0])), "same_business");
        if (probability === null) return { success: false, error: "JEV 是否判断返回格式无法识别" };
        if (probability >= MIS_MATCH_THRESHOLD) customer = customers[0];
      } else {
        mode = "choice";
        const { body, keyed } = misChoiceRequest(place, customers);
        const answer = choiceAnswer(await callJev(body), "same_business");
        if (!answer) return { success: false, error: "JEV 单选判断返回格式无法识别" };
        selection = answer.choice;
        confidence = answer.confidence;
        probability = answer.probabilities[answer.choice] ?? 0;
        const alternatives = Object.entries(answer.probabilities)
          .filter(([key]) => key !== answer.choice)
          .map(([, value]) => value)
          .sort((a, b) => b - a);
        margin = probability - (alternatives[0] ?? 0);
        const selected = keyed.find(x => x.key === answer.choice)?.customer || null;
        const certain = probability >= MIS_MATCH_THRESHOLD &&
          confidence >= MIS_CHOICE_CONFIDENCE_THRESHOLD && margin >= MIS_CHOICE_MARGIN;
        if (selected && certain) customer = selected;
        ambiguous = Boolean(selected) && !certain;
      }

      const matches = Boolean(customer);
      if (matches && (await checkMisAuth(true)).loggedIn) {
        await cachePositive(MIS_CACHE_KEY, place.placeId, {
          customer, jevVerified: true, jevProbability: probability,
          jevConfidence: confidence, jevMode: mode
        }, MIS_CACHE_MAX);
      } else if (!matches) {
        await removeCacheEntry(MIS_CACHE_KEY, place.placeId);
      }
      await setChecked(place, "m", !matches);
      return {
        success: true, matches, probability, confidence, margin, ambiguous, mode, selection,
        customer: matches ? customer : null
      };
    } catch (err) {
      return { success: false, disabled: Boolean(err.disabled), error: err.message };
    }
  });
  _jevChain = run.catch(() => {});
  return run;
}

/**
 * Tags for a place page (name badge): cached MIS match (login-gated) and
 * cached fried verdict. Same data as the 探索 pins, keyed by place id.
 */
async function handleGetPlaceTags(message) {
  const placeId = typeof message.placeId === "string" ? message.placeId.slice(0, 80) : "";
  if (!placeId) return { success: false };
  const now = Date.now();
  const fried = keptEntry((await readCache(FRIED_CACHE_KEY))[placeId], now);
  let customer = null;
  if ((await checkMisAuth(true)).loggedIn) {
    const hit = keptEntry((await readCache(MIS_CACHE_KEY))[placeId], now);
    customer = hit?.jevVerified === true ? hit.customer : null;
  }
  return { success: true, customer, fried: Boolean(fried), probability: fried?.probability ?? null };
}

/**
 * Grid clustering for a zoomed-out map: places sharing a `cellPx` square
 * of the world at `zoom` become one cluster {latitude, longitude (mean),
 * count, mis, fried, checked}; a place alone in its cell stays a place.
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
    const c = { latitude: 0, longitude: 0, count: list.length, mis: 0, fried: 0, checked: 0 };
    for (const p of list) {
      c.latitude += p.latitude / list.length;
      c.longitude += p.longitude / list.length;
      if (p.customer) c.mis++;
      else if (p.fried) c.fried++;
      else c.checked++;
    }
    clusters.push(c);
  }
  return { places: singles, clusters };
}

/**
 * Places for the resident map pins: MIS customers (only while logged in to
 * MIS) and fried places from the positive caches, then — with `checked` —
 * the grey checked places. With `bounds`, only places inside them (the
 * page loads the area around the map window, not the whole cache).
 * Without `cluster`, at most `checkedMax` grey places, nearest the center:
 * {places}. With `cluster` ({zoom, cellPx}, a zoomed-out map), every place
 * in the bounds, grid-clustered: {places (alone in their cell), clusters}.
 * `exclude`: place ids the page is drawing itself (a running 探索), left out
 * so they are not counted twice.
 * places: [{placeId, name, latitude, longitude, customer|null, fried, checked?}]
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
      customer: null, fried: true, probability: e.probability ?? null });
  }
  if ((await checkMisAuth(true)).loggedIn) {
    for (const [placeId, e] of Object.entries(await readCache(MIS_CACHE_KEY))) {
      const kept = keptEntry(e, now);
      const c = kept?.jevVerified === true ? kept.customer : null;
      if (!c || !within(c.latitude, c.longitude)) continue;
      const prev = byId.get(placeId);
      byId.set(placeId, { placeId, name: c.matchedCandidateName || c.name, latitude: c.latitude, longitude: c.longitude,
        customer: c, fried: Boolean(prev), probability: prev?.probability ?? null });
    }
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
        customer: null, fried: false, probability: null, checked: true });
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

      // 9. Check MIS authentication state
      if (message.action === "checkMisAuth") {
        const auth = await checkMisAuth(Boolean(message.force));
        sendResponse(auth);
        return;
      }

      // 10. 探索: per-place MIS match / fried-food judgement / cancel
      if (message.action === "exploreMatchMis") {
        sendResponse(await handleExploreMatchMis(message));
        return;
      }
      if (message.action === "exploreValidateMis") {
        sendResponse(await handleExploreValidateMis(message));
        return;
      }
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

      // 12. Helper to set or update MIS session cookie (e.g. for user convenience / testing)
      if (message.action === "setMisSessionCookie") {
        try {
          const sid = message.phpsessid || "91d9bd446f1c69d2a9285c50d1b1b927";
          await chrome.cookies.set({
            url: "https://mis.greenoilinc.com",
            name: "PHPSESSID",
            value: sid
          });
          await chrome.cookies.set({
            url: "https://mis.greenoilinc.com",
            name: "LOGCHECK",
            value: "1"
          });
          _cachedMisAuth = { loggedIn: false, checkedAt: 0 };
          const auth = await checkMisAuth(true);
          sendResponse({ success: true, auth });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
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

      sendResponse({ success: false, error: "未知操作" });
    } catch (err) {
      console.error("Runtime message handler error:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});
