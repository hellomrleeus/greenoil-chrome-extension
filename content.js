/**
 * Green Oil Chrome Extension - Content Script for Google Maps
 * Ultra-high-performance, zero-overhead button injection for Google Maps.
 * Only injects the button when viewing a place. Extracts place details on-demand upon click.
 */

if (window.__greenoil_injected__) {
  if (typeof window.__greenoil_check__ === "function") {
    window.__greenoil_check__();
  }
} else {
  window.__greenoil_injected__ = true;
  (() => {
    let lastProcessedKey = "";
    let currentTheme = { color: "#059669", hoverColor: "#047857", lightColor: "#ecfdf5", borderColor: "#10b981", name: "绿线" };

    function applyThemeToContainer(container, theme) {
      if (!container || !theme) return;
      container.style.setProperty("--go-theme", theme.color || "#059669");
      container.style.setProperty("--go-hover", theme.hoverColor || "#047857");
      container.style.setProperty("--go-light", theme.lightColor || "#ecfdf5");
      container.style.setProperty("--go-border", theme.borderColor || "#10b981");
    }

    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: "getActiveTheme" }, (resp) => {
          if (resp && resp.theme) {
            currentTheme = resp.theme;
            const btnContainer = document.getElementById("greenoil-add-waypoint-btn");
            if (btnContainer && !btnContainer.classList.contains("greenoil-added")) {
              applyThemeToContainer(btnContainer, currentTheme);
            }
          }
        });
      }
    } catch (_) {}

    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
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

        window.addEventListener("greenoil-cmd", (e) => {
          const { action, data } = e.detail || {};
          if (chrome.runtime?.id && action) {
            chrome.runtime.sendMessage({ action, ...data }, (resp) => {
              window.dispatchEvent(new CustomEvent("greenoil-cmd-resp", { detail: resp }));
            });
          }
        });

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
          const wp = message.waypoint;
          let p = message.targetPath;
          if (!p && wp.mapsUrl) {
            try {
              const u = new URL(wp.mapsUrl);
              p = u.pathname + u.search + u.hash;
            } catch (_) {
              p = wp.mapsUrl;
            }
          }
          if (p) {
            try {
              history.pushState(null, "", p);
              window.dispatchEvent(new PopStateEvent("popstate"));
            } catch (_) {}
          }
          showToast("已定位", wp.name || "途径点");
          lastProcessedKey = "";
          setTimeout(() => {
            if (typeof checkAndInject === "function") {
              checkAndInject();
            }
          }, 500);
        }

        if (message.action === "renderMisMatches" && Array.isArray(message.matches)) {
          renderMisPins(message.matches);
        }

        if (message.action === "misMatchProgress") {
          const misLabel = document.querySelector("#greenoil-match-mis-btn .greenoil-action-label");
          if (misLabel && message.total) {
            misLabel.textContent = `匹配中 (${message.current}/${message.total})`;
          }
        }
      });
    }

    window.addEventListener("message", (event) => {
      if (event.data?.type === "GREENOIL_RENDER_MIS_MATCHES" && Array.isArray(event.data.matches)) {
        renderMisPins(event.data.matches);
      }
      if (event.data?.type === "GREENOIL_OPEN_MIS_MODAL" && event.data.customer) {
        openMisModal(event.data.customer);
      }
    });

  const SVG_PLUS = `<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
  const SVG_CHECK = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  const SVG_INFO = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
  const SVG_MIS_SHIELD = `<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>`;
  const SVG_SPINNER = `<svg viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>`;
  const SVG_CLOSE = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const SVG_EXTERNAL = `<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`;
  const SVG_SORT_UP_DOWN = `<svg width="9" height="11" viewBox="0 0 10 12"><path d="M3 0L0 4h2v8h2V4h2L3 0zm4 12l3-4H8V0H6v8H4l3 4z" fill="rgba(255,255,255,0.7)"/></svg>`;
  const SVG_SORT_DOWN = `<svg width="8" height="7" viewBox="0 0 10 8"><path d="M5 8L0 0h10L5 8z" fill="#ffffff"/></svg>`;
  const SVG_CHIP_BOX = `<svg width="12" height="12" viewBox="0 0 24 24"><path d="M4 4h16v4H4V4zm1 6h14v10H5V10z"/></svg>`;
  const SVG_CHIP_DRUM = `<svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 3.79 2 6v12c0 2.21 4.48 4 10 4s10-1.79 10-4V6c0-2.21-4.48-4-10-4zm0 2c4.41 0 8 1.34 8 2s-3.59 2-8 2-8-1.34-8-2 3.59-2 8-2z"/></svg>`;
  const SVG_TRASH = `<svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

  // State for Map Overlay & MIS
  let currentMisMatches = [];
  let currentRouteWaypoints = [];
  let isMisAuthChecked = false;
  let isMisLoggedIn = false;

  function ensurePinsOverlay() {
    let overlay = document.getElementById("greenoil-pins-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "greenoil-pins-overlay";
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function updatePinsControlBar() {
    let bar = document.getElementById("greenoil-pins-control-bar");
    if (currentRouteWaypoints.length === 0 && currentMisMatches.length === 0) {
      if (bar) bar.remove();
      return;
    }

    if (!bar) {
      bar = document.createElement("div");
      bar.id = "greenoil-pins-control-bar";
      document.body.appendChild(bar);
    }

    bar.innerHTML = "";

    if (currentRouteWaypoints.length > 0) {
      const wpPill = document.createElement("div");
      wpPill.className = "greenoil-control-pill waypoint-pill";
      wpPill.innerHTML = `<span>路线途径点</span> <span>${currentRouteWaypoints.length}</span>`;
      wpPill.title = "当前路线中的途径点总数";
      bar.appendChild(wpPill);
    }

    if (currentMisMatches.length > 0) {
      const misPill = document.createElement("div");
      misPill.className = "greenoil-control-pill mis-pill";
      misPill.innerHTML = `<span>MIS签约</span> <span>${currentMisMatches.length}</span>`;
      misPill.title = "点击查看首个匹配客户";
      misPill.addEventListener("click", () => {
        if (currentMisMatches.length > 0) openMisModal(currentMisMatches[0]);
      });
      bar.appendChild(misPill);

      const clearBtn = document.createElement("div");
      clearBtn.className = "greenoil-control-clear";
      clearBtn.title = "清空 MIS 图钉";
      clearBtn.innerHTML = SVG_TRASH;
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        currentMisMatches = [];
        const overlay = document.getElementById("greenoil-pins-overlay");
        if (overlay) {
          overlay.querySelectorAll(".greenoil-mis-pin").forEach(el => el.remove());
        }
        const badge = document.getElementById("greenoil-heading-mis-badge");
        if (badge) badge.remove();
        updatePinsControlBar();
        showToast("已清空", "MIS 签约图钉已从地图清除");
      });
      bar.appendChild(clearBtn);
    }
  }

  function refreshWaypointPins() {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ action: "getRouteWaypoints" }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success) return;
        currentRouteWaypoints = Array.isArray(resp.waypoints) ? resp.waypoints : [];
        if (resp.activeTheme) currentTheme = resp.activeTheme;

        const overlay = ensurePinsOverlay();
        overlay.querySelectorAll(".greenoil-waypoint-pin").forEach(el => el.remove());

        currentRouteWaypoints.forEach((wp, idx) => {
          const lat = parseFloat(wp.latitude);
          const lng = parseFloat(wp.longitude);
          if (isNaN(lat) || isNaN(lng)) return;

          const pin = document.createElement("div");
          pin.className = "greenoil-map-pin greenoil-waypoint-pin";
          pin.dataset.lat = lat;
          pin.dataset.lng = lng;

          const pinMarker = document.createElement("div");
          pinMarker.className = "greenoil-pin-marker";
          pinMarker.style.setProperty("--pin-color", currentTheme.color || "#059669");

          pinMarker.innerHTML = `
            <svg viewBox="0 0 28 36" class="greenoil-pin-svg">
              <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22c0-7.73-6.27-14-14-14z" fill="var(--pin-color)"/>
              <circle cx="14" cy="14" r="10" fill="#ffffff"/>
            </svg>
            <span class="greenoil-pin-number" style="color: var(--pin-color);">${idx + 1}</span>
          `;

          const tooltip = document.createElement("div");
          tooltip.className = "greenoil-pin-tooltip";
          tooltip.textContent = `#${idx + 1} ${wp.name || '途径点'}`;

          pin.appendChild(pinMarker);
          pin.appendChild(tooltip);

          pin.addEventListener("click", (e) => {
            e.stopPropagation();
            if (chrome.runtime?.id) {
              chrome.runtime.sendMessage({ action: "panToWaypoint", waypoint: wp });
            }
          });

          overlay.appendChild(pin);
        });

        updatePinsControlBar();
        updateAllPinCoordinates();
      });
    } catch (_) {}
  }

  function renderMisPins(matches) {
    currentMisMatches = Array.isArray(matches) ? matches : [];
    const overlay = ensurePinsOverlay();

    overlay.querySelectorAll(".greenoil-mis-pin").forEach(el => el.remove());

    currentMisMatches.forEach((c) => {
      const lat = parseFloat(c.latitude);
      const lng = parseFloat(c.longitude);
      if (isNaN(lat) || isNaN(lng)) return;

      const pin = document.createElement("div");
      pin.className = "greenoil-map-pin greenoil-mis-pin";
      pin.dataset.lat = lat;
      pin.dataset.lng = lng;

      pin.innerHTML = `
        <div class="greenoil-pin-radar-ring"></div>
        <div class="greenoil-mis-pin-badge">
          ${SVG_MIS_SHIELD}
          <span class="greenoil-mis-pin-tag">MIS</span>
        </div>
        <div class="greenoil-pin-tooltip">【MIS签约】${c.name} (${c.code})</div>
      `;

      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        openMisModal(c);
      });

      overlay.appendChild(pin);
    });

    updatePinsControlBar();
    updateAllPinCoordinates();

    const mainPanel = document.querySelector('div[role="main"]');
    if (mainPanel) {
      updateHeadingMisBadge(mainPanel, extractPlaceData());
    }
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

  function extractStreetPrefix(raw) {
    if (!raw || typeof raw !== "string") return "";
    let addr = raw.trim();
    let part = addr.split(",")[0].trim();
    part = part.replace(/^(?:unit|ste|suite|#)\s*[\w\d-]+\s*[-–,]\s*/i, "").trim();
    part = part.replace(/\s+(?:unit|ste|suite|#|bldg|building)\s*[\w\d-]+$/i, "").trim();
    const m = part.match(/^(\d+[\w-]*\s+[A-Za-z0-9\s.]+)/);
    if (m) {
      return m[1].trim().split(/\s+/).slice(0, 5).join(" ");
    }
    return part;
  }

  function findMatchedMisCustomer(placeData) {
    if (!placeData || !Array.isArray(currentMisMatches) || currentMisMatches.length === 0) return null;

    const qName = (placeData.name || "").trim().toLowerCase();
    const qAddr = (placeData.address || "").trim().toLowerCase();
    const qPrefix = extractStreetPrefix(placeData.address).toLowerCase();
    const qLat = parseFloat(placeData.latitude);
    const qLng = parseFloat(placeData.longitude);

    for (const c of currentMisMatches) {
      const cName = (c.name || "").trim().toLowerCase();
      const cAddr = (c.address || "").trim().toLowerCase();
      const cPrefix = (c.matchedPrefix || "").toLowerCase();

      // 1. Name match
      if (qName && cName && (qName === cName || qName.includes(cName) || cName.includes(qName))) {
        return c;
      }

      // 2. Street prefix match
      if (qPrefix && (cAddr.includes(qPrefix) || (cPrefix && qPrefix.includes(cPrefix)))) {
        return c;
      }

      // 3. Proximity match (< 150m)
      const cLat = parseFloat(c.latitude);
      const cLng = parseFloat(c.longitude);
      if (!isNaN(qLat) && !isNaN(qLng) && !isNaN(cLat) && !isNaN(cLng)) {
        if (getHaversineDistKm(qLat, qLng, cLat, cLng) < 0.15) {
          return c;
        }
      }
    }
    return null;
  }

  function updateHeadingMisBadge(mainPanel, placeData) {
    if (!mainPanel) return;
    const h1 = mainPanel.querySelector('h1.DUwDvf') || mainPanel.querySelector('h1');
    if (!h1) return;

    const existing = document.getElementById("greenoil-heading-mis-badge");
    const matched = findMatchedMisCustomer(placeData);

    if (!matched) {
      if (existing) existing.remove();
      return;
    }

    if (existing) {
      if (existing.dataset.code === matched.code) return;
      existing.remove();
    }

    const badge = document.createElement("span");
    badge.id = "greenoil-heading-mis-badge";
    badge.className = "greenoil-heading-mis-badge";
    badge.dataset.code = matched.code || "";
    badge.title = `【MIS签约客户】${matched.name} (${matched.code}) - 点击查看详细信息`;

    badge.innerHTML = `
      <svg viewBox="0 0 24 24" class="greenoil-heading-mis-icon">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
      </svg>
      <span>MIS签约</span>
    `;

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      openMisModal(matched);
    });

    h1.appendChild(badge);
  }

  function updateAllPinCoordinates() {
    const centerMatch = location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/);
    if (!centerMatch) return;

    const cLat = parseFloat(centerMatch[1]);
    const cLng = parseFloat(centerMatch[2]);
    const zoom = parseFloat(centerMatch[3]);

    function project(lat, lng, z) {
      const scale = 256 * Math.pow(2, z);
      const x = scale * (lng + 180) / 360;
      const siny = Math.sin(lat * Math.PI / 180);
      const y = scale * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI));
      return { x, y };
    }

    const cProj = project(cLat, cLng, zoom);
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight / 2;

    const pins = document.querySelectorAll(".greenoil-map-pin");
    for (const pin of pins) {
      const pLat = parseFloat(pin.dataset.lat);
      const pLng = parseFloat(pin.dataset.lng);
      if (isNaN(pLat) || isNaN(pLng)) continue;

      const pProj = project(pLat, pLng, zoom);
      const sx = originX + (pProj.x - cProj.x);
      const sy = originY + (pProj.y - cProj.y);

      if (sx < -140 || sx > window.innerWidth + 140 || sy < -140 || sy > window.innerHeight + 140) {
        pin.style.display = "none";
      } else {
        pin.style.display = "flex";
        pin.style.left = `${sx}px`;
        pin.style.top = `${sy}px`;
      }
    }
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

  function openMisModal(c) {
    closeMisModal();

    const modal = document.createElement("div");
    modal.id = "greenoil-mis-modal";

    modal.innerHTML = `
      <div class="greenoil-mis-card">
        <div class="greenoil-mis-header">
          <div class="greenoil-mis-title-row">
            <div class="greenoil-mis-name-group">
              <span class="greenoil-mis-name">${c.name || "MIS 签约客户"}</span>
              <span class="greenoil-mis-code-badge">${c.code || "客户"}</span>
              <span class="greenoil-mis-sts-badge">${c.sts === 'I' ? '已暂停 (Inactive)' : '签约有效 (Active)'}</span>
            </div>
            <button class="greenoil-mis-close-btn" type="button" aria-label="关闭">${SVG_CLOSE}</button>
          </div>
          <div class="greenoil-mis-addr-text">${c.address || ''}${c.city ? ', ' + c.city : ''}</div>
        </div>

        <div class="greenoil-mis-table-wrapper">
          <table class="greenoil-mis-table">
            <thead>
              <tr>
                <th>Payment <span class="th-icon">${SVG_SORT_UP_DOWN}</span></th>
                <th>Rate <span class="th-icon">${SVG_SORT_UP_DOWN}</span></th>
                <th>Container <span class="th-icon">${SVG_SORT_UP_DOWN}</span></th>
                <th>Driver <span class="th-icon">${SVG_SORT_UP_DOWN}</span></th>
                <th>Phone <span class="th-icon">${SVG_SORT_UP_DOWN}</span></th>
                <th>Sts <span class="th-icon">${SVG_SORT_UP_DOWN}</span></th>
                <th>Contract <span class="th-icon">${SVG_SORT_DOWN}</span></th>
                <th>Inactive <span class="th-icon">${SVG_SORT_UP_DOWN}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="td-payment">${c.payment || '-'}</td>
                <td class="td-rate">${c.rate || '-'}</td>
                <td class="td-container">${renderContainerChips(c)}</td>
                <td class="td-driver">${c.driver || '-'}</td>
                <td class="td-phone">${c.phone || '-'}</td>
                <td class="td-sts"><b>${c.sts || 'A'}</b></td>
                <td class="td-contract">${c.contract || '-'}</td>
                <td class="td-inactive">${c.inactive || ''}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="greenoil-mis-footer">
          <a class="greenoil-mis-btn-link" href="https://mis.greenoilinc.com/index_intranet.php?view=customer_list&key_word=${encodeURIComponent(c.code || c.name)}" target="_blank">
            ${SVG_EXTERNAL}
            <span>在 MIS 中查看</span>
          </a>
          <button class="greenoil-mis-btn-add" type="button" style="background-color: ${currentTheme.color || '#059669'};">
            ${SVG_PLUS}
            <span>+ 加入当前路线途径点</span>
          </button>
        </div>
      </div>
    `;

    modal.querySelector(".greenoil-mis-close-btn").addEventListener("click", closeMisModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeMisModal();
    });

    const addBtn = modal.querySelector(".greenoil-mis-btn-add");
    addBtn.addEventListener("click", () => {
      const wp = {
        name: c.name,
        address: c.address + (c.city ? ", " + c.city : ""),
        latitude: c.latitude,
        longitude: c.longitude,
        phone: c.phone || "",
        notes: `MIS编号: ${c.code}, 费率: ${c.rate}, 司机: ${c.driver}`
      };

      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: "addWaypoint", waypoint: wp }, (resp) => {
          if (resp && resp.success) {
            showToast("已加入路线", `${c.name} 已加入【${resp.theme?.name || currentTheme.name}】`);
            refreshWaypointPins();
            closeMisModal();
          } else {
            showToast("提示", resp?.error || `${c.name} 已在路线中`, false);
          }
        });
      }
    });

    document.body.appendChild(modal);
  }

  function closeMisModal() {
    const m = document.getElementById("greenoil-mis-modal");
    if (m) m.remove();
  }

  function checkAndUpdateMisAuth(container, btn) {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ action: "checkMisAuth" }, (auth) => {
        if (chrome.runtime.lastError || !auth) return;
        isMisAuthChecked = true;
        isMisLoggedIn = Boolean(auth.loggedIn);
        if (isMisLoggedIn) {
          container.classList.remove("greenoil-mis-disabled");
          container.title = "扫描周边20家餐馆并匹配 MIS 签约客户";
          btn.title = "扫描周边20家餐馆并匹配 MIS 签约客户";
          btn.setAttribute("aria-label", "匹配MIS");
        } else {
          container.classList.add("greenoil-mis-disabled");
          container.title = "请先登录 MIS 内部系统 (点击前往登录)";
          btn.title = "请先登录 MIS 内部系统 (点击前往登录)";
          btn.setAttribute("aria-label", "请先登录 MIS 内部系统 (点击前往登录)");
        }
      });
    } catch (_) {}
  }

  function handleMisBtnClick(container, circle, label) {
    if (container.classList.contains("greenoil-mis-disabled")) {
      window.open("https://mis.greenoilinc.com/login_intranet.php", "_blank");
      showToast("请先登录 MIS", "正在前往 MIS 登录页面，登录后返回即可使用", false);
      return;
    }

    const latestPlace = extractPlaceData();
    if (!latestPlace || isNaN(latestPlace.latitude) || isNaN(latestPlace.longitude)) {
      showToast("提示", "未能获取地点坐标，请在地点详情页稍候重试", false);
      return;
    }

    circle.innerHTML = SVG_SPINNER;
    container.classList.add("greenoil-loading");
    label.textContent = "匹配中...";
    showToast("透视扫描中", `正在静默扫描 ${latestPlace.name} 周边 20 家餐馆并匹配 MIS...`);

    try {
      if (!chrome.runtime?.id) {
        showToast("提示", "扩展已重新加载，请刷新网页", false);
        circle.innerHTML = SVG_MIS_SHIELD;
        container.classList.remove("greenoil-loading");
        label.textContent = "匹配MIS";
        return;
      }

      chrome.runtime.sendMessage({
        action: "scanAndMatchMis",
        lat: latestPlace.latitude,
        lng: latestPlace.longitude,
        placeName: latestPlace.name,
        placeAddress: latestPlace.address
      }, (resp) => {
        circle.innerHTML = SVG_MIS_SHIELD;
        container.classList.remove("greenoil-loading");
        label.textContent = "匹配MIS";

        if (chrome.runtime.lastError) {
          showToast("通信异常", "无法连接后台服务，请刷新网页", false);
          return;
        }

        if (resp && resp.notLoggedIn) {
          container.classList.add("greenoil-mis-disabled");
          showToast("登录态失效", "请先登录 MIS 内部系统后再进行匹配", false);
          return;
        }

        if (resp && resp.success) {
          const matches = resp.matches || [];
          showToast("MIS匹配完成", `已扫描周边 ${resp.totalScanned} 家餐馆，匹配到 ${matches.length} 家签约客户！`, true);
          renderMisPins(matches);
          if (matches.length > 0) {
            openMisModal(matches[0]);
          }
        } else {
          showToast("匹配失败", resp?.error || "扫描周边餐馆失败，请稍后重试", false);
        }
      });
    } catch (err) {
      console.error("Failed to scan and match MIS:", err);
      circle.innerHTML = SVG_MIS_SHIELD;
      container.classList.remove("greenoil-loading");
      label.textContent = "匹配MIS";
      showToast("通信异常", "扩展连接失败", false);
    }
  }

  // Hook map movement & key events for pins overlay
  window.addEventListener("resize", updateAllPinCoordinates);
  window.addEventListener("popstate", () => {
    updateAllPinCoordinates();
    setTimeout(updateAllPinCoordinates, 300);
  });
  window.addEventListener("wheel", () => requestAnimationFrame(updateAllPinCoordinates), { passive: true });
  window.addEventListener("pointermove", (e) => {
    if (e.buttons > 0) requestAnimationFrame(updateAllPinCoordinates);
  }, { passive: true });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMisModal();
  });
  setInterval(updateAllPinCoordinates, 300);

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
        if (child.id === "greenoil-heading-mis-badge" || child.classList.contains("greenoil-heading-mis-badge")) {
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

    // 2. Latitude & Longitude from URL
    let latitude = 43.76;
    let longitude = -79.41;

    const exactCoordMatch = location.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (exactCoordMatch) {
      latitude = parseFloat(exactCoordMatch[1]);
      longitude = parseFloat(exactCoordMatch[2]);
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
      const cidMatch = location.href.match(/!1s0x[0-9a-fA-F]+:0x([0-9a-fA-F]+)/);
      if (cidMatch && cidMatch[1]) {
        placeId = "cid_" + cidMatch[1];
      } else {
        const hexMatch = location.href.match(/0x[0-9a-fA-F]+:0x[0-9a-fA-F]+/);
        if (hexMatch) {
          placeId = hexMatch[0];
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

  function showToast(title, description, isSuccess = true) {
    let container = document.getElementById("greenoil-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "greenoil-toast-container";
      container.className = "greenoil-toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "greenoil-toast";

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
    }, 3200);
  }

  /**
   * Check place status and inject [+ 途径点] button into the open place panel
   */
  function checkAndInject() {
    try {
      const currentUrl = location.href;

      // 1. Must be a ready place view
      if (!isPlacePage()) {
        if (lastProcessedKey) {
          lastProcessedKey = "";
          const oldBtn = document.getElementById("greenoil-add-waypoint-btn");
          if (oldBtn) oldBtn.remove();
          const oldMisBtn = document.getElementById("greenoil-match-mis-btn");
          if (oldMisBtn) oldMisBtn.remove();
          const oldBadge = document.getElementById("greenoil-heading-mis-badge");
          if (oldBadge) oldBadge.remove();
        }
        return;
      }

      const mainPanel = document.querySelector('div[role="main"]');
      if (!mainPanel) {
        const oldBtn = document.getElementById("greenoil-add-waypoint-btn");
        if (oldBtn) oldBtn.remove();
        const oldMisBtn = document.getElementById("greenoil-match-mis-btn");
        if (oldMisBtn) oldMisBtn.remove();
        const oldBadge = document.getElementById("greenoil-heading-mis-badge");
        if (oldBadge) oldBadge.remove();
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
        const oldHeadingBadge = document.getElementById("greenoil-heading-mis-badge");
        if (oldHeadingBadge) oldHeadingBadge.remove();
        return;
      }

      // If this place is matched to MIS, show MIS pin badge behind the name
      const currentPlaceObj = extractPlaceData();
      if (currentPlaceObj) {
        updateHeadingMisBadge(mainPanel, currentPlaceObj);
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
        const oldMisBtn = document.getElementById("greenoil-match-mis-btn");
        if (oldMisBtn) oldMisBtn.remove();
        lastProcessedKey = "";
        return;
      }

      const dirItem = dirBtn.closest('.etWJQ') || dirBtn.parentElement;
      const targetRow = dirItem ? dirItem.parentElement : null;

      if (!targetRow || !targetRow.classList.contains('m6QErb')) {
        const oldBtn = document.getElementById("greenoil-add-waypoint-btn");
        if (oldBtn) oldBtn.remove();
        const oldMisBtn = document.getElementById("greenoil-match-mis-btn");
        if (oldMisBtn) oldMisBtn.remove();
        lastProcessedKey = "";
        return;
      }

      const currentKey = currentUrl + "|" + placeName;

      // Already injected and in place for THIS place
      const existingBtn = document.getElementById("greenoil-add-waypoint-btn");
      if (existingBtn && document.body.contains(existingBtn) && currentKey === lastProcessedKey && targetRow.contains(existingBtn)) {
        return;
      }

      if (existingBtn) existingBtn.remove();
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
              if (resp && resp.inRoute) {
                // Requirement 2: Show the route it belongs to!
                circle.innerHTML = SVG_CHECK;
                label.textContent = "已添加";
                container.classList.add("greenoil-added");
                container.dataset.belongRouteName = resp.belongRouteName || "";
                container.dataset.belongRouteId = resp.belongRouteId || "";
                container.title = `该地点已在【${resp.belongRouteName}】中`;
                applyThemeToContainer(container, resp.belongTheme);
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
              }
            });
          }
        }
      } catch (_) {}

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

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

      // POINT 2: Place [匹配MIS] right after [+ 途径点] (before dirItem)
      let misContainer = document.getElementById("greenoil-match-mis-btn");
      if (!misContainer || !targetRow.contains(misContainer)) {
        if (misContainer) misContainer.remove();

        misContainer = document.createElement("div");
        misContainer.id = "greenoil-match-mis-btn";
        misContainer.className = "etWJQ jym1ob kdfrQc WY7ZIb greenoil-action-container";

        const misBtn = document.createElement("button");
        misBtn.className = "S9kvJb greenoil-action-btn";
        misBtn.type = "button";
        misBtn.setAttribute("aria-label", "匹配MIS");
        misBtn.title = "扫描周边20家餐馆并匹配 MIS 签约客户";

        const misCircle = document.createElement("span");
        misCircle.className = "DVeyrd greenoil-action-circle greenoil-mis-circle";
        misCircle.innerHTML = SVG_MIS_SHIELD;

        const misLabel = document.createElement("div");
        misLabel.className = "R8c4Qb fontLabelMedium greenoil-action-label greenoil-mis-label";
        misLabel.textContent = "匹配MIS";

        misBtn.appendChild(misCircle);
        misBtn.appendChild(misLabel);
        misContainer.appendChild(misBtn);

        checkAndUpdateMisAuth(misContainer, misBtn);

        misBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          handleMisBtnClick(misContainer, misCircle, misLabel);
        });

        targetRow.insertBefore(misContainer, dirItem);
      }
    } catch (err) {
      console.warn("[GreenOil] Injection check caught error:", err);
    }
  }

    window.__greenoil_check__ = checkAndInject;

    // Lightweight check every 800ms
    setInterval(checkAndInject, 800);

    // Initial check
    if (document.readyState === "complete" || document.readyState === "interactive") {
      checkAndInject();
      if (typeof refreshWaypointPins === "function") refreshWaypointPins();
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        checkAndInject();
        if (typeof refreshWaypointPins === "function") refreshWaypointPins();
      });
    }
  })();
}
