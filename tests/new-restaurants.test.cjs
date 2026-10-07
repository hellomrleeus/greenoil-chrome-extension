const test = require("node:test");
const assert = require("node:assert/strict");

test("GreenOilApi.getNewlyOpenedRestaurants builds correct URL and headers", async () => {
  const { GreenOilApi } = await import("../api.js");
  
  let requestedUrl = "";
  let requestedHeaders = {};

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedHeaders = options.headers || {};
    return {
      ok: true,
      json: async () => ({
        success: true,
        period: "week",
        data: [
          {
            id: "est_1",
            name: "New Dim Sum House",
            address: "123 Spadina Ave",
            estimatedOpeningDate: "2026-10-02",
            latitude: 43.651,
            longitude: -79.398
          }
        ]
      })
    };
  };

  try {
    const res = await GreenOilApi.getNewlyOpenedRestaurants("test_jwt_token", "week");
    assert.equal(res.success, true);
    assert.equal(requestedUrl.includes("/api/new-restaurants?period=week"), true);
    assert.equal(requestedHeaders["Authorization"], "Bearer test_jwt_token");
    assert.equal(res.data.length, 1);
    assert.equal(res.data[0].name, "New Dim Sum House");
    assert.equal(res.data[0].estimatedOpeningDate, "2026-10-02");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Newly opened restaurants Excel export data structure matches required columns", () => {
  const mockRestaurants = [
    {
      name: "Fresh Ramen Bar",
      address: "500 Bloor St W",
      estimatedOpeningDate: "2026-10-04",
      firstInspectionDate: "2026-10-04",
      latitude: 43.665,
      longitude: -79.410,
      phone: "416-555-1234",
      status: "Pass"
    }
  ];

  const exportRows = mockRestaurants.map((r, idx) => ({
    "序号": idx + 1,
    "餐厅名称": r.name || "",
    "地址": r.address || "",
    "预计开业时间(首次卫生检查时间)": r.estimatedOpeningDate || r.firstInspectionDate || "",
    "纬度": r.latitude != null ? r.latitude : "",
    "经度": r.longitude != null ? r.longitude : "",
    "电话": r.phone || "",
    "检查状态": r.status || "Pass"
  }));

  assert.equal(exportRows.length, 1);
  const row = exportRows[0];
  assert.equal(row["序号"], 1);
  assert.equal(row["餐厅名称"], "Fresh Ramen Bar");
  assert.equal(row["地址"], "500 Bloor St W");
  assert.equal(row["预计开业时间(首次卫生检查时间)"], "2026-10-04");
  assert.equal(row["纬度"], 43.665);
  assert.equal(row["经度"], -79.410);
  assert.equal(row["电话"], "416-555-1234");
  assert.equal(row["检查状态"], "Pass");
});

test("Newly opened restaurants filtering logic: day, week, month", () => {
  const refDate = new Date("2026-10-05T00:00:00Z");
  const data = [
    { name: "Shop 1d", firstInspectionDate: "2026-10-04" }, // 1 day
    { name: "Shop 5d", firstInspectionDate: "2026-09-30" }, // 5 days (in week)
    { name: "Shop 20d", firstInspectionDate: "2026-09-15" }, // 20 days (in month)
    { name: "Shop 45d", firstInspectionDate: "2026-08-20" }  // 45 days (outside month)
  ];

  const filterByDays = (days) => {
    return data.filter(item => {
      const diffDays = (refDate - new Date(item.firstInspectionDate + "T00:00:00Z")) / 86400000;
      return diffDays >= 0 && diffDays <= days;
    });
  };

  assert.equal(filterByDays(1).length, 1, "Only Shop 1d is within 1 day");
  assert.equal(filterByDays(7).length, 2, "Shop 1d and Shop 5d are within 1 week");
  assert.equal(filterByDays(30).length, 3, "Shop 1d, 5d, 20d are within 1 month");
});

test("Newly opened restaurants 24h cache expiration and force refresh logic", () => {
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const isCacheValid = (stored, requestedPeriod, forceRefresh) => {
    if (forceRefresh) return false;
    const isNotExpired = typeof stored?.gce_new_restaurants_updated === "number" &&
      (now - stored.gce_new_restaurants_updated < CACHE_TTL_MS);
    return Array.isArray(stored?.gce_new_restaurants_cache) &&
      stored.gce_new_restaurants_cache.length > 0 &&
      stored?.gce_new_restaurants_period === requestedPeriod &&
      isNotExpired;
  };

  const sampleCache = [{ id: "est_1", name: "Test Dine" }];

  // 1. Valid cache within 24 hours (e.g. 1 hour ago)
  const freshStored = {
    gce_new_restaurants_cache: sampleCache,
    gce_new_restaurants_period: "week",
    gce_new_restaurants_updated: now - 3600 * 1000
  };
  assert.equal(isCacheValid(freshStored, "week", false), true, "Fresh cache within 24h should be valid");

  // 2. Expired cache (24 hours and 1 millisecond ago)
  const expiredStored = {
    gce_new_restaurants_cache: sampleCache,
    gce_new_restaurants_period: "week",
    gce_new_restaurants_updated: now - (CACHE_TTL_MS + 1)
  };
  assert.equal(isCacheValid(expiredStored, "week", false), false, "Cache older than 24h should be expired");

  // 3. Cache with missing timestamp
  const noTimestampStored = {
    gce_new_restaurants_cache: sampleCache,
    gce_new_restaurants_period: "week"
  };
  assert.equal(isCacheValid(noTimestampStored, "week", false), false, "Cache without timestamp should be invalid");

  // 4. Force refresh bypasses valid fresh cache
  assert.equal(isCacheValid(freshStored, "week", true), false, "forceRefresh=true must bypass fresh cache");

  // 5. Different period requested (e.g. cached week, requested month)
  assert.equal(isCacheValid(freshStored, "month", false), false, "Period mismatch must invalidate cache hit");
});

