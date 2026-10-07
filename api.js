/**
 * Green Oil Cloudflare Worker API Client
 * Manages operator authentication and map-routes KV synchronization.
 */

const DEFAULT_WORKER_URL = "https://greenoil-api.ydxhjw4j5w.workers.dev";

export const GreenOilApi = {
  getWorkerUrl() {
    return DEFAULT_WORKER_URL;
  },

  /**
   * User login against Cloudflare Worker backend
   */
  async login(username, password) {
    try {
      const resp = await fetch(`${this.getWorkerUrl()}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
      });
      return await resp.json();
    } catch (e) {
      console.error("Login request failed:", e);
      return { success: false, error: e.message || "网络请求失败，请检查连接" };
    }
  },

  /**
   * Verify session token validity
   */
  async checkAuth(token) {
    if (!token) return { authenticated: false };
    try {
      const resp = await fetch(`${this.getWorkerUrl()}/api/auth/check`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (resp.status === 401) {
        return { authenticated: false, unauthorized: true, error: "Unauthorized" };
      }
      return await resp.json();
    } catch (e) {
      console.warn("Auth check failed:", e);
      return { authenticated: false, error: e.message };
    }
  },

  /**
   * Fetch grouped routes from Cloudflare KV
   */
  async getMapRoutes(token) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const resp = await fetch(`${this.getWorkerUrl()}/api/map-routes`, {
        method: "GET",
        headers
      });
      if (resp.status === 401) {
        return { success: false, unauthorized: true, error: "Unauthorized" };
      }
      return await resp.json();
    } catch (e) {
      console.warn("getMapRoutes failed:", e);
      return { success: false, error: e.message || "获取云端路线失败" };
    }
  },

  /**
   * Save grouped routes to Cloudflare KV
   */
  async saveMapRoutes(token, groups, activeGroupId, origin) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const resp = await fetch(`${this.getWorkerUrl()}/api/map-routes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ groups, activeGroupId, origin })
      });
      if (resp.status === 401) {
        return { success: false, unauthorized: true, error: "Unauthorized" };
      }
      return await resp.json();
    } catch (e) {
      console.warn("saveMapRoutes failed:", e);
      return { success: false, error: e.message || "同步云端路线失败" };
    }
  },

  /**
   * Fetch Jev API Key (requires authenticated session)
   */
  async getJevKey(token) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const resp = await fetch(`${this.getWorkerUrl()}/api/jev/key`, {
        method: "GET",
        headers
      });
      if (resp.status === 401) {
        return { success: false, unauthorized: true, error: "Unauthorized" };
      }
      return await resp.json();
    } catch (e) {
      console.warn("getJevKey failed:", e);
      return { success: false, error: e.message || "获取 JEV Key 失败" };
    }
  },

  /**
   * Fetch newly opened restaurants (DineSafe data, requires authentication)
   * @param {string} token
   * @param {'day'|'week'|'month'} period
   * @param {object} options
   */
  async getNewlyOpenedRestaurants(token, period = "week", options = {}) {
    try {
      if (!token) {
        return { success: false, unauthorized: true, error: "未登录，请先登录 Green Oil 账号" };
      }
      const headers = { "Content-Type": "application/json" };
      headers["Authorization"] = `Bearer ${token}`;

      const params = new URLSearchParams({ period, ...options });
      const resp = await fetch(`${this.getWorkerUrl()}/api/new-restaurants?${params}`, {
        method: "GET",
        headers
      });
      if (resp.status === 401) {
        return { success: false, unauthorized: true, error: "Unauthorized" };
      }
      return await resp.json();
    } catch (e) {
      console.warn("getNewlyOpenedRestaurants failed:", e);
      return { success: false, error: e.message || "获取新开餐馆失败" };
    }
  }
};


