const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadApi = () => import('../api.js');

test('api.js checkAuth handles missing token and 401 unauthorized status', async () => {
  const { GreenOilApi } = await loadApi();
  
  // 1. Missing token
  const noToken = await GreenOilApi.checkAuth('');
  assert.equal(noToken.authenticated, false);

  // 2. 401 Unauthorized
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    });

    const res = await GreenOilApi.checkAuth('expired-token');
    assert.equal(res.authenticated, false);
    assert.equal(res.unauthorized, true);
    assert.equal(res.error, 'Unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('api.js getMapRoutes and saveMapRoutes return unauthorized flag on 401', async () => {
  const { GreenOilApi } = await loadApi();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    });

    const getRes = await GreenOilApi.getMapRoutes('bad-token');
    assert.equal(getRes.success, false);
    assert.equal(getRes.unauthorized, true);
    assert.equal(getRes.error, 'Unauthorized');

    const saveRes = await GreenOilApi.saveMapRoutes('bad-token', [], 'route_1', 'HQ');
    assert.equal(saveRes.success, false);
    assert.equal(saveRes.unauthorized, true);
    assert.equal(saveRes.error, 'Unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('api.js getJevKey returns unauthorized flag on 401', async () => {
  const { GreenOilApi } = await loadApi();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    });

    const res = await GreenOilApi.getJevKey('bad-token');
    assert.equal(res.success, false);
    assert.equal(res.unauthorized, true);
    assert.equal(res.error, 'Unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('api.js getNewlyOpenedRestaurants requires token and handles 401', async () => {
  const { GreenOilApi } = await loadApi();
  
  // Missing token
  const noToken = await GreenOilApi.getNewlyOpenedRestaurants('');
  assert.equal(noToken.success, false);
  assert.equal(noToken.unauthorized, true);
  assert.ok(/未登录/.test(noToken.error));

  // 401 from server
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    });

    const res = await GreenOilApi.getNewlyOpenedRestaurants('bad-token', 'week');
    assert.equal(res.success, false);
    assert.equal(res.unauthorized, true);
    assert.equal(res.error, 'Unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('UI assets strictly contain zero emoji characters (Global Guideline compliance)', () => {
  const filesToCheck = [
    'popup.html',
    'popup.css',
    'popup.js',
    'content.css',
    'content.js',
    'api.js',
    'background.js',
    'route-store.js'
  ];

  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;

  for (const relPath of filesToCheck) {
    const fullPath = path.resolve(__dirname, '..', relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      assert.ok(
        !emojiRegex.test(line),
        `Emoji detected in ${relPath}:${index + 1} -> ${line.trim()}`
      );
    });
  }
});

test('toggleWaypointPins checkbox is present in popup and hooked up in content.js', () => {
  const popupHtml = fs.readFileSync(path.resolve(__dirname, '../popup.html'), 'utf8');
  assert.ok(popupHtml.includes('id="toggleWaypointPins"'));
  assert.ok(popupHtml.includes('地图显示路线途径点'));

  const popupJs = fs.readFileSync(path.resolve(__dirname, '../popup.js'), 'utf8');
  assert.ok(popupJs.includes('toggleWaypointPins'));
  assert.ok(popupJs.includes('gce_show_waypoints'));

  const contentJs = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
  assert.ok(contentJs.includes('gce_show_waypoints'));
  assert.ok(contentJs.includes('showWaypoints'));
});

