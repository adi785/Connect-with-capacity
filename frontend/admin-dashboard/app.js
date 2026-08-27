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
        "No pending approval requests",
        "All trainer and user registrations have been reviewed. New applications requiring approval will appear here."
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
      var roleBadgeClass = req.role === "trainer" ? "role-badge--trainer" : "";
      var reqId = req.id;

      html +=
        '<tr id="row-appr-' + Dash.escape(reqId) + '">' +
        '<td class="cell-strong">' +
        (req.name ? Dash.escape(req.name) : '<span class="cell-muted">Applicant</span>') +
        "</td>" +
        "<td>" + (req.email ? Dash.escape(req.email) : '<span class="cell-muted">—</span>') + "</td>" +
        "<td>" + (req.employee_id ? Dash.escape(req.employee_id) : '<span class="cell-muted">—</span>') + "</td>" +
        "<td>" +
        '<span class="role-badge ' + roleBadgeClass + '">' + Dash.escape(Dash.titleCase(req.role || "trainer")) + "</span>" +
        "</td>" +
        "<td>" + statusPill(req.status || "pending") + "</td>" +
        "<td>" +
        '<div class="action-cell">' +
        '<button class="btn btn--sm btn--approve" type="button" data-action="approve" data-user-id="' + Dash.escape(reqId) + '">✓ Approve</button>' +
        '<button class="btn btn--sm btn--reject" type="button" data-action="reject" data-user-id="' + Dash.escape(reqId) + '">✕ Reject</button>' +
        "</div>" +
        "</td>" +
        "</tr>";
    }

    html += "</tbody></table></div>";
    target.innerHTML = html;

    // Attach click listeners to approve / reject buttons
    target.querySelectorAll("button[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = this.getAttribute("data-action");
        var userId = this.getAttribute("data-user-id");
        decideApproval(userId, action, currentUserId, this);
      });
    });
  }

  async function decideApproval(userId, decision, currentUserId, buttonEl) {
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = decision === "approve" ? "Approving..." : "Rejecting...";
    }

    var newStatus = decision === "approve" ? "approved" : "rejected";
    var client = window.supabaseClient;

    try {
      if (client) {
        // 1. Update public.profiles
        await client.from("profiles").update({
          status: newStatus,
          updated_at: new Date().toISOString()
        }).eq("id", userId);

        // 2. Update public.approval_requests
        await client.from("approval_requests").update({
          status: newStatus,
          reviewed_at: new Date().toISOString(),
          reviewed_by: currentUserId
        }).eq("user_id", userId);

        // 3. If approved trainer, ensure trainer_profiles exists
        if (decision === "approve") {
          await client.from("trainer_profiles").upsert({
            user_id: userId,
            designation: "Trainer"
          }, { onConflict: "user_id" });
        }
      }

      // Also call backend API if reachable
      try {
        if (window.API_BASE) {
          fetch(window.API_BASE + "/admin/approvals/" + userId + "/decision", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: newStatus })
          }).catch(function () {});
        }
      } catch (e) {}

      // Refresh approvals list and users list
      await Promise.all([
        loadApprovals(currentUserId),
        loadUsers(currentUserId)
      ]);

    } catch (err) {
      console.error("Decision error:", err);
      alert("Failed to update status: " + (err.message || err));
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = decision === "approve" ? "✓ Approve" : "✕ Reject";
      }
    }
  }

  function loadApprovals(currentUserId) {
    var panel = document.getElementById("panel-approvals");
    var navCount = document.getElementById("nav-approval-count");
    if (!panel) return Promise.resolve();

    Dash.renderLoading(panel, "Loading pending approval requests…");

    return Promise.all([
      Dash.safeSelect("profiles", "*"),
      Dash.safeSelect("approval_requests", "*")
    ]).then(function (results) {
      var profilesResult = results[0];
      var approvalsResult = results[1];

      var pendingProfiles = [];
      var profileMap = {};

      if (profilesResult && profilesResult.rows) {
        profilesResult.rows.forEach(function (p) {
          profileMap[p.id] = p;
          if (String(p.status || "").toLowerCase() === "pending") {
            pendingProfiles.push(p);
          }
        });
      }

      // Also check approval_requests table for pending records
      if (approvalsResult && approvalsResult.rows) {
        approvalsResult.rows.forEach(function (req) {
          if (String(req.status || "").toLowerCase() === "pending") {
            var matchingProfile = profileMap[req.user_id] || {
              id: req.user_id,
              name: req.user_name || "Applicant",
              email: req.user_email || "—",
              employee_id: req.employee_id || "—",
              role: req.requested_role || "trainer",
              status: "pending"
            };
            if (!pendingProfiles.some(function (p) { return p.id === req.user_id; })) {
              pendingProfiles.push(matchingProfile);
            }
          }
        });
      }

      Dash.setStat("stat-approvals", pendingProfiles.length);
      if (navCount) {
        navCount.textContent = pendingProfiles.length;
        navCount.hidden = pendingProfiles.length === 0;
      }

      renderApprovalsTable(panel, pendingProfiles, currentUserId);
    }).catch(function (err) {
      Dash.setStat("stat-approvals", 0);
      Dash.renderError(panel, "Could not load approval requests.", function () {
        loadApprovals(currentUserId);
      });
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
