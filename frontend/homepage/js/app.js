/* ==========================================================================
   CAPACITY CONNECT — app.js
   Shared UI behaviour: mobile navigation, sticky navbar, scroll reveal,
   and the floating accessibility widget.
   Vanilla JS only. No dependencies.
   ========================================================================== */

(function () {
  "use strict";

  document.documentElement.classList.add("js");

  /* ======================================================================
     Mobile navigation
     ====================================================================== */

  function initMobileNav() {
    var toggle = document.getElementById("navToggle");
    var drawer = document.getElementById("mobileNav");
    var scrim = document.getElementById("navScrim");

    if (!toggle || !drawer) return;

    var open = false;

    function setOpen(next) {
      if (next === open) return;
      open = next;

      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute(
        "aria-label",
        open ? "Close navigation menu" : "Open navigation menu"
      );

      if (open) {
        drawer.hidden = false;
        if (scrim) scrim.hidden = false;

        // Measure the FULL height first — `.is-closed` zeroes padding and
        // border, so measuring after applying it would come up ~26px short
        // and clip the Log in / Register row for the whole transition.
        var target = drawer.scrollHeight;

        drawer.classList.add("is-closed");
        void drawer.offsetHeight; // force reflow so the transition runs
        drawer.classList.add("is-animating");
        drawer.classList.remove("is-closed");
        drawer.style.maxHeight = target + "px";

        window.setTimeout(function () {
          if (open) drawer.style.maxHeight = "none";
        }, 340);
      } else {
        drawer.style.maxHeight = drawer.scrollHeight + "px";
        void drawer.offsetHeight;
        drawer.classList.add("is-animating", "is-closed");
        drawer.style.maxHeight = "0px";

        window.setTimeout(function () {
          if (!open) {
            drawer.hidden = true;
            drawer.classList.remove("is-animating", "is-closed");
            drawer.style.maxHeight = "";
            if (scrim) scrim.hidden = true;
          }
        }, 340);
      }
    }

    toggle.addEventListener("click", function () {
      setOpen(!open);
    });

    if (scrim) {
      scrim.addEventListener("click", function () {
        setOpen(false);
      });
    }

    // Close after choosing a destination
    drawer.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && open) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Reset state if the viewport grows back to desktop.
    // Must match the 1024px breakpoint in responsive.css where the full
    // nav reappears — closing any earlier would leave no visible navigation.
    window.addEventListener("resize", function () {
      if (window.innerWidth > 1024 && open) setOpen(false);
    });
  }

  /* ======================================================================
     Sticky navbar shadow
     ====================================================================== */

  function initStickyNav() {
    var nav = document.getElementById("siteNav");
    if (!nav) return;

    function update() {
      nav.classList.toggle("is-stuck", window.scrollY > 12);
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  /* ======================================================================
     Scroll reveal
     ====================================================================== */

  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!items.length) return;

    // No IntersectionObserver -> show everything immediately.
    if (!("IntersectionObserver" in window)) {
      items.forEach(function (el) {
        el.classList.add("is-visible");
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );

    items.forEach(function (el, index) {
      // Light stagger within each group of siblings
      el.style.transitionDelay = (index % 4) * 70 + "ms";
      observer.observe(el);
    });
  }

  /* ======================================================================
     Accessibility widget
     ====================================================================== */

  function initAccessibility() {
    var btn = document.getElementById("a11yBtn");
    var panel = document.getElementById("a11yPanel");
    if (!btn || !panel) return;

    var MIN = 87.5;
    var MAX = 137.5;
    var STEP = 12.5;
    var scale = 100;

    function applyScale() {
      document.documentElement.style.fontSize = scale + "%";
    }

    function setPanel(next) {
      panel.hidden = !next;
      btn.setAttribute("aria-expanded", String(next));
    }

    btn.addEventListener("click", function () {
      setPanel(panel.hidden);
    });

    panel.addEventListener("click", function (event) {
      var action = event.target.getAttribute("data-a11y");
      if (!action) return;

      if (action === "inc") {
        scale = Math.min(MAX, scale + STEP);
        applyScale();
      } else if (action === "dec") {
        scale = Math.max(MIN, scale - STEP);
        applyScale();
      } else if (action === "contrast") {
        document.body.classList.toggle("hc");
      } else if (action === "reset") {
        scale = 100;
        applyScale();
        document.body.classList.remove("hc");
      }
    });

    // "Accessibility" link in the footer opens the panel
    document.querySelectorAll("[data-a11y-open]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        setPanel(true);
        btn.focus();
      });
    });

    // Click outside / Escape closes
    document.addEventListener("click", function (event) {
      if (panel.hidden) return;
      if (event.target.closest(".a11y") || event.target.closest("[data-a11y-open]")) {
        return;
      }
      setPanel(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) {
        setPanel(false);
        btn.focus();
      }
    });
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function init() {
    initMobileNav();
    initStickyNav();
    initReveal();
    initAccessibility();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
