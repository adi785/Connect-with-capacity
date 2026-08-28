/* ==========================================================================
   CAPACITY CONNECT — Frontend API configuration
   --------------------------------------------------------------------------
   Static HTML/JS frontend: browser code cannot consume Vite/Next/CRA .env
   variables automatically, so the deployed API URL is centralized here.
   ========================================================================== */
(function (window) {
  "use strict";

  var host = window.location.hostname || "127.0.0.1";
  var port = "8000";
  var apiOrigin = window.location.protocol + "//" + (host === "localhost" ? "localhost" : "127.0.0.1") + ":" + port;
  var API_BASE_URL = apiOrigin + "/api/v1";

  window.CapacityConnectConfig = Object.freeze({
    API_BASE_URL: API_BASE_URL,
    API_ORIGIN: apiOrigin
  });

  // Backward-compatible global used by existing dashboard code.
  window.API_BASE = API_BASE_URL;
})(window);
