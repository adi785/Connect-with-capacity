/* ==========================================================================
   CAPACITY CONNECT — Frontend API configuration
   --------------------------------------------------------------------------
   Dynamic API origin detection:
   - In production (Vercel, custom domain): frontend and backend share the
     deployed origin (window.location.origin).
   - In local development: defaults to the local FastAPI backend (port 8000).
   ========================================================================== */
(function (window) {
  "use strict";

  var hostname = (window.location && window.location.hostname) || "127.0.0.1";
  var isLocal = Boolean(
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]"
  );

  var apiOrigin;
  if (window.__CAPACITY_CONNECT_API_ORIGIN__) {
    apiOrigin = window.__CAPACITY_CONNECT_API_ORIGIN__;
  } else if (!isLocal) {
    // Production / Vercel: use the deployed origin (e.g. https://capacity-connect-three.vercel.app)
    apiOrigin = window.location.origin;
  } else {
    // Local dev: connect to local FastAPI backend
    var localPort = (window.location.port === "8000") ? "8000" : (window.location.port === "8001" ? "8001" : "8000");
    apiOrigin = window.location.port === "8000"
      ? window.location.origin
      : (window.location.protocol + "//" + (hostname === "localhost" ? "localhost" : "127.0.0.1") + ":" + localPort);
  }

  var API_BASE_URL = apiOrigin.replace(/\/+$/, "") + "/api/v1";

  window.CapacityConnectConfig = Object.freeze({
    API_BASE_URL: API_BASE_URL,
    API_ORIGIN: apiOrigin,
    IS_LOCAL: isLocal
  });

  // Backward-compatible globals used by existing dashboard and auth code.
  window.API_BASE = API_BASE_URL;
  window.CAPACITY_CONNECT_API_URL = API_BASE_URL;
})(window);
