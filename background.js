/**
 * Green Oil Chrome Extension - Background Service Worker
 * Manages 5-color route palette persistence, dynamic badge color, and Google Maps theme synchronization.
 * Completely standalone without ES module import dependencies for maximum stability.
 */

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

/**
 * Get or initialize the 5 color routes from storage
 */
async function getOrInitColorRoutes() {
  const data = await chrome.storage.local.get(["gce_color_routes", "gce_active_route_id"]);
  let routes = data.gce_color_routes;
  let activeId = data.gce_active_route_id;
  let needSave = false;

  if (!routes || typeof routes !== "object" || Object.keys(routes).length === 0) {
    routes = JSON.parse(JSON.stringify(COLOR_ROUTES_DEF));
    needSave = true;
  } else {
    // Ensure all 5 route keys exist
    for (const key of Object.keys(COLOR_ROUTES_DEF)) {
      if (!routes[key]) {
        routes[key] = JSON.parse(JSON.stringify(COLOR_ROUTES_DEF[key]));
        needSave = true;
      }
    }
  }

  if (!activeId || !routes[activeId]) {
    activeId = DEFAULT_ACTIVE_ROUTE_ID;
    needSave = true;
  }

  if (needSave) {
    await chrome.storage.local.set({
      gce_color_routes: routes,
      gce_active_route_id: activeId
    });
  }

  return { routes, activeId, activeRoute: routes[activeId] };
}

/**
 * Update the toolbar extension badge count and badge background color matching active route color
 */
