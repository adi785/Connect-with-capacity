/* ==========================================================================
   CAPACITY CONNECT — home.js
   Homepage-only behaviour: hero slider and the statistics count-up.
   Vanilla JS only. No dependencies.
   ========================================================================== */

(function () {
  "use strict";

  /* ======================================================================
     Hero slider
     ====================================================================== */

  var SLIDES = [
    {
      lines: [
        { text: "Connect.", accent: false },
        { text: "Learn.", accent: true },
        { text: "Grow.", accent: true }
      ],
      lede:
        "Empowering students, educators and institutions through accessible " +
        "learning, skill development and meaningful connections.",
      tag: "Learn • Connect • Grow"
    },
    {
      lines: [
        { text: "Build Skills", accent: false },
        { text: "For Tomorrow", accent: true }
      ],
      lede:
        "Practical, job-ready programmes in technology, data and digital " +
        "skills — structured, assessed and certified.",
      tag: "Skills • Practice • Certify"
    },
    {
      lines: [
        { text: "Learn From", accent: false },
        { text: "Experts", accent: true }
      ],
      lede:
        "Study alongside experienced trainers and mentors who guide your " +
        "progress from first module to final certificate.",
      tag: "Mentors • Guidance • Growth"
    }
  ];

  var AUTOPLAY_MS = 6000;
  var SWAP_MS = 320;

  function initHeroSlider() {
    var hero = document.querySelector(".hero");
    var title = document.getElementById("heroTitle");
    var lede = document.getElementById("heroLede");
    var tag = document.getElementById("visualTag");
    var dots = Array.prototype.slice.call(
      document.querySelectorAll(".hero__slider .dot")
    );

    if (!hero || !title || !lede || !dots.length) return;

    var current = 0;
    var timer = null;
    var swapTimer = null;

    var reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function render(index) {
      var slide = SLIDES[index];
      if (!slide) return;

      title.innerHTML = "";
      slide.lines.forEach(function (line) {
        var span = document.createElement("span");
        span.className = "hero__line" + (line.accent ? " accent" : "");
        span.textContent = line.text;
        title.appendChild(span);
      });

      lede.textContent = slide.lede;
      if (tag) tag.textContent = slide.tag;

      dots.forEach(function (dot, i) {
        var active = i === index;
        dot.classList.toggle("is-active", active);
        if (active) {
          dot.setAttribute("aria-current", "true");
        } else {
          dot.removeAttribute("aria-current");
        }
      });
    }

    function goTo(index) {
      var next = (index + SLIDES.length) % SLIDES.length;
      if (next === current) return;
      current = next;

      // Fade out, swap content, fade back in
      hero.classList.add("is-swapping");
      window.clearTimeout(swapTimer);
      swapTimer = window.setTimeout(function () {
        render(current);
        hero.classList.remove("is-swapping");
      }, SWAP_MS);
    }

    function start() {
      // Honour prefers-reduced-motion on every entry point, not just boot —
      // otherwise one hover or tab-switch would restart the autoplay.
      if (reduced) return;
      stop();
      timer = window.setInterval(function () {
        goTo(current + 1);
      }, AUTOPLAY_MS);
    }

    function stop() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    dots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        var index = parseInt(dot.getAttribute("data-slide"), 10);
        if (isNaN(index)) return;
        goTo(index);
        start(); // restart the clock after manual interaction
      });
    });

    // Pause while hovered or keyboard-focused
    hero.addEventListener("mouseenter", stop);
    hero.addEventListener("mouseleave", start);
    hero.addEventListener("focusin", stop);
    hero.addEventListener("focusout", start);

    // Pause when the tab is hidden
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    });

    render(0);

    // start() self-guards on prefers-reduced-motion.
    start();
  }

  /* ======================================================================
     Statistics count-up
     ====================================================================== */

  function formatNumber(value) {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function countUp(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    if (isNaN(target)) return;

    var suffix = el.getAttribute("data-suffix") || "";
    var duration = 1500;
    var started = null;

    function frame(now) {
      if (started === null) started = now;
      var progress = Math.min(1, (now - started) / duration);
      // easeOutCubic
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatNumber(Math.round(target * eased)) + suffix;

      if (progress < 1) {
        window.requestAnimationFrame(frame);
      }
    }

    window.requestAnimationFrame(frame);
  }

  function initStats() {
    var nums = document.querySelectorAll(".stat__num[data-count]");
    if (!nums.length) return;

    var reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Values are already correct in the HTML, so bail out gracefully.
    if (reduced || !("IntersectionObserver" in window)) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          countUp(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.4 }
    );

    nums.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function init() {
    initHeroSlider();
    initStats();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
