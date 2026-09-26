const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../content.css'), 'utf8');

test('CSS strictly forbids heading waypoint badge and includes zero-latency map pins', () => {
  // 1. User strictly requested NO waypoint badge beside heading
  assert.ok(!css.includes('.greenoil-heading-waypoint-badge'), 'Should not have .greenoil-heading-waypoint-badge in CSS');
  
  // 2. No unsolicited "路线途径点" pill in bottom right
  assert.ok(!css.includes('.waypoint-pill'), 'Should not have .waypoint-pill in CSS');

  // 3. Includes high performance zero-latency map pins overlay & layer
  assert.match(css, /#greenoil-waypoint-pins-overlay/);
  assert.match(css, /#greenoil-waypoint-pin-layer/);
  assert.match(css, /\.greenoil-waypoint-map-pin/);
  assert.match(css, /pointer-events:\s*none\s*!important/);
});

test('content.js implements zero-latency drag tracking, clean navigation, and no heading badge', () => {
  // 1. No heading waypoint badge function or injection
  assert.ok(!source.includes('function updateHeadingWaypointBadge'), 'Should not define updateHeadingWaypointBadge');
  
  // 2. Strict ban on omnibox search jumping during inPagePanToLocation
  assert.ok(!source.includes('inPageSearched'), 'Should not perform omnibox in-page search');
  
  // 3. Zero-latency drag tracking & waypoint map pin rendering functions exist
  assert.match(source, /function renderWaypointMapPins/);
  assert.match(source, /function initZeroLatencyDragTracking/);
  assert.match(source, /function projectToCanvasPixels/);
});
