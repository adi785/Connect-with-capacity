/* ==========================================================================
   CAPACITY CONNECT — Trainee Dashboard
   Seamless integration with backend APIs:
   - Trainee Dashboard Metrics (/api/v1/dashboard/trainee)
   - Enrolled Courses & Progress (/api/v1/enrollments)
   - Published Announcements Feed (/api/v1/notifications)
   - Certificates & Profile (/api/v1/profile/trainee)
   ========================================================================== */

(function (window, document) {
  "use strict";

  var API = window.CapacityConnectAPI || window.API;

  var state = {
    user: null,
    profile: null,
    enrollments: [],
    certificates: [],
    announcements: [],
    stats: null
  };

  /* ------------------------------------------------------------------------
     UI Helpers
     ------------------------------------------------------------------------ */

  function statusPill(status) {
    var value = String(status || "").toLowerCase();
    if (value === "active" || value === "approved" || value === "completed") {
      return '<span class="pill pill--active">' + Dash.escape(Dash.titleCase(value)) + '</span>';
    }
    if (value === "in_progress" || value === "enrolled" || value === "pending") {
      return '<span class="pill pill--orange">' + Dash.escape(Dash.titleCase(value)) + '</span>';
    }
    if (value === "dropped" || value === "suspended" || value === "rejected") {
      return '<span class="pill pill--reject">' + Dash.escape(Dash.titleCase(value)) + '</span>';
    }
    return '<span class="pill pill--muted">' + Dash.escape(Dash.titleCase(value || "Unknown")) + '</span>';
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    } catch (e) {
      return String(iso);
    }
  }

  /* ------------------------------------------------------------------------
     Section Navigation
     ------------------------------------------------------------------------ */

  function switchSection(targetHash) {
    var hash = targetHash || window.location.hash || "#overview";
    if (!hash.startsWith("#")) hash = "#" + hash;

    var validSections = ["#overview", "#my-courses", "#certificates", "#announcements", "#profile"];
    if (validSections.indexOf(hash) === -1) {
      hash = "#overview";
    }

    validSections.forEach(function (secId) {
      var el = document.querySelector(secId);
      if (el) {
        if (secId === hash) {
          el.removeAttribute("hidden");
        } else {
          el.setAttribute("hidden", "true");
        }
      }
    });

    var links = document.querySelectorAll(".dash-nav__link");
    links.forEach(function (link) {
      if (link.getAttribute("href") === hash) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      } else {
        link.classList.remove("is-active");
        link.removeAttribute("aria-current");
      }
    });
  }

  /* ------------------------------------------------------------------------
     API Loaders
     ------------------------------------------------------------------------ */

  // 1. Trainee Dashboard Metrics
  async function loadDashboardMetrics() {
    try {
      var d = await API.get("dashboard/trainee");
      state.stats = d;

      var enrolled = d.enrolled_courses || 0;
      var completed = d.completed_courses || 0;
      var inProgress = Math.max(enrolled - completed, 0);
      var certs = d.certificates_earned || 0;

      Dash.setStat("stat-enrolled", enrolled);
      Dash.setStat("stat-completed", completed);
      Dash.setStat("stat-progress", inProgress);
      Dash.setStat("stat-certificates", certs);
    } catch (err) {
      console.warn("Could not load dashboard metrics:", err);
    }
  }

  // 2. Enrollments & Course Progress
  async function loadEnrollments() {
    var coursesBody = document.getElementById("courses-body");
    var resumeBody = document.getElementById("resume-body");

    if (coursesBody) Dash.renderLoading(coursesBody, "Loading your enrolled courses…");
    if (resumeBody) Dash.renderLoading(resumeBody, "Loading your progress…");

    try {
      var data = await API.get("enrollments?limit=100");
      var items = (data && data.items) || (Array.isArray(data) ? data : []);
      state.enrollments = items;

      var enrolled = items.length;
      var completed = items.filter(function (e) { return e.status === "completed" || e.progress_percent >= 100; }).length;
      var inProgress = Math.max(enrolled - completed, 0);

      Dash.setStat("stat-enrolled", enrolled);
      Dash.setStat("stat-completed", completed);
      Dash.setStat("stat-progress", inProgress);

      renderCourseTable(items);
      renderResume(items);
    } catch (err) {
      console.error("Failed to load enrollments:", err);
      if (coursesBody) {
        Dash.renderError(coursesBody, "Could not load enrolled courses: " + (err.message || "Network error"), function () {
          loadEnrollments();
        });
      }
      if (resumeBody) {
        Dash.renderEmpty(resumeBody, "Nothing in progress.", "Enrol in a course from the catalog to track your progress.");
      }
    }
  }

  // 3. Certificates & Profile
  async function loadProfileAndCertificates() {
    var certsBody = document.getElementById("certs-body");
    if (certsBody) Dash.renderLoading(certsBody, "Loading certificates…");

    try {
      var prof = await API.get("profile/trainee");
      state.profile = prof;

      var certList = (prof && prof.certificates) ? prof.certificates : [];
      state.certificates = certList;
      Dash.setStat("stat-certificates", certList.length);

      renderCertificates(certList);
      renderProfileView();
    } catch (err) {
      console.warn("Failed to load trainee profile:", err);
      if (certsBody) {
        Dash.renderEmpty(certsBody, "No certificates yet.", "Complete courses to earn official certificates.");
      }
    }
  }

  // 4. Announcements
  async function loadAnnouncements() {
    var body = document.getElementById("announcements-body");
    if (body) Dash.renderLoading(body, "Loading platform announcements…");

    try {
      var res = await API.get("notifications?limit=50");
      var items = (res && res.items) || (Array.isArray(res) ? res : []);
      state.announcements = items;
      renderAnnouncements(items);
    } catch (err) {
      console.error("Failed to load announcements:", err);
      if (body) {
        Dash.renderError(body, "Could not load announcements: " + (err.message || "Network error"), function () {
          loadAnnouncements();
        });
      }
    }
  }

  /* ------------------------------------------------------------------------
     Renderers
     ------------------------------------------------------------------------ */

  function renderCourseTable(rows) {
    var body = document.getElementById("courses-body");
    if (!body) return;

    if (!rows.length) {
      Dash.renderEmpty(
        body,
        "No courses enrolled yet.",
        "Browse the available courses from the home page or catalog to start learning."
      );
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Course Title</th>';
    html += '<th scope="col">Subject</th>';
    html += '<th scope="col">Progress</th>';
    html += '<th scope="col">Status</th>';
    html += '<th scope="col">Enrolled Date</th>';
    html += '</tr></thead><tbody>';

    rows.forEach(function (row) {
      var pct = Math.max(0, Math.min(100, Math.round(row.progress_percent || 0)));
      var isDone = row.status === "completed" || pct >= 100;
      var title = row.course_title || row.title || "Course " + (row.course_id || "");
      var subject = row.subject_name || "General";

      html += '<tr>';
      html += '  <td class="cell-strong">' + Dash.escape(title) + '</td>';
      html += '  <td><span class="pill pill--orange">' + Dash.escape(subject) + '</span></td>';
      html += '  <td>';
      html += '    <div style="display:flex; align-items:center; gap:8px;">';
      html += '      <span class="progress"><span class="progress__fill" style="width:' + pct + '%;"></span></span>';
      html += '      <span style="font-size:0.8125rem; font-weight:700;">' + pct + '%</span>';
      html += '    </div>';
      html += '  </td>';
      html += '  <td>' + (isDone ? '<span class="pill pill--active">Completed</span>' : statusPill(row.status || "in_progress")) + '</td>';
      html += '  <td>' + Dash.escape(formatDateTime(row.enrolled_at || row.created_at)) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    body.innerHTML = html;
  }

  function renderResume(rows) {
    var body = document.getElementById("resume-body");
    if (!body) return;

    var active = rows.filter(function (r) {
      return r.status !== "completed" && (r.progress_percent || 0) < 100;
    });

    if (!active.length) {
      Dash.renderEmpty(
        body,
        rows.length ? "You are all caught up!" : "Nothing in progress yet.",
        rows.length
          ? "You have completed all your enrolled programmes."
          : "Enrol in a course to begin tracking your progress."
      );
      return;
    }

    var top = active[0];
    var pct = Math.max(0, Math.min(100, Math.round(top.progress_percent || 0)));
    var title = top.course_title || top.title || "Active Course";

    body.innerHTML =
      '<div class="resume">' +
      '<span class="icon-tile icon-tile--orange" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">' +
      '<path d="M9 7.5 17 12l-8 4.5Z"/><circle cx="12" cy="12" r="9"/></svg>' +
      '</span>' +
      '<div class="resume__body">' +
      '<p class="resume__title">' + Dash.escape(title) + '</p>' +
      '<p class="resume__meta">' + pct + '% complete</p>' +
      '<span class="progress resume__bar"><span class="progress__fill" style="width:' + pct + '%"></span></span>' +
      '</div>' +
      '</div>';
  }

  function renderCertificates(rows) {
    var body = document.getElementById("certs-body");
    if (!body) return;

    if (!rows.length) {
      Dash.renderEmpty(
        body,
        "No certificates yet.",
        "Complete a course curriculum to earn your first verified certificate."
      );
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Certificate Title</th>';
    html += '<th scope="col">Issuing Body</th>';
    html += '<th scope="col">Issue Date</th>';
    html += '</tr></thead><tbody>';

    rows.forEach(function (c) {
      html += '<tr>';
      html += '  <td class="cell-strong">' + Dash.escape(c.title || "Certificate of Completion") + '</td>';
      html += '  <td>' + Dash.escape(c.issuing_body || "Capacity Connect") + '</td>';
      html += '  <td>' + Dash.escape(formatDateTime(c.issue_date)) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    body.innerHTML = html;
  }

  function renderAnnouncements(items) {
    var body = document.getElementById("announcements-body");
    if (!body) return;

    if (!items.length) {
      Dash.renderEmpty(
        body,
        "No announcements at this time.",
        "Official platform notices, schedule updates, and training news will appear here."
      );
      return;
    }

    var html = '<div class="announcement-feed" style="padding:20px; display:flex; flex-direction:column; gap:16px;">';
    items.forEach(function (ann) {
      var categoryTag = ann.category ? '<span class="pill pill--orange" style="font-size:0.75rem;">' + Dash.escape(ann.category) + '</span>' : '';
      var publishedAt = formatDateTime(ann.published_at || ann.created_at);
      var publisher = ann.published_by_name ? 'Posted by ' + Dash.escape(ann.published_by_name) : 'Official Notice';

      html += '<article class="announcement-card" style="background:#fff; border:1px solid var(--border); border-radius:var(--radius-md); padding:20px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">';
      html += '  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:12px;">';
      html += '    <h3 style="font-size:1.0625rem; font-weight:700; color:var(--primary-blue-dark); margin:0;">' + Dash.escape(ann.title) + '</h3>';
      html += '    <div>' + categoryTag + '</div>';
      html += '  </div>';
      if (ann.summary) {
        html += '  <p style="font-size:0.875rem; font-weight:600; color:var(--text-dark); margin:0 0 8px 0;">' + Dash.escape(ann.summary) + '</p>';
      }
      if (ann.body) {
        html += '  <p style="font-size:0.875rem; color:var(--text-muted); line-height:1.6; margin:0 0 12px 0;">' + Dash.escape(ann.body) + '</p>';
      }
      html += '  <div style="font-size:0.75rem; color:var(--text-muted); display:flex; justify-content:space-between; border-top:1px solid var(--border-light); padding-top:10px;">';
      html += '    <span>' + publisher + '</span>';
      html += '    <span>' + Dash.escape(publishedAt) + '</span>';
      html += '  </div>';
      html += '</article>';
    });
    html += '</div>';

    body.innerHTML = html;
  }

  function renderProfileView() {
    var body = document.getElementById("profile-body");
    if (!body) return;

    var u = state.user || {};
    var p = state.profile || {};

    var rows = [
      ["Full Name", Dash.escape(u.name || "Trainee")],
      ["Email Address", Dash.escape(u.email || "—")],
      ["Headline / Bio", Dash.escape(p.headline || p.bio || "Learner")],
      ["Employee ID", u.employee_id ? Dash.escape(u.employee_id) : '<span class="cell-muted">Not provided</span>'],
      ["Role", '<span class="pill pill--active">Trainee</span>'],
      ["Account Status", statusPill(u.status)],
      ["Member Since", Dash.escape(formatDateTime(u.created_at))]
    ];

    var html = '<dl class="detail-grid">';
    rows.forEach(function (r) {
      html += '<div class="detail"><dt class="detail__label">' + r[0] + '</dt><dd class="detail__value">' + r[1] + '</dd></div>';
    });
    html += '</dl>';

    body.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Bootstrapping
     ------------------------------------------------------------------------ */

  Dash.init({
    role: "trainee",
    onReady: async function (ctx) {
      window.addEventListener("hashchange", function () {
        switchSection(window.location.hash);
      });

      try {
        var me = await API.get("auth/me");
        state.user = me;

        var topName = document.getElementById("user-name");
        if (topName) topName.textContent = me.name || ctx.name;
        var topSub = document.getElementById("user-sub");
        if (topSub) topSub.textContent = me.email || ctx.user.email;
        var welcomeName = document.getElementById("welcome-name");
        if (welcomeName) welcomeName.textContent = (me.name || ctx.name || "").split(" ")[0] || "Learner";

        await Promise.all([
          loadDashboardMetrics(),
          loadEnrollments(),
          loadProfileAndCertificates(),
          loadAnnouncements()
        ]);

        switchSection(window.location.hash || "#overview");
      } catch (err) {
        console.error("Trainee initialization error:", err);
      }
    }
  });

})(window, document);
