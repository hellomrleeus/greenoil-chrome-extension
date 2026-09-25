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
    const mapTabs = await chrome.tabs.query({ url: ["*://*.google.com/maps/*", "*://*.google.ca/maps/*"] });
    for (const t of mapTabs) {
      if (t.id) {
        chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ["content.css"] }).catch(() => {});
        chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
      }
    }
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

/**
 * Automatically inject content scripts on Google Maps when page completes loading
 * Completely decoupled from initial navigation to guarantee 100% native load speed.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = tab?.url || changeInfo?.url || "";
  if (!url || (!url.includes("google.com/maps") && !url.includes("google.ca/maps"))) return;

  if (changeInfo.status === "complete" || (changeInfo.url && changeInfo.url.includes("/place/"))) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
    } catch (e) {
      // Ignored if tab closed/navigated
    }
  }
});

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

  // 2. Perform smooth in-page navigation without reloading
  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      world: "MAIN",
      func: (urlPath, placeName) => {
        try {
          // Push state and dispatch popstate to trigger Google Maps native SPA flyTo / panTo
          history.pushState(null, "", urlPath);
          window.dispatchEvent(new PopStateEvent("popstate"));

          // If search input exists, sync its value smoothly as well
          const searchInput = document.querySelector('input[name="q"]');
          if (searchInput && placeName) {
            searchInput.value = placeName;
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [targetPath, wp.name || ""]
    });

    // Notify content script to display toast and refresh button state
    chrome.tabs.sendMessage(targetTab.id, {
      action: "didPanToWaypoint",
      waypoint: wp
    }).catch(() => {});

    return { success: true, panned: true };
  } catch (err) {
    console.error("ExecuteScript pan failed:", err);
    // Fallback: send message to content script
    try {
      await chrome.tabs.sendMessage(targetTab.id, {
        action: "panToLocation",
        targetPath,
        waypoint: wp
      });
      return { success: true, fallback: true };
    } catch (e2) {
      return { success: false, error: err.message };
    }
  }
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

/**
 * Check if the user is authenticated in the MIS system
 */
async function checkMisAuth(force = false) {
  const now = Date.now();
  if (!force && (now - _cachedMisAuth.checkedAt < 40000)) {
    return _cachedMisAuth;
  }

  try {
    const phpsessid = await chrome.cookies.get({
      url: "https://mis.greenoilinc.com",
      name: "PHPSESSID"
    });
    const logcheck = await chrome.cookies.get({
      url: "https://mis.greenoilinc.com",
      name: "LOGCHECK"
    });

    if (!phpsessid || !phpsessid.value || !logcheck || logcheck.value !== "1") {
      _cachedMisAuth = { loggedIn: false, checkedAt: now };
      return _cachedMisAuth;
    }

    // Fast probe request to verify login session validity (throttled to 1s/req)
    await rateLimitMisRequest();
    const probeRes = await fetch("https://mis.greenoilinc.com/index_intranet.php?view=customer_list&page=1&key_word=__probe__", {
      method: "GET",
      credentials: "include"
    });

    if (!probeRes.ok) {
      _cachedMisAuth = { loggedIn: false, checkedAt: now };
      return _cachedMisAuth;
    }

    const html = await probeRes.text();
    if (probeRes.url.includes("login_intranet") || html.includes("login_intranet.php") || (html.includes('name="m_userid"') && html.includes('name="m_pwd"'))) {
      _cachedMisAuth = { loggedIn: false, checkedAt: now };
      return _cachedMisAuth;
    }

    const isValid = html.includes("customer_list") || html.includes("customer-info-detail") || html.includes("tb-list") || html.includes("search-container");
    _cachedMisAuth = { loggedIn: isValid, checkedAt: now };
    return _cachedMisAuth;
  } catch (err) {
    console.warn("[GreenOil MIS] checkMisAuth error:", err);
    _cachedMisAuth = { loggedIn: false, checkedAt: now };
    return _cachedMisAuth;
  }
}

/**
 * Extract street address prefix for MIS matching, e.g. "3601 Victoria Park Ave"
 */
