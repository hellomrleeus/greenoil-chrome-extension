/**
 * Green Oil Chrome Extension - Background Service Worker
 * Manages route state persistence, extension badge, and background cloud sync.
 */

import { GreenOilApi } from "./api.js";

const DEFAULT_ORIGIN = "Green Oil Inc. 4490 Chesswood Dr Unit 3, North York, ON M3J 2B9";

const INITIAL_STATE = {
  groups: [
    {
      id: "group_default",
      name: "路线 1",
      origin: DEFAULT_ORIGIN,
      waypoints: []
    }
  ],
  activeGroupId: "group_default",
  authToken: "",
  authUser: "",
  lastSyncedAt: null
};

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["groups", "activeGroupId", "authToken"]);
  if (!data.groups || !Array.isArray(data.groups) || data.groups.length === 0) {
    await chrome.storage.local.set(INITIAL_STATE);
  }
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
});

/**
 * Update the toolbar extension badge count
 */
async function updateBadge() {
  try {
    const data = await chrome.storage.local.get(["groups", "activeGroupId"]);
    const groups = data.groups || INITIAL_STATE.groups;
    const activeId = data.activeGroupId || INITIAL_STATE.activeGroupId;
    const activeGroup = groups.find(g => g.id === activeId) || groups[0];
    const count = activeGroup && activeGroup.waypoints ? activeGroup.waypoints.length : 0;

    await chrome.action.setBadgeBackgroundColor({ color: "#059669" });
    await chrome.action.setBadgeText({
      text: count > 0 ? String(count) : ""
    });
  } catch (err) {
    console.warn("Failed to update badge:", err);
  }
}

/**
 * Sync route groups to Cloudflare KV in background if authenticated
 */
async function backgroundCloudSync() {
  try {
    const data = await chrome.storage.local.get(["groups", "activeGroupId", "authToken"]);
    if (!data.authToken) return; // Unauthenticated, skip cloud sync

    const groups = data.groups || INITIAL_STATE.groups;
    const activeGroupId = data.activeGroupId || INITIAL_STATE.activeGroupId;
    const activeGroup = groups.find(g => g.id === activeGroupId) || groups[0];
    const origin = activeGroup ? activeGroup.origin : DEFAULT_ORIGIN;

    const res = await GreenOilApi.saveMapRoutes(data.authToken, groups, activeGroupId, origin);
    if (res && res.success) {
      await chrome.storage.local.set({ lastSyncedAt: new Date().toISOString() });
      console.log("Auto-synced routes to cloud KV successfully");
    }
  } catch (err) {
    console.warn("Background cloud sync error:", err);
  }
}

// Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const data = await chrome.storage.local.get(["groups", "activeGroupId", "authToken"]);
      let groups = data.groups || INITIAL_STATE.groups;
      let activeGroupId = data.activeGroupId || INITIAL_STATE.activeGroupId;

      let activeGroup = groups.find(g => g.id === activeGroupId);
      if (!activeGroup) {
        activeGroup = groups[0];
        activeGroupId = activeGroup.id;
      }
      if (!Array.isArray(activeGroup.waypoints)) {
        activeGroup.waypoints = [];
      }

      if (message.action === "checkPlaceStatus") {
        const placeId = message.placeId;
        const name = (message.name || "").trim().toLowerCase();
        const inRoute = activeGroup.waypoints.some(w => {
          if (placeId && w.placeId === placeId) return true;
          if (name && w.name.trim().toLowerCase() === name) return true;
          return false;
        });
        sendResponse({ inRoute });
        return;
      }

      if (message.action === "addWaypoint") {
        const wp = message.waypoint;
        if (!wp || !wp.name) {
          sendResponse({ success: false, error: "缺少有效的地点信息" });
          return;
        }

        // Deduplication check
        const exists = activeGroup.waypoints.some(w => {
          if (wp.placeId && w.placeId === wp.placeId) return true;
          if (w.name.trim().toLowerCase() === wp.name.trim().toLowerCase()) return true;
          return false;
        });

        if (exists) {
          sendResponse({ success: false, alreadyExists: true });
          return;
        }

        activeGroup.waypoints.push(wp);

        await chrome.storage.local.set({ groups, activeGroupId });
        await updateBadge();
        backgroundCloudSync();

        sendResponse({
          success: true,
          count: activeGroup.waypoints.length,
          routeName: activeGroup.name
        });
        return;
      }

      if (message.action === "updateBadge") {
        await updateBadge();
        sendResponse({ success: true });
        return;
      }

      if (message.action === "syncToCloud") {
        await backgroundCloudSync();
        sendResponse({ success: true });
        return;
      }

      sendResponse({ success: false, error: "未知操作" });
    } catch (err) {
      console.error("Runtime message handler error:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep message port open for async response
});
