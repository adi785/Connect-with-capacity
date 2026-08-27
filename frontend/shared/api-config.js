/* ==========================================================================
   CAPACITY CONNECT — Frontend API configuration
   --------------------------------------------------------------------------
   Static HTML/JS frontend: browser code cannot consume Vite/Next/CRA .env
   variables automatically, so the deployed API URL is centralized here.
   ========================================================================== */
(function (window) {
  "use strict";

  var API_BASE_URL = "https://capacity-connect-three.vercel.app/api/v1";

  window.CapacityConnectConfig = Object.freeze({
    API_BASE_URL: API_BASE_URL,
    API_ORIGIN: "https://capacity-connect-three.vercel.app"
  });

  // Backward-compatible global used by existing dashboard code.
  window.API_BASE = API_BASE_URL;
})(window);