async function updateBadge() {
  try {
    const { activeRoute } = await getOrInitColorRoutes();
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
    await getOrInitColorRoutes();
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
// Only positive results are cached ("matched" places): an MIS customer
// matched to a Google place, and places jev judged to serve fried food.
// Places without a match are re-checked on the next 探索.
// MIS customer records are company data: only read while the MIS login is
// valid, wiped as soon as a logout is detected (see checkMisAuth).
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;          // 30 days
const MIS_CACHE_KEY = "gce_mis_match_cache";              // {placeId: {t, customer}}
const LEGACY_MIS_CACHE_KEY = "gce_mis_cache";             // old per-keyword cache
const FRIED_CACHE_KEY = "gce_fried_cache";                // {placeId: {t}}
const MIS_CACHE_MAX = 3000;
const FRIED_CACHE_MAX = 5000;

async function readCache(key) {
  const data = await chrome.storage.local.get(key);
  return data[key] || {};
}

function freshEntry(entry, now) {
  return entry && now - entry.t < CACHE_TTL_MS ? entry : null;
}

/** Drop expired entries and keep the newest `max`. */
function pruneCache(map, max, now) {
  return Object.fromEntries(
    Object.entries(map)
      .filter(([, e]) => freshEntry(e, now))
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

/** How to look this place up in MIS: {kind, keyword} or null. */
function misQueryFor(place) {
  if (place.streetPrefix && /^\d/.test(place.streetPrefix)) {
    return { kind: "address", keyword: place.streetPrefix };
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

/** The MIS customer that is this Google place, or null. */
function pickMisRecordForPlace(records, place, kind) {
  let pool = (records || []).filter(r => r && r.code);
  if (kind === "name") pool = filterNameHits(pool, place);
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
// would otherwise parse as "no customers".
function isMisLoginPage(url, html) {
  return /login/i.test(String(url || "")) || /<input[^>]+type=["']?password/i.test(String(html || ""));
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

/** {customer} when the place is an MIS customer, {customer: null} otherwise. */
async function handleExploreMatchMis(message) {
  const place = sanitizeExplorePlace(message.place);
  if (!place) return { success: false, error: "bad place" };
  const auth = await checkMisAuth(true);
  if (!auth.loggedIn) return { success: false, notLoggedIn: true };

  if (!message.forceRefresh) {
    const hit = freshEntry((await readCache(MIS_CACHE_KEY))[place.placeId], Date.now());
    if (hit) return { success: true, customer: hit.customer, cached: true };
  }
  const query = misQueryFor(place);
  if (!query) return { success: true, customer: null };

  return enqueueMis(async () => {
    if (_cancelledSessions.has(message.sessionId)) return { success: false, cancelled: true };
    const phpsessid = (await chrome.cookies.get({ url: "https://mis.greenoilinc.com", name: "PHPSESSID" }))?.value || "";
    const records = await misRecordsFor(query, phpsessid);
    if (!records) return { success: false, error: "MIS 查询失败" };
    const rec = pickMisRecordForPlace(records, place, query.kind);
    if (!rec) return { success: true, customer: null };
    const customer = {
      ...rec,
      latitude: place.latitude,
      longitude: place.longitude,
      placeId: place.placeId,
      matchedBy: query.kind,
      matchedPrefix: query.keyword,
      matchedCandidateName: place.name
    };
    // Persist only while still logged in (a logout mid-scan wipes the cache).
    if ((await checkMisAuth(true)).loggedIn) {
      await cachePositive(MIS_CACHE_KEY, place.placeId, { customer }, MIS_CACHE_MAX);
    }
    return { success: true, customer };
  });
}

// ---- 探索: fried-food judgement with the jev model ----
// Places are batched (JEV_BATCH_SIZE per call, one call at a time). The
// key comes from the Green Oil Worker (/api/jev/key, needs the operator's
// login token saved by the popup).
//
// TODO(jev): fill JEV_API once the jev endpoint / request format is known.
// Until then classification is reported as disabled and pins stay grey
// (MIS matching is unaffected).
const JEV_API = {
  url: "",   // e.g. "https://…/v1/chat/completions"
  model: ""
};
const JEV_BATCH_SIZE = 8;
const JEV_BATCH_WAIT_MS = 700;
let _jevKey = null;
let _jevChain = Promise.resolve();
const _jevPending = [];
let _jevTimer = null;

// A different (or no) operator login invalidates the fetched key.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.authToken) _jevKey = null;
});

async function getJevKey() {
  if (_jevKey) return _jevKey;
  const { authToken } = await chrome.storage.local.get("authToken");
  if (!authToken) throw new Error("请先在扩展中登录 Green Oil 账号");
  const resp = await fetch(`${WORKER_URL}/api/jev/key`, { headers: { Authorization: `Bearer ${authToken}` } });
  const data = await resp.json().catch(() => ({}));
  const key = data.key || data.apiKey || data.data?.key;
  if (!resp.ok || !key) throw new Error(data.message || data.error || "获取 JEV Key 失败");
  _jevKey = key;
  return key;
}

function friedPrompt(places) {
  return [
    {
      role: "system",
      content:
        "You help a used-cooking-oil collection company. For each restaurant decide whether it " +
        "very likely serves DEEP-FRIED food (fried chicken, fries, tempura, fish & chips, spring " +
        "rolls, deep-fried dim sum, wings, etc.), i.e. operates a deep fryer. Stir-frying alone " +
        "does not count. Use only the given text. Reply with JSON only: " +
        '{"results":[{"id":"<id>","fried":true|false}]}'
    },
    {
      role: "user",
      content: JSON.stringify(places.map(p => ({
        id: p.placeId,
        name: p.name,
        categories: p.categories,
        description: p.description,
        owner_description: p.ownerDescription,
        reviews: p.reviews
      })))
    }
  ];
}

/** Map placeId -> boolean from a jev reply (tolerates ```json fences). */
function parseFriedReply(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  const out = new Map();
  if (!m) return out;
  let data;
  try { data = JSON.parse(m[0]); } catch (_) { return out; }
  for (const r of Array.isArray(data.results) ? data.results : []) {
    if (r && typeof r.id === "string" && typeof r.fried === "boolean") out.set(r.id, r.fried);
  }
  return out;
}

async function callJev(messages) {
  if (!JEV_API.url) {
    const err = new Error("jev 模型尚未配置");
    err.disabled = true;
    throw err;
  }
  const key = await getJevKey();
  const resp = await fetch(JEV_API.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: JEV_API.model, messages, temperature: 0 }),
    signal: AbortSignal.timeout(60000)
  });
  if (resp.status === 401) _jevKey = null;
  if (!resp.ok) throw new Error(`jev HTTP ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

function flushJev() {
  _jevTimer = null;
  while (_jevPending.length) {
    const batch = _jevPending.splice(0, JEV_BATCH_SIZE);
    const live = batch.filter(j => !_cancelledSessions.has(j.sessionId));
    batch.filter(j => !live.includes(j)).forEach(j => j.resolve({ success: false, cancelled: true }));
    if (!live.length) continue;
    const run = _jevChain.then(async () => {
      try {
        const verdicts = parseFriedReply(await callJev(friedPrompt(live.map(j => j.place))));
        for (const j of live) {
          const fried = verdicts.has(j.place.placeId) ? verdicts.get(j.place.placeId) : null;
          if (fried === true) await cachePositive(FRIED_CACHE_KEY, j.place.placeId, {}, FRIED_CACHE_MAX);
          j.resolve({ success: fried !== null, fried });
        }
      } catch (err) {
        live.forEach(j => j.resolve({ success: false, disabled: Boolean(err.disabled), error: err.message }));
      }
    });
    _jevChain = run.catch(() => {});
  }
}

/** {fried: true|false} for one place (batched with others). */
async function handleExploreClassifyFried(message) {
  const place = sanitizeExplorePlace(message.place);
  if (!place) return { success: false, error: "bad place" };
  if (!message.forceRefresh) {
    const hit = freshEntry((await readCache(FRIED_CACHE_KEY))[place.placeId], Date.now());
    if (hit) return { success: true, fried: true, cached: true };
  }
  // Probe only: lets the page skip the detail-page request for cached places.
  if (message.cacheOnly) return { success: true, fried: null, miss: true };
  return new Promise((resolve) => {
    _jevPending.push({ sessionId: message.sessionId, place, resolve });
    if (_jevPending.length >= JEV_BATCH_SIZE) flushJev();
    else if (!_jevTimer) _jevTimer = setTimeout(flushJev, JEV_BATCH_WAIT_MS);
  });
}

// Runtime Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { routes, activeId, activeRoute } = await getOrInitColorRoutes();

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
          await updateBadge();
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

        if (!Array.isArray(activeRoute.waypoints)) {
          activeRoute.waypoints = [];
        }

        // Check if already in active route
        if (activeRoute.waypoints.some(w => isPlaceMatch(w, wp))) {
          sendResponse({
            success: false,
            alreadyExists: true,
            theme: activeRoute,
            belongTheme: activeRoute
          });
          return;
        }

        // Check if already in another route
        for (const key of Object.keys(routes)) {
          if (key === activeId) continue;
          const r = routes[key];
          if (r && Array.isArray(r.waypoints) && r.waypoints.some(w => isPlaceMatch(w, wp))) {
            sendResponse({
              success: false,
              alreadyExistsInOther: true,
              belongRouteName: r.name,
              belongTheme: r
            });
            return;
          }
        }

        activeRoute.waypoints.push(wp);
        routes[activeId] = activeRoute;

        await chrome.storage.local.set({ gce_color_routes: routes });
        await updateBadge();

        sendResponse({
          success: true,
          count: activeRoute.waypoints.length,
          theme: activeRoute
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
        activeRoute.waypoints = [];
        routes[activeId] = activeRoute;
        await chrome.storage.local.set({ gce_color_routes: routes });
        await updateBadge();
        sendResponse({ success: true });
        return;
      }

      // 7. Update waypoints (reorder, delete, lock, sort)
      if (message.action === "updateRouteWaypoints") {
        activeRoute.waypoints = Array.isArray(message.waypoints) ? message.waypoints : [];
        routes[activeId] = activeRoute;
        await chrome.storage.local.set({ gce_color_routes: routes });
        await updateBadge();
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
      if (message.action === "exploreClassifyFried") {
        sendResponse(await handleExploreClassifyFried(message));
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
        if (name && typeof latitude === "number" && typeof longitude === "number") {
          let updated = false;
          for (const key of Object.keys(routes)) {
            const r = routes[key];
            if (Array.isArray(r.waypoints)) {
              for (const wp of r.waypoints) {
                if (wp.name === name || isPlaceMatch(wp, { name })) {
                  wp.latitude = latitude;
                  wp.longitude = longitude;
                  updated = true;
                }
              }
            }
          }
          if (updated) {
            await chrome.storage.local.set({ gce_color_routes: routes });
            sendResponse({ success: true });
            return;
          }
        }
        sendResponse({ success: false });
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
