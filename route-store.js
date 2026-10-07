/**
 * Green Oil — route store: the waypoint lists live only in the cloud API
 * (/api/map-routes, shared with the web Map Explorer). Nothing is cached
 * locally; every read is a fresh GET, every change is GET -> edit -> POST.
 *
 * Wire format (worker/index.js): { groups: [{id, name, origin, waypoints}],
 * activeGroupId, origin }. The extension's 5 colour routes map onto the
 * groups by position: groups[0] -> route_1 ... groups[4] -> route_5.
 * Groups past the fifth, and every field the extension doesn't know, are
 * written back untouched.
 */

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Cloud payload -> {route_1..route_5} with colours from defs. */
export function routesFromCloud(data, defs) {
  if (!data || !Array.isArray(data.groups)) throw new Error("云端路线数据格式不正确");
  const routes = {};
  Object.keys(defs).forEach((key, i) => {
    const group = data.groups[i];
    const route = clone(defs[key]);
    if (group) {
      if (group.name) route.name = group.name;
      if (group.origin) route.origin = group.origin;
      route.waypoints = Array.isArray(group.waypoints) ? group.waypoints : [];
    }
    routes[key] = route;
  });
  return routes;
}

/** {route_1..route_5} -> cloud payload, merged over the latest cloud data. */
export function cloudFromRoutes(routes, data, defs) {
  const groups = Array.isArray(data?.groups) ? data.groups.map((g) => ({ ...g })) : [];
  const keys = Object.keys(defs);
  // Groups stay contiguous: a non-empty route_3 needs groups[1] and [2].
  let last = groups.length - 1;
  keys.forEach((key, i) => {
    if (routes[key]?.waypoints?.length) last = Math.max(last, i);
  });
  for (let i = 0; i <= last && i < keys.length; i++) {
    const route = routes[keys[i]] || defs[keys[i]];
    const group = groups[i] || { id: keys[i] };
    groups[i] = {
      ...group,
      id: group.id || keys[i],
      name: route.name || group.name || defs[keys[i]].name,
      origin: route.origin || group.origin || defs[keys[i]].origin,
      waypoints: Array.isArray(route.waypoints) ? route.waypoints : []
    };
  }
  const activeGroupId = data?.activeGroupId && groups.some((g) => g.id === data.activeGroupId)
    ? data.activeGroupId
    : groups[0]?.id;
  return { groups, activeGroupId, origin: data?.origin || groups[0]?.origin };
}

const hasWaypoints = (routes) => Object.values(routes || {}).some((r) => r?.waypoints?.length);

/**
 * api: { getMapRoutes(token), saveMapRoutes(token, groups, activeGroupId, origin) }
 * getToken: async () => the operator's bearer token, "" when logged out.
 */
const LOGIN_REQUIRED = "未登录或登录已过期，请在扩展弹窗中登录 Green Oil 账号";

function apiError(res, fallback) {
  if (res?.error === "Unauthorized" || res?.unauthorized) return loginRequired();
  return new Error(res?.error || res?.message || fallback);
}

function loginRequired() {
  const err = new Error(LOGIN_REQUIRED);
  err.unauthorized = true;
  return err;
}

export function createRouteStore({ api, defs, getToken = async () => "" }) {
  let inflight = null;
  let chain = Promise.resolve();

  // The API needs a login for reads and writes.
  async function token() {
    const t = await getToken();
    if (!t) throw loginRequired();
    return t;
  }

  async function fetchCloud() {
    const res = await api.getMapRoutes(await token());
    if (!res || !res.success || !res.data) throw apiError(res, "云端路线读取失败");
    return { data: res.data, routes: routesFromCloud(res.data, defs) };
  }

  /** Fresh routes from the API (concurrent callers share one request). */
  function load() {
    if (!inflight) inflight = fetchCloud().finally(() => { inflight = null; });
    return inflight;
  }

  /**
   * Serialized read-modify-write. fn(routes) edits the fresh routes in
   * place; returning false skips the save. Resolves to {routes, result}.
   * A failed read never writes, so a network error can't wipe the cloud.
   */
  function mutate(fn) {
    const run = chain.then(async () => {
      const { data, routes } = await fetchCloud();
      const result = await fn(routes);
      if (result === false) return { routes, result, saved: false };
      const payload = cloudFromRoutes(routes, data, defs);
      const res = await api.saveMapRoutes(await token(), payload.groups, payload.activeGroupId, payload.origin);
      if (!res || !res.success) throw apiError(res, "云端路线保存失败");
      return { routes: res.data?.groups ? routesFromCloud(res.data, defs) : routes, result, saved: true };
    });
    chain = run.catch(() => {});
    return run;
  }

  /** Replace every colour route's name / origin / waypoints (popup edits). */
  function replaceAll(next) {
    return mutate((routes) => {
      for (const key of Object.keys(defs)) {
        if (!next?.[key]) continue;
        routes[key].name = next[key].name || routes[key].name;
        routes[key].origin = next[key].origin || routes[key].origin;
        routes[key].waypoints = Array.isArray(next[key].waypoints) ? next[key].waypoints : [];
      }
    });
  }

  /**
   * One-time move of a legacy local copy into the cloud. Only when the
   * cloud holds no waypoints at all (an older build's broken sync could
   * have emptied it) is the local list uploaded; otherwise the cloud wins.
   * Resolves true when the caller may drop the local copy.
   */
  async function adoptLegacy(localRoutes) {
    if (!hasWaypoints(localRoutes)) return true;
    await mutate((routes) => {
      if (hasWaypoints(routes)) return false;
      for (const key of Object.keys(defs)) {
        const local = localRoutes[key];
        if (!local) continue;
        routes[key].waypoints = Array.isArray(local.waypoints) ? local.waypoints : [];
        if (local.origin) routes[key].origin = local.origin;
      }
    });
    return true;
  }

  return { load, mutate, replaceAll, adoptLegacy };
}
