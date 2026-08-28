/* ==========================================================================
   CAPACITY CONNECT — Optimized Frontend API client
   --------------------------------------------------------------------------
   Centralized CORS fetch wrapper with token caching, AbortController
   timeout protection, and structured error propagation.
   ========================================================================== */
(function (window) {
  "use strict";

  var config = window.CapacityConnectConfig || {};
  var baseUrl = String(config.API_BASE_URL || "").replace(/\/+$/, "");

  var cachedToken = null;
  var cachedTokenExpiry = 0;

  function buildUrl(path) {
    if (!baseUrl) throw new Error("Capacity Connect API is not configured.");
    return baseUrl + (path ? "/" + String(path).replace(/^\/+/, "") : "");
  }

  async function getToken() {
    var now = Date.now();
    if (cachedToken && now < cachedTokenExpiry) {
      return cachedToken;
    }

    try {
      if (window.supabaseClient) {
        var res = await window.supabaseClient.auth.getSession();
        if (!res.error && res.data && res.data.session) {
          cachedToken = res.data.session.access_token;
          cachedTokenExpiry = now + 15000; // cache for 15 seconds
          return cachedToken;
        }
      }
    } catch (error) {
      console.warn("Unable to get Supabase session:", error);
    }

    cachedToken = null;
    return null;
  }

  async function request(path, options) {
    options = options || {};
    var headers = Object.assign({ "Accept": "application/json" }, options.headers || {});
    var token = await getToken();

    if (token && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }

    var timeoutMs = options.timeout || 30000;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = null;

    var fetchOpts = Object.assign({}, options, {
      headers: headers,
      mode: "cors"
    });

    if (controller) {
      fetchOpts.signal = controller.signal;
      timeoutId = setTimeout(function () {
        controller.abort();
      }, timeoutMs);
    }

    var response;
    try {
      response = await fetch(buildUrl(path), fetchOpts);
    } catch (fetchErr) {
      if (timeoutId) clearTimeout(timeoutId);
      if (fetchErr.name === "AbortError") {
        throw new Error("Request timed out after " + (timeoutMs / 1000) + "s.");
      }
      throw fetchErr;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    var contentType = response.headers.get("content-type") || "";
    var body = contentType.indexOf("application/json") !== -1
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      var message = body && typeof body === "object" && body.detail
        ? body.detail
        : "API request failed (" + response.status + ").";
      var error = new Error(String(message));
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return body;
  }

  var apiClient = Object.freeze({
    baseUrl: baseUrl,
    url: buildUrl,
    request: request,
    clearTokenCache: function () {
      cachedToken = null;
      cachedTokenExpiry = 0;
    },
    get: function (path, options) {
      return request(path, Object.assign({}, options || {}, { method: "GET" }));
    },
    post: function (path, data, options) {
      var opts = Object.assign({}, options || {}, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" },
          (options && options.headers) || {})
      });
      if (data !== undefined) opts.body = JSON.stringify(data);
      return request(path, opts);
    },
    patch: function (path, data, options) {
      var opts = Object.assign({}, options || {}, {
        method: "PATCH",
        headers: Object.assign({ "Content-Type": "application/json" },
          (options && options.headers) || {})
      });
      if (data !== undefined) opts.body = JSON.stringify(data);
      return request(path, opts);
    },
    del: function (path, options) {
      return request(path, Object.assign({}, options || {}, { method: "DELETE" }));
    }
  });

  window.CapacityConnectAPI = apiClient;
  window.API = apiClient;
})(window);
