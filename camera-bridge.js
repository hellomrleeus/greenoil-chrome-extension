/**
 * Green Oil camera bridge — runs in the page MAIN world (via
 * chrome.scripting.executeScript {world: "MAIN"}), NOT the content-script
 * isolated world.
 *
 * Google Maps keeps its camera in the URL (@lat,lng,zoom) and updates it
 * with history.replaceState during every gesture (drag, wheel zoom,
 * double-click, buttons). Hook replaceState/pushState and forward each
 * camera update to the content script via window.postMessage, so pins can
 * track the map with zero snap-back instead of polling a stale URL.
 */
(function () {
  if (window.__greenoil_cam_bridge__) return;
  window.__greenoil_cam_bridge__ = true;

  function parseCamera(url) {
    var m = String(url || "").match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
    if (!m) return null;
    var lat = parseFloat(m[1]);
    var lng = parseFloat(m[2]);
    var zoom = parseFloat(m[3]);
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(zoom)) return null;
    return { lat: lat, lng: lng, zoom: zoom };
  }

  function broadcast() {
    var cam = parseCamera(location.href);
    if (cam) {
      try {
        window.postMessage({ type: "GREENOIL_CAM", cam: cam }, "*");
      } catch (e) {}
    }
  }

  ["replaceState", "pushState"].forEach(function (name) {
    var orig = history[name];
    if (typeof orig !== "function") return;
    history[name] = function () {
      var r = orig.apply(this, arguments);
      broadcast();
      return r;
    };
  });

  window.addEventListener("popstate", broadcast);
  broadcast();
})();
