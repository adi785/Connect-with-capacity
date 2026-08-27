/* ==========================================================================
   CAPACITY CONNECT — Trainee dashboard
   Guard (../shared/dashboard-guard.js) has already confirmed an active
   Supabase session whose profile row carries role === "trainee".
   ========================================================================== */

(function (window, document) {
  "use strict";

  /* ------------------------------------------------------------------------
     SCHEMA MAP
     ------------------------------------------------------------------------
     Right now the only table in the project is `profiles`, so nothing here is
     guessed or assumed: every course-related table is declared as null and the
     matching section renders an honest "not connected yet" state instead of
     inventing records or counts.

     When you create these tables in Supabase, set `table` to the real name and
     correct the column names beside it. No other file needs to change.
     ------------------------------------------------------------------------ */

  var SCHEMA = {
    enrollments: {
      table: "enrollments",
      userColumn: "trainee_profile_id",
      courseColumn: "course_id",
      statusColumn: "status",
      progressColumn: "progress_percent",
      updatedColumn: "enrolled_at",
      completedValue: "completed"
    },
    courses: {
      table: "courses",
      idColumn: "id",
      titleColumn: "title",
      areaColumn: "status"
    },
    certificates: {
      table: "certificates",
      userColumn: "trainee_profile_id",
      titleColumn: "title",
      issuedColumn: "issue_date",
      codeColumn: "issuing_body"
    }
  };

  var NOT_CONNECTED_TEXT =
    "No courses enrolled yet. Browse the course catalog to start your learning journey.";

  /* ------------------------------------------------------------------------
     Profile section — always backed by real data
     ------------------------------------------------------------------------ */

  function statusPill(status) {
    var value = String(status || "").toLowerCase();
    if (value === "active") {
      return '<span class="pill pill--active">Active</span>';
    }
    if (!value) {
      return '<span class="pill pill--muted">Not set</span>';
    }
    return '<span class="pill pill--muted">' + Dash.escape(Dash.titleCase(value)) + "</span>";
  }

  function renderProfile(ctx) {
    var body = document.getElementById("profile-body");
    if (!body) {
      return;
    }

    var profile = ctx.profile;
    var user = ctx.user;

    var rows = [
      ["Full name", Dash.escape(ctx.name)],
      ["Email address", Dash.escape(profile.email || user.email || "—")],
      [
        "Employee ID",
        profile.employee_id
          ? Dash.escape(profile.employee_id)
          : '<span class="cell-muted">Not provided</span>'
      ],
      ["Role", Dash.escape(Dash.titleCase(profile.role))],
      ["Account status", statusPill(profile.status)],
      ["Member since", Dash.escape(Dash.formatDate(user.created_at))]
    ];

    var html = '<dl class="detail-grid">';
    var i;

    for (i = 0; i < rows.length; i++) {
      html +=
        "<div class=\"detail\">" +
        '<dt class="detail__label">' +
        Dash.escape(rows[i][0]) +
        "</dt>" +
        '<dd class="detail__value">' +
        rows[i][1] +
        "</dd>" +
        "</div>";
    }

    html += "</dl>";
    body.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Course data
     ------------------------------------------------------------------------ */

  function progressValue(row) {
    var cfg = SCHEMA.enrollments;
    var raw = row[cfg.progressColumn];
    var number = Number(raw);

    if (isNaN(number)) {
      return isCompleted(row) ? 100 : 0;
    }
    if (number <= 1 && number > 0) {
      number = number * 100; // stored as a 0–1 fraction
    }
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function isCompleted(row) {
    var cfg = SCHEMA.enrollments;
    var status = String(row[cfg.statusColumn] || "").toLowerCase();
    if (status) {
      return status === String(cfg.completedValue).toLowerCase();
    }
    return Number(row[cfg.progressColumn]) >= 100;
  }

  // Resolves course_id -> title using the courses table when it is configured.
  function withCourseTitles(rows) {
    var courseCfg = SCHEMA.courses;
    var enrolCfg = SCHEMA.enrollments;

    if (!courseCfg.table || !rows.length) {
      return Promise.resolve({});
    }

    var ids = [];
    var seen = {};
    var i;

    for (i = 0; i < rows.length; i++) {
      var id = rows[i][enrolCfg.courseColumn];
      if (id !== null && id !== undefined && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    }

    if (!ids.length) {
      return Promise.resolve({});
    }

    return Dash.safeSelect(courseCfg.table, "*", function (q) {
      return q.in(courseCfg.idColumn, ids);
    }).then(function (result) {
      var map = {};
      var j;
      for (j = 0; j < result.rows.length; j++) {
        map[result.rows[j][courseCfg.idColumn]] = result.rows[j];
      }
      return map;
    });
  }

  function courseLabel(row, courseMap) {
    var enrolCfg = SCHEMA.enrollments;
    var courseCfg = SCHEMA.courses;
    var course = courseMap[row[enrolCfg.courseColumn]];

    if (course && course[courseCfg.titleColumn]) {
      return String(course[courseCfg.titleColumn]);
    }
    if (row.title) {
      return String(row.title);
    }
    if (row[enrolCfg.courseColumn]) {
      return "Course " + row[enrolCfg.courseColumn];
    }
    return "Untitled course";
  }

  function courseArea(row, courseMap) {
    var course = courseMap[row[SCHEMA.enrollments.courseColumn]];
    var areaCol = SCHEMA.courses.areaColumn;
    if (course && course[areaCol]) {
      return String(course[areaCol]);
    }
    return "";
  }

  function renderCourseTable(rows, courseMap) {
    var body = document.getElementById("courses-body");
    if (!body) {
      return;
    }

    if (!rows.length) {
      Dash.renderEmpty(
        body,
        "No courses enrolled yet.",
        "Once you enrol in a programme it will appear here with your progress."
      );
      return;
    }

    var html =
      '<div class="table-scroll"><table class="data-table">' +
      "<thead><tr>" +
      "<th scope=\"col\">Course</th>" +
      "<th scope=\"col\">Learning area</th>" +
      "<th scope=\"col\">Progress</th>" +
      "<th scope=\"col\">Status</th>" +
      "</tr></thead><tbody>";

    var i;

    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      var pct = progressValue(row);
      var done = isCompleted(row);
      var area = courseArea(row, courseMap);

      html +=
        "<tr>" +
        '<td class="cell-strong">' +
        Dash.escape(courseLabel(row, courseMap)) +
        "</td>" +
        "<td>" +
        (area
          ? Dash.escape(area)
          : '<span class="cell-muted">—</span>') +
        "</td>" +
        "<td>" +
        '<span class="progress"><span class="progress__fill" style="width:' +
        pct +
        '%"></span></span>' +
        '<span class="cell-muted" style="font-size:.8125rem">' +
        pct +
        "%</span>" +
        "</td>" +
        "<td>" +
        (done
          ? '<span class="pill pill--active">Completed</span>'
          : '<span class="pill pill--orange">In progress</span>') +
        "</td>" +
        "</tr>";
    }

    html += "</tbody></table></div>";
    body.innerHTML = html;
  }

  function renderResume(rows, courseMap) {
    var body = document.getElementById("resume-body");
    if (!body) {
      return;
    }

    var cfg = SCHEMA.enrollments;
    var active = [];
    var i;

    for (i = 0; i < rows.length; i++) {
      if (!isCompleted(rows[i])) {
        active.push(rows[i]);
      }
    }

    if (!active.length) {
      Dash.renderEmpty(
        body,
        rows.length ? "You are all caught up." : "Nothing in progress yet.",
        rows.length
          ? "Every course you are enrolled in has been completed."
          : "Enrol in a course to start tracking your progress."
      );
      return;
    }

    active.sort(function (a, b) {
      return (
        new Date(b[cfg.updatedColumn] || 0) - new Date(a[cfg.updatedColumn] || 0)
      );
    });

    var top = active[0];
    var pct = progressValue(top);
    var area = courseArea(top, courseMap);

    body.innerHTML =
      '<div class="resume">' +
      '<span class="icon-tile icon-tile--orange" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">' +
      '<path d="M9 7.5 17 12l-8 4.5Z"/><circle cx="12" cy="12" r="9"/></svg>' +
      "</span>" +
      '<div class="resume__body">' +
      '<p class="resume__title">' +
      Dash.escape(courseLabel(top, courseMap)) +
      "</p>" +
      '<p class="resume__meta">' +
      (area ? Dash.escape(area) + " · " : "") +
      pct +
      "% complete</p>" +
      '<span class="progress resume__bar"><span class="progress__fill" style="width:' +
      pct +
      '%"></span></span>' +
      "</div>" +
      "</div>";
  }

  function renderCertificates(rows) {
    var body = document.getElementById("certs-body");
    if (!body) {
      return;
    }

    if (!rows.length) {
      Dash.renderEmpty(
        body,
        "No certificates yet.",
        "Complete a course to earn your first certificate."
      );
      return;
    }

    var cfg = SCHEMA.certificates;
    var html =
      '<div class="table-scroll"><table class="data-table">' +
      "<thead><tr>" +
      "<th scope=\"col\">Certificate</th>" +
      "<th scope=\"col\">Reference</th>" +
      "<th scope=\"col\">Issued</th>" +
      "</tr></thead><tbody>";

    var i;

    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      html +=
        "<tr>" +
        '<td class="cell-strong">' +
        Dash.escape(row[cfg.titleColumn] || "Certificate") +
        "</td>" +
        "<td>" +
        (row[cfg.codeColumn]
          ? Dash.escape(row[cfg.codeColumn])
          : '<span class="cell-muted">—</span>') +
        "</td>" +
        "<td>" +
        Dash.escape(Dash.formatDate(row[cfg.issuedColumn])) +
        "</td>" +
        "</tr>";
    }

    html += "</tbody></table></div>";
    body.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Loaders
     ------------------------------------------------------------------------ */

  function showEnrollmentsNotConnected() {
    // Statistics stay as "—" rather than 0: an unconfigured table means the
    // real value is unknown, and showing 0 would assert something untrue.
    Dash.setStat("stat-enrolled", null);
    Dash.setStat("stat-completed", null);
    Dash.setStat("stat-progress", null);

    Dash.renderEmpty(
      document.getElementById("resume-body"),
      "Nothing to continue yet.",
      NOT_CONNECTED_TEXT
    );
    Dash.renderEmpty(
      document.getElementById("courses-body"),
      "No courses enrolled yet.",
      NOT_CONNECTED_TEXT
    );
  }

  function showCertificatesNotConnected() {
    Dash.setStat("stat-certificates", null);
    Dash.renderEmpty(
      document.getElementById("certs-body"),
      "No certificates yet.",
      NOT_CONNECTED_TEXT
    );
  }

  function showDataNotice() {
    Dash.renderNotice(
      document.getElementById("data-notice"),
      "Course data is not connected yet",
      "Your profile below is live from the database. Enrolment, progress and " +
        "certificate figures will populate automatically once those tables exist " +
        "&mdash; point <code>SCHEMA</code> in <code>trainee-dashboard/app.js</code> " +
        "at the real table and column names."
    );
  }

  function loadEnrollments(userId) {
    var cfg = SCHEMA.enrollments;
    var coursesBody = document.getElementById("courses-body");
    var resumeBody = document.getElementById("resume-body");

    Dash.renderLoading(coursesBody, "Loading your courses…");
    Dash.renderLoading(resumeBody, "Loading…");

    return Dash.safeSelect(cfg.table, "*", function (q) {
      return q.eq(cfg.userColumn, userId);
    }).then(function (result) {
      if (result.missing) {
        Dash.setStat("stat-enrolled", null);
        Dash.setStat("stat-completed", null);
        Dash.setStat("stat-progress", null);
        Dash.renderEmpty(coursesBody, "No courses enrolled yet.", NOT_CONNECTED_TEXT);
        Dash.renderEmpty(resumeBody, "Nothing to continue yet.", NOT_CONNECTED_TEXT);
        return;
      }

      if (result.error) {
        Dash.setStat("stat-enrolled", null);
        Dash.setStat("stat-completed", null);
        Dash.setStat("stat-progress", null);
        Dash.renderError(
          coursesBody,
          "We could not load your courses right now.",
          function () {
            loadEnrollments(userId);
          }
        );
        Dash.renderError(resumeBody, "We could not load this right now.");
        return;
      }

      var rows = result.rows;
      var completed = 0;
      var i;

      for (i = 0; i < rows.length; i++) {
        if (isCompleted(rows[i])) {
          completed++;
        }
      }

      Dash.setStat("stat-enrolled", rows.length);
      Dash.setStat("stat-completed", completed);
      Dash.setStat("stat-progress", rows.length - completed);

      return withCourseTitles(rows).then(function (courseMap) {
        renderCourseTable(rows, courseMap);
        renderResume(rows, courseMap);
      });
    });
  }

  function loadCertificates(userId) {
    var cfg = SCHEMA.certificates;
    var body = document.getElementById("certs-body");

    Dash.renderLoading(body, "Loading your certificates…");

    return Dash.safeSelect(cfg.table, "*", function (q) {
      return q.eq(cfg.userColumn, userId);
    }).then(function (result) {
      if (result.missing) {
        Dash.setStat("stat-certificates", null);
        Dash.renderEmpty(body, "No certificates yet.", NOT_CONNECTED_TEXT);
        return;
      }

      if (result.error) {
        Dash.setStat("stat-certificates", null);
        Dash.renderError(body, "We could not load your certificates right now.", function () {
          loadCertificates(userId);
        });
        return;
      }

      Dash.setStat("stat-certificates", result.rows.length);
      renderCertificates(result.rows);
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  Dash.init({
    role: "trainee",
    onReady: function (ctx) {
      renderProfile(ctx);

      // Each section is gated on its own table so a partially configured
      // schema still leaves every panel with a meaningful state.
      var hasEnrollments = !!SCHEMA.enrollments.table;
      var hasCertificates = !!SCHEMA.certificates.table;

      if (hasEnrollments) {
        loadEnrollments(ctx.user.id);
      } else {
        showEnrollmentsNotConnected();
      }

      if (hasCertificates) {
        loadCertificates(ctx.user.id);
      } else {
        showCertificatesNotConnected();
      }

      if (!hasEnrollments || !hasCertificates) {
        showDataNotice();
      }
    }
  });
})(window, document);
