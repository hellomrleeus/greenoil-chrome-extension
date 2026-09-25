/**
 * Green Oil Chrome Extension - Popup Controller
 * Manages 5 dedicated color routes, vertical resizing, real-time search,
 * locked group operations, route optimization, and English Excel export.
 * Strict ban on emojis: Vector SVGs only.
 */

import { GreenOilApi } from "./api.js";
import { toEnglishAddress, toEnglishRestaurantName, formatOpeningHoursEnglish } from "./utils.js";

const DEFAULT_ORIGIN = "Green Oil Inc. 4490 Chesswood Dr Unit 3, North York, ON M3J 2B9";
const DEFAULT_ORIGIN_COORDS = { lat: 43.7686, lng: -79.4674 };

// 5 Dedicated Color Routes Definition
const COLOR_ROUTES_DEF = {
  route_1: {
    id: "route_1",
    color: "#059669", // Emerald Green
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

const SVG_TRASH = `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
const SVG_UP = `<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`;
const SVG_DOWN = `<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`;
const SVG_LOCK = `<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;
const SVG_UNLOCK = `<svg viewBox="0 0 24 24"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75l1.93.52C10.5 3.84 11.66 3 13 3c1.66 0 3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>`;
const SVG_STAR = `<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
const SVG_CLOCK = `<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`;
const SVG_EMPTY = `<svg class="empty-icon" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
const SVG_PIN_MINI = `<svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class PopupController {
  constructor() {
    this.colorRoutes = JSON.parse(JSON.stringify(COLOR_ROUTES_DEF));
    this.activeRouteId = "route_1";
    this.searchQuery = "";
    this.selectedWaypointKeys = new Set();

    this.authToken = "";
    this.authUser = "";
    this.lastSyncedAt = null;

    this.initElements();
    this.initResizer();
    this.bindEvents();
    this.loadState();
  }

  initElements() {
    this.elColorPaletteList = document.getElementById("colorPaletteList");
    this.elBtnOptimizeRoute = document.getElementById("btnOptimizeRoute");
    this.elBtnClearRoute = document.getElementById("btnClearRoute");

    this.elInputOrigin = document.getElementById("inputOrigin");
    this.elBtnResetOrigin = document.getElementById("btnResetOrigin");

    this.elInputSearchWaypoints = document.getElementById("inputSearchWaypoints");
    this.elBtnClearSearch = document.getElementById("btnClearSearch");

    this.elBatchBar = document.getElementById("batchBar");
    this.elSelectAllWaypoints = document.getElementById("selectAllWaypoints");
    this.elBatchCountLabel = document.getElementById("batchCountLabel");
    this.elBtnLockSelected = document.getElementById("btnLockSelected");
    this.elBtnUnlockSelected = document.getElementById("btnUnlockSelected");
    this.elBtnBatchDelete = document.getElementById("btnBatchDelete");

    this.elWaypointsList = document.getElementById("waypointsList");

    this.elBtnGenerateNav = document.getElementById("btnGenerateNav");
    this.elBtnExportExcel = document.getElementById("btnExportExcel");

    this.elBtnSyncCloud = document.getElementById("btnSyncCloud");
    this.elBtnOpenAuth = document.getElementById("btnOpenAuth");
    this.elAuthDot = document.getElementById("authDot");

    this.elPopupResizer = document.getElementById("popupResizer");

    // Nav Modal
    this.elNavModal = document.getElementById("navModal");
    this.elBtnCloseNavModal = document.getElementById("btnCloseNavModal");
    this.elNavLegsList = document.getElementById("navLegsList");
    this.elBtnOpenAllLegs = document.getElementById("btnOpenAllLegs");

    // Auth Modal
    this.elAuthModal = document.getElementById("authModal");
    this.elBtnCloseAuthModal = document.getElementById("btnCloseAuthModal");
    this.elAuthLoggedView = document.getElementById("authLoggedView");
    this.elAuthLoginForm = document.getElementById("authLoginForm");
    this.elAuthUsernameDisplay = document.getElementById("authUsernameDisplay");
    this.elAuthSyncTimeDisplay = document.getElementById("authSyncTimeDisplay");
    this.elInputUsername = document.getElementById("inputUsername");
    this.elInputPassword = document.getElementById("inputPassword");
    this.elBtnLogin = document.getElementById("btnLogin");
    this.elBtnLogout = document.getElementById("btnLogout");
    this.elBtnManualSync = document.getElementById("btnManualSync");
    this.elAuthErrorMsg = document.getElementById("authErrorMsg");
  }

  /**
   * Vertical resizer: drag handle to adjust popup height (bounded 400px - 600px)
   */
  initResizer() {
    const applySavedHeight = (savedHeight) => {
      const h = parseInt(savedHeight, 10);
      if (h && h >= 400 && h <= 600) {
        document.body.style.height = `${h}px`;
        document.documentElement.style.height = `${h}px`;
      } else {
        document.body.style.height = "560px";
        document.documentElement.style.height = "560px";
      }
    };

    if (chrome?.storage?.local) {
      chrome.storage.local.get(["gce_popup_height"], (res) => {
        applySavedHeight(res?.gce_popup_height);
      });
    } else {
      applySavedHeight(localStorage?.getItem("gce_popup_height"));
    }

    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e) => {
      const deltaY = e.clientY - startY;
      const newHeight = Math.min(600, Math.max(400, startHeight + deltaY));
      document.body.style.height = `${newHeight}px`;
      document.documentElement.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      this.elPopupResizer.classList.remove("active");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      const finalHeight = parseInt(document.body.style.height, 10);
      if (finalHeight) {
        if (chrome?.storage?.local) {
          chrome.storage.local.set({ gce_popup_height: finalHeight });
        } else {
          try { localStorage?.setItem("gce_popup_height", String(finalHeight)); } catch (_) {}
        }
      }
    };

    this.elPopupResizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startY = e.clientY;
      startHeight = document.body.offsetHeight;
      this.elPopupResizer.classList.add("active");
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
  }

  bindEvents() {
    // Route Toolbar
    this.elBtnOptimizeRoute.addEventListener("click", () => this.handleOptimizeRoute());
    this.elBtnClearRoute.addEventListener("click", () => this.handleClearRoute());

    // Origin Address
    this.elInputOrigin.addEventListener("change", () => {
      const activeRoute = this.getActiveRoute();
      if (activeRoute) {
        activeRoute.origin = this.elInputOrigin.value.trim() || DEFAULT_ORIGIN;
        this.saveState();
      }
    });

    this.elBtnResetOrigin.addEventListener("click", () => {
      const activeRoute = this.getActiveRoute();
      if (activeRoute) {
        activeRoute.origin = DEFAULT_ORIGIN;
        this.elInputOrigin.value = DEFAULT_ORIGIN;
        this.saveState();
      }
    });

    // Real-time Search
    this.elInputSearchWaypoints.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.elBtnClearSearch.style.display = this.searchQuery ? "inline-flex" : "none";
      this.render();
    });

    this.elBtnClearSearch.addEventListener("click", () => {
      this.searchQuery = "";
      this.elInputSearchWaypoints.value = "";
      this.elBtnClearSearch.style.display = "none";
      this.render();
    });

    // Batch Actions
    this.elSelectAllWaypoints.addEventListener("change", (e) => {
      this.toggleSelectAll(e.target.checked);
    });

    this.elBtnLockSelected.addEventListener("click", () => this.handleLockSelected());
    this.elBtnUnlockSelected.addEventListener("click", () => this.handleUnlockSelected());
    this.elBtnBatchDelete.addEventListener("click", () => this.handleBatchDelete());

    // Actions
    this.elBtnGenerateNav.addEventListener("click", () => this.handleGenerateNav());
    this.elBtnExportExcel.addEventListener("click", () => this.handleExportExcel());

    // Cloud Sync & Auth
    this.elBtnSyncCloud.addEventListener("click", () => this.handleCloudSync());
    this.elBtnOpenAuth.addEventListener("click", () => this.openAuthModal());
    this.elBtnCloseAuthModal.addEventListener("click", () => this.closeAuthModal());
    this.elBtnCloseNavModal.addEventListener("click", () => this.closeNavModal());

    this.elBtnLogin.addEventListener("click", () => this.handleLogin());
    this.elBtnLogout.addEventListener("click", () => this.handleLogout());
    this.elBtnManualSync.addEventListener("click", () => this.handleCloudSync());
  }

  async loadState() {
    let data = {};
    if (chrome?.storage?.local) {
      data = await chrome.storage.local.get([
        "gce_color_routes",
        "gce_active_route_id",
        "authToken",
        "authUser",
        "lastSyncedAt"
      ]);
    } else {
      try {
        data = JSON.parse(localStorage?.getItem("gce_state") || "{}");
      } catch (_) {}
    }

    if (data.gce_color_routes && typeof data.gce_color_routes === "object") {
      this.colorRoutes = { ...JSON.parse(JSON.stringify(COLOR_ROUTES_DEF)), ...data.gce_color_routes };
    } else {
      this.colorRoutes = JSON.parse(JSON.stringify(COLOR_ROUTES_DEF));
    }

    this.activeRouteId = data.gce_active_route_id || "route_1";
    if (!this.colorRoutes[this.activeRouteId]) {
      this.activeRouteId = "route_1";
    }

    this.authToken = data.authToken || "";
    this.authUser = data.authUser || "";
    this.lastSyncedAt = data.lastSyncedAt || null;

    this.applyTheme(this.getActiveRoute());
    this.updateAuthStatusUI();
    this.render();
  }

  async saveState() {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({
        gce_color_routes: this.colorRoutes,
        gce_active_route_id: this.activeRouteId,
        authToken: this.authToken,
        authUser: this.authUser,
        lastSyncedAt: this.lastSyncedAt
      });
    } else {
      try {
        localStorage?.setItem("gce_state", JSON.stringify({
          gce_color_routes: this.colorRoutes,
          gce_active_route_id: this.activeRouteId,
          authToken: this.authToken,
          authUser: this.authUser,
          lastSyncedAt: this.lastSyncedAt
        }));
      } catch (_) {}
    }

    if (chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: "updateBadge" });
    }
  }

  getActiveRoute() {
    return this.colorRoutes[this.activeRouteId] || this.colorRoutes["route_1"];
  }

  /**
   * Apply dynamic CSS variables matching the active color route
   */
  applyTheme(route) {
    if (!route) return;
    const root = document.documentElement;
    root.style.setProperty("--theme-color", route.color || "#059669");
    root.style.setProperty("--theme-hover", route.hoverColor || "#047857");
    root.style.setProperty("--theme-light", route.lightColor || "#ecfdf5");
    root.style.setProperty("--theme-border", route.borderColor || "#10b981");
    root.style.setProperty("--theme-text", route.textColor || "#065f46");
  }

  /**
   * Switch active color route
   */
  async switchRoute(routeId) {
    if (!this.colorRoutes[routeId] || this.activeRouteId === routeId) return;

    this.activeRouteId = routeId;
    this.selectedWaypointKeys.clear();
    const activeRoute = this.getActiveRoute();
    this.applyTheme(activeRoute);

    await this.saveState();
    chrome.runtime.sendMessage({ action: "setActiveRoute", routeId });
    this.render();
  }

  render() {
    const activeRoute = this.getActiveRoute();
    const waypoints = Array.isArray(activeRoute.waypoints) ? activeRoute.waypoints : [];

    // 1. Render 5 Color Palette Pills
    this.elColorPaletteList.innerHTML = "";
    Object.keys(COLOR_ROUTES_DEF).forEach(id => {
      const def = COLOR_ROUTES_DEF[id];
      const routeData = this.colorRoutes[id] || def;
      const count = Array.isArray(routeData.waypoints) ? routeData.waypoints.length : 0;
      const isActive = id === this.activeRouteId;

      const btn = document.createElement("button");
      btn.className = `color-circle-btn ${isActive ? 'active' : ''}`;
      btn.style.backgroundColor = def.color;
      btn.title = `${def.name} (${count} 站)`;
      btn.dataset.routeId = id;

      const countSpan = document.createElement("span");
      countSpan.className = "palette-count";
      countSpan.textContent = count > 0 ? String(count) : "";
      btn.appendChild(countSpan);

      btn.addEventListener("click", () => this.switchRoute(id));
      this.elColorPaletteList.appendChild(btn);
    });

    // 2. Render Origin Address
    this.elInputOrigin.value = activeRoute.origin || DEFAULT_ORIGIN;

    // 3. Filter Waypoints by Search Query
    let filteredWaypoints = waypoints.map((w, idx) => ({ ...w, originalIndex: idx }));
    if (this.searchQuery) {
      filteredWaypoints = filteredWaypoints.filter(w => {
        const name = (w.name || "").toLowerCase();
        const nameEn = (w.nameEn || "").toLowerCase();
        const addr = (w.address || "").toLowerCase();
        return name.includes(this.searchQuery) || nameEn.includes(this.searchQuery) || addr.includes(this.searchQuery);
      });
    }

    // 4. Update Batch Bar
    if (this.elBtnOptimizeRoute) {
      this.elBtnOptimizeRoute.disabled = waypoints.length <= 1;
    }
    this.updateBatchBar(filteredWaypoints, waypoints.length);

    // 5. Render Waypoints List
    this.elWaypointsList.innerHTML = "";

    if (waypoints.length === 0) {
      this.elWaypointsList.innerHTML = `
        <div class="empty-state">
          ${SVG_EMPTY}
          <div class="empty-text">当前路线暂无经停点</div>
          <div class="empty-subtext">在 Google Maps 官方网页浏览地点时，点击地点信息行的【+ 途径点】按钮即可加入当前路线。</div>
        </div>
      `;
      return;
    }

    if (filteredWaypoints.length === 0 && this.searchQuery) {
      this.elWaypointsList.innerHTML = `
        <div class="empty-state">
          ${SVG_EMPTY}
          <div class="empty-text">未搜索到匹配的途径点</div>
          <div class="empty-subtext">请检查搜索关键词，或点击搜索框右侧的清空图标。</div>
        </div>
      `;
      return;
    }

    filteredWaypoints.forEach((wp) => {
      const index = wp.originalIndex;
      const key = wp.placeId || wp.id || `${wp.name}_${wp.address}`;
      const isSelected = this.selectedWaypointKeys.has(key);
      const isLocked = !!wp.lockGroupId;

      const card = document.createElement("div");
      card.className = `waypoint-card ${isLocked ? 'card-locked' : ''}`;

      const displayName = toEnglishRestaurantName(wp.name, wp.nameEn);
      const displayAddress = toEnglishAddress(wp.address);
      const hoursEn = formatOpeningHoursEnglish(wp.openingHours);

      let hoursHtml = "";
      if (hoursEn && hoursEn !== "N/A") {
        hoursHtml = `<span class="card-hours" title="${this.escapeHtml(hoursEn)}">${SVG_CLOCK} ${this.escapeHtml(hoursEn)}</span>`;
      }

      let metaHtml = "";
      if (wp.rating || hoursHtml) {
        metaHtml = `
          <div class="card-meta">
            ${wp.rating ? `<span class="card-rating">${SVG_STAR} ${wp.rating}</span><span class="card-reviews">(${wp.reviews || 0} reviews)</span>` : ''}
            ${hoursHtml}
          </div>
        `;
      }

      const lockedBadgeHtml = isLocked
        ? `<span class="badge-locked" title="此站点处于锁定组合中，优化排序与移动时保持相对连续">${SVG_LOCK} 锁定</span>`
        : "";

      card.innerHTML = `
        <input type="checkbox" class="card-checkbox custom-checkbox" ${isSelected ? 'checked' : ''} title="选择此站点">
        <div class="card-index" title="点击在地图上平滑定位到此地点" role="button" tabindex="0">
          <span class="index-num">#${index + 1}</span>
          <span class="index-pin">${SVG_PIN_MINI}</span>
        </div>
        <div class="card-main" title="点击在地图上平滑定位到此地点" role="button" tabindex="0">
          <div class="card-header-row">
            <span class="card-name" title="${this.escapeHtml(displayName)}">${this.escapeHtml(displayName)}</span>
            ${lockedBadgeHtml}
          </div>
          <div class="card-address" title="${this.escapeHtml(displayAddress)}">${this.escapeHtml(displayAddress)}</div>
          ${metaHtml}
        </div>
        <div class="card-actions">
          ${isLocked ? `
            <button class="btn-card-action unlock btn-unlock-single" title="解除此站点锁定">
              ${SVG_UNLOCK}
            </button>
          ` : ''}
          <button class="btn-card-action btn-move-up" title="上移" ${index === 0 ? 'disabled' : ''}>
            ${SVG_UP}
          </button>
          <button class="btn-card-action btn-move-down" title="下移" ${index === waypoints.length - 1 ? 'disabled' : ''}>
            ${SVG_DOWN}
          </button>
          <button class="btn-card-action danger btn-delete" title="删除">
            ${SVG_TRASH}
          </button>
        </div>
      `;

      // Event Listeners
      const cb = card.querySelector(".card-checkbox");
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", (e) => {
        if (e.target.checked) {
          this.selectedWaypointKeys.add(key);
        } else {
          this.selectedWaypointKeys.delete(key);
        }
        this.updateBatchBar(filteredWaypoints, waypoints.length);
      });

      // Smooth pan to waypoint on clicking index circle or place name
      const cardIndex = card.querySelector(".card-index");
      const cardMain = card.querySelector(".card-main");
      const onPanToLocation = (e) => {
        e.stopPropagation();
        this.handlePanToWaypoint(wp, card);
      };

      if (cardIndex) cardIndex.addEventListener("click", onPanToLocation);
      if (cardMain) cardMain.addEventListener("click", onPanToLocation);

      const cardActions = card.querySelector(".card-actions");
      if (cardActions) cardActions.addEventListener("click", (e) => e.stopPropagation());

      const btnUp = card.querySelector(".btn-move-up");
      const btnDown = card.querySelector(".btn-move-down");
      const btnDelete = card.querySelector(".btn-delete");
      const btnUnlockSingle = card.querySelector(".btn-unlock-single");

      if (btnUp) btnUp.addEventListener("click", () => this.moveWaypoint(index, -1));
      if (btnDown) btnDown.addEventListener("click", () => this.moveWaypoint(index, 1));
      if (btnDelete) btnDelete.addEventListener("click", () => this.deleteWaypoint(index));
      if (btnUnlockSingle) btnUnlockSingle.addEventListener("click", () => this.unlockSingleWaypoint(index));

      this.elWaypointsList.appendChild(card);
    });
  }

  escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }

  /**
   * Update Batch Selection Bar State
   */
  updateBatchBar(filteredWaypoints, totalCount) {
    const visibleCount = filteredWaypoints.length;
    let selectedVisibleCount = 0;

    filteredWaypoints.forEach(w => {
      const key = w.placeId || w.id || `${w.name}_${w.address}`;
      if (this.selectedWaypointKeys.has(key)) {
        selectedVisibleCount++;
      }
    });

    if (visibleCount > 0 && selectedVisibleCount === visibleCount) {
      this.elSelectAllWaypoints.checked = true;
      this.elSelectAllWaypoints.indeterminate = false;
    } else if (selectedVisibleCount > 0) {
      this.elSelectAllWaypoints.checked = false;
      this.elSelectAllWaypoints.indeterminate = true;
    } else {
      this.elSelectAllWaypoints.checked = false;
      this.elSelectAllWaypoints.indeterminate = false;
    }

    if (this.selectedWaypointKeys.size > 0) {
      this.elBatchCountLabel.textContent = `已选 ${this.selectedWaypointKeys.size} 项`;
      this.elBtnLockSelected.style.display = "inline-flex";
      this.elBtnUnlockSelected.style.display = "inline-flex";
      this.elBtnBatchDelete.style.display = "inline-flex";
    } else {
      this.elBatchCountLabel.textContent = `全选 (${totalCount} 站)`;
      this.elBtnLockSelected.style.display = "none";
      this.elBtnUnlockSelected.style.display = "none";
      this.elBtnBatchDelete.style.display = "none";
    }
  }

  toggleSelectAll(checked) {
    const activeRoute = this.getActiveRoute();
    const waypoints = activeRoute.waypoints || [];

    if (checked) {
      waypoints.forEach(w => {
        const key = w.placeId || w.id || `${w.name}_${w.address}`;
        this.selectedWaypointKeys.add(key);
      });
    } else {
      this.selectedWaypointKeys.clear();
    }
    this.render();
  }

  /**
   * Lock selected waypoints into an atomic contiguous block (referencing dev version)
   */
  handleLockSelected() {
    const activeRoute = this.getActiveRoute();
    const waypoints = activeRoute.waypoints || [];

    const selectedIndices = [];
    waypoints.forEach((w, idx) => {
      const key = w.placeId || w.id || `${w.name}_${w.address}`;
      if (this.selectedWaypointKeys.has(key)) {
        selectedIndices.push(idx);
      }
    });

    if (selectedIndices.length < 2) {
      alert("至少需要选择 2 个站点才能锁定为组合。");
      return;
    }

    const lockGroupId = "lock_" + Date.now();
    const anchorIndex = Math.min(...selectedIndices);
    const selectedItems = [];
    const remainingItems = [];

    waypoints.forEach((w, idx) => {
      if (selectedIndices.includes(idx)) {
        w.lockGroupId = lockGroupId;
        selectedItems.push(w);
      } else {
        remainingItems.push(w);
      }
    });

    // Reinsert grouped items contiguously at anchorIndex
    let insertIdx = 0;
    let counted = 0;
    for (let i = 0; i < waypoints.length; i++) {
      if (i === anchorIndex) {
        insertIdx = counted;
        break;
      }
      if (!selectedIndices.includes(i)) counted++;
    }
    remainingItems.splice(insertIdx, 0, ...selectedItems);
    activeRoute.waypoints = remainingItems;

    this.selectedWaypointKeys.clear();
    this.saveState();
    this.render();
  }

  /**
   * Unlock selected waypoints
   */
  handleUnlockSelected() {
    const activeRoute = this.getActiveRoute();
    const waypoints = activeRoute.waypoints || [];

    let count = 0;
    waypoints.forEach(w => {
      const key = w.placeId || w.id || `${w.name}_${w.address}`;
      if (this.selectedWaypointKeys.has(key) && w.lockGroupId) {
        w.lockGroupId = null;
        count++;
      }
    });

    this.selectedWaypointKeys.clear();
    this.saveState();
    this.render();
  }

  unlockSingleWaypoint(index) {
    const activeRoute = this.getActiveRoute();
    const w = activeRoute.waypoints[index];
    if (w) {
      w.lockGroupId = null;
      this.saveState();
      this.render();
    }
  }

  /**
   * Smoothly pan Google Maps to waypoint without reloading page
   */
  handlePanToWaypoint(wp, card) {
    if (!wp) return;

    // Visual pulse feedback on card
    if (card) {
      document.querySelectorAll(".waypoint-card.card-panned").forEach(c => c.classList.remove("card-panned"));
      card.classList.add("card-panned");
      setTimeout(() => {
        card.classList.remove("card-panned");
      }, 1500);
    }

    if (chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        action: "panToWaypoint",
        waypoint: wp
      }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn("panToWaypoint error:", chrome.runtime.lastError.message);
        }
      });
    }
  }

  /**
   * Batch Delete (blocked if any selected item is locked)
   */
  handleBatchDelete() {
    const activeRoute = this.getActiveRoute();
    const waypoints = activeRoute.waypoints || [];

    const selectedWaypoints = waypoints.filter(w => {
      const key = w.placeId || w.id || `${w.name}_${w.address}`;
      return this.selectedWaypointKeys.has(key);
    });

    if (selectedWaypoints.length === 0) return;

    const hasLocked = selectedWaypoints.some(w => !!w.lockGroupId);
    if (hasLocked) {
      alert("所选站点包含已被锁定的站点，必须先解锁后再删除！");
      return;
    }

    if (!confirm(`确定删除选中的 ${selectedWaypoints.length} 个经停点吗？`)) return;

    activeRoute.waypoints = waypoints.filter(w => {
      const key = w.placeId || w.id || `${w.name}_${w.address}`;
      return !this.selectedWaypointKeys.has(key);
    });

    this.selectedWaypointKeys.clear();
    this.saveState();
    this.render();
  }

  /**
   * Move Waypoint / Locked Group (referencing dev version map-explorer.js:831-906)
   */
  moveWaypoint(index, delta) {
    const activeRoute = this.getActiveRoute();
    const waypoints = activeRoute.waypoints;
    if (index < 0 || index >= waypoints.length) return;

    const cur = waypoints[index];
    if (!cur) return;

    // Case 1: Waypoint belongs to a locked group -> move whole group together as a block
    if (cur.lockGroupId) {
      const grpId = cur.lockGroupId;
      let grpStart = index;
      while (grpStart > 0 && waypoints[grpStart - 1].lockGroupId === grpId) {
        grpStart--;
      }
      let grpEnd = index;
      while (grpEnd < waypoints.length - 1 && waypoints[grpEnd + 1].lockGroupId === grpId) {
        grpEnd++;
      }
      const grpLen = grpEnd - grpStart + 1;

      if (delta < 0) {
        // Move UP
        if (grpStart === 0) return;
        const prevIdx = grpStart - 1;
        const prevItem = waypoints[prevIdx];
        let targetInsertIndex = prevIdx;
        if (prevItem.lockGroupId) {
          const prevGrpId = prevItem.lockGroupId;
          while (targetInsertIndex > 0 && waypoints[targetInsertIndex - 1].lockGroupId === prevGrpId) {
            targetInsertIndex--;
          }
        }
        const groupItems = waypoints.splice(grpStart, grpLen);
        waypoints.splice(targetInsertIndex, 0, ...groupItems);
      } else if (delta > 0) {
        // Move DOWN
        if (grpEnd === waypoints.length - 1) return;
        const nextIdx = grpEnd + 1;
        const nextItem = waypoints[nextIdx];
        let nextBlockEnd = nextIdx;
        if (nextItem.lockGroupId) {
          const nextGrpId = nextItem.lockGroupId;
          while (nextBlockEnd < waypoints.length - 1 && waypoints[nextBlockEnd + 1].lockGroupId === nextGrpId) {
            nextBlockEnd++;
          }
        }
        const groupItems = waypoints.splice(grpStart, grpLen);
        const insertPos = nextBlockEnd - grpLen + 1;
        waypoints.splice(insertPos, 0, ...groupItems);
      }
    } else {
      // Case 2: Standalone waypoint -> jump over any adjacent locked group without splitting it
      if (delta < 0) {
        if (index === 0) return;
        const prevItem = waypoints[index - 1];
        let targetPos = index - 1;
        if (prevItem.lockGroupId) {
          const prevGrpId = prevItem.lockGroupId;
          while (targetPos > 0 && waypoints[targetPos - 1].lockGroupId === prevGrpId) {
            targetPos--;
          }
        }
        const item = waypoints.splice(index, 1)[0];
        waypoints.splice(targetPos, 0, item);
      } else if (delta > 0) {
        if (index === waypoints.length - 1) return;
        const nextItem = waypoints[index + 1];
        let targetBlockEnd = index + 1;
        if (nextItem.lockGroupId) {
          const nextGrpId = nextItem.lockGroupId;
          while (targetBlockEnd < waypoints.length - 1 && waypoints[targetBlockEnd + 1].lockGroupId === nextGrpId) {
            targetBlockEnd++;
          }
        }
        const item = waypoints.splice(index, 1)[0];
        waypoints.splice(targetBlockEnd, 0, item);
      }
    }

    this.saveState();
    this.render();
  }

  deleteWaypoint(index) {
    const activeRoute = this.getActiveRoute();
    const w = activeRoute.waypoints[index];
    if (w && w.lockGroupId) {
      alert("该站点处于锁定组合中，请先解锁后再删除。");
      return;
    }
    activeRoute.waypoints.splice(index, 1);
    this.saveState();
    this.render();
  }

  /**
   * Route Optimization (Distance TSP starting from Origin, preserving locked groups contiguously)
   */
  handleOptimizeRoute() {
    const activeRoute = this.getActiveRoute();
    const waypoints = activeRoute.waypoints || [];

    if (waypoints.length <= 1) {
      alert("路线中至少需要 2 个途径点才能进行路线优化。");
      return;
    }

    // Origin coordinates
    const curLat = DEFAULT_ORIGIN_COORDS.lat;
    const curLng = DEFAULT_ORIGIN_COORDS.lng;

    const remaining = [...waypoints];
    const initialRoute = [];

    let currentLat = curLat;
    let currentLng = curLng;

    while (remaining.length > 0) {
      let bestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const item = remaining[i];
        const rLat = parseFloat(item.latitude) || currentLat;
        const rLng = parseFloat(item.longitude) || currentLng;
        const dist = getHaversineDistance(currentLat, currentLng, rLat, rLng);

        if (dist < minDistance) {
          minDistance = dist;
          bestIdx = i;
        }
      }

      const bestItem = remaining.splice(bestIdx, 1)[0];
      initialRoute.push(bestItem);

      currentLat = parseFloat(bestItem.latitude) || currentLat;
      currentLng = parseFloat(bestItem.longitude) || currentLng;

      // If bestItem belongs to a locked group, pull in all other members in their original relative order!
      if (bestItem.lockGroupId) {
        const grpId = bestItem.lockGroupId;
        for (let ri = 0; ri < remaining.length; ) {
          if (remaining[ri].lockGroupId === grpId) {
            const sibling = remaining.splice(ri, 1)[0];
            initialRoute.push(sibling);
            currentLat = parseFloat(sibling.latitude) || currentLat;
            currentLng = parseFloat(sibling.longitude) || currentLng;
          } else {
            ri++;
          }
        }
      }
    }

    activeRoute.waypoints = initialRoute;
    this.saveState();
    this.render();
  }

  handleClearRoute() {
    const activeRoute = this.getActiveRoute();
    if (!activeRoute.waypoints || activeRoute.waypoints.length === 0) {
      alert("当前路线已为空。");
      return;
    }
    if (confirm(`确定要清空【${activeRoute.name}】中的全部 ${activeRoute.waypoints.length} 个途径点吗？`)) {
      activeRoute.waypoints = [];
      this.selectedWaypointKeys.clear();
      this.saveState();
      this.render();
    }
  }

  /**
   * Build Google Maps directions URL with origin and stops
   */
  buildSlashUrl(origin, stops) {
    const originStr = encodeURIComponent(origin);
    const stopStrs = stops.map(s => {
      const q = (s.name ? s.name + ", " : "") + (s.address || "");
      return encodeURIComponent(q);
    });
    return `https://www.google.com/maps/dir/${originStr}/${stopStrs.join("/")}/`;
  }

  handleGenerateNav() {
    const activeRoute = this.getActiveRoute();
    const waypoints = activeRoute.waypoints || [];
    const origin = activeRoute.origin || DEFAULT_ORIGIN;

    if (waypoints.length === 0) {
      alert("当前路线中尚无途径点，请先在 Google Maps 官方网页添加经停点。");
      return;
    }

    const STEP = 9;
    if (waypoints.length <= STEP) {
      const url = this.buildSlashUrl(origin, waypoints);
      window.open(url, "_blank");
      return;
    }

    const totalLegs = Math.ceil(waypoints.length / STEP);
    const legs = [];

    for (let i = 0; i < totalLegs; i++) {
      const startIdx = i * STEP;
      const endIdx = Math.min(startIdx + STEP, waypoints.length);
      const legStops = waypoints.slice(startIdx, endIdx);

      const legOrigin = i === 0 ? origin : ((waypoints[startIdx - 1].name ? waypoints[startIdx - 1].name + ", " : "") + (waypoints[startIdx - 1].address || ""));
      const legUrl = this.buildSlashUrl(legOrigin, legStops);

      const fromLabel = i === 0 ? "Green Oil HQ" : (waypoints[startIdx - 1].name || `第 ${startIdx} 站`);
      const toLabel = legStops[legStops.length - 1].name || `第 ${endIdx} 站`;

      legs.push({
        index: i + 1,
        from: fromLabel,
        to: toLabel,
        count: legStops.length,
        url: legUrl
      });
    }

    this.renderNavModal(legs);
  }

  renderNavModal(legs) {
    this.elNavLegsList.innerHTML = "";
    legs.forEach(leg => {
      const item = document.createElement("div");
      item.className = "nav-leg-item";
      item.innerHTML = `
        <div class="leg-info">
          <div class="leg-title">第 ${leg.index} 段（${leg.count} 个经停点）</div>
          <div class="leg-subtitle">${this.escapeHtml(leg.from)} &rarr; ${this.escapeHtml(leg.to)}</div>
        </div>
        <button class="btn btn-secondary">导航本段</button>
      `;
      item.querySelector("button").addEventListener("click", () => {
        window.open(leg.url, "_blank");
      });
      this.elNavLegsList.appendChild(item);
    });

    this.elBtnOpenAllLegs.onclick = () => {
      legs.forEach(leg => window.open(leg.url, "_blank"));
    };

    this.elNavModal.style.display = "flex";
  }

  closeNavModal() {
    this.elNavModal.style.display = "none";
  }

  /**
   * Export English Excel without Phone numbers
   */
  handleExportExcel() {
    const activeRoute = this.getActiveRoute();
    const waypoints = activeRoute.waypoints || [];

    if (waypoints.length === 0) {
      alert("当前路线无经停点可导出。");
      return;
    }

    const xlsxLib = window.XLSX;
    if (!xlsxLib) {
      alert("Excel 导出组件尚未加载完成，请稍后重试。");
      return;
    }

    const exportRows = waypoints.map((w, idx) => ({
      "No.": idx + 1,
      "Restaurant Name": toEnglishRestaurantName(w.name, w.nameEn),
      "Address": toEnglishAddress(w.address),
      "Opening Hours": formatOpeningHoursEnglish(w.openingHours)
    }));

    const ws = xlsxLib.utils.json_to_sheet(exportRows);
    ws["!cols"] = [
      { wch: 8 },   // No.
      { wch: 38 },  // Restaurant Name
      { wch: 48 },  // Address
      { wch: 38 }   // Opening Hours
    ];

    const wb = xlsxLib.utils.book_new();
    xlsxLib.utils.book_append_sheet(wb, ws, "Route Stops");

    const dateStr = new Date().toISOString().slice(0, 10);
    const cleanRouteName = activeRoute.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
    xlsxLib.writeFile(wb, `GreenOil_${cleanRouteName}_Stops_${dateStr}.xlsx`);
  }

  // Cloud Sync
  async handleCloudSync() {
    if (!this.authToken) {
      this.openAuthModal();
      return;
    }

    this.elBtnSyncCloud.disabled = true;
    try {
      const activeRoute = this.getActiveRoute();
      const origin = activeRoute.origin || DEFAULT_ORIGIN;
      const res = await GreenOilApi.saveMapRoutes(this.authToken, this.colorRoutes, this.activeRouteId, origin);

      if (res && res.success) {
        this.lastSyncedAt = new Date().toISOString();
        await this.saveState();
        this.updateAuthStatusUI();
        alert("云端路线数据同步成功！");
      } else {
        alert(res?.error || "云端同步失败，请检查登录凭据");
      }
    } catch (e) {
      alert("同步请求异常：" + e.message);
    } finally {
      this.elBtnSyncCloud.disabled = false;
    }
  }

  updateAuthStatusUI() {
    if (this.authToken && this.authUser) {
      this.elAuthDot.classList.add("authed");
      this.elAuthDot.title = `已连接账号: ${this.authUser}`;
      this.elAuthLoggedView.style.display = "block";
      this.elAuthLoginForm.style.display = "none";
      this.elAuthUsernameDisplay.textContent = `操作员: ${this.authUser}`;
      this.elAuthSyncTimeDisplay.textContent = this.lastSyncedAt ? `上次同步: ${this.lastSyncedAt.slice(0, 19).replace('T', ' ')}` : "尚未进行云端同步";
    } else {
      this.elAuthDot.classList.remove("authed");
      this.elAuthDot.title = "未连接云端";
      this.elAuthLoggedView.style.display = "none";
      this.elAuthLoginForm.style.display = "block";
    }
  }

  openAuthModal() {
    this.updateAuthStatusUI();
    this.elAuthErrorMsg.style.display = "none";
    this.elAuthModal.style.display = "flex";
  }

  closeAuthModal() {
    this.elAuthModal.style.display = "none";
  }

  async handleLogin() {
    const user = this.elInputUsername.value.trim();
    const pass = this.elInputPassword.value.trim();

    if (!user || !pass) {
      this.showAuthError("请输入用户名与密码");
      return;
    }

    this.elBtnLogin.disabled = true;
    this.elAuthErrorMsg.style.display = "none";

    try {
      const res = await GreenOilApi.login(user, pass);
      if (res && res.success && res.token) {
        this.authToken = res.token;
        this.authUser = res.user?.username || user;
        this.lastSyncedAt = new Date().toISOString();
        await this.saveState();
        this.updateAuthStatusUI();

        // Pull latest routes from cloud on login
        const cloudData = await GreenOilApi.getMapRoutes(this.authToken);
        if (cloudData && cloudData.success && cloudData.data && cloudData.data.gce_color_routes) {
          this.colorRoutes = { ...this.colorRoutes, ...cloudData.data.gce_color_routes };
          this.activeRouteId = cloudData.data.gce_active_route_id || this.activeRouteId;
          await this.saveState();
          this.applyTheme(this.getActiveRoute());
          this.render();
        }

        this.closeAuthModal();
      } else {
        this.showAuthError(res?.message || res?.error || "登录失败，请检查账号密码");
      }
    } catch (e) {
      this.showAuthError("网络异常：" + e.message);
    } finally {
      this.elBtnLogin.disabled = false;
    }
  }

  async handleLogout() {
    this.authToken = "";
    this.authUser = "";
    await this.saveState();
    this.updateAuthStatusUI();
  }

  showAuthError(msg) {
    this.elAuthErrorMsg.textContent = msg;
    this.elAuthErrorMsg.style.display = "block";
  }
}

function initPopup() {
  window.popupController = new PopupController();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}
