/* ==========================================================================
   CAPACITY CONNECT — Frontend API client
   --------------------------------------------------------------------------
   Centralized CORS fetch wrapper. Automatically forwards the Supabase/dev
   bearer token when one is available.
   ========================================================================== */
(function (window) {
  "use strict";

  var config = window.CapacityConnectConfig || {};
  var baseUrl = String(config.API_BASE_URL || "").replace(/\/+$/, "");

  function buildUrl(path) {
    if (!baseUrl) throw new Error("Capacity Connect API is not configured.");
    return baseUrl + (path ? "/" + String(path).replace(/^\/+/, "") : "");
  }

  async function getToken() {
    try {
      if (window.supabaseClient) {
        const { data, error } =
          await window.supabaseClient.auth.getSession();

        if (!error && data && data.session) {
          return data.session.access_token;
        }
      }
    } catch (error) {
      console.error("Unable to get Supabase session:", error);
    }

    return null;
  }

  async function request(path, options) {
    options = options || {};
    var headers = Object.assign({ "Accept": "application/json" }, options.headers || {});
    var token = await getToken();

    if (token && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }

    var response = await fetch(buildUrl(path), Object.assign({}, options, {
      headers: headers,
      mode: "cors"
    }));

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
