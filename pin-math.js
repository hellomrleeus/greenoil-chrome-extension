/**
 * Green Oil — pin math helpers (pure functions, no DOM).
 *
 * Loaded in the page MAIN world before map-hook.js AND required directly by
 * node tests. Keep this file free of browser globals, and keep everything
 * inside the IIFE: in the MAIN world top-level names would leak into (and
 * could collide with) Google's own global scope.
 */

(function () {
"use strict";

// ---- Web Mercator, normalized to [0..1] (Google's shader world space) ----

function worldX(lng) {
  return (lng + 180) / 360;
}

function worldY(lat) {
  let s = Math.sin((lat * Math.PI) / 180);
  s = Math.max(-0.9999, Math.min(0.9999, s));
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function worldToLatLng(wx, wy) {
  const n = Math.PI * (1 - 2 * wy);
  return {
    lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    lng: wx * 360 - 180,
  };
}

// ---- Google vector-map camera uniform signatures ----
//
// Every shader program that draws map geometry receives, in this order:
//   uniform3fv  hi  camera center in [0..1] world space, tile-snapped, z = 0
//   uniform3fv  lo  remainder (|lo| < one tile), z = 0  -> center = hi + lo
//   uniformMatrix4fv  perspective: view px -> clip (m[11] < 0)
//   uniform1f   world size in CSS px = 256 * 2^zoom (fractional while zooming)

function isCameraHi(v) {
  return !!v && v[2] === 0 && v[0] >= 0 && v[0] <= 1 && v[1] >= 0 && v[1] <= 1;
}

function isCameraLo(v) {
  return !!v && v[2] === 0 && Math.abs(v[0]) < 0.01 && Math.abs(v[1]) < 0.01;
}

function isPerspective(m) {
  return !!m && m.length >= 16 && m[11] < 0 && m[15] > 0 && m[0] > 0 && m[5] < 0;
}

function isWorldScale(s) {
  // 256 * 2^1 .. 256 * 2^28
  return typeof s === "number" && s >= 512 && s <= 7e10;
}

function zoomFromScale(s) {
  return Math.log(s / 256) / Math.LN2;
}

/**
 * Project a world point through the captured GL camera.
 * cam: {cx, cy, s, m}; w/h: canvas CSS size.
 * Returns canvas-local CSS px {x, y}, or null when behind the camera.
 */
function projectGL(wx, wy, cam, w, h) {
  const vx = (wx - cam.cx) * cam.s;
  const vy = (wy - cam.cy) * cam.s;
  const m = cam.m;
  const X = m[0] * vx + m[4] * vy + m[12];
  const Y = m[1] * vx + m[5] * vy + m[13];
  const W = m[3] * vx + m[7] * vy + m[15];
  if (!(W > 1e-6)) return null;
  return {
    x: ((X / W + 1) / 2) * w,
    y: ((1 - Y / W) / 2) * h,
  };
}

/**
 * Fallback projection from the URL camera (@lat,lng,zoom). Google's URL
 * camera is the center of the full map canvas (even with the side panel
 * open), so project around the canvas center.
 */
function projectUrl(wx, wy, cam, w, h) {
  const s = 256 * Math.pow(2, cam.zoom);
  return {
    x: w / 2 + (wx - worldX(cam.lng)) * s,
    y: h / 2 + (wy - worldY(cam.lat)) * s,
  };
}

/** True when a canvas-local point is inside the canvas (plus margin). */
function inCanvas(pt, w, h, margin) {
  const m = margin || 0;
  return !!pt && pt.x >= -m && pt.y >= -m && pt.x <= w + m && pt.y <= h + m;
}

/**
 * Does the GL camera agree with the settled URL camera? Used to detect a
 * future Google shader change that would make the signature match the
 * wrong uniforms. URL lat/lng has 7 decimals and zoom 2 decimals.
 */
function glAgreesWithUrl(cam, urlCam, w, h) {
  if (!cam || !urlCam) return true;
  const z = zoomFromScale(cam.s);
  if (Math.abs(z - urlCam.zoom) > 0.02) return false;
  const pt = projectGL(worldX(urlCam.lng), worldY(urlCam.lat), cam, w, h);
  return !!pt && Math.abs(pt.x - w / 2) <= 3 && Math.abs(pt.y - h / 2) <= 3;
}

// ---- Google's off-thread renderer (OffscreenCanvas in a Worker) ----
//
// Newer Google Maps draws the map in a Worker, so the WebGL calls above
// never happen on the page's thread. The page still sends the camera to
// that Worker every frame: Worker.postMessage({command, methodType,
// payload: Uint8Array}) where payload is a protobuf message containing
//
//   camera {                       (nested somewhere in the payload)
//     1: { 3: { 1: lat (double), 2: lng (double) } }
//     2: zoom (double, fractional while zooming)
//     5: tilt (float)   6: heading (float)   8: field of view (float, 13.1)
//   }
//
// It is recognised by that structure (not by message ids), so reordered
// commands keep working; anything else parses to null.

/** Minimal protobuf reader: [{field, wire, value}] or null if malformed. */
function readProtobuf(bytes, start, end) {
  const out = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = start;
  const varint = () => {
    let r = 0, mul = 1, b;
    do {
      if (i >= end || mul > 2 ** 49) throw new Error("bad varint");
      b = bytes[i++];
      r += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return r;
  };
  try {
    while (i < end) {
      const key = varint();
      const field = Math.floor(key / 8);
      const wire = key & 7;
      if (field === 0) return null;
      if (wire === 0) out.push({ field, wire, value: varint() });
      else if (wire === 1) { if (i + 8 > end) return null; out.push({ field, wire, value: view.getFloat64(i, true) }); i += 8; }
      else if (wire === 5) { if (i + 4 > end) return null; out.push({ field, wire, value: view.getFloat32(i, true) }); i += 4; }
      else if (wire === 2) { const len = varint(); if (i + len > end) return null; out.push({ field, wire, start: i, end: i + len }); i += len; }
      else return null;
    }
  } catch (_) {
    return null;
  }
  return out;
}

function protoField(fields, n, wire) {
  for (const f of fields) if (f.field === n && f.wire === wire) return f;
  return null;
}

/** The camera inside a renderer command payload, or null. */
function findProtoCamera(bytes, start = 0, end = bytes ? bytes.length : 0, depth = 0) {
  if (!bytes || depth > 6 || end - start > 4096) return null;
  const fields = readProtobuf(bytes, start, end);
  if (!fields) return null;
  const target = protoField(fields, 1, 2);
  const zoom = protoField(fields, 2, 1);
  if (target && zoom && zoom.value >= 0 && zoom.value <= 23) {
    const t = readProtobuf(bytes, target.start, target.end);
    const ll = t && protoField(t, 3, 2);
    const p = ll && readProtobuf(bytes, ll.start, ll.end);
    const lat = p && protoField(p, 1, 1);
    const lng = p && protoField(p, 2, 1);
    if (lat && lng && Math.abs(lat.value) <= 90 && Math.abs(lng.value) <= 180) {
      const fov = protoField(fields, 8, 5);
      if (!fov || (fov.value > 1 && fov.value < 90)) {
        return {
          lat: lat.value,
          lng: lng.value,
          zoom: zoom.value,
          tilt: protoField(fields, 5, 5)?.value || 0,
          heading: protoField(fields, 6, 5)?.value || 0
        };
      }
    }
  }
  for (const f of fields) {
    if (f.wire !== 2 || f.end - f.start < 20) continue;
    const found = findProtoCamera(bytes, f.start, f.end, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Project with a top-down camera {lat, lng, zoom} around the canvas center
 * (Google's camera center is the full canvas center).
 */
function projectFlat(wx, wy, cam, w, h) {
  const s = 256 * Math.pow(2, cam.zoom);
  return {
    x: w / 2 + (wx - worldX(cam.lng)) * s,
    y: h / 2 + (wy - worldY(cam.lat)) * s,
  };
}

/** A tilted or rotated view can't be drawn with a flat projection. */
function isFlatCamera(cam) {
  const h = (((cam.heading || 0) % 360) + 360) % 360;
  return Math.abs(cam.tilt || 0) < 0.5 && Math.min(h, 360 - h) < 0.5;
}

/** Does a settled URL camera agree with a renderer camera? */
function cameraAgreesWithUrl(cam, urlCam) {
  if (!cam || !urlCam) return true;
  return Math.abs(cam.zoom - urlCam.zoom) <= 0.02 &&
    Math.abs(cam.lat - urlCam.lat) < 2e-6 * Math.pow(2, 17 - Math.min(17, urlCam.zoom)) + 1e-6 &&
    Math.abs(cam.lng - urlCam.lng) < 2e-6 * Math.pow(2, 17 - Math.min(17, urlCam.zoom)) + 1e-6;
}

// ---- URLs ----

function parseCameraFromUrl(url) {
  const m = String(url || "").match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  const zoom = parseFloat(m[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
  return { lat, lng, zoom };
}

/**
 * A /maps/place/ URL that carries a place id (…!1s0x…:0x…). Google's
 * in-app router can open these via popstate: panel + camera animate in
 * place, no page reload.
 */
/**
 * Google's full-screen imagery viewer (place photos, Street View, photo
 * spheres) replaces the map with a picture in the same container; its URL
 * camera is "@lat,lng,3a,75y,90t" instead of "@lat,lng,17z".
 */
function isImageryUrl(url) {
  return /@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,\d+(?:\.\d+)?a,/.test(String(url || ""));
}

function isRoutablePlacePath(path) {
  return typeof path === "string" &&
    /^\/maps\/place\//.test(path) &&
    /!1s0x[0-9a-f]+:0x[0-9a-f]+/i.test(path);
}

// ---- Glide easing ----

function easeInOutCubic(a) {
  a = Math.max(0, Math.min(1, a));
  return a < 0.5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2;
}

const api = {
  isImageryUrl,
  readProtobuf,
  findProtoCamera,
  projectFlat,
  isFlatCamera,
  cameraAgreesWithUrl,
  worldX,
  worldY,
  worldToLatLng,
  isCameraHi,
  isCameraLo,
  isPerspective,
  isWorldScale,
  zoomFromScale,
  projectGL,
  projectUrl,
  inCanvas,
  glAgreesWithUrl,
  parseCameraFromUrl,
  isRoutablePlacePath,
  easeInOutCubic,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else if (typeof window !== "undefined") {
  window.__greenoil_pinMath = api;
}
})();
