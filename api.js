const API = (() => {
  const TOKEN_KEY = "tanklog_token";
  let _token = localStorage.getItem(TOKEN_KEY) || "";
  let _session = null;
  let _onUnauthorized = null;

  function _baseUrl() {
    const configured = window.TANKLOG_API_BASE || localStorage.getItem("tanklog_api_base") || "";
    return configured.replace(/\/$/, "");
  }

  async function _request(path, options = {}) {
    const { method = "GET", body, auth = true } = options;
    const headers = { "Content-Type": "application/json" };
    if (auth && _token) {
      headers.Authorization = `Bearer ${_token}`;
    }

    const response = await fetch(_baseUrl() + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    let payload = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else if (response.status !== 204) {
      payload = await response.text();
    }

    if (response.status === 401) {
      clearSession();
      if (_onUnauthorized) _onUnauthorized();
    }

    if (!response.ok) {
      const message = payload && payload.error ? payload.error : `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async function login(username, password) {
    const result = await _request("/auth/login", {
      method: "POST",
      auth: false,
      body: { username, password }
    });
    _token = result.token;
    localStorage.setItem(TOKEN_KEY, _token);
    return getMe();
  }

  async function getFuelPriceInsight(fuelType, scope, options = {}) {
    const query = new URLSearchParams();
    if (fuelType) query.set("fuelType", fuelType);
    if (scope) query.set("scope", scope);
    if (options.fuelVariant) query.set("fuelVariant", String(options.fuelVariant));
    if (options.force) query.set("force", "1");
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return _request(`/api/fuel-prices/insight${suffix}`);
  }

  async function getFuelPriceMapPreview(fuelType, options = {}) {
    const query = new URLSearchParams();
    if (fuelType) query.set("fuelType", fuelType);
    if (options.fuelVariant) query.set("fuelVariant", String(options.fuelVariant));
    if (options.scope) query.set("scope", String(options.scope));
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return _request(`/api/fuel-prices/map-preview${suffix}`);
  }

  async function searchFuelStations(params = {}) {
    const query = new URLSearchParams();
    if (params.q) query.set("q", String(params.q));
    if (params.lat !== undefined) query.set("lat", String(params.lat));
    if (params.lng !== undefined) query.set("lng", String(params.lng));
    if (params.radius !== undefined) query.set("radius", String(params.radius));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return _request(`/api/fuel-prices/stations/search${suffix}`);
  }

  async function getFuelStationPreferences() {
    return _request("/api/fuel-prices/stations/preferences");
  }

  async function saveFuelStationPreferences(stationIds) {
    return _request("/api/fuel-prices/stations/preferences", {
      method: "PUT",
      body: { stationIds }
    });
  }

  async function getMe() {
    const result = await _request("/auth/me");
    _session = result;
    return _session;
  }

  async function getSettings() {
    return _request("/api/settings");
  }

  async function saveSettings(settings) {
    return _request("/api/settings", {
      method: "PUT",
      body: settings
    });
  }

  async function restoreSession() {
    if (!_token) return null;
    try {
      return await getMe();
    } catch {
      return null;
    }
  }

  async function logout() {
    if (_token) {
      try {
        await _request("/auth/logout", { method: "POST" });
      } catch {}
    }
    clearSession();
  }

  function clearSession() {
    _token = "";
    _session = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  function session() {
    return _session;
  }

  function onUnauthorized(fn) {
    _onUnauthorized = fn;
  }

  return {
    request: _request,
    login,
    getFuelPriceInsight,
    getFuelPriceMapPreview,
    searchFuelStations,
    getFuelStationPreferences,
    saveFuelStationPreferences,
    getSettings,
    saveSettings,
    getMe,
    restoreSession,
    logout,
    clearSession,
    session,
    onUnauthorized
  };
})();
