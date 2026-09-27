const test = require('node:test');
const assert = require('node:assert/strict');

const DEFS = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`route_${n}`,
  { id: `route_${n}`, color: `#00000${n}`, name: `R${n}`, origin: 'HQ', waypoints: [] }]));
const load = () => import('../route-store.js');
const TOKEN = async () => 'signed-token';

function fakeApi(initial) {
  const api = {
    data: initial, gets: 0, posts: [], failGet: false,
    async getMapRoutes() {
      api.gets++;
      if (api.failGet) return { success: false, error: 'offline' };
      return { success: true, data: JSON.parse(JSON.stringify(api.data)) };
    },
    async saveMapRoutes(token, groups, activeGroupId, origin) {
      api.posts.push({ groups, activeGroupId, origin });
      api.data = { groups, activeGroupId, origin };
      return { success: true, data: api.data };
    }
  };
  return api;
}

test('cloud groups map onto the colour routes by position, colours from defs', async () => {
  const { routesFromCloud } = await load();
  const routes = routesFromCloud({ groups: [
    { id: 'group_default', name: '路线 1', origin: 'A', waypoints: [{ name: 'x' }] },
    { id: 'g2', name: '路线 2', waypoints: [{ name: 'y' }, { name: 'z' }] }
  ] }, DEFS);
  assert.equal(routes.route_1.name, '路线 1');
  assert.equal(routes.route_1.color, '#000001');
  assert.deepEqual(routes.route_2.waypoints.map((w) => w.name), ['y', 'z']);
  assert.deepEqual(routes.route_3.waypoints, []);
  assert.throws(() => routesFromCloud({ gce_color_routes: {} }, DEFS));
});

test('writes keep cloud ids, extra groups, and stay contiguous', async () => {
  const { cloudFromRoutes, routesFromCloud } = await load();
  const cloud = { activeGroupId: 'g1', groups: [{ id: 'g1', name: 'A', waypoints: [], extra: 1 }] };
  const routes = routesFromCloud(cloud, DEFS);
  routes.route_3.waypoints = [{ name: 'p' }];
  const out = cloudFromRoutes(routes, cloud, DEFS);
  assert.deepEqual(out.groups.map((g) => g.id), ['g1', 'route_2', 'route_3']);
  assert.equal(out.groups[0].extra, 1);
  assert.equal(out.activeGroupId, 'g1');
  assert.ok(Array.isArray(out.groups), 'groups is an array (the worker ignores objects)');

  const six = { groups: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `g${n}`, name: `G${n}`, waypoints: [] })) };
  assert.equal(cloudFromRoutes(routesFromCloud(six, DEFS), six, DEFS).groups[5].id, 'g6');
});

test('every read hits the API; concurrent reads share one request', async () => {
  const { createRouteStore } = await load();
  const api = fakeApi({ groups: [{ id: 'g1', waypoints: [{ name: 'a' }] }] });
  const store = createRouteStore({ api, defs: DEFS, getToken: TOKEN });
  await Promise.all([store.load(), store.load()]);
  assert.equal(api.gets, 1);
  api.data.groups[0].waypoints.push({ name: 'b' });
  const { routes } = await store.load();
  assert.equal(api.gets, 2);
  assert.deepEqual(routes.route_1.waypoints.map((w) => w.name), ['a', 'b']);
});

test('mutate re-reads before writing and never writes after a failed read', async () => {
  const { createRouteStore } = await load();
  const api = fakeApi({ groups: [{ id: 'g1', waypoints: [{ name: 'web' }] }] });
  const store = createRouteStore({ api, defs: DEFS, getToken: TOKEN });
  await store.mutate((r) => { r.route_1.waypoints.push({ name: 'ext' }); });
  assert.deepEqual(api.data.groups[0].waypoints.map((w) => w.name), ['web', 'ext']);

  api.failGet = true;
  await assert.rejects(store.mutate((r) => { r.route_1.waypoints = []; }));
  assert.equal(api.posts.length, 1);

  api.failGet = false;
  const skipped = await store.mutate(() => false);
  assert.equal(skipped.saved, false);
  assert.equal(api.posts.length, 1);
});

test('a legacy local list is uploaded only into an empty cloud', async () => {
  const { createRouteStore } = await load();
  const local = { route_1: { waypoints: [{ name: 'local' }] } };

  const empty = fakeApi({ groups: [{ id: 'group_default', waypoints: [] }] });
  assert.equal(await createRouteStore({ api: empty, defs: DEFS, getToken: TOKEN }).adoptLegacy(local), true);
  assert.deepEqual(empty.data.groups[0].waypoints.map((w) => w.name), ['local']);

  const full = fakeApi({ groups: [{ id: 'g1', waypoints: [{ name: 'cloud' }] }] });
  assert.equal(await createRouteStore({ api: full, defs: DEFS, getToken: TOKEN }).adoptLegacy(local), true);
  assert.equal(full.posts.length, 0);
  assert.deepEqual(full.data.groups[0].waypoints.map((w) => w.name), ['cloud']);
});

test('reads and writes need a login: no token -> no request; 401 -> login error', async () => {
  const { createRouteStore } = await load();
  const api = fakeApi({ groups: [{ id: 'g1', waypoints: [] }] });
  const loggedOut = createRouteStore({ api, defs: DEFS, getToken: async () => '' });
  await assert.rejects(loggedOut.load(), (e) => e.unauthorized === true);
  await assert.rejects(loggedOut.mutate(() => {}), (e) => e.unauthorized === true);
  assert.equal(api.gets, 0);
  assert.equal(api.posts.length, 0);

  api.getMapRoutes = async () => ({ error: 'Unauthorized', message: '未登录或凭据已过期' });
  const expired = createRouteStore({ api, defs: DEFS, getToken: TOKEN });
  await assert.rejects(expired.load(), (e) => e.unauthorized === true && /登录/.test(e.message));
});
