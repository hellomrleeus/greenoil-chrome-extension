/**
 * Green Oil — route ordering (pure functions, no DOM).
 *
 * Orders waypoints as an open path that starts at the origin and ends at the
 * last stop (the same shape as the Google Maps directions URL we build).
 *
 * Locked groups (same lockGroupId) are treated as one block: their members stay
 * together, in their original relative order, and are never reversed. The block
 * is entered at its first located member and left at its last.
 *
 *   <= EXACT_LIMIT blocks : exact optimum (Held-Karp dynamic programming)
 *   larger                : nearest neighbour, then 2-opt + or-opt until no
 *                           move shortens the route
 *
 * Waypoints without usable coordinates cannot be placed, so they are appended
 * at the end in their original order instead of being scattered by a fake
 * zero distance.
 *
 * Loaded by popup.html as a classic script AND required directly by node tests.
 */

(function () {
"use strict";

const EXACT_LIMIT = 12;

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function pointOf(w) {
  const lat = parseFloat(w && w.latitude);
  const lng = parseFloat(w && w.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** Group waypoints into blocks; locked groups become one block. */
function buildBlocks(waypoints) {
  const blocks = [];
  const byGroup = new Map();
  for (const w of waypoints) {
    const gid = w && w.lockGroupId;
    if (gid) {
      if (!byGroup.has(gid)) {
        const b = { items: [] };
        byGroup.set(gid, b);
        blocks.push(b);
      }
      byGroup.get(gid).items.push(w);
    } else {
      blocks.push({ items: [w] });
    }
  }
  for (const b of blocks) {
    const pts = b.items.map(pointOf).filter(Boolean);
    b.entry = pts[0] || null;
    b.exit = pts[pts.length - 1] || null;
  }
  return blocks;
}

/** Length of the open path origin -> blocks[order[0]] -> ... */
function pathLength(order, origin, blocks, dist) {
  if (order.length === 0) return 0;
  let total = dist.fromOrigin[order[0]];
  for (let i = 1; i < order.length; i++) total += dist.between[order[i - 1]][order[i]];
  return total;
}

function buildDistances(origin, blocks) {
  const n = blocks.length;
  const fromOrigin = blocks.map(b => haversineKm(origin, b.entry));
  const between = [];
  for (let i = 0; i < n; i++) {
    between.push([]);
    for (let j = 0; j < n; j++) {
      between[i].push(i === j ? 0 : haversineKm(blocks[i].exit, blocks[j].entry));
    }
  }
  return { fromOrigin, between };
}

/** Exact shortest open path via Held-Karp, O(n^2 * 2^n). */
function solveExact(n, dist) {
  const full = 1 << n;
  const cost = new Float64Array(full * n).fill(Infinity);
  const parent = new Int8Array(full * n).fill(-1);
  for (let j = 0; j < n; j++) cost[(1 << j) * n + j] = dist.fromOrigin[j];

  for (let mask = 1; mask < full; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const c = cost[mask * n + last];
      if (c === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const m2 = mask | (1 << next);
        const c2 = c + dist.between[last][next];
        if (c2 < cost[m2 * n + next]) {
          cost[m2 * n + next] = c2;
          parent[m2 * n + next] = last;
        }
      }
    }
  }

  let mask = full - 1;
  let last = 0;
  for (let j = 1; j < n; j++) {
    if (cost[mask * n + j] < cost[mask * n + last]) last = j;
  }
  const order = [];
  while (last !== -1) {
    order.push(last);
    const prev = parent[mask * n + last];
    mask &= ~(1 << last);
    last = prev;
  }
  return order.reverse();
}

function nearestNeighbour(n, dist) {
  const used = new Array(n).fill(false);
  const order = [];
  let cur = -1;
  for (let step = 0; step < n; step++) {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const d = cur === -1 ? dist.fromOrigin[j] : dist.between[cur][j];
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    used[best] = true;
    order.push(best);
    cur = best;
  }
  return order;
}

const EPS = 1e-9;

/** 2-opt (reverse a run of blocks) + or-opt (move a run of 1-3 blocks). */
function improve(order, origin, blocks, dist) {
  let best = pathLength(order, origin, blocks, dist);
  const n = order.length;
  let improved = true;
  let guard = 0;

  while (improved && guard++ < 1000) {
    improved = false;

    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        const len = pathLength(cand, origin, blocks, dist);
        if (len < best - EPS) {
          order = cand;
          best = len;
          improved = true;
        }
      }
    }

    for (let segLen = 1; segLen <= 3; segLen++) {
      for (let i = 0; i + segLen <= n; i++) {
        const seg = order.slice(i, i + segLen);
        const rest = order.slice(0, i).concat(order.slice(i + segLen));
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          const cand = rest.slice(0, k).concat(seg, rest.slice(k));
          const len = pathLength(cand, origin, blocks, dist);
          if (len < best - EPS) {
            order = cand;
            best = len;
            improved = true;
            break;
          }
        }
      }
    }
  }
  return order;
}

