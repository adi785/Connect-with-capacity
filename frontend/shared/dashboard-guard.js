/* ==========================================================================
   CAPACITY CONNECT — Shared dashboard guard + view helpers
   --------------------------------------------------------------------------
   Load order on every dashboard page:
     1. https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
     2. ../auth/js/supabase.js   (existing client)
     3. ../auth/js/auth.js       (existing Auth object)
     4. ../shared/dashboard-guard.js                     (this file)
     5. ./app.js                                         (per-role page logic)

   Security note: this guard is a user-experience gate, not the security
   boundary. The database is the authority — Row Level Security decides what
   any given signed-in user can actually read. A tampered frontend can hide
   this guard but cannot read rows the policies forbid.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var LOGIN_FALLBACK = "../auth/index.html";

  var ICON_EMPTY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">' +
    '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2.5h5.5A2.5 2.5 0 0 1 20 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z"/>' +
    "</svg>";

  var ICON_ALERT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">' +
    '<path d="M12 8.5v5"/><path d="M12 16.8h.01"/>' +
    '<path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>' +
    "</svg>";

  var ICON_INFO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>' +
    "</svg>";

  var Dash = {};

  /* ----------------------------------------------------------------------
     Dependency resolution
     ------------------------------------------------------------------------
     auth.js declares `const Auth` and supabase.js declares `const supabaseClient`
     at the top level of a classic script. Top-level const/let live in the global
     LEXICAL environment, not on the global object — so `window.Auth` and
     `window.supabaseClient` are both undefined even though the bare identifiers
     resolve fine. These resolvers read the bare identifier through the scope
     chain, with a `window` fallback in case those files are ever changed to
     `var` or to an explicit assignment.

     typeof is used because referencing a never-declared identifier directly
     throws a ReferenceError, whereas typeof on it does not.

     The try/catch covers a second, nastier case that typeof does NOT protect
     against. typeof only suppresses the error for an UNRESOLVABLE name; a const
     that was declared but never initialised is a different thing — it exists in
     the temporal dead zone, and touching it throws. supabase.js does
     `const supabaseClient = window.supabase.createClient(...)`, so if the CDN
     tag fails (offline, blocked, outage) that initialiser throws, the script
     aborts, and the binding is stranded in TDZ for the life of the page. Every
     later `typeof supabaseClient` would then throw instead of returning
     "undefined", which would blow past the friendly "sign-in service did not
     load" gate and leave the page spinning forever. Catching it converts that
     back into a plain null so the intended error state renders.
     ---------------------------------------------------------------------- */

  function getAuth() {
    try {
      if (typeof Auth !== "undefined" && Auth) {
        return Auth;
      }
    } catch (tdz) {
      /* auth.js loaded but its declaration never completed. */
    }
    if (window.Auth) {
      return window.Auth;
    }
    return null;
  }

  function getClient() {
    try {
      if (typeof supabaseClient !== "undefined" && supabaseClient) {
        return supabaseClient;
      }
    } catch (tdz) {
      /* supabase.js loaded but createClient threw — usually a CDN failure. */
    }
    if (window.supabaseClient) {
      return window.supabaseClient;
    }
    return null;
  }

  /* ----------------------------------------------------------------------
     Small utilities
     ---------------------------------------------------------------------- */

  Dash.loginPage = function () {
    var auth = getAuth();
    return (auth && auth.LOGIN_PAGE) || LOGIN_FALLBACK;
  };

  // Always use replace() for guard-driven navigation so the browser Back
  // button cannot return the visitor to a protected page shell.
  Dash.goto = function (url) {
    window.location.replace(url);
  };

  Dash.escape = function (value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  Dash.initials = function (name) {
    var clean = String(name || "").trim();
    if (!clean) {
      return "CC";
    }
    var parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return clean.substring(0, 2).toUpperCase();
  };

  Dash.titleCase = function (value) {
    var clean = String(value || "").trim();
    if (!clean) {
      return "";
    }
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  };

  Dash.formatDate = function (value) {
    if (!value) {
      return "—";
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return "—";
    }
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  };

  Dash.isNetworkError = function (error) {
    var message = String((error && error.message) || "").toLowerCase();
    return (
      message.indexOf("failed to fetch") > -1 ||
      message.indexOf("networkerror") > -1 ||
      message.indexOf("network request failed") > -1 ||
      message.indexOf("load failed") > -1
    );
  };

  // A table that has not been created yet reports itself through a handful of
  // different PostgREST / Postgres signals depending on version.
  Dash.isMissingRelation = function (error) {
    if (!error) {
      return false;
    }
    var code = String(error.code || "");
    if (code === "42P01" || code === "PGRST205" || code === "PGRST204") {
      return true;
    }
    var message = String(error.message || "").toLowerCase();
    return (
      message.indexOf("does not exist") > -1 ||
      message.indexOf("could not find the table") > -1 ||
      message.indexOf("schema cache") > -1
    );
  };

  /* ----------------------------------------------------------------------
     Query wrapper
     Never throws. Distinguishes "table not created yet" from a real failure
     so a page can show an accurate empty state instead of an error, and so
     no view ever has to invent placeholder records.
     ---------------------------------------------------------------------- */

  Dash.safeSelect = function (table, columns, tweak) {
    // An unconfigured table in a page's SCHEMA map is reported as "missing"
    // rather than attempted, so no request is ever sent to `from(null)`.
    if (!table) {
      return Promise.resolve({
        rows: [],
        count: null,
        missing: true,
        error: null
      });
    }

    if (!getClient()) {
      return Promise.resolve({
        rows: [],
        count: null,
        missing: false,
        error: new Error("Supabase client unavailable.")
      });
    }

    var query;

    try {
      query = getClient().from(table).select(columns || "*");
      if (typeof tweak === "function") {
        query = tweak(query) || query;
      }
    } catch (setupError) {
      return Promise.resolve({
        rows: [],
        count: null,
        missing: false,
        error: setupError
      });
    }

    return Promise.resolve(query).then(
      function (result) {
        if (result.error) {
          return {
            rows: [],
            count: null,
            missing: Dash.isMissingRelation(result.error),
            error: result.error
          };
        }
        return {
          rows: result.data || [],
          count: typeof result.count === "number" ? result.count : null,
          missing: false,
          error: null
        };
      },
      function (thrown) {
        return {
          rows: [],
          count: null,
          missing: Dash.isMissingRelation(thrown),
          error: thrown
        };
      }
    );
  };

  /* ----------------------------------------------------------------------
     State rendering
     ---------------------------------------------------------------------- */

  Dash.renderLoading = function (target, message) {
    if (!target) {
      return;
    }
    target.innerHTML =
      '<div class="state" role="status">' +
      '<div class="spinner" aria-hidden="true"></div>' +
      '<p class="state__text" style="margin-top:16px">' +
      Dash.escape(message || "Loading…") +
      "</p>" +
      "</div>";
  };

  Dash.renderSkeletonCards = function (target, count) {
    if (!target) return;
    count = count || 3;
    var html = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px; width:100%;">';
    for (var i = 0; i < count; i++) {
      html += '<div class="skeleton-card">' +
        '<div class="skeleton skeleton--title"></div>' +
        '<div class="skeleton skeleton--text"></div>' +
        '<div class="skeleton skeleton--text" style="width:75%;"></div>' +
        '<div style="display:flex; justify-content:space-between; margin-top:8px;">' +
        '<div class="skeleton skeleton--pill"></div>' +
        '<div class="skeleton skeleton--pill" style="width:80px;"></div>' +
        '</div>' +
        '</div>';
    }
    html += '</div>';
    target.innerHTML = html;
  };

  Dash.renderSkeletonTable = function (target, rowCount, colCount) {
    if (!target) return;
    rowCount = rowCount || 4;
    colCount = colCount || 4;
    var html = '<div class="table-scroll"><table class="data-table" style="width:100%; border-collapse:collapse;"><tbody>';
    for (var r = 0; r < rowCount; r++) {
      html += '<tr style="border-bottom:1px solid var(--border-light);">';
      for (var c = 0; c < colCount; c++) {
        var w = c === 0 ? "70%" : (c === colCount - 1 ? "40%" : "60%");
        html += '<td style="padding:16px 20px;"><div class="skeleton skeleton--text" style="width:' + w + '; margin:0;"></div></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    target.innerHTML = html;
  };

  Dash.renderEmpty = function (target, title, text) {
    if (!target) {
      return;
    }
    target.innerHTML =
      '<div class="state">' +
      '<div class="state__icon" aria-hidden="true">' +
      ICON_EMPTY +
      "</div>" +
      '<p class="state__title">' +
      Dash.escape(title) +
      "</p>" +
      (text ? '<p class="state__text">' + Dash.escape(text) + "</p>" : "") +
      "</div>";
  };

  Dash.renderError = function (target, text, onRetry) {
    if (!target) {
      return;
    }
    target.innerHTML =
      '<div class="state state--error" role="alert">' +
      '<div class="state__icon" aria-hidden="true">' +
      ICON_ALERT +
      "</div>" +
      '<p class="state__title">Something went wrong</p>' +
      '<p class="state__text">' +
      Dash.escape(text || "We could not load this section right now.") +
      "</p>" +
      (onRetry
        ? '<div class="state__actions">' +
          '<button class="btn btn--outline btn--sm" type="button" data-retry>Try again</button>' +
          "</div>"
        : "") +
      "</div>";

    if (onRetry) {
      var button = target.querySelector("[data-retry]");
      if (button) {
        button.addEventListener("click", onRetry);
      }
    }
  };

  Dash.renderNotice = function (target, title, html) {
    if (!target) {
      return;
    }
    target.innerHTML =
      '<div class="notice" style="position: relative;">' +
      ICON_INFO +
      '<div style="flex: 1;">' +
      '<p class="notice__title">' +
      Dash.escape(title) +
      "</p>" +
      '<p class="notice__text">' +
      html +
      "</p>" +
      "</div>" +
      '<button type="button" style="background: none; border: none; font-size: 16px; cursor: pointer; color: var(--text-muted); padding: 0 4px;" aria-label="Dismiss notice" data-dismiss-notice>✕</button>' +
      "</div>";
    target.hidden = false;

    var dismiss = target.querySelector("[data-dismiss-notice]");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        target.hidden = true;
        target.innerHTML = "";
      });
    }
  };

  // Writes a resolved number into a stat card and clears its pending styling.
  Dash.setStat = function (id, value) {
    var el = document.getElementById(id);
    if (!el) {
      return;
    }
    el.classList.remove("is-pending");
    el.textContent = value === null || value === undefined ? "—" : String(value);
  };

  Dash.setText = function (id, value) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  };

  /* ----------------------------------------------------------------------
     Gate
     ---------------------------------------------------------------------- */

  function gateEl() {
    return document.getElementById("gate");
  }

  function shellEl() {
    return document.getElementById("shell");
  }

  Dash.gateMessage = function (title, text) {
    var gate = gateEl();
    if (!gate) {
      return;
    }
    gate.hidden = false;
    gate.innerHTML =
      '<div class="gate__inner" role="status">' +
      '<div class="spinner" aria-hidden="true"></div>' +
      '<p class="gate__title">' +
      Dash.escape(title) +
      "</p>" +
      (text ? '<p class="gate__text">' + Dash.escape(text) + "</p>" : "") +
      "</div>";
  };

  // Terminal state: the shell stays hidden and the visitor gets a way out.
  Dash.gateFatal = function (title, text, linkLabel) {
    var gate = gateEl();
    var shell = shellEl();

    if (shell) {
      shell.hidden = true;
    }
    if (!gate) {
      return;
    }

    gate.hidden = false;
    gate.innerHTML =
      '<div class="gate__inner" role="alert">' +
      '<div class="state__icon" aria-hidden="true">' +
      ICON_ALERT +
      "</div>" +
      '<p class="gate__title">' +
      Dash.escape(title) +
      "</p>" +
      '<p class="gate__text">' +
      Dash.escape(text) +
      "</p>" +
      '<div class="gate__actions">' +
      '<a class="btn btn--blue btn--sm" href="' +
      Dash.escape(Dash.loginPage()) +
      '">' +
      Dash.escape(linkLabel || "Return to sign in") +
      "</a>" +
      '<button class="btn btn--outline btn--sm" type="button" data-gate-retry>Try again</button>' +
      "</div>" +
      "</div>";

    var retry = gate.querySelector("[data-gate-retry]");
    if (retry) {
      retry.addEventListener("click", function () {
        window.location.reload();
      });
    }
  };

  /* ----------------------------------------------------------------------
     Logout — always performs a real Supabase sign-out
     ---------------------------------------------------------------------- */

  Dash.logout = function (trigger) {
    if (trigger) {
      trigger.disabled = true;
      trigger.textContent = "Signing out…";
    }

    var finish = function () {
      Dash.goto(Dash.loginPage());
    };

    var auth = getAuth();

    if (!auth || typeof auth.logout !== "function") {
      finish();
      return;
    }

    // Redirect happens only after signOut settles, so the session is genuinely
    // cleared rather than merely navigated away from. A failed signOut still
    // returns the visitor to the login page, where the next attempt re-checks.
    Promise.resolve(auth.logout()).then(finish, finish);
  };

  /* ----------------------------------------------------------------------
     Chrome wiring
     ---------------------------------------------------------------------- */

  function wireChrome() {
    var logoutButtons = document.querySelectorAll("[data-logout]");
    var i;

    for (i = 0; i < logoutButtons.length; i++) {
      logoutButtons[i].addEventListener("click", function (event) {
        event.preventDefault();
        Dash.logout(event.currentTarget);
      });
    }

    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.getElementById("dash-nav");

    if (toggle && nav) {
      // Collapsed by default only on the narrow layout where the toggle shows.
      if (window.matchMedia("(max-width: 1024px)").matches) {
        nav.classList.add("is-closed");
        toggle.setAttribute("aria-expanded", "false");
      }

      toggle.addEventListener("click", function () {
        var closed = nav.classList.toggle("is-closed");
        toggle.setAttribute("aria-expanded", closed ? "false" : "true");
      });

      window.addEventListener("resize", function () {
        if (!window.matchMedia("(max-width: 1024px)").matches) {
          nav.classList.remove("is-closed");
          toggle.setAttribute("aria-expanded", "true");
        }
      });
    }

    wireNavHighlight(nav, toggle);
  }

  // Keeps the sidebar's active item in step with the section on screen, and
  // collapses the narrow-layout menu once a destination has been chosen.
  function wireNavHighlight(nav, toggle) {
    if (!nav) {
      return;
    }

    var links = nav.querySelectorAll(".dash-nav__link");
    var targets = [];
    var i;

    for (i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href") || "";

      if (href.charAt(0) === "#" && href.length > 1) {
        var section = document.getElementById(href.slice(1));
        if (section) {
          targets.push({ link: links[i], section: section });
        }
      }

      links[i].addEventListener("click", function () {
        if (window.matchMedia("(max-width: 1024px)").matches) {
          nav.classList.add("is-closed");
          if (toggle) {
            toggle.setAttribute("aria-expanded", "false");
          }
        }
      });
    }

    if (!targets.length || !window.IntersectionObserver) {
      return;
    }

    var setActive = function (activeSection) {
      var j;
      for (j = 0; j < targets.length; j++) {
        var isActive = targets[j].section === activeSection;
        targets[j].link.classList.toggle("is-active", isActive);
        if (isActive) {
          targets[j].link.setAttribute("aria-current", "page");
        } else {
          targets[j].link.removeAttribute("aria-current");
        }
      }
    };

    var observer = new window.IntersectionObserver(
      function (entries) {
        var best = null;
        var k;

        for (k = 0; k < entries.length; k++) {
          if (!entries[k].isIntersecting) {
            continue;
          }
          if (!best || entries[k].intersectionRatio > best.intersectionRatio) {
            best = entries[k];
          }
        }

        if (best) {
          setActive(best.target);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] }
    );

    for (i = 0; i < targets.length; i++) {
      observer.observe(targets[i].section);
    }
  }

  function paintIdentity(profile, user, role) {
    var name = getAuth().displayName(profile, user);

    Dash.setText("user-name", name);
    Dash.setText("user-sub", profile.email || user.email || "");
    Dash.setText("user-avatar", Dash.initials(name));
    Dash.setText("welcome-name", name);

    var badge = document.getElementById("role-badge");
    if (badge) {
      badge.textContent = Dash.titleCase(role);
    }

    return name;
  }

  /* ----------------------------------------------------------------------
     init
     ---------------------------------------------------------------------- */

  Dash.init = function (options) {
    var config = options || {};
    var expectedRole = config.role;

    function boot() {
      Dash.gateMessage("Loading your dashboard…", "Verifying your session.");
      wireChrome();

      var auth = getAuth();

      // Dependencies must exist before anything else is attempted.
      if (!getClient() || !auth) {
        Dash.gateFatal(
          "Dashboard could not start",
          "The sign-in service did not load. Please refresh the page, or return to sign in and try again.",
          "Return to sign in"
        );
        return;
      }

      auth.requireSession().then(
        function (result) {
          var profile = result.profile;

          // Role comes from the database profile row, never from the browser.
          if (profile.role !== expectedRole) {
            var target = auth.dashboardFor(profile.role);
            Dash.gateMessage(
              "Taking you to your dashboard…",
              "This page is for " + expectedRole + " accounts."
            );
            Dash.goto(target || Dash.loginPage());
            return;
          }

          var name = paintIdentity(profile, result.user, expectedRole);

          var shell = shellEl();
          var gate = gateEl();

          if (shell) {
            shell.hidden = false;
          }
          if (gate) {
            gate.hidden = true;
          }

          // Signing out in another tab, or a session expiring, must not leave
          // dashboard content on screen.
          try {
            getClient().auth.onAuthStateChange(function (event) {
              if (event === "SIGNED_OUT") {
                Dash.goto(Dash.loginPage());
              }
            });
          } catch (ignored) {
            /* Listener is a safety net; its absence is not fatal. */
          }

          if (typeof config.onReady === "function") {
            try {
              config.onReady({
                user: result.user,
                profile: profile,
                session: result.session,
                name: name
              });
            } catch (pageError) {
              /* A page-level failure must not blank the whole dashboard. */
              if (window.console && window.console.error) {
                window.console.error(pageError);
              }
            }
          }
        },
        function (error) {
          var code = (error && error.code) || "";

          if (code === "no-session") {
            Dash.gateMessage("Redirecting to sign in…", "");
            Dash.goto(Dash.loginPage());
            return;
          }

          if (Dash.isNetworkError(error)) {
            Dash.gateFatal(
              "No connection",
              "We could not reach the server. Check your internet connection and try again.",
              "Return to sign in"
            );
            return;
          }

          // Any half-authenticated state is cleared before showing the message,
          // so the visitor cannot linger with a session the app will not honour.
          var messages = {
            "no-profile":
              "We verified your sign-in but could not find a matching profile record. Please contact your administrator.",
            inactive:
              "Your account is currently inactive. Please contact your administrator to reactivate it.",
            "no-role":
              "Your account does not have a role assigned yet. Please contact your administrator.",
            "bad-role":
              "Your account has a role this portal does not recognise. Please contact your administrator.",
            query:
              "We could not load your profile just now. Please try again in a moment.",
            session:
              "We could not verify your session. Please sign in again."
          };

          var text =
            messages[code] ||
            "We could not open your dashboard. Please sign in again.";

          var show = function () {
            Dash.gateFatal("Unable to open your dashboard", text, "Return to sign in");
          };

          if (
            code === "no-profile" ||
            code === "inactive" ||
            code === "no-role" ||
            code === "bad-role"
          ) {
            Promise.resolve(auth.logout()).then(show, show);
          } else {
            show();
          }
        }
      );
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  };

  window.Dash = Dash;
})(window, document);
