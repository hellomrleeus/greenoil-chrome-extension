/**
 * Green Oil Chrome Extension - Popup Controller
 * Manages multi-route groups, English waypoint management, leg navigation, and English Excel export without phone numbers.
 */

import { GreenOilApi } from "./api.js";
import { toEnglishAddress, toEnglishRestaurantName, formatOpeningHoursEnglish } from "./utils.js";

const DEFAULT_ORIGIN = "Green Oil Inc. 4490 Chesswood Dr Unit 3, North York, ON M3J 2B9";

const SVG_TRASH = `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
const SVG_UP = `<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`;
const SVG_DOWN = `<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`;
const SVG_LINK = `<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`;
const SVG_STAR = `<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
const SVG_CLOCK = `<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`;
const SVG_EMPTY = `<svg class="empty-icon" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

class PopupController {
  constructor() {
    this.groups = [];
    this.activeGroupId = "group_default";
    this.authToken = "";
    this.authUser = "";
    this.lastSyncedAt = null;

    this.initElements();
    this.bindEvents();
    this.loadState();
  }

  initElements() {
    this.elRouteSelect = document.getElementById("routeSelect");
    this.elBtnNewRoute = document.getElementById("btnNewRoute");
    this.elBtnRenameRoute = document.getElementById("btnRenameRoute");
    this.elBtnDeleteRoute = document.getElementById("btnDeleteRoute");

    this.elInputOrigin = document.getElementById("inputOrigin");
    this.elBtnResetOrigin = document.getElementById("btnResetOrigin");

    this.elBadgeCount = document.getElementById("badgeCount");
    this.elWaypointsList = document.getElementById("waypointsList");

    this.elBtnGenerateNav = document.getElementById("btnGenerateNav");
    this.elBtnExportExcel = document.getElementById("btnExportExcel");
    this.elBtnClearRoute = document.getElementById("btnClearRoute");

    this.elBtnSyncCloud = document.getElementById("btnSyncCloud");
    this.elBtnOpenAuth = document.getElementById("btnOpenAuth");
    this.elAuthDot = document.getElementById("authDot");

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

  bindEvents() {
    // Route Selection
    this.elRouteSelect.addEventListener("change", () => {
      this.activeGroupId = this.elRouteSelect.value;
      this.saveState();
      this.render();
    });

    this.elBtnNewRoute.addEventListener("click", () => this.handleNewRoute());
    this.elBtnRenameRoute.addEventListener("click", () => this.handleRenameRoute());
    this.elBtnDeleteRoute.addEventListener("click", () => this.handleDeleteRoute());

    // Origin Address
    this.elInputOrigin.addEventListener("change", () => {
      const activeGroup = this.getActiveGroup();
      if (activeGroup) {
        activeGroup.origin = this.elInputOrigin.value.trim() || DEFAULT_ORIGIN;
        this.saveState();
      }
    });

    this.elBtnResetOrigin.addEventListener("click", () => {
      const activeGroup = this.getActiveGroup();
      if (activeGroup) {
        activeGroup.origin = DEFAULT_ORIGIN;
        this.elInputOrigin.value = DEFAULT_ORIGIN;
        this.saveState();
      }
    });

    // Actions
    this.elBtnGenerateNav.addEventListener("click", () => this.handleGenerateNav());
    this.elBtnExportExcel.addEventListener("click", () => this.handleExportExcel());
    this.elBtnClearRoute.addEventListener("click", () => this.handleClearRoute());

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
    const data = await chrome.storage.local.get(["groups", "activeGroupId", "authToken", "authUser", "lastSyncedAt"]);

    if (Array.isArray(data.groups) && data.groups.length > 0) {
      this.groups = data.groups;
    } else {
      this.groups = [
        {
          id: "group_default",
          name: "路线 1",
          origin: DEFAULT_ORIGIN,
          waypoints: []
        }
      ];
    }

    this.activeGroupId = data.activeGroupId || this.groups[0].id;
    if (!this.groups.some(g => g.id === this.activeGroupId)) {
      this.activeGroupId = this.groups[0].id;
    }

    this.authToken = data.authToken || "";
    this.authUser = data.authUser || "";
    this.lastSyncedAt = data.lastSyncedAt || null;

    this.updateAuthStatusUI();
    this.render();
  }

  async saveState() {
    await chrome.storage.local.set({
      groups: this.groups,
      activeGroupId: this.activeGroupId,
      authToken: this.authToken,
      authUser: this.authUser,
      lastSyncedAt: this.lastSyncedAt
    });

    chrome.runtime.sendMessage({ action: "updateBadge" });
  }

  getActiveGroup() {
    return this.groups.find(g => g.id === this.activeGroupId) || this.groups[0];
  }

  render() {
    // 1. Render Route Selector
    this.elRouteSelect.innerHTML = "";
    this.groups.forEach(g => {
      const opt = document.createElement("option");
      opt.value = g.id;
      const count = Array.isArray(g.waypoints) ? g.waypoints.length : 0;
      opt.textContent = `${g.name} (${count} 站)`;
      if (g.id === this.activeGroupId) opt.selected = true;
      this.elRouteSelect.appendChild(opt);
    });

    const activeGroup = this.getActiveGroup();
    const waypoints = Array.isArray(activeGroup.waypoints) ? activeGroup.waypoints : [];

    // 2. Render Origin Address
    this.elInputOrigin.value = activeGroup.origin || DEFAULT_ORIGIN;

    // 3. Render Badge Count
    this.elBadgeCount.textContent = `${waypoints.length} 站`;

    // 4. Render Waypoints List
    this.elWaypointsList.innerHTML = "";

    if (waypoints.length === 0) {
      this.elWaypointsList.innerHTML = `
        <div class="empty-state">
          ${SVG_EMPTY}
          <div class="empty-text">当前路线暂无经停点</div>
          <div class="empty-subtext">在 Google Maps 官方网页浏览地点时，点击面板中的【+ 途径点】按钮即可加入当前路线。</div>
        </div>
      `;
      return;
    }

    waypoints.forEach((wp, index) => {
      const card = document.createElement("div");
      card.className = "waypoint-card";

      const displayName = toEnglishRestaurantName(wp.name, wp.nameEn);
      const displayAddress = toEnglishAddress(wp.address);
      const hoursEn = formatOpeningHoursEnglish(wp.openingHours);

      let hoursHtml = "";
      if (hoursEn && hoursEn !== "N/A") {
        hoursHtml = `<span class="card-hours" title="${this.escapeHtml(hoursEn)}">${SVG_CLOCK} ${this.escapeHtml(hoursEn)}</span>`;
      }

      // Meta: rating, reviews, and hours
      let metaHtml = "";
      if (wp.rating || hoursHtml) {
        metaHtml = `
          <div class="card-meta">
            ${wp.rating ? `<span class="card-rating">${SVG_STAR} ${wp.rating}</span><span class="card-reviews">(${wp.reviews || 0} reviews)</span>` : ''}
            ${hoursHtml}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="card-index">#${index + 1}</div>
        <div class="card-main">
          <div class="card-name" title="${this.escapeHtml(displayName)}">${this.escapeHtml(displayName)}</div>
          <div class="card-address" title="${this.escapeHtml(displayAddress)}">${this.escapeHtml(displayAddress)}</div>
          ${metaHtml}
        </div>
        <div class="card-actions">
          <button class="btn-card-action btn-move-up" title="上移" ${index === 0 ? 'disabled' : ''}>
            ${SVG_UP}
          </button>
          <button class="btn-card-action btn-move-down" title="下移" ${index === waypoints.length - 1 ? 'disabled' : ''}>
            ${SVG_DOWN}
          </button>
          <button class="btn-card-action btn-open-map" title="在 Google 地图中查看">
            ${SVG_LINK}
          </button>
          <button class="btn-card-action danger btn-delete" title="删除">
            ${SVG_TRASH}
          </button>
        </div>
      `;

      // Event listeners for card buttons
      const btnUp = card.querySelector(".btn-move-up");
      const btnDown = card.querySelector(".btn-move-down");
      const btnOpenMap = card.querySelector(".btn-open-map");
      const btnDelete = card.querySelector(".btn-delete");

      btnUp.addEventListener("click", () => this.moveWaypoint(index, index - 1));
      btnDown.addEventListener("click", () => this.moveWaypoint(index, index + 1));
      btnOpenMap.addEventListener("click", () => {
        const url = wp.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(displayName + " " + displayAddress)}`;
        window.open(url, "_blank");
      });
      btnDelete.addEventListener("click", () => this.deleteWaypoint(index));

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

  moveWaypoint(fromIdx, toIdx) {
    const activeGroup = this.getActiveGroup();
    const wps = activeGroup.waypoints;
    if (toIdx < 0 || toIdx >= wps.length) return;

    const item = wps.splice(fromIdx, 1)[0];
    wps.splice(toIdx, 0, item);

    this.saveState();
    this.render();
  }

  deleteWaypoint(index) {
    const activeGroup = this.getActiveGroup();
    activeGroup.waypoints.splice(index, 1);
    this.saveState();
    this.render();
  }

  handleClearRoute() {
    const activeGroup = this.getActiveGroup();
    if (!activeGroup.waypoints || activeGroup.waypoints.length === 0) {
      alert("当前路线已为空。");
      return;
    }
    if (confirm(`确定要清空【${activeGroup.name}】中的全部 ${activeGroup.waypoints.length} 个途径点吗？`)) {
      activeGroup.waypoints = [];
      this.saveState();
      this.render();
    }
  }

  handleNewRoute() {
    const defaultName = `路线 ${this.groups.length + 1}`;
    const name = prompt("请输入新路线分组名称：", defaultName);
    if (!name || !name.trim()) return;

    const newGroup = {
      id: "group_" + Date.now(),
      name: name.trim(),
      origin: DEFAULT_ORIGIN,
      waypoints: []
    };

    this.groups.push(newGroup);
    this.activeGroupId = newGroup.id;
    this.saveState();
    this.render();
  }

  handleRenameRoute() {
    const activeGroup = this.getActiveGroup();
    const newName = prompt("请输入路线新名称：", activeGroup.name);
    if (!newName || !newName.trim() || newName.trim() === activeGroup.name) return;

    activeGroup.name = newName.trim();
    this.saveState();
    this.render();
  }

  handleDeleteRoute() {
    if (this.groups.length <= 1) {
      alert("必须保留至少一个路线分组。如需重新开始，请点击【清空】。");
      return;
    }

    const activeGroup = this.getActiveGroup();
    if (confirm(`确定要删除路线分组【${activeGroup.name}】及其所有经停点吗？`)) {
      this.groups = this.groups.filter(g => g.id !== activeGroup.id);
      this.activeGroupId = this.groups[0].id;
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
    const activeGroup = this.getActiveGroup();
    const waypoints = activeGroup.waypoints || [];
    const origin = activeGroup.origin || DEFAULT_ORIGIN;

    if (waypoints.length === 0) {
      alert("当前路线中尚无途径点，请先在 Google Maps 官方网页添加经停点。");
      return;
    }

    // Google Maps directions supports up to 9 intermediate stops per link cleanly
    const STEP = 9;
    if (waypoints.length <= STEP) {
      const url = this.buildSlashUrl(origin, waypoints);
      window.open(url, "_blank");
      return;
    }

    // Partition into legs
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
    const activeGroup = this.getActiveGroup();
    const waypoints = activeGroup.waypoints || [];

    if (waypoints.length === 0) {
      alert("当前路线无经停点可导出。");
      return;
    }

    const xlsxLib = window.XLSX;
    if (!xlsxLib) {
      alert("Excel 导出组件尚未加载完成，请稍后重试。");
      return;
    }

    // Strictly English Headers and Content: No., Restaurant Name, Address, Opening Hours
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
    const cleanRouteName = activeGroup.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
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
      const activeGroup = this.getActiveGroup();
      const origin = activeGroup.origin || DEFAULT_ORIGIN;
      const res = await GreenOilApi.saveMapRoutes(this.authToken, this.groups, this.activeGroupId, origin);

      if (res && res.success) {
        this.lastSyncedAt = new Date().toISOString();
        await this.saveState();
        this.updateAuthStatusUI();
        alert("云端多路线数据同步成功！");
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
        if (cloudData && cloudData.success && cloudData.data && Array.isArray(cloudData.data.groups) && cloudData.data.groups.length > 0) {
          this.groups = cloudData.data.groups;
          this.activeGroupId = cloudData.data.activeGroupId || this.groups[0].id;
          await this.saveState();
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

document.addEventListener("DOMContentLoaded", () => {
  new PopupController();
});