/**
 * @param {Array} waypoints  items with latitude/longitude and optional lockGroupId
 * @param {{lat:number,lng:number}} origin
 * @returns {Array} the same waypoint objects, reordered
 */
function optimizeRoute(waypoints, origin) {
  const blocks = buildBlocks(waypoints || []);
  const located = blocks.filter(b => b.entry);
  const unlocated = blocks.filter(b => !b.entry);

  let order = [];
  const n = located.length;
  if (n > 0) {
    const dist = buildDistances(origin, located);
    order = n <= EXACT_LIMIT ? solveExact(n, dist) : improve(nearestNeighbour(n, dist), origin, located, dist);
  }

  const result = [];
  for (const idx of order) result.push(...located[idx].items);
  for (const b of unlocated) result.push(...b.items);
  return result;
}

/** Total km of an already-ordered waypoint list (unlocated points skipped). */
function routeLengthKm(waypoints, origin) {
  let cur = origin;
  let total = 0;
  for (const w of waypoints || []) {
    const p = pointOf(w);
    if (!p) continue;
    total += haversineKm(cur, p);
    cur = p;
  }
  return total;
}

/**
 * Build Google Maps directions URL with origin and stops.
 * Concatenates all waypoints with slashes, bypassing the Google Maps UI 10-stop limit.
 */
function buildSlashUrl(origin, stops) {
  const originStr = encodeURIComponent(origin || "");
  const stopStrs = (stops || []).map(s => {
    const isCustom = !!s.isCustomAddress || s.name === s.address;
    let target = isCustom ? (s.address || s.name || "") : ((s.name ? s.name + ", " : "") + (s.address || ""));
    if (!target.trim() && s.latitude && s.longitude) {
      target = `${s.latitude},${s.longitude}`;
    }
    return encodeURIComponent(target);
  });
  return `https://www.google.com/maps/dir/${originStr}/${stopStrs.join("/")}/`;
}

/**
 * Split waypoints into legs of up to 9 stops each (for mobile Google Maps app support).
 */
function buildRouteLegs(origin, stops, step = 9) {
  const legs = [];
  const safeStops = stops || [];
  const totalLegs = Math.ceil(safeStops.length / step);

  for (let i = 0; i < totalLegs; i++) {
    const startIdx = i * step;
    const endIdx = Math.min(startIdx + step, safeStops.length);
    const legStops = safeStops.slice(startIdx, endIdx);

    const prevStop = safeStops[startIdx - 1];
    const legOrigin = i === 0
      ? origin
      : ((prevStop && prevStop.name ? prevStop.name + ", " : "") + ((prevStop && prevStop.address) || ""));

    const legUrl = buildSlashUrl(legOrigin, legStops);

    const fromLabel = i === 0 ? "Green Oil HQ" : ((prevStop && prevStop.name) || `第 ${startIdx} 站`);
    const toLabel = (legStops[legStops.length - 1] && legStops[legStops.length - 1].name) || `第 ${endIdx} 站`;

    legs.push({
      index: i + 1,
      from: fromLabel,
      to: toLabel,
      count: legStops.length,
      stopNames: legStops.map(s => s.name || s.address).join(" → "),
      url: legUrl
    });
  }

  return legs;
}

const api = { optimizeRoute, routeLengthKm, haversineKm, buildSlashUrl, buildRouteLegs };

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else if (typeof window !== "undefined") {
  window.GreenOilRoute = api;
}
})();