function extractStreetPrefix(raw) {
  if (!raw || typeof raw !== "string") return "";
  let addr = raw.trim();

  // If address has commas, take the first segment
  let part = addr.split(",")[0].trim();

  // Strip Unit/Suite/# prefixes e.g. "Unit 3 - 3601 Victoria Park Ave" -> "3601 Victoria Park Ave"
  part = part.replace(/^(?:unit|ste|suite|#)\s*[\w\d-]+\s*[-–,]\s*/i, "").trim();

  // Strip trailing unit e.g. "3601 Victoria Park Ave Unit 12" -> "3601 Victoria Park Ave"
  part = part.replace(/\s+(?:unit|ste|suite|#|bldg|building)\s*[\w\d-]+$/i, "").trim();

  // Match house number + street words, e.g. "3601 Victoria Park Ave"
  const m = part.match(/^(\d+[\w-]*\s+[A-Za-z0-9\s.]+)/);
  if (m) {
    const words = m[1].trim().split(/\s+/).slice(0, 5).join(" ");
    return words;
  }

  return part;
}

/**
 * Fetch up to 20 nearest restaurants around (lat, lng) silently using Nominatim
 */
async function fetchNearbyRestaurants(lat, lng, limit = 20) {
  try {
    const dLat = 0.035;
    const dLng = 0.045;
    const minLng = (lng - dLng).toFixed(5);
    const maxLng = (lng + dLng).toFixed(5);
    const minLat = (lat - dLat).toFixed(5);
    const maxLat = (lat + dLat).toFixed(5);

    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=restaurant&viewbox=${minLng},${maxLat},${maxLng},${minLat}&bounded=1&limit=${limit}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "GreenOilChromeExt/1.0"
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map(d => {
          const addr = d.address || {};
          let prefix = "";
          if (addr.house_number && addr.road) {
            prefix = `${addr.house_number} ${addr.road}`.trim();
          } else if (addr.road) {
            prefix = addr.road.trim();
          } else {
            prefix = extractStreetPrefix(d.display_name);
          }
          return {
            name: d.name || (d.display_name ? d.display_name.split(",")[0] : "餐馆"),
            displayName: d.display_name || "",
            latitude: parseFloat(d.lat),
            longitude: parseFloat(d.lon),
            streetPrefix: prefix
          };
        });
      }
    }

    // Fallback: search query near lat, lng
    const fbUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=restaurant+near+${lat},${lng}&limit=${limit}`;
    const fbResp = await fetch(fbUrl, { headers: { "User-Agent": "GreenOilChromeExt/1.0" } });
    if (fbResp.ok) {
      const fbData = await fbResp.json();
      if (Array.isArray(fbData)) {
        return fbData.map(d => {
          const addr = d.address || {};
          let prefix = "";
          if (addr.house_number && addr.road) {
            prefix = `${addr.house_number} ${addr.road}`.trim();
          } else {
            prefix = extractStreetPrefix(d.display_name);
          }
          return {
            name: d.name || (d.display_name ? d.display_name.split(",")[0] : "餐馆"),
            displayName: d.display_name || "",
            latitude: parseFloat(d.lat),
            longitude: parseFloat(d.lon),
            streetPrefix: prefix
          };
        });
      }
    }

    return [];
  } catch (err) {
    console.warn("[GreenOil MIS] fetchNearbyRestaurants failed:", err);
    return [];
  }
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

/**
 * Query MIS for a single prefix keyword
 */
async function queryMisPrefix(prefix, phpsessid) {
  if (!prefix || prefix.trim().length < 2) return [];
  try {
    const url = `https://mis.greenoilinc.com/index_intranet.php?view=customer_list&switched=&page=1&column=&sorting_type=&switch=&key_word=${encodeURIComponent(prefix.trim())}&cstatus=T&cistop=T`;
    const resp = await fetch(url, {
      method: "GET",
      credentials: "include"
    });

    if (!resp.ok) return [];
    const html = await resp.text();
    return parseMisCustomerHtml(html);
  } catch (e) {
    console.warn(`[GreenOil MIS] queryMisPrefix failed for "${prefix}":`, e);
    return [];
  }
}

/**
 * Silent scan & match MIS customers around a center coordinate
 */
async function handleScanAndMatchMis(param, sender) {
  const { lat, lng, placeName, placeAddress } = param || {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { success: false, error: "缺少地点坐标" };
  }

  // 1. Check MIS auth status
  const auth = await checkMisAuth();
  if (!auth.loggedIn) {
    return { success: false, notLoggedIn: true, error: "未登录 MIS 内部系统" };
  }

  const phpsessidCookie = await chrome.cookies.get({
    url: "https://mis.greenoilinc.com",
    name: "PHPSESSID"
  });
  const phpsessid = phpsessidCookie?.value || "";

  // 2. Fetch nearest 20 restaurants
  const nearbyRestaurants = await fetchNearbyRestaurants(lat, lng, 20);

  // 3. Assemble all candidates including the clicked place
  const candidates = [];
  if (placeName && placeAddress) {
    candidates.push({
      name: placeName,
      displayName: placeAddress,
      latitude: lat,
      longitude: lng,
      streetPrefix: extractStreetPrefix(placeAddress)
    });
  }

  for (const r of nearbyRestaurants) {
    if (!candidates.some(c => c.name.toLowerCase() === r.name.toLowerCase())) {
      candidates.push(r);
    }
  }

  // 4. Group candidates by unique street prefix to avoid repeated queries to MIS
  const prefixMap = new Map();
  for (const c of candidates) {
    const p = (c.streetPrefix || "").trim();
    if (p.length >= 3) {
      if (!prefixMap.has(p)) {
        prefixMap.set(p, []);
      }
      prefixMap.get(p).push(c);
    }
  }

  // 5. Query MIS for each unique prefix throttled strictly to 1 second per request
  const matchedCustomers = [];
  const seenCodes = new Set();
  let currentIdx = 0;
  const totalPrefixes = prefixMap.size;

  for (const [prefix, candList] of prefixMap.entries()) {
    currentIdx++;

    // Broadcast real-time progress to caller tab (e.g. 1/6, 2/6...)
    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        action: "misMatchProgress",
        current: currentIdx,
        total: totalPrefixes,
        prefix
      }).catch(() => {});
    }

    // Strict throttle: 1 request per second
    await rateLimitMisRequest();

    const records = await queryMisPrefix(prefix, phpsessid);
    for (const rec of records) {
      if (!rec.code || seenCodes.has(rec.code)) continue;
      seenCodes.add(rec.code);

      // Associate best coordinate from candidate list
      let bestCand = candList[0] || candidates[0];
      const recAddr = rec.address.toLowerCase();
      for (const cand of candList) {
        if (cand.displayName && (cand.displayName.toLowerCase().includes(recAddr) || recAddr.includes(cand.displayName.toLowerCase()))) {
          bestCand = cand;
          break;
        }
      }

      matchedCustomers.push({
        ...rec,
        latitude: bestCand ? bestCand.latitude : lat,
        longitude: bestCand ? bestCand.longitude : lng,
        matchedPrefix: prefix,
        matchedCandidateName: bestCand ? bestCand.name : ""
      });
    }
  }

  const { activeRoute } = await getOrInitColorRoutes();

  return {
    success: true,
    matches: matchedCustomers,
    totalScanned: candidates.length,
    activeRoute
  };
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
          sendResponse({
            inRoute: true,
            belongRouteId: foundInRoute.id,
            belongRouteName: foundInRoute.name,
            belongTheme: foundInRoute,
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

      // 9. Check MIS authentication state
      if (message.action === "checkMisAuth") {
        const auth = await checkMisAuth(Boolean(message.force));
        sendResponse(auth);
        return;
      }

      // 10. Silent scan & match MIS customers around given place
      if (message.action === "scanAndMatchMis") {
        const matchResult = await handleScanAndMatchMis(message, sender);
        sendResponse(matchResult);
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

      sendResponse({ success: false, error: "未知操作" });
    } catch (err) {
      console.error("Runtime message handler error:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});
