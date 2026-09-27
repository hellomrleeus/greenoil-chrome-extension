/**
 * Green Oil map hook — runs in the page MAIN world at document_start
 * (manifest content_scripts, world: "MAIN"), after pin-math.js.
 *
 * 1) Pins glued to the map.
 *    Google Maps writes the camera into the URL (@lat,lng,zoom) only AFTER
 *    a gesture settles, so any URL-driven overlay lags drags, inertia and
 *    zoom animations and "floats". The vector map, however, uploads the
 *    exact camera to its shaders for every frame it draws (see
 *    pin-math.js for the uniform signature). We read that camera from
 *    inside Google's own render call and position our pins in a microtask
 *    right after it — i.e. in the same frame, before paint.
 *
 *    Pins are plain DOM owned by content.js: elements with
 *    [data-greenoil-lat][data-greenoil-lng] inside #greenoil-waypoint-pin-layer.
 *    content.js puts that layer inside Google's map container (next to the
 *    canvas), so Google's panels/search box/buttons naturally cover it and
 *    the container's overflow:hidden clips it to the map.
 *    This script only writes each pin's transform/visibility.
 *
 *    Newer Google Maps renders in a Worker (OffscreenCanvas), so the WebGL
 *    calls happen off this thread. The page still posts the camera to
 *    that Worker every frame (Worker.postMessage, protobuf payload; see
 *    pin-math.js findProtoCamera): we read it there and move the pins on
 *    the next animation frame, when the Worker draws that camera.
 *
 *    Fallback (Lite mode, or a future format change detected by
 *    cross-checking the settled URL camera): URL camera, with pins hidden
 *    while the map is being manipulated so they never float.
 *
 * 2) In-page navigation (window.postMessage {type: "GREENOIL_NAVIGATE"}).
 *    - Place URL with a place id: pushState + popstate -> Google's own
 *      router opens the place and animates the camera. No reload.
 *    - Otherwise, target near the view: glide with a synthetic mouse drag
 *      (Google ignores synthetic PointerEvents but honors MouseEvents),
 *      steered every frame by the live GL camera so it lands exactly.
 *    - Otherwise: normal navigation.
 */
