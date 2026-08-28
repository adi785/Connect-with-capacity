/* ==========================================================================
   CAPACITY CONNECT — Admin dashboard
   Guard (../shared/dashboard-guard.js) has already confirmed an active
   Supabase session whose profile row carries role === "admin".

   Important: an admin sees only what Row Level Security permits. This page
   never claims a platform-wide total it could not actually read — if the
   policies restrict reads, that is stated plainly rather than papered over.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var SCHEMA = {
    profiles: {
      table: "profiles",
      idColumn: "id",
      roleColumn: "role",
      nameColumn: "name",
      emailColumn: "email",
      employeeColumn: "employee_id",
      statusColumn: "status",
      activeValue: "approved"
    },
    courses: {
      table: "courses",
      idColumn: "id"
    },
    enrollments: {
      table: "enrollments",
      statusColumn: "status",
      completedValue: "completed"
    }
  };

  var POLICY_HINT =
    "These figures reflect only the rows your database policies let this account read. " +
    "If they look lower than expected, apply the admin read policy in " +
    "<code>supabase-policies.sql</code> at the project root.";

  /* ------------------------------------------------------------------------
     Shared bits
     ------------------------------------------------------------------------ */

  function statusPill(status) {
    var value = String(status || "").toLowerCase();
    if (value === "active" || value === "approved") {
      return '<span class="pill pill--active">Approved</span>';
    }
    if (value === "pending") {
      return '<span class="pill pill--orange">Pending Review</span>';
    }
    if (value === "rejected" || value === "suspended") {
      return '<span class="pill pill--muted">' + Dash.escape(Dash.titleCase(value)) + "</span>";
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
     User tables
     ------------------------------------------------------------------------ */

  function renderUserTable(target, rows, roleLabel) {
    if (!target) {
      return;
    }

    if (!rows.length) {
      Dash.renderEmpty(
        target,
        "No " + roleLabel + " accounts to show.",
        roleLabel === "trainer"
          ? "Trainer accounts are created from registration. Once registered and reviewed, they will be listed here."
          : "Trainee accounts appear here once people register."
      );
      return;
    }

    var cfg = SCHEMA.profiles;
    var html =
      '<div class="table-scroll"><table class="data-table">' +
      "<thead><tr>" +
      '<th scope="col">Name</th>' +
      '<th scope="col">Email</th>' +
      '<th scope="col">Employee ID</th>' +
      '<th scope="col">Status</th>' +
      "</tr></thead><tbody>";

    var i;

    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      html +=
        "<tr>" +
        '<td class="cell-strong">' +
        (row[cfg.nameColumn]
          ? Dash.escape(row[cfg.nameColumn])
          : '<span class="cell-muted">Not provided</span>') +
        "</td>" +
        "<td>" +
        (row[cfg.emailColumn]
          ? Dash.escape(row[cfg.emailColumn])
          : '<span class="cell-muted">—</span>') +
        "</td>" +
        "<td>" +
        (row[cfg.employeeColumn]
          ? Dash.escape(row[cfg.employeeColumn])
          : '<span class="cell-muted">—</span>') +
        "</td>" +
        "<td>" +
        statusPill(row[cfg.statusColumn]) +
        "</td>" +
        "</tr>";
    }

    html += "</tbody></table></div>";
    target.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Approvals workflow
     ------------------------------------------------------------------------ */

  function renderApprovalsTable(target, requests, currentUserId) {
    if (!target) return;

    if (!requests.length) {
      Dash.renderEmpty(
        target,
        "No pending trainer applications",
        "All trainer applications have been reviewed. New trainer registrations requiring approval will appear here."
      );
      return;
    }

    var html =
      '<div class="table-scroll"><table class="data-table">' +
      "<thead><tr>" +
      '<th scope="col">Applicant Name</th>' +
      '<th scope="col">Email</th>' +
      '<th scope="col">Employee ID</th>' +
      '<th scope="col">Requested Role</th>' +
      '<th scope="col">Status</th>' +
      '<th scope="col">Actions</th>' +
      "</tr></thead><tbody>";

    for (var i = 0; i < requests.length; i++) {
      var req = requests[i];

      html +=
        '<tr id="row-appr-' + Dash.escape(req.user_id) + '">' +

        '<td class="cell-strong">' +
        (req.name
          ? Dash.escape(req.name)
          : '<span class="cell-muted">Applicant</span>') +
        "</td>" +

        "<td>" +
        (req.email
          ? Dash.escape(req.email)
          : '<span class="cell-muted">—</span>') +
        "</td>" +

        "<td>" +
        (req.employee_id
          ? Dash.escape(req.employee_id)
          : '<span class="cell-muted">—</span>') +
        "</td>" +

        "<td>" +
        '<span class="role-badge role-badge--trainer">Trainer</span>' +
        "</td>" +

        "<td>" +
        statusPill("pending") +
        "</td>" +

        "<td>" +
        '<div class="action-cell">' +

        '<button class="btn btn--sm btn--approve" ' +
        'type="button" ' +
        'data-action="approve" ' +
        'data-user-id="' + Dash.escape(req.user_id) + '">' +
        '✓ Approve' +
        "</button>" +

        '<button class="btn btn--sm btn--reject" ' +
        'type="button" ' +
        'data-action="reject" ' +
        'data-user-id="' + Dash.escape(req.user_id) + '">' +
        '✕ Reject' +
        "</button>" +

        "</div>" +
        "</td>" +

        "</tr>";
    }

    html += "</tbody></table></div>";
    target.innerHTML = html;

    target.querySelectorAll("button[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = this.getAttribute("data-action");
        var userId = this.getAttribute("data-user-id");

        decideApproval(
          userId,
          action,
          currentUserId,
          this
        );
      });
    });
  }
  async function decideApproval(
    userId,
    decision,
    currentUserId,
    buttonEl
  ) {
    if (!userId) {
      alert("Invalid trainer account.");
      return;
    }

    if (
      decision !== "approve" &&
      decision !== "reject"
    ) {
      return;
    }

    var actionText =
      decision === "approve"
        ? "Approving..."
        : "Rejecting...";

    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = actionText;
    }

    var newStatus =
      decision === "approve"
        ? "approved"
        : "rejected";

    var client = window.supabaseClient;

    if (!client) {
      alert("Supabase is not configured.");

      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent =
          decision === "approve"
            ? "✓ Approve"
            : "✕ Reject";
      }

      return;
    }

    try {

      /*
       * 1. Update trainer profile status.
       */
      var profileUpdate =
        await client
          .from("profiles")
          .update({
            status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq("id", userId)
          .eq("role", "trainer");

      if (profileUpdate.error) {
        throw profileUpdate.error;
      }

      /*
       * 2. Update approval request.
       */
      var approvalUpdate =
        await client
          .from("approval_requests")
          .update({
            status: newStatus,
            reviewed_at: new Date().toISOString(),
            reviewed_by: currentUserId
          })
          .eq("user_id", userId)
          .eq("requested_role", "trainer")
          .eq("status", "pending");

      if (approvalUpdate.error) {
        throw approvalUpdate.error;
      }

      /*
       * 3. Make sure approved trainer has
       *    a trainer_profiles record.
       */
      if (decision === "approve") {

        var trainerProfile =
          await client
            .from("trainer_profiles")
            .upsert(
              {
                user_id: userId,
                designation: "Trainer"
              },
              {
                onConflict: "user_id"
              }
            );

        if (trainerProfile.error) {
          throw trainerProfile.error;
        }
      }

      /*
       * 4. Refresh dashboard.
       */
      await Promise.all([
        loadApprovals(currentUserId),
        loadUsers(currentUserId)
      ]);

      alert(
        decision === "approve"
          ? "Trainer approved successfully."
          : "Trainer application rejected."
      );

    } catch (error) {

      console.error(
        "Trainer approval failed:",
        error
      );

      alert(
        "Failed to update trainer status: " +
        (error.message || error)
      );

      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent =
          decision === "approve"
            ? "✓ Approve"
            : "✕ Reject";
      }
    }
  }

  function loadApprovals(currentUserId) {
    var panel = document.getElementById("panel-approvals");
    var navCount = document.getElementById("nav-approval-count");

    if (!panel) return Promise.resolve();

    Dash.renderLoading(
      panel,
      "Loading pending trainer applications…"
    );

    return Promise.all([
      Dash.safeSelect("profiles", "*"),
      Dash.safeSelect("approval_requests", "*")
    ])
      .then(function (results) {

        var profilesResult = results[0];
        var approvalsResult = results[1];

        var profileMap = {};
        var pendingTrainers = {};

        /*
         * Build a profile lookup.
         */
        if (profilesResult && profilesResult.rows) {

          profilesResult.rows.forEach(function (profile) {

            profileMap[profile.id] = profile;

            /*
             * ONLY TRAINERS with pending status
             * belong in the approval queue.
             */
            if (
              String(profile.role || "").toLowerCase() === "trainer" &&
              String(profile.status || "").toLowerCase() === "pending"
            ) {
              pendingTrainers[profile.id] = {
                user_id: profile.id,
                name: profile.name || "",
                email: profile.email || "",
                employee_id: profile.employee_id || "",
                role: "trainer",
                status: "pending"
              };
            }
          });
        }

        /*
         * Check approval_requests as the authoritative
         * approval queue.
         */
        if (approvalsResult && approvalsResult.rows) {

          approvalsResult.rows.forEach(function (request) {

            if (
              String(request.status || "").toLowerCase() !== "pending"
            ) {
              return;
            }

            /*
             * Only trainer requests.
             */
            if (
              String(request.requested_role || "").toLowerCase() !==
              "trainer"
            ) {
              return;
            }

            var profile = profileMap[request.user_id];

            /*
             * If the profile exists, make sure it is also
             * a trainer and still pending.
             */
            if (profile) {

              if (
                String(profile.role || "").toLowerCase() !==
                "trainer"
              ) {
                return;
              }

              if (
                String(profile.status || "").toLowerCase() !==
                "pending"
              ) {
                return;
              }

              pendingTrainers[request.user_id] = {
                user_id: request.user_id,
                name: profile.name || "",
                email: profile.email || "",
                employee_id: profile.employee_id || "",
                role: "trainer",
                status: "pending"
              };

            } else {

              /*
               * Fallback if approval request exists but
               * profile cannot currently be read.
               */
              pendingTrainers[request.user_id] = {
                user_id: request.user_id,
                name: request.user_name || "Applicant",
                email: request.user_email || "",
                employee_id: request.employee_id || "",
                role: "trainer",
                status: "pending"
              };
            }
          });
        }

        var requests = Object.keys(pendingTrainers).map(
          function (id) {
            return pendingTrainers[id];
          }
        );

        /*
         * Update counters.
         */
        Dash.setStat(
          "stat-approvals",
          requests.length
        );

        if (navCount) {
          navCount.textContent = requests.length;
          navCount.hidden = requests.length === 0;
        }

        /*
         * Render only pending trainers.
         */
        renderApprovalsTable(
          panel,
          requests,
          currentUserId
        );

      })
      .catch(function (err) {

        console.error(
          "Approval loading error:",
          err
        );

        Dash.setStat(
          "stat-approvals",
          0
        );

        Dash.renderError(
          panel,
          "Could not load trainer approval requests.",
          function () {
            loadApprovals(currentUserId);
          }
        );
      });
  }

  function wireSubtabs() {
    var pairs = [
      { tab: "tab-trainees", panel: "panel-trainees" },
      { tab: "tab-trainers", panel: "panel-trainers" }
    ];

    function select(activeIndex) {
      var i;
      for (i = 0; i < pairs.length; i++) {
        var tab = document.getElementById(pairs[i].tab);
        var panel = document.getElementById(pairs[i].panel);
        var isActive = i === activeIndex;

        if (tab) {
          tab.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        if (panel) {
          panel.hidden = !isActive;
        }
      }
    }

    var j;

    for (j = 0; j < pairs.length; j++) {
      (function (index) {
        var tab = document.getElementById(pairs[index].tab);
        if (tab) {
          tab.addEventListener("click", function () {
            select(index);
          });
        }
      })(j);
    }

    select(0);
  }

  /* ------------------------------------------------------------------------
     Loaders
     ------------------------------------------------------------------------ */

  function loadUsers(currentUserId) {
    var cfg = SCHEMA.profiles;
    var traineePanel = document.getElementById("panel-trainees");
    var trainerPanel = document.getElementById("panel-trainers");

    Dash.renderLoading(traineePanel, "Loading accounts…");

    return Dash.safeSelect(cfg.table, "*").then(function (result) {
      if (result.error) {
        Dash.setStat("stat-trainees", null);
        Dash.setStat("stat-trainers", null);
        Dash.setStat("stat-active", null);
        Dash.renderError(traineePanel, "We could not load user accounts right now.", function () {
          loadUsers(currentUserId);
        });
        Dash.renderError(trainerPanel, "We could not load user accounts right now.");
        return;
      }

      var rows = result.rows;
      var trainees = [];
      var trainers = [];
      var active = 0;
      var i;

      for (i = 0; i < rows.length; i++) {
        var row = rows[i];
        var role = String(row[cfg.roleColumn] || "").toLowerCase();

        if (role === "trainee") {
          trainees.push(row);
        } else if (role === "trainer") {
          trainers.push(row);
        }

        if (
          String(row[cfg.statusColumn] || "").toLowerCase() ===
          String(cfg.activeValue).toLowerCase()
        ) {
          active++;
        }
      }

      Dash.setStat("stat-trainees", trainees.length);
      Dash.setStat("stat-trainers", trainers.length);
      Dash.setStat("stat-active", active);

      renderUserTable(traineePanel, trainees, "trainee");
      renderUserTable(trainerPanel, trainers, "trainer");

      var onlySelf =
        rows.length === 0 ||
        (rows.length === 1 && rows[0][cfg.idColumn] === currentUserId);

      var noticeEl = document.getElementById("data-notice");
      if (onlySelf) {
        Dash.renderNotice(
          noticeEl,
          "Account data is limited by your database policies",
          POLICY_HINT
        );
      } else if (noticeEl) {
        noticeEl.hidden = true;
        noticeEl.innerHTML = "";
      }
    });
  }

  function loadCourseStats() {
    if (!SCHEMA.courses.table) {
      Dash.setStat("stat-courses", null);
    } else {
      Dash.safeSelect(SCHEMA.courses.table, "*").then(function (result) {
        Dash.setStat(
          "stat-courses",
          result.missing || result.error ? null : result.rows.length
        );
      });
    }

    if (!SCHEMA.enrollments.table) {
      Dash.setStat("stat-completed", null);
      return;
    }

    var cfg = SCHEMA.enrollments;

    Dash.safeSelect(cfg.table, "*").then(function (result) {
      if (result.missing || result.error) {
        Dash.setStat("stat-completed", null);
        return;
      }

      var completed = 0;
      var i;

      for (i = 0; i < result.rows.length; i++) {
        var status = String(result.rows[i][cfg.statusColumn] || "").toLowerCase();
        if (status === String(cfg.completedValue).toLowerCase()) {
          completed++;
        }
      }

      Dash.setStat("stat-completed", completed);
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  Dash.init({
    role: "admin",
    onReady: function (ctx) {
      wireSubtabs();
      renderProfile(ctx);
      loadApprovals(ctx.user.id);
      loadUsers(ctx.user.id);
      loadCourseStats();

      var refreshBtn = document.getElementById("btn-refresh-approvals");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", function () {
          loadApprovals(ctx.user.id);
          loadUsers(ctx.user.id);
        });
      }
    }
  });
})(window, document);