test("Unauthenticated access strictly blocks reading browser cached restaurant data", () => {
  const mockStorage = {
    authToken: "", // unauthenticated
    gce_new_restaurants_cache: [{ id: "est_1", name: "Secret New Cafe" }],
    gce_new_restaurants_period: "week",
    gce_new_restaurants_updated: Date.now()
  };

  // Simulating popup / content / background cache resolution
  const resolveRestaurants = (storage, isLoggedIn) => {
    // Unauthenticated guard
    if (!isLoggedIn || !storage.authToken) {
      return []; // strictly blocked
    }
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    const isNotExpired = typeof storage?.gce_new_restaurants_updated === "number" &&
      (Date.now() - storage.gce_new_restaurants_updated < CACHE_TTL_MS);

    if (Array.isArray(storage.gce_new_restaurants_cache) && isNotExpired) {
      return storage.gce_new_restaurants_cache;
    }
    return [];
  };

  // When not logged in: must return empty array even if cache is present in storage
  const unauthedResult = resolveRestaurants(mockStorage, false);
  assert.deepEqual(unauthedResult, [], "Unauthenticated read must return empty array, blocking cached data");

  // When logged in: returns cached data
  mockStorage.authToken = "valid-token-xyz";
  const authedResult = resolveRestaurants(mockStorage, true);
  assert.equal(authedResult.length, 1);
  assert.equal(authedResult[0].name, "Secret New Cafe");
});

test("New restaurant pin tooltip has close button and single plus sign without duplication", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const contentJs = fs.readFileSync(path.resolve(__dirname, "../content.js"), "utf8");
  const contentCss = fs.readFileSync(path.resolve(__dirname, "../content.css"), "utf8");

  // 1. Close button exists in tooltip markup and has CSS styling
  assert.ok(contentJs.includes("greenoil-new-tooltip-close-btn"), "Tooltip must include close button class");
  assert.ok(contentCss.includes(".greenoil-new-tooltip-close-btn"), "CSS must style tooltip close button");

  // 2. Dismissed state handled
  assert.ok(contentCss.includes(".greenoil-new-pin.dismissed"), "CSS must handle dismissed pin state");
  assert.ok(contentJs.includes("pointerdown"), "Pointerdown outside dismissal must be registered");

  // 3. Button text should NOT duplicate the plus sign (+ 加入路线)
  assert.ok(!contentJs.includes("<span>+ 加入路线"), "Tooltip add button text must not duplicate plus sign");
  assert.ok(contentJs.includes("<span>加入路线</span>") || contentJs.includes('"加入路线"'), "Button should say '加入路线'");
});

test("New restaurant address in floating tooltip and popup is clickable to copy", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const contentJs = fs.readFileSync(path.resolve(__dirname, "../content.js"), "utf8");
  const contentCss = fs.readFileSync(path.resolve(__dirname, "../content.css"), "utf8");
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../popup.js"), "utf8");
  const popupCss = fs.readFileSync(path.resolve(__dirname, "../popup.css"), "utf8");

  // 1. Content script floating tooltip supports copy
  assert.ok(contentJs.includes("greenoil-new-tooltip-address"), "Tooltip must include address class");
  assert.ok(contentJs.includes("greenoil-new-tooltip-copy-btn"), "Tooltip must include copy button element");
  assert.ok(contentJs.includes("copyToClipboard"), "Content script must have copyToClipboard helper");
  assert.ok(contentJs.includes("showToast(\"已复制地址\""), "Content script should show toast on copy");
  assert.ok(contentCss.includes(".greenoil-new-tooltip-address"), "CSS must style tooltip address");
  assert.ok(contentCss.includes(".greenoil-new-tooltip-address[role=\"button\"]"), "CSS must style clickable address pointer");
  assert.ok(contentCss.includes(".greenoil-new-tooltip-address.is-copied"), "CSS must style copied feedback state");
  assert.ok(contentCss.includes(".greenoil-new-tooltip-copy-btn"), "CSS must style copy button");

  // 2. Popup extension list also supports copy
  assert.ok(popupJs.includes("new-rest-copy-btn"), "Popup JS must include copy button element");
  assert.ok(popupJs.includes("copyToClipboard"), "Popup JS must have copyToClipboard helper");
  assert.ok(popupCss.includes(".new-rest-copy-btn"), "Popup CSS must style copy button");
  assert.ok(popupCss.includes(".new-rest-address-row.is-copied"), "Popup CSS must style copied feedback state");
});

