/**
 * Green Oil — "导入地址": pasted lines -> waypoints (pure functions, no DOM).
 *
 * The popup sends the lines to a Google Maps tab, whose content script looks
 * each one up with Google's own search (google-places.js lookupAddress), then
 * planImport() decides what to add.
 *
 * Loaded by popup.html as a classic script AND required directly by node tests.
 */

(function () {
"use strict";

const MAX_LINES = 100;

/** One address (or "name, address") per line; blanks and repeats dropped. */
function parseAddressLines(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:\d+[.)、]|[-*•])\s+/, "").replace(/\s+/g, " ").trim();
    if (line.length < 3) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function samePlace(a, b) {
  if (a.placeId && b.placeId && a.placeId === b.placeId && !a.placeId.startsWith("custom_")) return true;
  const an = String(a.name || "").trim().toLowerCase();
  const bn = String(b.name || "").trim().toLowerCase();
  const aa = String(a.address || "").trim().toLowerCase();
  const ba = String(b.address || "").trim().toLowerCase();
  return Boolean(an) && an === bn && (!aa || !ba || aa === ba);
}

/** Lookup result -> the waypoint shape the routes store. */
function toWaypoint(place) {
  const lat = Number(place.latitude);
  const lng = Number(place.longitude);
  return {
    name: place.name,
    address: place.address || "",
    latitude: lat,
    longitude: lng,
    openingHours: "",
    phone: "",
    placeId: place.placeId || "",
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
  };
}

/**
 * @param results  [{query, place|null, error?}] from the Maps tab
 * @param routes   {routeId: {name, waypoints[]}} — every route, to skip
 *                 places already planned anywhere
 * @returns {{add: Waypoint[], duplicates: [{query, name, routeName}],
 *            notFound: string[], failed: [{query, error}]}}
 */
function planImport(results, routes) {
  const plan = { add: [], duplicates: [], notFound: [], failed: [] };
  const existing = [];
  for (const r of Object.values(routes || {})) {
    for (const w of (r && Array.isArray(r.waypoints) ? r.waypoints : [])) existing.push({ w, routeName: r.name || "" });
  }

  for (const res of results || []) {
    if (res.error) {
      plan.failed.push({ query: res.query, error: res.error });
      continue;
    }
    const p = res.place;
    if (!p || !p.name || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude))) {
      plan.notFound.push(res.query);
      continue;
    }
    const wp = toWaypoint(p);
    const hit = existing.find(e => samePlace(e.w, wp));
    if (hit) {
      plan.duplicates.push({ query: res.query, name: wp.name, routeName: hit.routeName });
      continue;
    }
    if (plan.add.some(w => samePlace(w, wp))) {
      plan.duplicates.push({ query: res.query, name: wp.name, routeName: "" });
      continue;
    }
    plan.add.push(wp);
  }
  return plan;
}

const api = { MAX_LINES, parseAddressLines, planImport, toWaypoint };

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else if (typeof window !== "undefined") {
  window.GreenOilAddressImport = api;
}
})();
