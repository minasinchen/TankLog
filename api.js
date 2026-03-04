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

  async function login(email, password) {
    const result = await _request("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password }
    });
    _token = result.token;
    localStorage.setItem(TOKEN_KEY, _token);
    return getMe();
  }

  async function getMe() {
    const result = await _request("/auth/me");
    _session = result;
    return _session;
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
    getMe,
    restoreSession,
    logout,
    clearSession,
    session,
    onUnauthorized
  };
})();
