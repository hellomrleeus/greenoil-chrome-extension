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

      sendResponse({ success: false, error: "未知操作" });
    } catch (err) {
      console.error("Runtime message handler error:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});