(function () {
  "use strict";
  if (window.__greenoil_map_hook__) return;
  var M = window.__greenoil_pinMath;
  if (!M) return;
  window.__greenoil_map_hook__ = true;

  var LAYER_ID = "greenoil-waypoint-pin-layer";
  var MIN_ZOOM = 10;
  var CLIP_MARGIN = 40;       // px beyond the canvas edge before a pin hides
  var MAX_GLIDE_SCREENS = 2;  // glide only if target is within 2 viewports

  // ---- Camera state ------------------------------------------------
  var gl = null;              // {canvas, cx, cy, s, m, t}   main-thread WebGL renderer
  var glDisabled = false;     // set if GL camera disagrees with settled URL
  var glStrikes = 0;
  var wc = null;              // {lat, lng, zoom, tilt, heading, t}   Worker renderer
  var wcDisabled = false;
  var wcStrikes = 0;
  var urlCam = null;          // {lat, lng, zoom}
  var interacting = false;    // URL fallback only: hide pins mid-gesture

  function now() { return performance.now(); }

  // Per-rendering-context capture state
  var capture = new WeakMap();
  function cap(ctx) {
    var c = capture.get(ctx);
    if (!c) {
      c = { a: null, b: null, m: null, cx: 0, cy: 0 };
      capture.set(ctx, c);
    }
    return c;
  }

  function mapCanvasOk(canvas) {
    // Only the main map canvas (Google's auxiliary canvases are 0x0).
    return !!canvas && canvas.clientWidth >= 200 && canvas.clientHeight >= 150;
  }

  function hook(proto) {
    if (!proto || proto.__greenoil_hooked__) return;
    proto.__greenoil_hooked__ = true;

    var u3 = proto.uniform3fv;
    proto.uniform3fv = function (loc, v) {
      try {
        if (v && v.length >= 3) {
          var c = cap(this);
          c.a = c.b;
          c.b = [v[0], v[1], v[2]];
        }
      } catch (_) {}
      return u3.apply(this, arguments);
    };

    var um = proto.uniformMatrix4fv;
    proto.uniformMatrix4fv = function (loc, transpose, v) {
      try {
        if (!transpose && M.isPerspective(v)) {
          var c = cap(this);
          if (M.isCameraHi(c.a) && M.isCameraLo(c.b)) {
            c.m = Array.prototype.slice.call(v, 0, 16);
            c.cx = c.a[0] + c.b[0];
            c.cy = c.a[1] + c.b[1];
          } else {
            c.m = null;
          }
        }
      } catch (_) {}
      return um.apply(this, arguments);
    };

    var u1 = proto.uniform1f;
    proto.uniform1f = function (loc, s) {
      try {
        if (M.isWorldScale(s)) {
          var c = cap(this);
          if (c.m) {
            var m = c.m;
            c.m = null;
            if (mapCanvasOk(this.canvas)) commit(this.canvas, c.cx, c.cy, s, m);
          }
        }
      } catch (_) {}
      return u1.apply(this, arguments);
    };
  }

  try { hook(window.WebGLRenderingContext && WebGLRenderingContext.prototype); } catch (_) {}
  try { hook(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch (_) {}

  // Off-thread renderer: read the camera the page sends to the Worker.
  try {
    var wpost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data) {
      try {
        var payload = data && data.payload;
        if (payload instanceof Uint8Array && payload.length >= 30 && payload.length <= 1024) {
          var cam = M.findProtoCamera(payload);
          if (cam) commitWorker(cam);
        }
      } catch (_) {}
      return wpost.apply(this, arguments);
    };
  } catch (_) {}

  function commitWorker(cam) {
    var p = wc;
    if (p && p.lat === cam.lat && p.lng === cam.lng && p.zoom === cam.zoom &&
        p.tilt === cam.tilt && p.heading === cam.heading) return;
    cam.t = now();
    wc = cam;
    // The Worker draws this camera on its next frame: move the pins then.
    queueFrameFlush();
  }

  function commit(canvas, cx, cy, s, m) {
    var g = gl;
    if (g && g.canvas === canvas && g.cx === cx && g.cy === cy && g.s === s &&
        g.m[0] === m[0] && g.m[5] === m[5] && g.m[4] === m[4] && g.m[1] === m[1] &&
        g.m[12] === m[12] && g.m[13] === m[13] && g.m[15] === m[15]) {
      return; // same camera, uploaded again by the next shader program
    }
    gl = { canvas: canvas, cx: cx, cy: cy, s: s, m: m, t: now() };
    queueFlush();
  }

  function liveGL() {
    return !glDisabled && gl && gl.canvas.isConnected ? gl : null;
  }

  function liveWorker() {
    return !wcDisabled && wc ? wc : null;
  }

  // The per-frame camera in use: {kind: "gl"|"worker", ...} or null (URL).
  function liveCam() {
    var g = liveGL();
    var w = liveWorker();
    if (g && (!w || g.t >= w.t - 1000)) return { kind: "gl", gl: g, t: g.t };
    if (w) return { kind: "worker", cam: w, t: w.t };
    return null;
  }

  // Topmost full-size map canvas (newer Maps stacks a WebGL canvas and the
  // Worker's OffscreenCanvas of the same size; the later one is on top).
  var topCanvas = null;
  function mapCanvasTop() {
    if (topCanvas && topCanvas.isConnected && topCanvas.clientWidth > 0) return topCanvas;
    var best = null;
    var bestArea = 0;
    var list = document.querySelectorAll("canvas.H1VXrf");
    for (var i = 0; i < list.length; i++) {
      var area = list[i].clientWidth * list[i].clientHeight;
      if (area > 0 && area >= bestArea) { best = list[i]; bestArea = area; }
    }
    topCanvas = best;
    return best;
  }

  function projectLive(live, wx, wy) {
    return live.kind === "gl"
      ? M.projectGL(wx, wy, live.gl, box.w, box.h)
      : M.projectFlat(wx, wy, live.cam, box.w, box.h);
  }

  // ---- Frame-synchronous flush ---------------------------------------
  var frameFlushQueued = false;
  function queueFrameFlush() {
    if (frameFlushQueued) return;
    frameFlushQueued = true;
    requestAnimationFrame(function () {
      frameFlushQueued = false;
      flush();
    });
  }

  var flushQueued = false;
  function queueFlush() {
    if (flushQueued) return;
    flushQueued = true;
    // Microtask: runs right after Google's render callback returns and
    // before the browser paints this frame, so pins and map pixels are
    // presented together.
    Promise.resolve().then(function () {
      flushQueued = false;
      flush();
    });
  }

  // Canvas CSS box, cached: reading layout inside the render loop would
  // force a synchronous reflow every frame.
  var box = { canvas: null, left: 0, top: 0, w: 0, h: 0 };
  var ro = null;
  function measure() {
    var c = box.canvas;
    box.left = c.offsetLeft || 0;
    box.top = c.offsetTop || 0;
    box.w = c.clientWidth;
    box.h = c.clientHeight;
  }
  function trackCanvas(canvas) {
    if (box.canvas === canvas) return;
    box.canvas = canvas;
    measure();
    try {
      if (ro) ro.disconnect();
      ro = new ResizeObserver(function () { measure(); queueFlush(); });
      ro.observe(canvas);
    } catch (_) {}
  }

  // ---- Pins ----------------------------------------------------------
  var layer = null;
  var pins = [];              // {el, wx, wy, minZoom, shown}
  var mo = null;

  function collectPins() {
    pins = [];
    if (!layer) return;
    var els = layer.querySelectorAll("[data-greenoil-lat][data-greenoil-lng]");
    for (var i = 0; i < els.length; i++) {
      var lat = parseFloat(els[i].getAttribute("data-greenoil-lat"));
      var lng = parseFloat(els[i].getAttribute("data-greenoil-lng"));
      if (!isFinite(lat) || !isFinite(lng)) continue;
      // Clusters opt into a lower zoom with data-greenoil-min-zoom.
      var minZoom = parseFloat(els[i].getAttribute("data-greenoil-min-zoom"));
      pins.push({ el: els[i], wx: M.worldX(lng), wy: M.worldY(lat),
        minZoom: isFinite(minZoom) ? minZoom : MIN_ZOOM, shown: null });
    }
  }

  function bindLayer() {
    var l = document.getElementById(LAYER_ID);
    if (l === layer) return;
    layer = l;
    if (mo) { mo.disconnect(); mo = null; }
    collectPins();
    if (layer) {
      mo = new MutationObserver(function () { collectPins(); queueFlush(); });
      mo.observe(layer, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["data-greenoil-lat", "data-greenoil-lng"] });
    }
  }

  function setShown(p, on) {
    if (p.shown === on) return;
    p.shown = on;
    p.el.style.visibility = on ? "visible" : "hidden";
  }

  function flush() {
    bindLayer();
    if (!layer || !layer.isConnected) return;

    var live = liveCam();
    var canvas = live && live.kind === "gl" ? live.gl.canvas : mapCanvasTop();
    if (!canvas) return;
    trackCanvas(canvas);
    layer.setAttribute("data-greenoil-mode", live ? live.kind : "url");
    if (glide) glideObserve(live);
    if (pins.length === 0) return;

    var zoom = live ? (live.kind === "gl" ? M.zoomFromScale(live.gl.s) : live.cam.zoom)
                    : (urlCam ? urlCam.zoom : 0);
    var visible = box.w > 0 && box.h > 0 &&
      (live ? live.kind === "gl" || M.isFlatCamera(live.cam) : (urlCam && !interacting));

    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      if (!visible || zoom < p.minZoom) { setShown(p, false); continue; }
      var pt = live ? projectLive(live, p.wx, p.wy)
                    : M.projectUrl(p.wx, p.wy, urlCam, box.w, box.h);
      if (!M.inCanvas(pt, box.w, box.h, CLIP_MARGIN)) { setShown(p, false); continue; }
      p.el.style.transform = "translate3d(" + (box.left + pt.x).toFixed(2) + "px," +
        (box.top + pt.y).toFixed(2) + "px,0)";
      setShown(p, true);
    }
  }

  // ---- URL camera (fallback + GL sanity check) -----------------------
  var checkTimer = 0;
  function readUrlCamera() {
    var c = M.parseCameraFromUrl(location.href);
    if (!c) return;
    urlCam = c;
    interacting = false;
    queueFlush();
    // Cross-check the GL camera once the map has been idle for a moment
    // (Google also writes the URL mid-animation, e.g. on popstate).
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () {
      var g = gl;
      if (g && !glDisabled && now() - g.t >= 400 && box.w) {
        if (M.glAgreesWithUrl(g, urlCam, box.w, box.h)) {
          glStrikes = 0;
        } else if (++glStrikes >= 2) {
          glDisabled = true;
          console.warn("[GreenOil] map camera signature mismatch; pins fall back to URL camera");
          queueFlush();
        }
      }
      var w = wc;
      if (w && !wcDisabled && now() - w.t >= 400) {
        if (M.cameraAgreesWithUrl(w, urlCam)) {
          wcStrikes = 0;
        } else if (++wcStrikes >= 2) {
          wcDisabled = true;
          console.warn("[GreenOil] renderer camera mismatch; pins fall back to URL camera");
          queueFlush();
        }
      }
    }, 700);
  }
  ["replaceState", "pushState"].forEach(function (name) {
    var orig = history[name];
    if (typeof orig !== "function") return;
    history[name] = function () {
      var r = orig.apply(this, arguments);
      try { readUrlCamera(); } catch (_) {}
      return r;
    };
  });
  window.addEventListener("popstate", readUrlCamera);

  function onGestureStart(e) {
    if (liveCam()) return; // a per-frame camera tracks every frame; nothing to hide
    if (e.target && e.target.tagName === "CANVAS") {
      interacting = true;
      queueFlush();
    }
  }
  window.addEventListener("mousedown", onGestureStart, true);
  window.addEventListener("wheel", onGestureStart, { capture: true, passive: true });

  // ---- In-page navigation --------------------------------------------
  var glide = null;           // active glide state

  function panelLabel() {
    var p = document.querySelector('div[role="main"]');
    return p ? p.getAttribute("aria-label") : null;
  }

  function routeInPage(path) {
    // Follow Google's own history convention (state = {index: n}). With a
    // foreign state (e.g. null) its router still retitles the page but
    // stops loading places on later switches.
    var cur = history.state;
    var st = { index: (cur && typeof cur.index === "number" ? cur.index : 0) + 1 };
    var label0 = panelLabel();
    var t0 = now();
    history.pushState(st, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: st }));
    // Watchdog: a working route opens the place panel and/or moves the
    // camera. (The URL is no signal: Google rewrites it even when stuck.)
    // Generous timeout: a freshly loaded page can take a few seconds.
    setTimeout(function () {
      var live = liveCam();
      var moved = !!live && live.t > t0;
      if (!moved && panelLabel() === label0) location.assign(path);
    }, 6000);
  }

  function mouse(type, x, y, target) {
    (target || document).dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: type === "mouseup" ? 0 : 1,
    }));
  }

  // Closed-loop glide. The map follows the mouse 1:1 once Google's drag
  // threshold is crossed, so mouse = start + eased path + offset, where
  // offset (threshold slack) is measured on every camera frame as
  // "how far the mouse has moved" minus "how far the target has moved".
  function startGlide(lat, lng) {
    var live = liveCam();
    if (!live || !box.w) return false;
    if (live.kind === "worker" && !M.isFlatCamera(live.cam)) return false;
    var wx = M.worldX(lng);
    var wy = M.worldY(lat);
    var p0 = projectLive(live, wx, wy);
    if (!p0) return false;
    var dx = box.w / 2 - p0.x;
    var dy = box.h / 2 - p0.y;
    var dist = Math.hypot(dx, dy);
    if (dist < 2) return true;
    if (dist > MAX_GLIDE_SCREENS * Math.max(box.w, box.h)) return false;

    var canvas = live.kind === "gl" ? live.gl.canvas : mapCanvasTop();
    var rect = canvas.getBoundingClientRect();
    // Grab the map at the canvas center: always on the map surface.
    var sx = rect.left + box.w / 2;
    var sy = rect.top + box.h / 2;
    glide = {
      wx: wx, wy: wy, from: p0, dx: dx, dy: dy,
      t0: now(), dur: Math.min(900, 380 + dist * 0.6),
      sx: sx, sy: sy, mx: sx, my: sy, ox: 0, oy: 0, settle: 0, frames: 0,
    };
    window.addEventListener("mousedown", onUserMouseDown, true);
    mouse("mousedown", sx, sy, canvas);
    requestAnimationFrame(glideTick);
    return true;
  }

  function onUserMouseDown(e) {
    if (e.isTrusted) endGlide(); // the user grabbed the map: hand it back
  }

  function endGlide() {
    if (!glide) return;
    var gs = glide;
    glide = null;
    window.removeEventListener("mousedown", onUserMouseDown, true);
    mouse("mouseup", gs.mx, gs.my);
  }

  // A camera frame produced with the latest synthetic mouse position.
  function glideObserve(live) {
    var gs = glide;
    if (!live || !gs) return;
    var cur = projectLive(live, gs.wx, gs.wy);
    if (!cur) return;
    gs.ox = (gs.mx - gs.sx) - (cur.x - gs.from.x);
    gs.oy = (gs.my - gs.sy) - (cur.y - gs.from.y);
    gs.err = Math.hypot(box.w / 2 - cur.x, box.h / 2 - cur.y);
  }

  function glideTick() {
    var gs = glide;
    if (!gs) return;
    if (!liveCam() || ++gs.frames > 240) { endGlide(); return; }
    var t = now() - gs.t0;
    var e = M.easeInOutCubic(t / gs.dur);
    // Whole pixels: Google applies mouse deltas in integer px, and
    // fractional input would make the correction dither by 1px.
    var mx = Math.round(gs.sx + gs.dx * e + gs.ox);
    var my = Math.round(gs.sy + gs.dy * e + gs.oy);
    var still = mx === gs.mx && my === gs.my;
    gs.mx = mx;
    gs.my = my;
    mouse("mousemove", mx, my);
    if (e >= 1) {
      // Hold still a few frames so Google computes zero fling velocity.
      gs.settle = still ? gs.settle + 1 : 0;
      if (gs.settle >= 3 || t > gs.dur + 300) { endGlide(); return; }
    }
    requestAnimationFrame(glideTick);
  }

  function navigate(d) {
    var path = typeof d.path === "string" ? d.path : "";
    if (path && path.indexOf("/maps/") !== 0) path = "";
    var lat = parseFloat(d.lat);
    var lng = parseFloat(d.lng);
    endGlide();

    if (M.isRoutablePlacePath(path)) { routeInPage(path); return "route"; }
    if (isFinite(lat) && isFinite(lng) && startGlide(lat, lng)) return "glide";
    if (path) { location.assign(path); return "load"; }
    return "none";
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || e.data.type !== "GREENOIL_NAVIGATE") return;
    var mode = "none";
    try { mode = navigate(e.data); } catch (err) { console.warn("[GreenOil] navigate failed:", err); }
    window.postMessage({ type: "GREENOIL_NAVIGATE_DONE", id: e.data.id, mode: mode }, "*");
  });

  // content.js pings after (re)building the pin layer.
  window.addEventListener("greenoil:pins", function () { layer = null; queueFlush(); });

  // Diagnostics (DevTools console): __greenoil_map_hook_state__()
  window.__greenoil_map_hook_state__ = function () {
    var live = liveCam();
    var g = live && live.kind === "gl" ? live.gl : null;
    var w = live && live.kind === "worker" ? live.cam : null;
    return {
      mode: live ? live.kind : "url",
      glDisabled: glDisabled,
      workerDisabled: wcDisabled,
      zoom: g ? M.zoomFromScale(g.s) : w ? w.zoom : urlCam && urlCam.zoom,
      center: g ? M.worldToLatLng(g.cx, g.cy) : w ? { lat: w.lat, lng: w.lng } : urlCam,
      pins: pins.length,
      box: { left: box.left, top: box.top, w: box.w, h: box.h },
    };
  };

  try { document.documentElement.setAttribute("data-greenoil-maphook", "1"); } catch (_) {}
  readUrlCamera();
})();
