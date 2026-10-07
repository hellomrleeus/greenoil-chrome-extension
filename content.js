/**
 * Green Oil Chrome Extension - Content Script for Google Maps
 * Place actions and lifecycle-managed coloring for Google Maps' native markers.
 * Only injects the button when viewing a place. Extracts place details on-demand upon click.
 */

if (window.__greenoil_injected__) {
  if (typeof window.__greenoil_check__ === "function") {
    window.__greenoil_check__();
  }
} else {
  window.__greenoil_injected__ = true;
  (() => {
    const lifetime = new AbortController();
    const timers = new Set();
    const intervals = new Set();
    const frames = new Set();
    let disposed = false;
    const owner = `${Date.now()}-${Math.random()}`;
    const ownerAttribute = "data-greenoil-owner";
    const listen = (target, type, handler, options = {}) => {
      const settings = typeof options === "boolean" ? { capture: options } : options;
      target.addEventListener(type, (...args) => { if (isAlive()) handler(...args); },
        { ...settings, signal: lifetime.signal });
    };
    function isAlive() {
      if (disposed) return false;
      if (!chrome.runtime?.id || document.documentElement.getAttribute(ownerAttribute) !== owner) {
        dispose();
        return false;
      }
      return true;
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      const ownsDocument = document.documentElement.getAttribute(ownerAttribute) === owner;
      if (ownsDocument && typeof removeAnyPinOverlays === "function") removeAnyPinOverlays();
      lifetime.abort();
      timers.forEach(id => window.clearTimeout(id));
      intervals.forEach(id => window.clearInterval(id));
      frames.forEach(id => window.cancelAnimationFrame(id));
      if (ownsDocument) {
        document.querySelectorAll('[id^="greenoil-"]').forEach(el => el.remove());
        document.documentElement.removeAttribute(ownerAttribute);
        window.__greenoil_injected__ = false;
      }
    }
    function setTimeout(fn, delay) {
      const id = window.setTimeout(() => { timers.delete(id); if (isAlive()) fn(); }, delay);
      timers.add(id);
      return id;
    }
    function setInterval(fn, delay) {
      const id = window.setInterval(() => { if (isAlive()) fn(); }, delay);
      intervals.add(id);
      return id;
    }
    function requestAnimationFrame(fn) {
      const id = window.requestAnimationFrame((time) => {
        frames.delete(id);
        if (isAlive()) fn(time);
      });
      frames.add(id);
      return id;
    }
    document.documentElement.setAttribute(ownerAttribute, owner);
    window.__greenoil_dispose__ = dispose;
    listen(window, "pagehide", (event) => { if (!event.persisted) dispose(); });

    let lastProcessedKey = "";
    let currentTheme = { color: "#059669", hoverColor: "#047857", lightColor: "#ecfdf5", borderColor: "#10b981", name: "绿线" };
    let isLoggedIn = false;

    function applyThemeToContainer(container, theme) {
      if (!container || !theme) return;
      container.style.setProperty("--go-theme", theme.color || "#059669");
      container.style.setProperty("--go-hover", theme.hoverColor || "#047857");
      container.style.setProperty("--go-light", theme.lightColor || "#ecfdf5");
      container.style.setProperty("--go-border", theme.borderColor || "#10b981");
    }

    function applyUnauthedState(container, circle, label) {
      if (!container) return;
      container.classList.remove("greenoil-added");
      container.classList.add("greenoil-not-logged-in");
      delete container.dataset.belongRouteName;
      delete container.dataset.belongRouteId;
      container.title = "未登录 Green Oil 账号，请点击浏览器右上角扩展图标登录后再添加途径点";
      if (circle) circle.innerHTML = SVG_PLUS;
      if (label) label.textContent = "+ 途径点 (需登录)";
    }

    try {
      if (chrome.storage?.local) {
        chrome.storage.local.get("authToken", (res) => {
          isLoggedIn = Boolean(res?.authToken);
          const btnContainer = document.getElementById("greenoil-add-waypoint-btn");
          if (btnContainer && !isLoggedIn) {
            applyUnauthedState(
              btnContainer,
              btnContainer.querySelector(".greenoil-action-circle"),
              btnContainer.querySelector(".greenoil-action-label")
            );
          }
        });
      }
      if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (!isAlive()) return;
          if (area === "local" && changes.authToken) {
            isLoggedIn = Boolean(changes.authToken.newValue);
            lastProcessedKey = "";
            if (!isLoggedIn) {
              newRestaurantsList = [];
              renderNewRestaurantPins();
            } else {
              loadNewRestaurantsData();
            }
            if (typeof checkAndInject === "function") checkAndInject();
            if (typeof refreshWaypointPins === "function") refreshWaypointPins();
          }
        });
      }
    } catch (_) {}

    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: "getActiveTheme" }, (resp) => {
          if (resp && resp.unauthorized) {
            isLoggedIn = false;
            newRestaurantsList = [];
            renderNewRestaurantPins();
            const btnContainer = document.getElementById("greenoil-add-waypoint-btn");
            if (btnContainer) {
              applyUnauthedState(
                btnContainer,
                btnContainer.querySelector(".greenoil-action-circle"),
                btnContainer.querySelector(".greenoil-action-label")
              );
            }
          } else if (resp && resp.theme) {
            isLoggedIn = true;
            currentTheme = resp.theme;
            const btnContainer = document.getElementById("greenoil-add-waypoint-btn");
            if (btnContainer && !btnContainer.classList.contains("greenoil-added") && !btnContainer.classList.contains("greenoil-not-logged-in")) {
              applyThemeToContainer(btnContainer, currentTheme);
            }
            if (typeof rebuildPinElements === "function") rebuildPinElements();
          }
        });
      }
    } catch (_) {}

    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!isAlive()) return;
        if (message.action === "themeColorChanged" && message.theme) {
          currentTheme = message.theme;
          const btnContainer = document.getElementById("greenoil-add-waypoint-btn");
          if (btnContainer && !btnContainer.classList.contains("greenoil-added")) {
            applyThemeToContainer(btnContainer, currentTheme);
            btnContainer.title = `加入当前地点到【${currentTheme.name}】`;
          }
          lastProcessedKey = "";
          if (typeof checkAndInject === "function") {
            checkAndInject();
          }
          if (typeof refreshWaypointPins === "function") {
            refreshWaypointPins();
          }
        }

        // Waypoint lists changed in the cloud (popup edit, add from any tab).
        if (message.action === "routesChanged") {
          lastProcessedKey = "";
          if (typeof checkAndInject === "function") checkAndInject();
          if (typeof refreshWaypointPins === "function") refreshWaypointPins();
        }

        if (message.action === "didPanToWaypoint" && message.waypoint) {
          showToast("已定位", message.waypoint.name || "途径点");
          lastProcessedKey = "";
          setTimeout(() => {
            if (typeof checkAndInject === "function") {
              checkAndInject();
            }
          }, 500);
        }

        if (message.action === "panToLocation" && message.waypoint) {
          inPagePanToLocation(message.targetPath, message.waypoint);
          // Answer so the background does not fall back to a page load.
          sendResponse({ success: true });
        }

        if (message.action === "centerMapCoordinates") {
          const wp = {
            latitude: message.latitude,
            longitude: message.longitude,
            name: message.name || "新开餐馆"
          };
          const targetPath = `/maps/@${message.latitude},${message.longitude},17z`;
          inPagePanToLocation(targetPath, wp);
          sendResponse({ success: true });
        }

      });
    }

    // Top-level custom event bridge for main-world communication
    listen(window, "greenoil-cmd", (e) => {
      const { action, data } = e.detail || {};
      if (chrome.runtime?.id && action) {
        chrome.runtime.sendMessage({ action, ...data }, (resp) => {
          window.dispatchEvent(new CustomEvent("greenoil-cmd-resp", { detail: resp }));
        });
      }
    });

    // Window focus and visibility listeners for instant login state sync
    listen(window, "focus", () => {
      refreshWaypointPins();
    });

    listen(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshWaypointPins();
      }
    });

    function closeAllNewRestaurantTooltips() {
      if (document.querySelectorAll) {
        document.querySelectorAll(".greenoil-new-pin.active, .greenoil-new-pin.dismissed").forEach(p => {
          p.classList.remove("active");
          p.classList.remove("dismissed");
        });
      }
    }

    listen(window, "pointerdown", (e) => {
      if (e.target?.closest && !e.target.closest(".greenoil-new-pin")) {
        closeAllNewRestaurantTooltips();
      }
    }, { capture: true });

    listen(window, "click", (e) => {
      if (e.target?.closest && !e.target.closest(".greenoil-new-pin")) {
        closeAllNewRestaurantTooltips();
      }
    }, { capture: true });

    listen(window, "keydown", (e) => {
      if (e.key === "Escape") {
        closeAllNewRestaurantTooltips();
      }
    });

  const SVG_PLUS = `<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
  const SVG_CHECK = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  const SVG_INFO = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
  const SVG_SPINNER = `<svg viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>`;
  const SVG_CLOSE = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const SVG_EXTERNAL = `<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`;
  const SVG_SORT_UP_DOWN = `<svg width="9" height="11" viewBox="0 0 10 12"><path d="M3 0L0 4h2v8h2V4h2L3 0zm4 12l3-4H8V0H6v8H4l3 4z" fill="rgba(255,255,255,0.7)"/></svg>`;
  const SVG_SORT_DOWN = `<svg width="8" height="7" viewBox="0 0 10 8"><path d="M5 8L0 0h10L5 8z" fill="#ffffff"/></svg>`;
  const SVG_CHIP_BOX = `<svg width="12" height="12" viewBox="0 0 24 24"><path d="M4 4h16v4H4V4zm1 6h14v10H5V10z"/></svg>`;
  const SVG_CHIP_DRUM = `<svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 3.79 2 6v12c0 2.21 4.48 4 10 4s10-1.79 10-4V6c0-2.21-4.48-4-10-4zm0 2c4.41 0 8 1.34 8 2s-3.59 2-8 2-8-1.34-8-2 3.59-2 8-2z"/></svg>`;
  const SVG_TRASH = `<svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
  const SVG_COPY = `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;

  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch (_) {
      return false;
    }
  }

  // State for native Google Maps marker coloring
  let currentRouteWaypoints = [];

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeMapPlaceName(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  // ==========================================
  // Map pins (DOM only)
  //
  // Positioning lives in map-hook.js (page MAIN world): it reads Google's
  // exact per-frame camera from the WebGL renderer and moves every
  // [data-greenoil-lat][data-greenoil-lng] element inside the pin layer in
  // the same frame the map is drawn. This side only builds the elements.
  //
  // The overlay is mounted inside Google's map container, right after the
  // map canvas: Google's side panel, search box and controls stack above
  // it, and the container's overflow:hidden clips pins to the map.
  // ==========================================

  // Google's POI pinlet (the restaurant search-result marker), same
  // geometry: 28x32 box, white-rimmed drop (head r12 at 14,14, tip at
  // 14,29), a 20px coloured disc and a ~12px white glyph in the middle.
  const PIN_OUTLINE_PATH = "M14 2C7.373 2 2 7.373 2 14c0 6.6 8 11.5 12 15 4-3.5 12-8.4 12-15 0-6.627-5.373-12-12-12z";
  function pinSvg(color, discClass = "") {
    return `<svg viewBox="0 0 28 32" class="greenoil-pin-svg" aria-hidden="true">
          <path d="${PIN_OUTLINE_PATH}" fill="#ffffff"/>
          <circle cx="14" cy="14" r="10"${discClass ? ` class="${discClass}"` : ""} fill="${color}"/>
        </svg>`;
  }
  const pinGlyph = (d) => `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#ffffff" d="${d}"/></svg>`;

  // Topmost full-size map canvas. Newer Maps stacks a WebGL canvas and the
  // Worker's OffscreenCanvas at the same size; pins must go after the later
  // (upper) one or the map covers them.
  function mapCanvas() {
    let best = null;
    let bestArea = 0;
    document.querySelectorAll("canvas.H1VXrf").forEach((c) => {
      const area = c.clientWidth * c.clientHeight;
      if (area > 0 && area >= bestArea) { best = c; bestArea = area; }
    });
    return best;
  }

  function ensurePinLayer() {
    const canvas = mapCanvas();
    let overlay = document.getElementById("greenoil-waypoint-pins-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "greenoil-waypoint-pins-overlay";
      overlay.setAttribute("aria-hidden", "true");
    }
    // (Re)mount right after the map canvas; Google may rebuild its container.
    if (canvas && overlay.previousElementSibling !== canvas) {
      canvas.insertAdjacentElement("afterend", overlay);
    }
    let layer = document.getElementById("greenoil-waypoint-pin-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "greenoil-waypoint-pin-layer";
      overlay.appendChild(layer);
    }
    // Resident matched pins, then 探索 pins, newly opened pins, route waypoints on top
    for (const id of ["greenoil-pins-matched", "greenoil-pins-explore", "greenoil-pins-new", "greenoil-pins-route"]) {
      if (!document.getElementById(id)) {
        const group = document.createElement("div");
        group.id = id;
        group.className = "greenoil-pin-group";
        layer.appendChild(group);
      }
    }
    return overlay.isConnected ? layer : null;
  }

  function makePin(lat, lng, kind, color, innerHtml) {
    const pin = document.createElement("div");
    pin.className = "greenoil-waypoint-map-pin";
    pin.dataset.kind = kind;
    pin.dataset.greenoilLat = String(lat);
    pin.dataset.greenoilLng = String(lng);
    pin.innerHTML = `
      <div class="greenoil-pin-body">
        ${pinSvg(color)}
        ${innerHtml}
      </div>`;
    return pin;
  }

  // ==========================================
  // Newly Opened Restaurants (Toronto DineSafe) Layer
  // ==========================================
  const COLOR_NEW = "#0284c7";
  const SVG_STORE_PATH = "M12 3L2 12h3v8h14v-8h3L12 3zm0 2.5l6 5.4V18H6v-7.1l6-5.4z";
  let showNewRestaurants = true;
  let newRestaurantsList = [];

  function isRestaurantInRoute(rest) {
    if (!Array.isArray(currentRouteWaypoints) || !rest) return false;
    const rNameNorm = normalizeMapPlaceName(rest.name);
    const rLat = parseFloat(rest.latitude);
    const rLng = parseFloat(rest.longitude);
    return currentRouteWaypoints.some(wp => {
      if (wp.placeId && rest.id && wp.placeId === rest.id) return true;
      if (wp.name && rest.name) {
        const wNorm = normalizeMapPlaceName(wp.name);
        if (wNorm && rNameNorm && (wNorm === rNameNorm || wNorm.includes(rNameNorm) || rNameNorm.includes(wNorm))) return true;
      }
      if (Number.isFinite(wp.latitude) && Number.isFinite(rLat) && Number.isFinite(wp.longitude) && Number.isFinite(rLng)) {
        if (getHaversineDistKm(wp.latitude, wp.longitude, rLat, rLng) < 0.05) return true;
      }
      return false;
    });
  }

  function makeNewRestaurantPin(rest) {
    const lat = parseFloat(rest.latitude);
    const lng = parseFloat(rest.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const pin = document.createElement("div");
    pin.className = "greenoil-waypoint-map-pin greenoil-new-pin";
    pin.dataset.kind = "new-restaurant";
    pin.dataset.greenoilLat = String(lat);
    pin.dataset.greenoilLng = String(lng);
    pin.setAttribute("tabindex", "0");
    pin.setAttribute("role", "button");
    pin.setAttribute("aria-label", `${rest.name} - ${rest.address}`);

    const dateText = rest.estimatedOpeningDate || rest.firstInspectionDate || "";
    const inRoute = isRestaurantInRoute(rest);

    pin.innerHTML = `
      <div class="greenoil-pin-body">
        ${pinSvg(COLOR_NEW)}
        <span class="greenoil-new-icon">${pinGlyph(SVG_STORE_PATH)}</span>
      </div>
      <div class="greenoil-new-tooltip">
        <div class="greenoil-new-tooltip-header">
          <div class="greenoil-new-tooltip-badge">新开业 (首次卫生检查)</div>
          <button type="button" class="greenoil-new-tooltip-close-btn" title="关闭" aria-label="关闭">
            ${SVG_CLOSE}
          </button>
        </div>
        <div class="greenoil-new-tooltip-name">${escapeHtml(rest.name || "")}</div>
        <div class="greenoil-new-tooltip-address"${rest.address ? ' title="点击复制地址" role="button" tabindex="0"' : ""}>
          <span class="greenoil-new-tooltip-address-text">${escapeHtml(rest.address || "")}</span>
          ${rest.address ? `<span class="greenoil-new-tooltip-copy-btn" title="点击复制地址" aria-label="点击复制地址">${SVG_COPY}</span>` : ""}
        </div>
        ${dateText ? `<div class="greenoil-new-tooltip-meta">预计开业: ${escapeHtml(dateText)}</div>` : ""}
        <div class="greenoil-new-tooltip-footer">
          <button type="button" class="greenoil-new-tooltip-add-btn${inRoute ? " is-added" : (!isLoggedIn ? " is-unauthed" : "")}"
            title="${inRoute ? "已存在于当前路线中" : (!isLoggedIn ? "需要登录 Green Oil 账号" : "加入当前路线途径点")}">
            ${inRoute ? SVG_CHECK : SVG_PLUS}
            <span>${inRoute ? "已在路线中" : (!isLoggedIn ? "加入路线 (需登录)" : "加入路线")}</span>
          </button>
        </div>
      </div>`;

    const tooltip = pin.querySelector(".greenoil-new-tooltip");
    if (tooltip) {
      tooltip.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }

    const closeBtn = pin.querySelector(".greenoil-new-tooltip-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        pin.classList.remove("active");
        pin.classList.add("dismissed");
      });
    }

    const addressEl = pin.querySelector(".greenoil-new-tooltip-address");
    if (addressEl && rest.address) {
      addressEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const success = await copyToClipboard(rest.address);
        if (success) {
          addressEl.classList.add("is-copied");
          const copyBtn = addressEl.querySelector(".greenoil-new-tooltip-copy-btn");
          if (copyBtn) {
            copyBtn.innerHTML = SVG_CHECK;
            copyBtn.title = "已复制";
          }
          showToast("已复制地址", rest.address);
          setTimeout(() => {
            addressEl.classList.remove("is-copied");
            if (copyBtn) {
              copyBtn.innerHTML = SVG_COPY;
              copyBtn.title = "点击复制地址";
            }
          }, 2000);
        } else {
          showToast("复制失败", "无法访问剪贴板，请手动复制", false);
        }
      });

      addressEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          addressEl.click();
        }
      });
    }

    pin.addEventListener("mouseleave", () => {
      pin.classList.remove("dismissed");
    });

    const addBtn = pin.querySelector(".greenoil-new-tooltip-add-btn");
    if (addBtn) {
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (!isLoggedIn) {
          showToast("请先登录", "添加途径点需要登录态。请点击浏览器右上角的【Green Oil 路线助手】扩展图标完成登录。", false, "warning");
          return;
        }

        if (isRestaurantInRoute(rest)) {
          showToast("提示", `"${rest.name}" 已在路线中`, true);
          return;
        }

        addBtn.disabled = true;
        const originalHtml = addBtn.innerHTML;
        addBtn.innerHTML = `${SVG_SPINNER}<span>添加中...</span>`;

        const wp = {
          name: rest.name || "新开餐馆",
          address: rest.address || "",
          latitude: lat,
          longitude: lng,
          openingHours: "",
          phone: rest.phone || "",
          placeId: rest.id || "",
          mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
          addedAt: new Date().toISOString()
        };

        try {
          if (!chrome.runtime?.id) {
            showToast("提示", "扩展已重新加载，请刷新网页", false);
            addBtn.disabled = false;
            addBtn.innerHTML = originalHtml;
            return;
          }

          chrome.runtime.sendMessage({
            action: "addWaypoint",
            waypoint: wp
          }, (response) => {
            addBtn.disabled = false;
            if (chrome.runtime.lastError) {
              showToast("通信异常", "无法连接后台服务，请刷新网页", false);
              addBtn.innerHTML = originalHtml;
              return;
            }

            if (response && response.unauthorized) {
              isLoggedIn = false;
              newRestaurantsList = [];
              renderNewRestaurantPins();
              addBtn.className = "greenoil-new-tooltip-add-btn is-unauthed";
              addBtn.innerHTML = `${SVG_PLUS}<span>加入路线 (需登录)</span>`;
              showToast("登录态已失效", "登录已过期，请点击浏览器右上角扩展图标重新登录。", false, "warning");
              return;
            }

            if (response && response.success) {
              addBtn.className = "greenoil-new-tooltip-add-btn is-added";
              addBtn.innerHTML = `${SVG_CHECK}<span>已在路线中</span>`;
              showToast("已加入路线", `${wp.name} (已加入【${response.theme?.name || currentTheme?.name}】，共 ${response.count} 站)`);
              refreshWaypointPins();
            } else if (response && (response.alreadyExists || response.alreadyExistsInOther)) {
              addBtn.className = "greenoil-new-tooltip-add-btn is-added";
              addBtn.innerHTML = `${SVG_CHECK}<span>已在路线中</span>`;
              const rName = response.theme?.name || response.belongRouteName || "路线";
              showToast("提示", `${wp.name} 已存在于【${rName}】中`, false);
            } else {
              addBtn.innerHTML = originalHtml;
              showToast("添加失败", response?.error || "请稍后重试", false);
            }
          });
        } catch (err) {
          addBtn.disabled = false;
          addBtn.innerHTML = originalHtml;
          showToast("通信异常", "扩展连接失败", false);
        }
      });
    }

    pin.addEventListener("click", (e) => {
      if (e.target?.closest && e.target.closest(".greenoil-new-tooltip")) return;
      e.stopPropagation();
      const wasActive = pin.classList.contains("active");
      if (document.querySelectorAll) {
        document.querySelectorAll(".greenoil-new-pin.active").forEach(p => {
          if (p !== pin) p.classList.remove("active");
        });
      }
      if (wasActive) {
        pin.classList.remove("active");
        pin.classList.add("dismissed");
      } else {
        pin.classList.remove("dismissed");
        pin.classList.add("active");
      }
    });

    return pin;
  }

  function renderNewRestaurantPins() {
    const group = document.getElementById("greenoil-pins-new");
    if (!group) return;

    if (!isLoggedIn || !showNewRestaurants) {
      group.replaceChildren();
      return;
    }

    const frag = document.createDocumentFragment();
    for (const r of newRestaurantsList) {
      const pin = makeNewRestaurantPin(r);
      if (pin) frag.appendChild(pin);
    }
    group.replaceChildren(frag);
    window.dispatchEvent(new Event("greenoil:pins"));
  }

  const NEW_REST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  async function loadNewRestaurantsData() {
    try {
      if (!chrome?.storage?.local) return;
      const stored = await chrome.storage.local.get([
        "authToken",
        "gce_show_new_restaurants",
        "gce_new_restaurants_cache",
        "gce_new_restaurants_updated"
      ]);
      isLoggedIn = Boolean(stored.authToken);
      if (!isLoggedIn) {
        newRestaurantsList = [];
        renderNewRestaurantPins();
        return;
      }
      showNewRestaurants = stored.gce_show_new_restaurants !== false;
      const isCacheValid = Array.isArray(stored.gce_new_restaurants_cache) &&
        stored.gce_new_restaurants_cache.length > 0 &&
        typeof stored.gce_new_restaurants_updated === "number" &&
        (Date.now() - stored.gce_new_restaurants_updated < NEW_REST_CACHE_TTL_MS);

      if (isCacheValid) {
        newRestaurantsList = stored.gce_new_restaurants_cache;
        renderNewRestaurantPins();
      } else {
        const res = await bgMessage({ action: "getNewlyOpenedRestaurants", period: "week" });
        if (!isLoggedIn) {
          newRestaurantsList = [];
          renderNewRestaurantPins();
          return;
        }
        if (res && res.unauthorized) {
          isLoggedIn = false;
          newRestaurantsList = [];
          renderNewRestaurantPins();
          return;
        }
        if (res && res.success && Array.isArray(res.data)) {
          newRestaurantsList = res.data;
          renderNewRestaurantPins();
        } else {
          newRestaurantsList = [];
          renderNewRestaurantPins();
        }
      }
    } catch (err) {
      console.warn("[GreenOil] Failed to load new restaurants data:", err);
    }
  }

  // Route waypoints (rebuilt whenever the route changes).
  let showWaypoints = true;
  function rebuildPinElements() {
    const layer = ensurePinLayer();
    if (!layer) return;
    const themeColor = currentTheme?.color || "#059669";
    const frag = document.createDocumentFragment();

    if (showWaypoints) {
      currentRouteWaypoints.forEach((wp, idx) => {
        const lat = parseFloat(wp.latitude);
        const lng = parseFloat(wp.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        frag.appendChild(makePin(lat, lng, "waypoint", themeColor,
          `<span class="greenoil-pin-num">${idx + 1}</span>`));
      });
    }

    document.getElementById("greenoil-pins-route").replaceChildren(frag);
    // Google may have rebuilt its map container (and our overlay with it):
    // put the 探索 pins back.
    const exploreGroup = document.getElementById("greenoil-pins-explore");
    if (explore && exploreGroup && !exploreGroup.firstChild && explore.places.size) {
      for (const entry of explore.places.values()) {
        if (entry.el) {
          entry.el.querySelector(".greenoil-pin-body")?.classList.remove("greenoil-explore-rise");
          exploreGroup.appendChild(entry.el);
        }
      }
    }
    applyExploreShadowing();
    renderMatchedPins();
    renderNewRestaurantPins();
    // Ask map-hook.js to position the new pins right away.
    window.dispatchEvent(new Event("greenoil:pins"));
  }

  // ==========================================
  // 探索 — restaurants in the map window, 20 at a time
  //
  // Each click snapshots the window and checks the 20 nearest places that
  // this action has no cached result for (positive or negative, see the
  // checked-place cache in background.js); Shift+click re-checks them all.
  // So a further click on the same window simply takes the next 20, and a
  // click after the map moved works on the new window.
  //
  // Google detail responses are memoized per page (detailMemo), so a
  // later click never fetches the same detail again.
  // ==========================================

  const EXPLORE_BATCH_SIZE = 20;
  const EXPLORE_TITLE = "探索当前地图窗口内最近的 20 家餐馆，只判断是否提供油炸食品。Shift+点击忽略油炸判断缓存";
  const SVG_EXPLORE = `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-5.5-2.5 7.51-3.49L17.5 6.5 9.99 9.99 6.5 17.5zm5.5-6.6a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z"/></svg>`;
  const FLAME_PATH = "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z";
  const RESTAURANT_PATH = "M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z";
  const EXPLORE_GLYPHS = { candidate: pinGlyph(RESTAURANT_PATH), fried: pinGlyph(FLAME_PATH) };
  const EXPLORE_COLORS = { candidate: "#9ca3af", fried: "#f59e0b" };
  const PLACE_ID_RE = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i;

  let explore = null;                  // current exploration (one click)
  const detailMemo = new Map();        // placeId -> Google detail (null = none), newest last
  const DETAIL_MEMO_MAX = 300;
  const placesApi = window.__greenoil_places;
  const searchLimiter = placesApi ? placesApi.createRateLimiter(400) : null;
  const detailLimiter = placesApi ? placesApi.createRateLimiter(1000) : null;

  function bgMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(resp || {});
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  // fried > grey, from whatever results have arrived so far.
  function exploreState(entry) {
    if (entry.fried) return "fried";
    return "candidate";
  }

  function exploreIconHtml(state) {
    return `<span class="greenoil-pin-shield">${EXPLORE_GLYPHS[state] || EXPLORE_GLYPHS.candidate}</span>`;
  }

  function paintExplorePin(entry) {
    const el = entry.el;
    const state = exploreState(entry);
    el.dataset.state = state;
    el.querySelector(".greenoil-explore-fill").setAttribute("fill", EXPLORE_COLORS[state]);
    el.querySelector(".greenoil-explore-icon").innerHTML = exploreIconHtml(state);
  }

  function makeExplorePin(entry, order) {
    const el = document.createElement("div");
    el.className = "greenoil-waypoint-map-pin greenoil-explore-pin";
    el.dataset.kind = "explore";
    el.dataset.placeId = entry.place.placeId;
    el.dataset.greenoilLat = String(entry.place.latitude);
    el.dataset.greenoilLng = String(entry.place.longitude);
    el.innerHTML = `
      <div class="greenoil-pin-body greenoil-explore-rise" style="animation-delay:${Math.min(order * 45, 900)}ms">
        ${pinSvg(EXPLORE_COLORS.candidate, "greenoil-explore-fill")}
        <span class="greenoil-explore-icon"></span>
      </div>
      <span class="greenoil-explore-label" style="animation-delay:${Math.min(order * 45, 900) + 250}ms">${escapeHtml(entry.place.name || "")}</span>`;
    entry.el = el;
    paintExplorePin(entry);
    return el;
  }

  // A result arrived for this place: repaint if its derived state changed.
  function refreshExploreEntry(entry) {
    if (!entry.el) return;
    upsertMatched(entry); // positive results stay after clearing; rejected stale matches are removed
    tagMemo.delete(entry.place.placeId);
    const before = entry.el.dataset.state;
    paintExplorePin(entry);
    if (entry.el.dataset.state !== before) {
      const body = entry.el.querySelector(".greenoil-pin-body");
      body.classList.remove("greenoil-explore-rise", "greenoil-explore-bump");
      void body.offsetWidth; // restart the animation
      body.classList.add("greenoil-explore-bump");
    }
    updatePinsControlBar();
    updateActionButtons();
    const mainPanel = document.querySelector('div[role="main"]');
    const currentPlace = mainPanel && extractPlaceData();
    if (currentPlace && placeIdOf(currentPlace) === entry.place.placeId) updateHeadingTag(mainPanel, currentPlace);
  }

  function isOnRoute(place) {
    return currentRouteWaypoints.some((wp) => {
      const id = String(wp.mapsUrl || "").match(PLACE_ID_RE)?.[1];
      if (id && id === place.placeId) return true;
      const lat = parseFloat(wp.latitude);
      const lng = parseFloat(wp.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) &&
        getHaversineDistKm(lat, lng, place.latitude, place.longitude) < 0.02;
    });
  }

  // A place that is a route waypoint shows only its waypoint pin.
  function applyExploreShadowing() {
    if (!explore) return;
    for (const entry of explore.places.values()) {
      if (entry.el) entry.el.classList.toggle("greenoil-explore-shadowed", isOnRoute(entry.place));
    }
  }

  function clearExplore() {
    if (explore) {
      explore.cancelled = true;
      bgMessage({ action: "exploreCancel", sessionId: explore.id });
    }
    explore = null;
    document.getElementById("greenoil-pins-explore")?.replaceChildren();
    renderMatchedPins(); // matched places stay as resident pins
    if (residentArea?.cluster) loadMatchedPlaces(); // no longer left out of the clusters
    updatePinsControlBar();
    updateActionButtons();
    const mainPanel = document.querySelector('div[role="main"]');
    const currentPlace = mainPanel && extractPlaceData();
    if (currentPlace) updateHeadingTag(mainPanel, currentPlace);
  }

  function exploreCounts() {
    const c = { total: 0, fried: 0 };
    if (!explore) return c;
    for (const e of explore.places.values()) {
      c.total++;
      if (e.fried) c.fried++;
    }
    return c;
  }

  function updatePinsControlBar() {
    let bar = document.getElementById("greenoil-pins-control-bar");
    if (!explore) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "greenoil-pins-control-bar";
      document.body.appendChild(bar);
    }
    bar.innerHTML = "";
    const c = exploreCounts();
    const b = explore.batch;

    const pill = (cls, label, n, title, onClick) => {
      const el = document.createElement("div");
      el.className = `greenoil-control-pill ${cls}`;
      el.innerHTML = `<span>${label}</span> <span>${n}</span>`;
      el.title = title;
      if (onClick) el.addEventListener("click", onClick);
      bar.appendChild(el);
    };
    const running = Boolean(explore.runningAction);
    pill("explore-pill", running && b ? "探索中" : "餐馆",
      running && b ? `${b.done}/${b.size}` : c.total,
      explore.lister?.exhausted ? "窗口内餐馆已全部检查" : `本次检查的餐馆（再次点击检查下 ${EXPLORE_BATCH_SIZE} 家未检查的餐馆）`);
    pill("fried-pill", "油炸", c.fried, "jev 判断含油炸食物的餐馆");

    const clearBtn = document.createElement("div");
    clearBtn.className = "greenoil-control-clear";
    clearBtn.title = "清除探索结果";
    clearBtn.innerHTML = SVG_TRASH;
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearExplore();
      showToast("已清除", "探索结果已清除");
    });
    bar.appendChild(clearBtn);
  }

  const ACTION_FRIED = "fried";

  function updateActionButton(id, action, idleText, idleIcon) {
    const container = document.getElementById(id);
    if (!container) return;
    const circle = container.querySelector(".greenoil-action-circle");
    const label = container.querySelector(".greenoil-action-label");
    const running = Boolean(explore && explore.runningAction === action);
    container.classList.toggle("greenoil-loading", running);
    const iconName = running ? "spin" : action;
    if (circle && circle.dataset.icon !== iconName) {
      circle.innerHTML = running ? SVG_SPINNER : idleIcon;
      circle.dataset.icon = iconName;
    }
    let text = idleText;
    if (running) {
      text = explore.batch?.size ? `探索中 ${explore.batch.done}/${explore.batch.size}` : "探索中...";
    }
    if (label && label.textContent !== text) label.textContent = text;
  }

  function updateActionButtons() {
    updateActionButton("greenoil-explore-btn", ACTION_FRIED, "探索", SVG_EXPLORE);
  }

  function rememberDetail(id, detail) {
    detailMemo.delete(id);
    detailMemo.set(id, detail);
    if (detailMemo.size > DETAIL_MEMO_MAX) detailMemo.delete(detailMemo.keys().next().value);
  }

  /** Load a Google detail at most once for this place on this page. */
  async function detailedPlace(session, entry) {
    const live = () => session === explore && !session.cancelled;
    const id = entry.place.placeId;
    if (!entry.detailLoaded && detailMemo.has(id)) {
      entry.detail = detailMemo.get(id);
      entry.detailLoaded = true;
    }
    if (entry.detailLoaded) {
      return { ...entry.place, ...(entry.detail || {}), placeId: id, name: entry.place.name };
    }
    if (!entry.detailPromise) {
      entry.detailPromise = detailLimiter(async () => {
        if (!live()) return undefined;
        try {
          return await placesApi.fetchPlaceDetail(id);
        } catch (err) {
          console.warn("[GreenOil] place detail failed:", err);
          return null;
        }
      }).then((detail) => {
        if (detail !== undefined && live()) {
          entry.detail = detail;
          entry.detailLoaded = true;
          rememberDetail(id, detail);
        }
        return detail;
      }).finally(() => { entry.detailPromise = null; });
    }
    const detail = await entry.detailPromise;
    if (detail === undefined || !live()) return null;
    return { ...entry.place, ...(detail || {}), placeId: id, name: entry.place.name };
  }

  async function processFriedPlace(session, entry, force) {
    const live = () => session === explore && !session.cancelled;
    if (!force) {
      const cached = await bgMessage({ action: "exploreClassifyFried", sessionId: session.id, place: entry.place, cacheOnly: true });
      if (cached.success && cached.fried) {
        if (live()) { entry.fried = true; entry.friedDone = true; refreshExploreEntry(entry); }
        return;
      }
    }
    const place = await detailedPlace(session, entry);
    if (!place || !live()) return;
    const r = await bgMessage({ action: "exploreClassifyFried", sessionId: session.id, place, forceRefresh: force });
    if (!live()) return;
    if (r.disabled || r.unauthorized) {
      if (r.unauthorized) isLoggedIn = false;
      const addBtn = document.getElementById("greenoil-add-waypoint-btn");
      if (addBtn && !isLoggedIn) {
        applyUnauthedState(addBtn, addBtn.querySelector(".greenoil-action-circle"), addBtn.querySelector(".greenoil-action-label"));
      }
      if (!session.jevDisabledNotified) {
        session.jevDisabledNotified = true;
        showToast("需要登录", r.error || "请先在扩展弹窗中登录 Green Oil 账号", false);
      }
    } else if (r.success) {
      entry.fried = r.fried === true;
      entry.friedProbability = r.probability ?? null;
      if (!entry.fried) entry.checked = true;
      refreshExploreEntry(entry);
    } else if (!r.cancelled) {
      session.friedErrors = (session.friedErrors || 0) + 1;
    }
  }

  function addExplorePlaces(session, chunk, entries) {
    const fresh = chunk.filter(p => !session.places.has(p.placeId));
    if (!fresh.length) return;
    const group = document.getElementById("greenoil-pins-explore") ||
      (ensurePinLayer(), document.getElementById("greenoil-pins-explore"));
    const frag = document.createDocumentFragment();
    for (const place of fresh) {
      const known = matched.get(place.placeId);
      const entry = {
        place, fried: Boolean(known?.fried),
        friedProbability: known?.friedProbability ?? null,
        friedDone: false, checked: Boolean(known?.checked), detailLoaded: false, detail: null,
        detailPromise: null, el: null
      };
      session.places.set(place.placeId, entry);
      frag.appendChild(makeExplorePin(entry, session.places.size - 1));
      entries.push(entry);
    }
    group?.appendChild(frag);
    applyExploreShadowing();
    renderMatchedPins();
    // Re-checked places may already be counted in a cluster: leave them out.
    if (residentArea?.cluster) loadMatchedPlaces();
    updatePinsControlBar();
    updateActionButtons();
  }

  async function runActionBatch(session, action, force) {
    const live = () => session === explore && !session.cancelled;
    const label = "探索";
    const title = "探索";
    session.runningAction = action;
    const batch = { action, size: 0, done: 0 };
    session.batch = batch;
    updateActionButtons();
    updatePinsControlBar();
    const finish = () => {
      session.runningAction = null;
      session.batch = null;
      updateActionButtons();
      updatePinsControlBar();
      settleExplorePins();
    };

    // Places this action already has a result for are skipped, so every
    // click takes the next unchecked ones. Shift+click re-checks them.
    let skip = new Set();
    if (!force) {
      const r = await bgMessage({ action: "getCheckedPlaceIds", kind: action, bounds: placesApi.viewBounds(session.view) });
      if (!live()) return;
      if (r.success) skip = new Set(r.ids);
    }
    session.lister = placesApi.createWindowLister(session.view, {
      schedule: searchLimiter,
      exclude: (place) => {
        if (!skip.has(place.placeId)) return false;
        session.skipped++;
        return true;
      }
    });

    const entries = [];
    try {
      await session.lister.next(EXPLORE_BATCH_SIZE, {
        isCancelled: () => !live(),
        onChunk: (chunk) => { if (live()) addExplorePlaces(session, chunk, entries); }
      });
    } catch (err) {
      console.warn("[GreenOil] explore search failed:", err);
      if (live() && entries.length === 0) {
        finish();
        showToast(`${title}失败`, "无法读取 Google 地图当前窗口的餐馆，请稍后重试", false);
        return;
      }
    }
    if (!live()) return;

    if (!entries.length) {
      finish();
      showToast(`${title}完成`, session.skipped
        ? `当前窗口的 ${session.skipped} 家餐馆都已检查过。移动或缩小地图检查更多，Shift+点击可重新检查`
        : "当前地图窗口内没有找到餐馆，可缩小地图扩大范围", session.skipped > 0);
      return;
    }

    batch.size = entries.length;
        await Promise.allSettled(entries.map(async (entry) => {
      await processFriedPlace(session, entry, force);
      if (live()) {
        batch.done++;
        updatePinsControlBar();
        updateActionButtons();
      }
    }));
    if (!live()) return;

    session.runningAction = null;
    updateActionButtons();
    updatePinsControlBar();
    settleExplorePins();
    console.info(`[GreenOil ${label}]`);
    console.table(entries.map(e => ({
      餐馆: e.place.name,
      地址: e.place.displayName,
      油炸: e.fried ? `是 ${e.friedProbability != null ? Math.round(e.friedProbability * 100) + "%" : ""}` : "否"
    })));
    const positive = entries.filter(e => e.fried).length;
    const notes = [];
    if (session.friedErrors) notes.push(`${session.friedErrors} 家油炸识别失败`);
    const next = session.lister.exhausted ? "窗口内餐馆已全部检查" : `再次点击检查下 ${EXPLORE_BATCH_SIZE} 家`;
    const skipped = session.skipped ? `，跳过已检查 ${session.skipped} 家` : "";
    showToast(`${title}完成`,
      `${batch.size} 家餐馆：油炸 ${positive} 家${skipped}。${next}${notes.length ? "（" + notes.join("；") + "）" : ""}`, true);
  }

  async function handleExploreClick(action, container, forceRefresh = false) {
    if (!isLoggedIn) {
      showToast("需要登录", "探索餐馆功能需要登录态，请先点击浏览器右上角扩展图标登录 Green Oil 账号。", false);
      return;
    }
    if (!placesApi) {
      showToast("提示", "扩展已更新，请刷新网页", false);
      return;
    }
    if (explore?.runningAction) return;

    const view = currentMapView(extractPlaceData());
    if (!view) {
      showToast("提示", "未能读取当前地图范围，请稍后重试", false);
      return;
    }
    // Checked places are already resident pins: a new click starts over.
    clearExplore();
    ensurePinLayer();
    explore = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      view,                // snapshot: later map moves don't change this exploration
      lister: null,
      places: new Map(),
      skipped: 0,
      batch: null,
      runningAction: null
    };
    runActionBatch(explore, action, forceRefresh);
  }

  // ---- Resident pins: matched (fried) and checked (grey) places ----
  // From the background cache plus
  // results found by 探索 in this page. Only the area around the map window
  // is loaded, reloaded when the map leaves it or the zoom changes — the
  // cache can grow large, the DOM (and map-hook's per-frame loop) stays
  // small:
  //   zoom >= CLUSTER_BELOW_ZOOM: single pins in 3x the window, grey ones at
  //     most CHECKED_MAX nearest the center;
  //   zoomed out: grid clusters (one bubble per CLUSTER_CELL_PX square,
  //     count + 油炸/已检查 ring), computed in background.js, down to
  //     CLUSTER_MIN_ZOOM (single pins hide below zoom 10 in map-hook).
  // Toggled by the popup checkboxes "地图显示已匹配商家" (gce_show_matched)
  // and "地图显示已检查地点" (gce_show_checked), both default on.
  // A place in the current 探索 shows only its 探索 pin; a place on the
  // route shows only its waypoint pin.

  const matched = new Map(); // placeId -> {place, fried, friedProbability, checked, el}
  let residentClusters = []; // [{latitude, longitude, count, fried, checked, el}]
  let showMatched = true;
  let showChecked = true;
  const CLUSTER_BELOW_ZOOM = 14;
  const CLUSTER_CELL_PX = 72;
  const CLUSTER_MIN_ZOOM = 5;
  const CHECKED_MAX = 600;
  let residentArea = null;           // {bounds, zoom, checked, cluster} of the last load
  let residentLoadSeq = 0;
  let residentLoading = false;
  let residentReloadQueued = false;

  /**
   * 探索 pins are drawn one by one while the batch runs (live progress).
   * On a zoomed-out (clustered) map they fold into the clusters once it
   * is done, exactly like cached results — one rule for old and new.
   */
  function sessionPinsShown() {
    return Boolean(explore && explore.places.size) && (Boolean(explore.runningAction) || !residentArea?.cluster);
  }

  /** Batch done: on a clustered map, reload so its places join the clusters. */
  function settleExplorePins() {
    if (residentArea?.cluster) loadMatchedPlaces();
    else renderMatchedPins();
  }

  function matchedIsHidden(m) {
    return Boolean(explore && explore.places.has(m.place.placeId)) || isOnRoute(m.place);
  }

  function renderMatchedPins() {
    const group = document.getElementById("greenoil-pins-matched");
    if (!group) return;
    for (const id of ["greenoil-pins-matched", "greenoil-pins-explore"]) {
      const resultGroup = document.getElementById(id);
      resultGroup?.classList.toggle("greenoil-matched-off", !showMatched);
      resultGroup?.classList.toggle("greenoil-checked-off", !showChecked);
    }
    document.getElementById("greenoil-pins-explore")?.classList.toggle("greenoil-folded", !sessionPinsShown());
    const frag = document.createDocumentFragment();
    for (const c of residentClusters) { // under the single pins
      const visible = visibleCluster(c);
      if (!visible.count) continue;
      const key = `${visible.fried}:${visible.checked}`;
      if (!c.el || c.visibleKey !== key) {
        c.el = makeClusterPin(visible);
        c.visibleKey = key;
      }
      frag.appendChild(c.el);
    }
    for (const m of matched.values()) {
      if (!m.el) {
        makeExplorePin(m, 0);
        m.el.classList.add("greenoil-matched-pin");
        m.el.querySelector(".greenoil-pin-body").classList.remove("greenoil-explore-rise");
      } else {
        paintExplorePin(m);
      }
      m.el.classList.toggle("greenoil-checked-pin", !m.fried);
      m.el.classList.toggle("greenoil-explore-shadowed", matchedIsHidden(m));
      frag.appendChild(m.el);
    }
    group.replaceChildren(frag);
    window.dispatchEvent(new Event("greenoil:pins"));
  }

  function formatCount(n) {
    return n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  function visibleCluster(c) {
    const fried = showMatched ? c.fried : 0;
    const checked = showChecked ? c.checked : 0;
    return { ...c, fried, checked, count: fried + checked };
  }

  /**
   * A cluster bubble, centered on the cluster: size grows with the count,
   * the ring shows the 油炸 / 已检查 shares, the glow takes the colour
   * of the highest one present (fried > grey), like a heat spot.
   */
  function makeClusterPin(c) {
    const el = document.createElement("div");
    el.className = "greenoil-waypoint-map-pin greenoil-cluster-pin";
    el.dataset.kind = "cluster";
    el.dataset.greenoilLat = String(c.latitude);
    el.dataset.greenoilLng = String(c.longitude);
    el.dataset.greenoilMinZoom = String(CLUSTER_MIN_ZOOM);
    const size = Math.round(Math.min(64, 26 + 7 * Math.log2(c.count)));
    const b = (c.fried / c.count) * 360;
    const ring = `conic-gradient(${EXPLORE_COLORS.fried} 0deg ${b}deg, ` +
      `${EXPLORE_COLORS.candidate} ${b}deg 360deg)`;
    const top = c.fried ? "fried" : "candidate";
    el.innerHTML = `<div class="greenoil-cluster-body" data-top="${top}"
      style="width:${size}px;height:${size}px;background:${ring}"><span>${formatCount(c.count)}</span></div>`;
    return el;
  }

  function upsertMatched(entry) {
    // Clustered map: background.js is the only source (see settleExplorePins).
    if (residentArea?.cluster) return;
    const id = entry.place.placeId;
    const previous = matched.get(id);
    if (!entry.fried && !entry.checked) {
      previous?.el?.remove();
      matched.delete(id);
      return;
    }
    const m = previous || { place: entry.place, el: null };
    m.fried = Boolean(entry.fried);
    m.friedProbability = entry.friedProbability ?? null;
    m.checked = Boolean(entry.checked || previous?.checked);
    matched.set(id, m);
  }

  /** The area to load around the current map window, or null (no camera). */
  function residentAreaFor(view) {
    if (!view || !placesApi || !(view.w > 0 && view.h > 0)) return null;
    const cluster = view.zoom < CLUSTER_BELOW_ZOOM;
    return {
      // Clusters cover everything in the area: keep it closer to the window.
      bounds: placesApi.viewBounds(view, cluster ? 1.5 : 3),
      zoom: view.zoom,
      checked: showChecked,
      cluster
    };
  }

  /** Reload when the window left the loaded area or the zoom changed. */
  function residentAreaStale() {
    const view = currentMapView(null);
    const area = residentAreaFor(view);
    if (!area) return false;
    if (!residentArea?.bounds) return true;
    return area.cluster !== residentArea.cluster || area.checked !== residentArea.checked ||
      Math.abs(area.zoom - residentArea.zoom) >= (area.cluster ? 0.5 : 1) ||
      !placesApi.boundsContain(residentArea.bounds, placesApi.viewBounds(view));
  }

  /** Coalesce cache change notifications (a batch writes one per place). */
  function scheduleResidentReload() {
    if (residentReloadQueued) return;
    residentReloadQueued = true;
    setTimeout(() => {
      residentReloadQueued = false;
      loadMatchedPlaces();
    }, 1500);
  }

  async function loadMatchedPlaces() {
    const area = residentAreaFor(currentMapView(null));
    const seq = ++residentLoadSeq;
    residentLoading = true;
    // While 探索 pins are drawn, their places stay out of the clusters.
    const exclude = area?.cluster && explore?.runningAction ? [...explore.places.keys()] : [];
    const r = await bgMessage(area
      ? { action: "getMatchedPlaces", bounds: area.bounds, checked: area.checked, checkedMax: CHECKED_MAX,
        cluster: area.cluster ? { zoom: area.zoom, cellPx: CLUSTER_CELL_PX } : null, exclude }
      : { action: "getMatchedPlaces" });
    if (seq === residentLoadSeq) residentLoading = false;
    if (!r.success || !isAlive() || seq !== residentLoadSeq) return;
    residentArea = area;
    residentClusters = Array.isArray(r.clusters) ? r.clusters.map(c => ({ ...c, el: null })) : [];
    tagMemo.clear();
    const previous = new Map(matched); // reuse pin elements across reloads
    matched.clear();
    for (const p of r.places || []) {
      matched.set(p.placeId, {
        place: { placeId: p.placeId, name: p.name, latitude: p.latitude, longitude: p.longitude },
        fried: Boolean(p.fried),
        friedProbability: p.probability ?? null,
        checked: Boolean(p.checked),
        el: previous.get(p.placeId)?.el || null
      });
    }
    if (explore) {
      for (const e of explore.places.values()) {
        const cached = matched.get(e.place.placeId);
        if (!e.friedDone && cached?.fried) {
          e.fried = true;
          e.friedProbability = cached.friedProbability;
        }
        upsertMatched(e);
      }
    }
    ensurePinLayer();
    renderMatchedPins();
  }

  if (chrome.storage?.local) {
    chrome.storage.local.get(["gce_show_matched", "gce_show_checked", "gce_show_waypoints"]).then((d) => {
      showMatched = d.gce_show_matched !== false;
      showChecked = d.gce_show_checked !== false;
      showWaypoints = d.gce_show_waypoints !== false;
      renderMatchedPins();
      rebuildPinElements();
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!isAlive() || area !== "local") return;
      if (changes.gce_show_waypoints) {
        showWaypoints = changes.gce_show_waypoints.newValue !== false;
        rebuildPinElements();
      }
      if (changes.gce_show_matched) {
        showMatched = changes.gce_show_matched.newValue !== false;
        renderMatchedPins();
      }
      if (changes.gce_show_checked) {
        showChecked = changes.gce_show_checked.newValue !== false;
        renderMatchedPins();
        loadMatchedPlaces(); // grey pins are only loaded while shown
      }
      if (changes.gce_show_new_restaurants) {
        showNewRestaurants = changes.gce_show_new_restaurants.newValue !== false;
        if (!isLoggedIn) newRestaurantsList = [];
        renderNewRestaurantPins();
      }
      if (changes.gce_new_restaurants_cache) {
        if (isLoggedIn) {
          newRestaurantsList = Array.isArray(changes.gce_new_restaurants_cache.newValue)
            ? changes.gce_new_restaurants_cache.newValue
            : [];
        } else {
          newRestaurantsList = [];
        }
        renderNewRestaurantPins();
      }
      // Keep resident pins in sync when another Maps tab checked places.
      if (changes.gce_fried_cache ||
        Object.keys(changes).some(k => k.startsWith("gce_seen:"))) scheduleResidentReload();
    });
  }

  // ---- Name tag on a place page: 油炸 ----

  function placeIdOf(placeData) {
    return String(placeData?.mapsUrl || location.href).match(PLACE_ID_RE)?.[1] || "";
  }

  const tagMemo = new Map(); // placeId -> {t, info} from the background caches
  let tagRequestSeq = 0;

  async function placeTagInfo(placeData) {
    const id = placeIdOf(placeData);
    let entry = id ? explore?.places.get(id) : null;
    if (!entry && explore && Number.isFinite(placeData.latitude)) {
      entry = [...explore.places.values()].find(e =>
        getHaversineDistKm(e.place.latitude, e.place.longitude, placeData.latitude, placeData.longitude) < 0.015);
    }
    if (entry && entry.fried) {
      return { fried: entry.fried, probability: entry.friedProbability };
    }
    const resident = id && matched.get(id);
    if (resident) return { fried: resident.fried, probability: resident.friedProbability };
    if (!id) return null;
    const memo = tagMemo.get(id);
    if (memo && Date.now() - memo.t < 15000) return memo.info;
    const r = await bgMessage({ action: "getPlaceTags", placeId: id });
    const info = r.success ? { fried: r.fried, probability: r.probability } : null;
    tagMemo.set(id, { t: Date.now(), info });
    return info;
  }

  async function updateHeadingTag(mainPanel, placeData) {
    if (!mainPanel || !placeData) return;
    const seq = ++tagRequestSeq;
    const info = await placeTagInfo(placeData);
    if (seq !== tagRequestSeq) return; // a newer update (other place) won
    const h1 = mainPanel.querySelector("h1.DUwDvf") || mainPanel.querySelector("h1");
    const existing = document.getElementById("greenoil-heading-badge");
    const kind = info?.fried ? "fried" : "";
    if (!h1 || !kind) {
      if (existing) existing.remove();
      return;
    }
    const key = "fried";
    if (existing && existing.dataset.key === key && existing.parentElement === h1) return;
    if (existing) existing.remove();

    const tag = document.createElement("span");
    tag.id = "greenoil-heading-badge";
    tag.className = `greenoil-heading-tag is-${kind}`;
    tag.dataset.key = key;
    {
      const pct = Number.isFinite(info.probability) ? `（jev 判断概率 ${Math.round(info.probability * 100)}%）` : "";
      tag.title = `含油炸食物${pct}`;
      tag.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${FLAME_PATH}"/></svg><span>油炸</span>`;
    }
    h1.appendChild(tag);
  }

  // Tabs opened before the extension was (re)loaded have no MAIN-world
  // hook yet; ask the background to inject it.
  function ensureMapHook() {
    if (document.documentElement.hasAttribute("data-greenoil-maphook")) return;
    try {
      chrome.runtime.sendMessage({ action: "injectMapHook" }, () => {
        if (chrome.runtime.lastError) {
          console.warn("[GreenOil] map hook inject:", chrome.runtime.lastError.message);
        }
      });
    } catch (_) {}
  }

  let waypointRefreshPending = false;

  function refreshWaypointPins() {
    try {
      if (!isAlive() || waypointRefreshPending) return;
      waypointRefreshPending = true;
      chrome.runtime.sendMessage({ action: "getRouteWaypoints" }, (resp) => {
        waypointRefreshPending = false;
        if (!isAlive()) return;
        if (chrome.runtime.lastError || !resp || !resp.success) return;
        currentRouteWaypoints = Array.isArray(resp.waypoints) ? resp.waypoints : [];
        if (resp.activeTheme) currentTheme = resp.activeTheme;

        rebuildPinElements();
        updatePinsControlBar();

        const mainPanel = document.querySelector('div[role="main"]');
        if (mainPanel) {
          const currentPlace = extractPlaceData();
          if (currentPlace) {
            updateHeadingTag(mainPanel, currentPlace);
          }
        }
      });
    } catch (_) {}
  }

  function inPagePanToLocation(targetPath, wp) {
    // map-hook.js (MAIN world) navigates without reloading the page:
    // place URLs go through Google's own router (panel + animated camera),
    // nearby coordinates glide with a drag; otherwise a normal navigation.
    window.postMessage({
      type: "GREENOIL_NAVIGATE",
      path: targetPath || "",
      lat: wp?.latitude,
      lng: wp?.longitude,
    }, "*");

    lastProcessedKey = "";
    setTimeout(() => {
      if (typeof checkAndInject === "function") checkAndInject();
      refreshWaypointPins();
    }, 300);

    showToast("已定位", wp?.name || "目标地点");
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

  function findWaypointIndexForPlace(waypoints, placeData) {
    if (!Array.isArray(waypoints) || !placeData) return -1;
    const pName = (placeData.name || "").trim().toLowerCase();
    const pNorm = normalizeMapPlaceName(placeData.name);

    // 1. Direct name match first (highest priority)
    if (pName && pName !== "selected location") {
      const idx = waypoints.findIndex((wp) => {
        const wName = (wp.name || "").trim().toLowerCase();
        const wNorm = normalizeMapPlaceName(wp.name);
        return wName === pName || (wNorm && pNorm && (wNorm === pNorm || wNorm.includes(pNorm) || pNorm.includes(wNorm)));
      });
      if (idx !== -1) return idx;
    }

    // 2. Place ID / CID match (only if names do not contradict)
    const pPid = placeData.placeId || placeData.id || "";
    if (pPid && !pPid.startsWith("custom_")) {
      const idx = waypoints.findIndex((wp) => {
        const wPid = wp.placeId || wp.id || "";
        if (wPid && wPid === pPid) {
          const wName = (wp.name || "").trim().toLowerCase();
          if (!wName || !pName || wName === pName || wName.includes(pName) || pName.includes(wName)) {
            return true;
          }
        }
        return false;
      });
      if (idx !== -1) return idx;
    }

    // 3. Proximity match (< 50m)
    const pLat = parseFloat(placeData.latitude);
    const pLng = parseFloat(placeData.longitude);
    if (!isNaN(pLat) && !isNaN(pLng)) {
      const idx = waypoints.findIndex((wp) => {
        const wLat = parseFloat(wp.latitude);
        const wLng = parseFloat(wp.longitude);
        if (!isNaN(wLat) && !isNaN(wLng)) {
          return getHaversineDistKm(pLat, pLng, wLat, wLng) < 0.05;
        }
        return false;
      });
      if (idx !== -1) return idx;
    }

    return -1;
  }

  function removeHeadingWaypointBadge() {
    const existing = document.getElementById("greenoil-heading-waypoint-badge");
    if (existing) existing.remove();
  }

  function renderContainerChips(c) {
    let html = "";
    const raw = (c.containerRaw || "").toLowerCase();
    const text = (c.container || "").toUpperCase();

    const isYellow = raw.includes("chip-oil") || raw.includes("b o") || text.includes("B O") || text.includes("400B") || text.includes("600B");
    const isGrey = raw.includes("chip-company") || raw.includes("bi-database") || text.includes("D");

    if (isYellow) {
      html += `<span class="chip-container-oil">${SVG_CHIP_BOX} <b>B</b> <b>O</b></span>`;
    }
    if (isGrey) {
      html += `<span class="chip-container-drum">${SVG_CHIP_DRUM} <b>D</b></span>`;
    }
    if (!html) {
      const chipText = text || "D";
      html += `<span class="chip-container-drum">${SVG_CHIP_DRUM} <b>${chipText}</b></span>`;
    }
    return html;
  }

  // The visible map window: URL camera (Google's full-canvas center), canvas
  // size, and the side panel rect so places hidden under it are skipped.
  function currentMapView(place) {
    const m = location.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
    const canvas = mapCanvas();
    const w = canvas?.clientWidth || window.innerWidth;
    const h = canvas?.clientHeight || window.innerHeight;
    let view;
    if (m) view = { lat: parseFloat(m[1]), lng: parseFloat(m[2]), zoom: parseFloat(m[3]), w, h };
    else if (place && Number.isFinite(place.latitude)) view = { lat: place.latitude, lng: place.longitude, zoom: 16, w, h };
    else return null;
    const panel = document.querySelector('div[role="main"]');
    if (canvas && panel) {
      const c = canvas.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      if (p.width > 50 && p.height > 50) {
        view.hidden = [{ left: p.left - c.left, top: p.top - c.top, width: p.width, height: p.height }];
      }
    }
    return view;
  }

  /**
   * Safely extract place name from h1 without being polluted by injected badges
   */
  function getPlaceNameFromH1(h1) {
    if (!h1) return "";
    let text = "";
    for (const child of h1.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (
          child.id === "greenoil-heading-badge" ||
          child.classList?.contains("greenoil-heading-badge") ||
          child.classList?.contains("greenoil-heading-tag") ||
          child.id === "greenoil-heading-waypoint-badge" ||
          child.classList?.contains("greenoil-heading-waypoint-badge")
        ) {
          continue;
        }
        text += child.textContent;
      }
    }
    return text.trim();
  }

  /**
   * Determine whether a place detail panel is currently open and ready
   */
  function isPlacePage() {
    const mainPanel = document.querySelector('div[role="main"]');
    if (!mainPanel) return false;
    const heading = mainPanel.querySelector('h1.DUwDvf') || mainPanel.querySelector('h1');
    let name = getPlaceNameFromH1(heading);
    if (!name) {
      const urlMatch = location.pathname.match(/\/place\/([^/@]+)/);
      if (urlMatch && urlMatch[1]) {
        name = decodeURIComponent(urlMatch[1].replace(/\+/g, " ")).trim();
      }
    }
    if (!name || name.length === 0) {
      return false;
    }
    const dirBtn = mainPanel.querySelector([
      '[data-item-id="directions"]',
      'button[data-value="Directions"]',
      'button[data-value="路线"]',
      'button[data-value="規劃路線"]',
      'button[aria-label*="Directions" i]',
      'button[aria-label*="路线"]',
      'button[aria-label*="路線"]',
      'button[aria-label*="规划"]',
      'button[aria-label*="規劃"]',
      'a[data-value="Directions"]',
      'a[data-item-id="directions"]'
    ].join(', '));
    if (!dirBtn || !dirBtn.offsetParent) return false;

    return true;
  }

  /**
   * Extract place details on-demand with strict place validation
   */
  function extractPlaceData() {
    const mainPanel = document.querySelector('div[role="main"]') || document.body;

    // 1. Name: Heading text is the single source of truth for the currently viewed place
    let name = "";
    const h1 = mainPanel.querySelector('h1.DUwDvf') || mainPanel.querySelector('h1');
    if (h1) {
      name = getPlaceNameFromH1(h1);
    }
    if (!name) {
      const urlMatch = location.pathname.match(/\/place\/([^/@]+)/);
      if (urlMatch && urlMatch[1]) {
        name = decodeURIComponent(urlMatch[1].replace(/\+/g, " ")).trim();
      }
    }
    if (!name || name === "Selected Location") return null;

    // 2. Latitude & Longitude from URL: Take the LAST !3d!4d match (the currently open place)
    let latitude = 43.76;
    let longitude = -79.41;

    const allCoordMatches = Array.from(location.href.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g));
    if (allCoordMatches.length > 0) {
      const lastMatch = allCoordMatches[allCoordMatches.length - 1];
      latitude = parseFloat(lastMatch[1]);
      longitude = parseFloat(lastMatch[2]);
    } else {
      const centerCoordMatch = location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (centerCoordMatch) {
        latitude = parseFloat(centerCoordMatch[1]);
        longitude = parseFloat(centerCoordMatch[2]);
      }
    }

    // 3. Address
    let address = "";
    const addrBtn = mainPanel.querySelector('button[data-item-id="address"]') ||
                    mainPanel.querySelector('[data-item-id="address"]');
    if (addrBtn) {
      const textDiv = addrBtn.querySelector('.fontBodyMedium') || addrBtn.querySelector('div.Io6YTe');
      if (textDiv && textDiv.textContent) {
        address = textDiv.textContent.trim();
      } else if (addrBtn.getAttribute("aria-label")) {
        address = addrBtn.getAttribute("aria-label").replace(/^(Address:\s*|地址：\s*|地址:\s*)/i, "").trim();
      }
    }
    if (!address) {
      const possibleAddress = mainPanel.querySelector('div.Io6YTe');
      if (possibleAddress && possibleAddress.textContent) {
        address = possibleAddress.textContent.trim();
      }
    }
    if (!address) {
      address = name;
    }

    // 4. Place ID / CID: ONLY trust URL's CID if URL matches current place name!
    let placeId = "";
    const pathMatch = location.pathname.match(/\/place\/([^/@]+)/);
    const urlPlaceName = pathMatch && pathMatch[1] ? decodeURIComponent(pathMatch[1].replace(/\+/g, " ")).trim().toLowerCase() : "";
    const nameLower = name.toLowerCase();

    const urlMatchesPlace = !urlPlaceName || urlPlaceName === nameLower || nameLower.includes(urlPlaceName) || urlPlaceName.includes(nameLower);

    if (urlMatchesPlace) {
      const allCidMatches = Array.from(location.href.matchAll(/!1s0x[0-9a-fA-F]+:0x([0-9a-fA-F]+)/g));
      if (allCidMatches.length > 0) {
        placeId = "cid_" + allCidMatches[allCidMatches.length - 1][1];
      } else {
        const allHexMatches = Array.from(location.href.matchAll(/0x[0-9a-fA-F]+:0x([0-9a-fA-F]+)/g));
        if (allHexMatches.length > 0) {
          placeId = "cid_" + allHexMatches[allHexMatches.length - 1][1];
        }
      }
    }

    if (!placeId) {
      placeId = "custom_" + Math.abs(hashCode(name + "|" + address));
    }

    // 5. Rating & Reviews
    let rating = 0;
    let reviews = 0;
    const ratingEl = mainPanel.querySelector('div.F7nice span[aria-hidden="true"]');
    if (ratingEl && ratingEl.textContent) {
      const r = parseFloat(ratingEl.textContent.trim());
      if (!isNaN(r)) rating = r;
    }
    const reviewsEl = mainPanel.querySelector('div.F7nice span:last-child');
    if (reviewsEl && reviewsEl.textContent) {
      const cleanReviews = reviewsEl.textContent.replace(/[(),]/g, "").trim();
      const rev = parseInt(cleanReviews, 10);
      if (!isNaN(rev)) reviews = rev;
    }

    // 6. Opening Hours
    let openingHours = "N/A";
    const ohTable = mainPanel.querySelector("table.eK4R0e, table.WgFkxc, [data-item-id*='oh'] table, div[role='main'] table");
    if (ohTable) {
      const rows = Array.from(ohTable.querySelectorAll("tr")).map(tr => {
        const dayTd = tr.querySelector("td.ylH6lf") || tr.querySelector("td:first-child");
        const dayText = dayTd ? (dayTd.querySelector("div")?.textContent.trim() || dayTd.textContent.trim()) : "";
        const valTd = tr.querySelector("td.mxowUb") || tr.querySelector("td:nth-child(2)");
        const lis = valTd ? Array.from(valTd.querySelectorAll("li")).map(li => li.textContent.trim()) : [];
        const valText = lis.length > 0 ? lis.join(", ") : (valTd ? valTd.textContent.trim() : "");
        if (dayText) return `${dayText}: ${valText}`;
        return tr.textContent.trim();
      }).filter(Boolean);
      if (rows.length > 0) {
        openingHours = rows.join("\n");
      }
    }

    if (!openingHours || openingHours === "N/A") {
      const ohBtn = mainPanel.querySelector("[data-item-id*='oh'], [aria-label*='營業時間'], [aria-label*='营业时间'], [aria-label*='Hours' i], [aria-label*='hours' i]");
      if (ohBtn) {
        const aria = ohBtn.getAttribute("aria-label") || "";
        const text = ohBtn.innerText || ohBtn.textContent || "";
        if (aria.includes(";") || (aria.includes(":") && (aria.includes("星期") || aria.includes("周") || aria.includes("Monday")))) {
          openingHours = aria
            .replace(/^(?:營業時間|营业时间|Hours)[:：]?\s*/i, "")
            .replace(/;\s*/g, "\n")
            .replace(/ 到 /g, "–")
            .replace(/ to /gi, "–");
        } else {
          openingHours = aria.replace(/·.*$/, "").replace(/查看更詳細.*$/, "").trim() ||
                         text.replace(/查看更詳細.*$/, "").replace(/\n/g, " ").trim();
        }
      }
    }

    return {
      id: placeId,
      placeId,
      name,
      address,
      openingHours,
      latitude,
      longitude,
      hasPlaceCoordinates: allCoordMatches.length > 0,
      rating,
      reviews,
      mapsUrl: location.href,
      addedAt: new Date().toISOString()
    };
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  function showToast(title, description, isSuccess = true, type = "") {
    let container = document.getElementById("greenoil-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "greenoil-toast-container";
      container.className = "greenoil-toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    const toastType = type || (isSuccess ? "success" : "warning");
    toast.className = `greenoil-toast greenoil-toast-${toastType}`;

    const iconSpan = document.createElement("span");
    iconSpan.className = "greenoil-toast-icon";
    iconSpan.innerHTML = isSuccess ? SVG_CHECK : SVG_INFO;

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "greenoil-toast-body";

    const titleEl = document.createElement("div");
    titleEl.className = "greenoil-toast-title";
    titleEl.textContent = title;

    const descEl = document.createElement("div");
    descEl.className = "greenoil-toast-desc";
    descEl.textContent = description;

    bodyDiv.appendChild(titleEl);
    bodyDiv.appendChild(descEl);
    toast.appendChild(iconSpan);
    toast.appendChild(bodyDiv);

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("greenoil-toast-exit");
      setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 250);
    }, 3500);
  }

  /**
   * Check place status and inject [+ 途径点] button into the open place panel
   */
  function checkAndInject() {
    if (!isAlive()) return;
    try {
      // 1. Must be a ready place view
      if (!isPlacePage()) {
        if (lastProcessedKey) {
          lastProcessedKey = "";
          const oldBtn = document.getElementById("greenoil-add-waypoint-btn");
          if (oldBtn) oldBtn.remove();
          const oldExploreBtn = document.getElementById("greenoil-explore-btn");
          if (oldExploreBtn) oldExploreBtn.remove();
          const oldBadge = document.getElementById("greenoil-heading-badge");
          if (oldBadge) oldBadge.remove();
          const oldWpBadge = document.getElementById("greenoil-heading-waypoint-badge");
          if (oldWpBadge) oldWpBadge.remove();
        }
        return;
      }

      const mainPanel = document.querySelector('div[role="main"]');
      if (!mainPanel) {
        const oldBtn = document.getElementById("greenoil-add-waypoint-btn");
        if (oldBtn) oldBtn.remove();
        const oldExploreBtn = document.getElementById("greenoil-explore-btn");
        if (oldExploreBtn) oldExploreBtn.remove();
        const oldBadge = document.getElementById("greenoil-heading-badge");
        if (oldBadge) oldBadge.remove();
        const oldWpBadge = document.getElementById("greenoil-heading-waypoint-badge");
        if (oldWpBadge) oldWpBadge.remove();
        lastProcessedKey = "";
        return;
      }

      // 2. Extract heading place name
      const h1 = mainPanel.querySelector('h1.DUwDvf') || mainPanel.querySelector('h1');
      let placeName = getPlaceNameFromH1(h1);
      if (!placeName) {
        const urlMatch = location.pathname.match(/\/place\/([^/@]+)/);
        if (urlMatch && urlMatch[1]) {
          placeName = decodeURIComponent(urlMatch[1].replace(/\+/g, " ")).trim();
        }
      }
      if (!placeName) {
        const oldHeadingBadge = document.getElementById("greenoil-heading-badge");
        if (oldHeadingBadge) oldHeadingBadge.remove();
        const oldWpBadge = document.getElementById("greenoil-heading-waypoint-badge");
        if (oldWpBadge) oldWpBadge.remove();
        return;
      }

      // 3. MUST find Directions button in place main actions row
      const dirBtn = mainPanel.querySelector([
        'button[data-value="Directions"]',
        'button[data-value="路线"]',
        'button[data-value="路線"]',
        'button[data-value="規劃路線"]',
        'button[aria-label*="Directions" i]',
        'button[aria-label*="路线"]',
        'button[aria-label*="路線"]',
        'button[aria-label*="规划"]',
        'button[aria-label*="規劃"]',
        'a[data-value="Directions"]',
        'a[data-item-id="directions"]',
        '[data-item-id="directions"]'
      ].join(', '));

      if (!dirBtn || !dirBtn.offsetParent) {
        const oldBtn = document.getElementById("greenoil-add-waypoint-btn");
        if (oldBtn) oldBtn.remove();
        const oldExploreBtn = document.getElementById("greenoil-explore-btn");
        if (oldExploreBtn) oldExploreBtn.remove();
        lastProcessedKey = "";
        return;
      }

      const dirItem = dirBtn.closest('.etWJQ') || dirBtn.parentElement;
      const targetRow = dirItem ? dirItem.parentElement : null;

      if (!targetRow || !targetRow.classList.contains('m6QErb')) {
        const oldBtn = document.getElementById("greenoil-add-waypoint-btn");
        if (oldBtn) oldBtn.remove();
        const oldExploreBtn = document.getElementById("greenoil-explore-btn");
        if (oldExploreBtn) oldExploreBtn.remove();
        lastProcessedKey = "";
        return;
      }

      const currentKey = placeName;

      // Ensure the fried tag is up to date and clean up any heading waypoint badge
      const currentPlaceObj = extractPlaceData();
      if (currentPlaceObj) {
        removeHeadingWaypointBadge();
        updateHeadingTag(mainPanel, currentPlaceObj);
      }

      // Already injected and in place for THIS place
      const existingBtn = document.getElementById("greenoil-add-waypoint-btn");
      const existingExploreBtn = document.getElementById("greenoil-explore-btn");
      if (existingBtn && targetRow.contains(existingBtn) &&
        existingExploreBtn && targetRow.contains(existingExploreBtn) && currentKey === lastProcessedKey) {
        return;
      }

      if (existingBtn) existingBtn.remove();
      if (existingExploreBtn) existingExploreBtn.remove();
      lastProcessedKey = currentKey;

      // Create container matching Google's .etWJQ.jym1ob.kdfrQc.WY7ZIb
      const container = document.createElement("div");
      container.id = "greenoil-add-waypoint-btn";
      container.className = "etWJQ jym1ob kdfrQc WY7ZIb greenoil-action-container";

      // Initially styled with current active route theme
      applyThemeToContainer(container, currentTheme);

      const btn = document.createElement("button");
      btn.className = "S9kvJb greenoil-action-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "+ 途径点");
      btn.title = `加入当前地点到【${currentTheme?.name || '当前路线'}】`;

      const circle = document.createElement("span");
      circle.className = "DVeyrd greenoil-action-circle";
      circle.innerHTML = SVG_PLUS;

      const label = document.createElement("div");
      label.className = "R8c4Qb fontLabelMedium greenoil-action-label";
      label.textContent = "+ 途径点";

      btn.appendChild(circle);
      btn.appendChild(label);
      container.appendChild(btn);

      // If currently not logged in, apply grey button state immediately
      if (!isLoggedIn) {
        applyUnauthedState(container, circle, label);
      }

      // Check if place is already in ANY of the 5 color routes
      try {
        if (chrome.runtime?.id) {
          const preliminaryData = extractPlaceData();
          if (preliminaryData) {
            chrome.runtime.sendMessage({
              action: "checkPlaceStatus",
              placeId: preliminaryData.placeId,
              name: preliminaryData.name,
              nameEn: preliminaryData.nameEn,
              address: preliminaryData.address,
              latitude: preliminaryData.latitude,
              longitude: preliminaryData.longitude
            }, (resp) => {
              if (chrome.runtime.lastError) return;
              if (resp && resp.unauthorized) {
                isLoggedIn = false;
                applyUnauthedState(container, circle, label);
                return;
              }
              isLoggedIn = true;
              container.classList.remove("greenoil-not-logged-in");

              if (resp && resp.inRoute) {
                // Requirement 2: Show the route it belongs to!
                circle.innerHTML = SVG_CHECK;
                if (Array.isArray(resp.waypoints) && resp.waypoints.length > 0) {
                  currentRouteWaypoints = resp.waypoints;
                }
                const stopNum = resp.stopNumber || ((findWaypointIndexForPlace(currentRouteWaypoints, preliminaryData) + 1) || 1);
                label.textContent = stopNum > 0 ? `第 ${stopNum} 站` : "已添加";
                container.classList.add("greenoil-added");
                container.dataset.belongRouteName = resp.belongRouteName || "";
                container.dataset.belongRouteId = resp.belongRouteId || "";
                container.title = `该地点已在【${resp.belongRouteName}】中`;
                applyThemeToContainer(container, resp.belongTheme);
                removeHeadingWaypointBadge();
              } else {
                // Not added: show active route theme!
                circle.innerHTML = SVG_PLUS;
                label.textContent = "+ 途径点";
                container.classList.remove("greenoil-added");
                delete container.dataset.belongRouteName;
                delete container.dataset.belongRouteId;
                const activeTh = resp?.activeTheme || currentTheme;
                container.title = `加入当前地点到【${activeTh?.name || '当前路线'}】`;
                applyThemeToContainer(container, activeTh);
                const oldWpBadge = document.getElementById("greenoil-heading-waypoint-badge");
                if (oldWpBadge) oldWpBadge.remove();
              }
            });
          }
        }
      } catch (_) {}

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (!isLoggedIn || container.classList.contains("greenoil-not-logged-in")) {
          showToast("请先登录", "添加途径点需要登录态。请点击浏览器右上角的【Green Oil 路线助手】扩展图标完成登录。", false, "warning");
          return;
        }

        if (container.classList.contains("greenoil-added")) {
          const belongName = container.dataset.belongRouteName || "路线";
          showToast("提示", `该地点已存在于【${belongName}】中`, true);
          return;
        }

        circle.style.opacity = "0.7";
        label.textContent = "添加中...";
        const latestPlace = extractPlaceData();
        if (!latestPlace) {
          circle.style.opacity = "1";
          label.textContent = "+ 途径点";
          showToast("提示", "未能获取有效的地点信息", false);
          return;
        }

        try {
          if (!chrome.runtime?.id) {
            showToast("提示", "扩展已重新加载，请刷新网页", false);
            circle.style.opacity = "1";
            label.textContent = "+ 途径点";
            return;
          }

          chrome.runtime.sendMessage({
            action: "addWaypoint",
            waypoint: latestPlace
          }, (response) => {
            circle.style.opacity = "1";
            if (chrome.runtime.lastError) {
              showToast("通信异常", "无法连接后台服务，请刷新网页", false);
              label.textContent = "+ 途径点";
              return;
            }

            if (response && response.unauthorized) {
              isLoggedIn = false;
              applyUnauthedState(container, circle, label);
              showToast("登录态已失效", "登录已过期，请点击浏览器右上角扩展图标重新登录。", false, "warning");
              return;
            }

            if (response && response.success) {
              circle.innerHTML = SVG_CHECK;
              label.textContent = "已添加";
              container.classList.add("greenoil-added");
              container.dataset.belongRouteName = response.theme?.name || "";
              container.title = `该地点已在【${response.theme?.name}】中`;
              applyThemeToContainer(container, response.theme);
              showToast("已加入路线", `${latestPlace.name} (已加入【${response.theme?.name}】，共 ${response.count} 站)`);
              refreshWaypointPins();
            } else if (response && response.alreadyExists) {
              circle.innerHTML = SVG_CHECK;
              label.textContent = "已添加";
              container.classList.add("greenoil-added");
              container.dataset.belongRouteName = response.theme?.name || "";
              applyThemeToContainer(container, response.theme);
              showToast("提示", `${latestPlace.name} 已存在于当前路线中`, false);
            } else if (response && response.alreadyExistsInOther) {
              circle.innerHTML = SVG_CHECK;
              label.textContent = "已添加";
              container.classList.add("greenoil-added");
              container.dataset.belongRouteName = response.belongRouteName || "";
              applyThemeToContainer(container, response.belongTheme);
              showToast("提示", `${latestPlace.name} 已存在于【${response.belongRouteName}】中`, false);
            } else {
              label.textContent = "+ 途径点";
              showToast("添加失败", response?.error || "请稍后重试", false);
            }
          });
        } catch (err) {
          console.error("Failed to add waypoint:", err);
          circle.style.opacity = "1";
          label.textContent = "+ 途径点";
          showToast("通信异常", "扩展连接失败", false);
        }
      });

      // POINT 1: Place [+ 途径点] as the FIRST button in the row (before dirItem)!
      targetRow.insertBefore(container, dirItem);

      // POINT 2: [探索] only judges fried food.
      let exploreContainer = document.getElementById("greenoil-explore-btn");
      if (exploreContainer) exploreContainer.remove();

      exploreContainer = document.createElement("div");
      exploreContainer.id = "greenoil-explore-btn";
      exploreContainer.className = "etWJQ jym1ob kdfrQc WY7ZIb greenoil-action-container";

      const exploreBtn = document.createElement("button");
      exploreBtn.className = "S9kvJb greenoil-action-btn";
      exploreBtn.type = "button";
      exploreBtn.setAttribute("aria-label", "探索");
      exploreBtn.title = EXPLORE_TITLE;

      const exploreCircle = document.createElement("span");
      exploreCircle.className = "DVeyrd greenoil-action-circle";
      exploreCircle.innerHTML = SVG_EXPLORE;
      exploreCircle.dataset.icon = ACTION_FRIED;

      const exploreLabel = document.createElement("div");
      exploreLabel.className = "R8c4Qb fontLabelMedium greenoil-action-label";
      exploreLabel.textContent = "探索";

      exploreBtn.appendChild(exploreCircle);
      exploreBtn.appendChild(exploreLabel);
      exploreContainer.appendChild(exploreBtn);
      exploreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (exploreContainer.classList.contains("greenoil-loading")) return;
        handleExploreClick(ACTION_FRIED, exploreContainer, e.shiftKey);
      });
      targetRow.insertBefore(exploreContainer, dirItem);

      updateActionButtons();
    } catch (err) {
      console.warn("[GreenOil] Injection check caught error:", err);
    }
  }

    window.__greenoil_check__ = checkAndInject;

    // Periodic check to inject buttons and sync place state; also keeps
    // the pin overlay mounted if Google rebuilds its map container.
    setInterval(() => {
      if (!document.hidden) {
        checkAndInject();
        const hasPins = (showWaypoints && currentRouteWaypoints.length > 0) || Boolean(explore && explore.places.size) ||
          matched.size > 0 || residentClusters.length > 0 || (showNewRestaurants && newRestaurantsList.length > 0);
        const overlay = document.getElementById("greenoil-waypoint-pins-overlay");
        const canvas = mapCanvas();
        if (hasPins && canvas && overlay?.previousElementSibling !== canvas) rebuildPinElements();
        if (!residentLoading && residentAreaStale()) loadMatchedPlaces();
        updateActionButtons(); // keep both independent action labels in sync
      }
    }, 600);

    ensureMapHook();
    loadMatchedPlaces();
    loadNewRestaurantsData();

    // Initial check immediately on script evaluation
    checkAndInject();
    if (typeof refreshWaypointPins === "function") refreshWaypointPins();

    if (document.readyState !== "complete") {
      listen(window, "load", () => {
        checkAndInject();
        if (typeof refreshWaypointPins === "function") refreshWaypointPins();
      }, { once: true });
    }
  })();
}
