/* ==========================================================================
   CAPACITY CONNECT — Trainer dashboard
   Guard (../shared/dashboard-guard.js) has already confirmed an active
   Supabase session whose profile row carries role === "trainer".
   ========================================================================== */

(function (window, document) {
  "use strict";

  /* ------------------------------------------------------------------------
     SCHEMA MAP
     `profiles` is the only table that exists today, so both course tables are
     declared null and their sections render honest empty states rather than
     inventing courses or trainees. Fill these in when the tables are created.
     ------------------------------------------------------------------------ */

  var SCHEMA = {
    courses: {
      table: "courses",
      idColumn: "id",
      titleColumn: "title",
      areaColumn: "status",
      trainerColumn: "created_by",
      statusColumn: "status",
      activeValue: "published"
    },
    enrollments: {
      table: "enrollments",
      userColumn: "trainee_profile_id",
      courseColumn: "course_id",
      statusColumn: "status",
      progressColumn: "progress_percent",
      completedValue: "completed"
    },
    profiles: {
      table: "profiles",
      idColumn: "id",
      nameColumn: "name",
      emailColumn: "email",
      employeeColumn: "employee_id",
      statusColumn: "status"
    }
  };

  var NOT_CONNECTED_TEXT =
    "Course tracking is not connected to the database yet, so there is nothing to show here.";

  /* ------------------------------------------------------------------------
     Profile
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
        '<div class="detail">' +
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
     Helpers
     ------------------------------------------------------------------------ */

  function isCourseActive(row) {
    var cfg = SCHEMA.courses;
    var status = String(row[cfg.statusColumn] || "").toLowerCase();
    if (!status) {
      return true; // No status column means nothing has been archived.
    }
    return status === String(cfg.activeValue).toLowerCase();
  }

  function isEnrollmentComplete(row) {
    var cfg = SCHEMA.enrollments;
    var status = String(row[cfg.statusColumn] || "").toLowerCase();
    if (status) {
      return status === String(cfg.completedValue).toLowerCase();
    }
    return Number(row[cfg.progressColumn]) >= 100;
  }

  function progressValue(row) {
    var raw = Number(row[SCHEMA.enrollments.progressColumn]);
    if (isNaN(raw)) {
      return isEnrollmentComplete(row) ? 100 : 0;
    }
    if (raw <= 1 && raw > 0) {
      raw = raw * 100;
    }
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  /* ------------------------------------------------------------------------
     Renderers
     ------------------------------------------------------------------------ */

  function renderCourses(rows) {
    var body = document.getElementById("courses-body");
    if (!body) {
      return;
    }

    if (!rows.length) {
      Dash.renderEmpty(
        body,
        "No courses assigned yet.",
        "Courses you are assigned to deliver will appear here."
      );
      return;
    }

    var cfg = SCHEMA.courses;
    var html =
      '<div class="table-scroll"><table class="data-table">' +
      "<thead><tr>" +
      '<th scope="col">Course</th>' +
      '<th scope="col">Learning area</th>' +
      '<th scope="col">Status</th>' +
      "</tr></thead><tbody>";

    var i;

    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      html +=
        "<tr>" +
        '<td class="cell-strong">' +
        Dash.escape(row[cfg.titleColumn] || "Untitled course") +
        "</td>" +
        "<td>" +
        (row[cfg.areaColumn]
          ? Dash.escape(row[cfg.areaColumn])
          : '<span class="cell-muted">—</span>') +
        "</td>" +
        "<td>" +
        (isCourseActive(row)
          ? '<span class="pill pill--active">Active</span>'
          : '<span class="pill pill--muted">Closed</span>') +
        "</td>" +
        "</tr>";
    }

    html += "</tbody></table></div>";
    body.innerHTML = html;
  }

  function renderTrainees(enrollments, profileMap, courseMap, restricted) {
    var body = document.getElementById("trainees-body");
    if (!body) {
      return;
    }

    if (!enrollments.length) {
      Dash.renderEmpty(
        body,
        "No trainees enrolled yet.",
        "Learners who enrol in your courses will be listed here."
      );
      return;
    }

    var enrolCfg = SCHEMA.enrollments;
    var profCfg = SCHEMA.profiles;
    var courseCfg = SCHEMA.courses;

    var html =
      '<div class="table-scroll"><table class="data-table">' +
      "<thead><tr>" +
      '<th scope="col">Trainee</th>' +
      '<th scope="col">Employee ID</th>' +
      '<th scope="col">Course</th>' +
      '<th scope="col">Progress</th>' +
      '<th scope="col">Status</th>' +
      "</tr></thead><tbody>";

    var i;

    for (i = 0; i < enrollments.length; i++) {
      var row = enrollments[i];
      var person = profileMap[row[enrolCfg.userColumn]];
      var course = courseMap[row[enrolCfg.courseColumn]];
      var pct = progressValue(row);
      var done = isEnrollmentComplete(row);

      var name = person && person[profCfg.nameColumn];
      var email = person && person[profCfg.emailColumn];
      var employee = person && person[profCfg.employeeColumn];

      html +=
        "<tr>" +
        '<td class="cell-strong">' +
        (name
          ? Dash.escape(name)
          : email
          ? Dash.escape(email)
          : '<span class="cell-muted">Name not visible</span>') +
        "</td>" +
        "<td>" +
        (employee
          ? Dash.escape(employee)
          : '<span class="cell-muted">—</span>') +
        "</td>" +
        "<td>" +
        (course && course[courseCfg.titleColumn]
          ? Dash.escape(course[courseCfg.titleColumn])
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

    if (restricted) {
      html +=
        '<div style="padding:16px clamp(14px,1.8vw,22px) 20px">' +
        '<p class="cell-muted" style="font-size:.875rem;margin:0">' +
        "Some trainee names are hidden because your database policies do not " +
        "grant trainers read access to other profile records." +
        "</p></div>";
    }

    body.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Not-connected path
     ------------------------------------------------------------------------ */

  function showNotConnected() {
    Dash.setStat("stat-courses", null);
    Dash.setStat("stat-trainees", null);
    Dash.setStat("stat-active", null);
    Dash.setStat("stat-completed", null);

    Dash.renderEmpty(
      document.getElementById("courses-body"),
      "No courses assigned yet.",
      NOT_CONNECTED_TEXT
    );
    Dash.renderEmpty(
      document.getElementById("trainees-body"),
      "No trainees enrolled yet.",
      NOT_CONNECTED_TEXT
    );

    Dash.renderNotice(
      document.getElementById("data-notice"),
      "Course data is not connected yet",
      "Your profile below is live from the database. Course and trainee figures " +
        "will populate automatically once those tables exist &mdash; point " +
        "<code>SCHEMA</code> in <code>trainer-dashboard/app.js</code> at the real " +
        "table and column names."
    );
  }

  /* ------------------------------------------------------------------------
     Loaders
     ------------------------------------------------------------------------ */

  function loadCourses(trainerId) {
    var cfg = SCHEMA.courses;
    var body = document.getElementById("courses-body");

    Dash.renderLoading(body, "Loading your courses…");

    return Dash.safeSelect(cfg.table, "*", function (q) {
      return q.eq(cfg.trainerColumn, trainerId);
    }).then(function (result) {
      if (result.missing) {
        Dash.setStat("stat-courses", null);
        Dash.setStat("stat-active", null);
        Dash.renderEmpty(body, "No courses assigned yet.", NOT_CONNECTED_TEXT);
        return [];
      }

      if (result.error) {
        Dash.setStat("stat-courses", null);
        Dash.setStat("stat-active", null);
        Dash.renderError(body, "We could not load your courses right now.", function () {
          loadCourses(trainerId);
        });
        return [];
      }

      var rows = result.rows;
      var active = 0;
      var i;

      for (i = 0; i < rows.length; i++) {
        if (isCourseActive(rows[i])) {
          active++;
        }
      }

      Dash.setStat("stat-courses", rows.length);
      Dash.setStat("stat-active", active);
      renderCourses(rows);

      return rows;
    });
  }

  function loadTrainees(courses) {
    var enrolCfg = SCHEMA.enrollments;
    var courseCfg = SCHEMA.courses;
    var profCfg = SCHEMA.profiles;
    var body = document.getElementById("trainees-body");

    if (!enrolCfg.table) {
      Dash.setStat("stat-trainees", null);
      Dash.setStat("stat-completed", null);
      Dash.renderEmpty(body, "No trainees enrolled yet.", NOT_CONNECTED_TEXT);
      return Promise.resolve();
    }

    var courseIds = [];
    var courseMap = {};
    var i;

    for (i = 0; i < courses.length; i++) {
      courseIds.push(courses[i][courseCfg.idColumn]);
      courseMap[courses[i][courseCfg.idColumn]] = courses[i];
    }

    if (!courseIds.length) {
      Dash.setStat("stat-trainees", 0);
      Dash.setStat("stat-completed", 0);
      Dash.renderEmpty(
        body,
        "No trainees enrolled yet.",
        "Once you are assigned a course, its learners will appear here."
      );
      return Promise.resolve();
    }

    Dash.renderLoading(body, "Loading your trainees…");

    return Dash.safeSelect(enrolCfg.table, "*", function (q) {
      return q.in(enrolCfg.courseColumn, courseIds);
    }).then(function (result) {
      if (result.missing) {
        Dash.setStat("stat-trainees", null);
        Dash.setStat("stat-completed", null);
        Dash.renderEmpty(body, "No trainees enrolled yet.", NOT_CONNECTED_TEXT);
        return;
      }

      if (result.error) {
        Dash.setStat("stat-trainees", null);
        Dash.setStat("stat-completed", null);
        Dash.renderError(body, "We could not load your trainees right now.", function () {
          loadTrainees(courses);
        });
        return;
      }

      var enrollments = result.rows;
      var userIds = [];
      var seen = {};
      var completed = 0;
      var j;

      for (j = 0; j < enrollments.length; j++) {
        var uid = enrollments[j][enrolCfg.userColumn];
        if (uid && !seen[uid]) {
          seen[uid] = true;
          userIds.push(uid);
        }
        if (isEnrollmentComplete(enrollments[j])) {
          completed++;
        }
      }

      Dash.setStat("stat-trainees", userIds.length);
      Dash.setStat("stat-completed", completed);

      if (!userIds.length) {
        renderTrainees(enrollments, {}, courseMap, false);
        return;
      }

      // Names come from `profiles`. If RLS only permits own-row reads this
      // returns nothing — that is a policy outcome, not an error, so the table
      // still renders with names marked as not visible.
      return Dash.safeSelect(profCfg.table, "*", function (q) {
        return q.in(profCfg.idColumn, userIds);
      }).then(function (profileResult) {
        var profileMap = {};
        var k;

        for (k = 0; k < profileResult.rows.length; k++) {
          profileMap[profileResult.rows[k][profCfg.idColumn]] =
            profileResult.rows[k];
        }

        var restricted = profileResult.rows.length < userIds.length;
        renderTrainees(enrollments, profileMap, courseMap, restricted);
      });
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  Dash.init({
    role: "trainer",
    onReady: function (ctx) {
      renderProfile(ctx);

      if (!SCHEMA.courses.table) {
        showNotConnected();
        return;
      }

      loadCourses(ctx.user.id).then(
        function (courses) {
          loadTrainees(courses || []);
        },
        function () {
          // Dash.init can only try/catch the synchronous part of onReady, so an
          // async failure here would otherwise strand the trainee panel on its
          // loading spinner forever.
          Dash.setStat("stat-trainees", null);
          Dash.setStat("stat-completed", null);
          Dash.renderError(
            document.getElementById("trainees-body"),
            "We could not load your trainees right now."
          );
        }
      );
    }
  });
})(window, document);
