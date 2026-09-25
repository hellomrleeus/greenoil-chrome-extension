/**
 * Green Oil Chrome Extension - Content Script for Google Maps
 * Safely injects "+ 途径点" button into Google Maps place details panel without impacting page performance.
 */

(() => {
  let lastUrl = location.href;
  let debounceTimer = null;
  let currentInjectedPlaceId = null;

  const SVG_PLUS = `<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
  const SVG_CHECK = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  const SVG_INFO = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;

  /**
   * Fast check if Google Maps is displaying a place details panel
   */
  function isPlacePage() {
    return location.href.includes("/place/");
  }

  /**
   * Extract place details from DOM & URL without calling any Google APIs
   */
  function extractPlaceData() {
    const mainPanel = document.querySelector('div[role="main"]') || document.body;

    // 1. Name: English/Official Name from H1 or URL
    let name = "";
    const h1 = mainPanel.querySelector('h1.DUwDvf') || mainPanel.querySelector('h1');
    if (h1 && h1.textContent) {
      name = h1.textContent.trim();
    }
    if (!name) {
      const urlMatch = location.pathname.match(/\/place\/([^/@]+)/);
      if (urlMatch && urlMatch[1]) {
        name = decodeURIComponent(urlMatch[1].replace(/\+/g, " "));
      }
    }
    if (!name) name = "Unknown Place";

    // 2. Latitude & Longitude from URL
    let latitude = 43.76;
    let longitude = -79.41;

    // Exact place coordinates in Google Maps URL: !3d43.xxxx!4d-79.xxxx
    const exactCoordMatch = location.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (exactCoordMatch) {
      latitude = parseFloat(exactCoordMatch[1]);
      longitude = parseFloat(exactCoordMatch[2]);
    } else {
      // Fallback: Map center coords: /@43.xxxx,-79.xxxx,17z
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
        address = addrBtn.getAttribute("aria-label").replace(/^(Address:\s*|地址：\s*)/i, "").trim();
      }
    }
    if (!address) {
      const possibleAddress = mainPanel.querySelector('div.Io6YTe');
      if (possibleAddress && possibleAddress.textContent) {
        address = possibleAddress.textContent.trim();
      }
    }

    // 4. Place ID / CID
    let placeId = "";
    const cidMatch = location.href.match(/!1s0x[0-9a-fA-F]+:0x([0-9a-fA-F]+)/);
    if (cidMatch && cidMatch[1]) {
      placeId = "cid_" + cidMatch[1];
    } else {
      const hexMatch = location.href.match(/0x[0-9a-fA-F]+:0x[0-9a-fA-F]+/);
      if (hexMatch) {
        placeId = hexMatch[0];
      } else {
        placeId = "custom_" + Math.abs(hashCode(name + address));
      }
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

    return {
      id: placeId,
      placeId,
      name,
      address,
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

  /**
   * Display modern feedback toast
   */
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
   * Safely inject button with deduplication and state caching
   */
  async function tryInjectButton() {
    if (!isPlacePage()) {
      currentInjectedPlaceId = null;
      return;
    }

    const mainPanel = document.querySelector('div[role="main"]');
    if (!mainPanel) return;

    const placeData = extractPlaceData();
    if (!placeData.name || placeData.name === "Unknown Place") return;

    // Check if already injected for this exact place
    const existingBtn = document.getElementById("greenoil-add-waypoint-btn");
    if (existingBtn) {
      if (currentInjectedPlaceId === placeData.placeId && document.body.contains(existingBtn)) {
        return; // Already cleanly injected for this place
      }
      existingBtn.remove();
    }

    // Locate container for action buttons (Directions, Save, Share row)
    const dirBtn = mainPanel.querySelector('button[data-value="Directions"], button[data-value="路线"], button[aria-label*="Directions"], button[aria-label*="路线"], [data-item-id="directions"]');
    let targetContainer = dirBtn ? (dirBtn.closest('.m6QErb, .R6PtDb') || dirBtn.parentElement) : null;

    if (!targetContainer) {
      const actionRow = mainPanel.querySelector('.m6QErb[aria-label], .m6QErb');
      if (actionRow) targetContainer = actionRow;
      else {
        const h1 = mainPanel.querySelector('h1.DUwDvf') || mainPanel.querySelector('h1');
        if (h1 && h1.parentElement) targetContainer = h1.parentElement;
      }
    }

    if (!targetContainer) return;

    currentInjectedPlaceId = placeData.placeId;

    const btn = document.createElement("button");
    btn.id = "greenoil-add-waypoint-btn";
    btn.className = "greenoil-add-btn";
    btn.type = "button";
    btn.title = "加入当前地点到 Green Oil 路线";
    btn.innerHTML = `${SVG_PLUS}<span>+ 途径点</span>`;

    // Query status safely
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({
          action: "checkPlaceStatus",
          placeId: placeData.placeId,
          name: placeData.name
        }, (res) => {
          if (chrome.runtime.lastError) return;
          if (res && res.inRoute) {
            btn.innerHTML = `${SVG_CHECK}<span>已在路线中</span>`;
            btn.classList.add("greenoil-added");
            btn.disabled = true;
          }
        });
      }
    } catch {
      // Ignore background communication errors
    }

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const latestPlace = extractPlaceData();
      btn.disabled = true;

      try {
        if (!chrome.runtime?.id) {
          showToast("提示", "扩展已重新加载，请刷新页面后重试", false);
          btn.disabled = false;
          return;
        }

        chrome.runtime.sendMessage({
          action: "addWaypoint",
          waypoint: latestPlace
        }, (response) => {
          if (chrome.runtime.lastError) {
            showToast("通信异常", "无法连接到后台服务，请刷新页面", false);
            btn.disabled = false;
            return;
          }

          if (response && response.success) {
            btn.innerHTML = `${SVG_CHECK}<span>已添加</span>`;
            btn.classList.add("greenoil-added");
            showToast("已加入路线", `${latestPlace.name} (当前路线共 ${response.count} 个途径点)`);
          } else if (response && response.alreadyExists) {
            btn.innerHTML = `${SVG_CHECK}<span>已在路线中</span>`;
            btn.classList.add("greenoil-added");
            showToast("提示", `${latestPlace.name} 已存在于当前路线中`, false);
          } else {
            showToast("添加失败", response?.error || "请稍后重试", false);
            btn.disabled = false;
          }
        });
      } catch (err) {
        console.error("Failed to add waypoint:", err);
        showToast("通信异常", "扩展连接失败", false);
        btn.disabled = false;
      }
    });

    if (dirBtn && dirBtn.nextSibling) {
      targetContainer.insertBefore(btn, dirBtn.nextSibling);
    } else {
      targetContainer.appendChild(btn);
    }
  }

  function scheduleCheck() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      tryInjectButton();
    }, 350);
  }

  // Hook into browser history navigation
  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    const res = originalPushState.apply(this, args);
    scheduleCheck();
    return res;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function(...args) {
    const res = originalReplaceState.apply(this, args);
    scheduleCheck();
    return res;
  };

  window.addEventListener("popstate", scheduleCheck);

  // Relaxed mutation observer - strictly ignores non-place pages and its own elements
  const observer = new MutationObserver((mutations) => {
    if (!isPlacePage()) return;

    for (let i = 0; i < mutations.length; i++) {
      const target = mutations[i].target;
      if (target && target.id && target.id.startsWith("greenoil-")) {
        return; // Skip self mutations to prevent loop
      }
    }

    scheduleCheck();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Background URL polling as fallback (every 1 second)
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleCheck();
    }
  }, 1000);

  // Initial check
  if (document.readyState === "complete" || document.readyState === "interactive") {
    scheduleCheck();
  } else {
    document.addEventListener("DOMContentLoaded", scheduleCheck);
  }
})();
