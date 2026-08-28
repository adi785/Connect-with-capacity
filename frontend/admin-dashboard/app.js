/* ==========================================================================
   CAPACITY CONNECT — Admin Workspace Controller
   Authoritative implementation supporting:
   - Platform Overview & Dashboard Metrics
   - Pending Trainer & Account Approvals
   - User Management (Trainees / Trainers / Admins, Search, Status Toggles)
   - Platform Course Management (View All, Filter, Publish, Unpublish, Archive, Delete)
   - News & Platform Announcements (Create, Draft, Edit, Preview, Publish, Unpublish, Delete)
   - Subject & Competency Taxonomy Management
   - Admin Profile
   ========================================================================== */

(function (window, document) {
  "use strict";

  var API = window.CapacityConnectAPI || window.API;

  var state = {
    user: null,
    stats: null,
    approvals: [],
    users: [],
    courses: [],
    subjects: [],
    announcements: [],
    activeTab: "trainees",
    pendingConfirmAction: null
  };

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay || 200);
    };
  }

  /* ------------------------------------------------------------------------
     UI Helpers & Notifications
     ------------------------------------------------------------------------ */

  function showToast(message, type, title) {
    type = type || "info";
    var container = document.getElementById("toast-container");
    if (!container) return;

    var toast = document.createElement("div");
    toast.className = "toast toast--" + type;
    toast.setAttribute("role", "alert");

    var iconSvg = "";
    if (type === "success") {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
    } else if (type === "error") {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    } else {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="8"/></svg>';
    }

    var html = '<span class="toast__icon" aria-hidden="true">' + iconSvg + "</span>";
    html += '<div class="toast__content">';
    if (title) html += '<div class="toast__title">' + Dash.escape(title) + "</div>";
    html += '<div class="toast__msg">' + Dash.escape(message) + "</div>";
    html += "</div>";
    html += '<button class="toast__close" type="button" aria-label="Dismiss">✕</button>';

    toast.innerHTML = html;
    container.appendChild(toast);

    var closeBtn = toast.querySelector(".toast__close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      });
    }

    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4500);
  }

  function openModal(modalId) {
    var m = document.getElementById(modalId);
    if (m) {
      m.classList.add("is-open");
      m.setAttribute("aria-hidden", "false");
    }
  }

  function closeModal(modalId) {
    var m = document.getElementById(modalId);
    if (m) {
      m.classList.remove("is-open");
      m.setAttribute("aria-hidden", "true");
    }
  }

  function confirmAction(message, onConfirm, title) {
    var modal = document.getElementById("modal-confirm");
    var msgEl = document.getElementById("modal-confirm-message");
    var titleEl = document.getElementById("modal-confirm-title");
    if (titleEl) titleEl.textContent = title || "Confirm Action";
    if (msgEl) msgEl.textContent = message;

    state.pendingConfirmAction = onConfirm;
    openModal("modal-confirm");
  }

  function statusPill(status) {
    var s = String(status || "").toLowerCase();
    if (s === "approved" || s === "active" || s === "published") {
      return '<span class="pill pill--active">' + Dash.escape(Dash.titleCase(s)) + '</span>';
    }
    if (s === "pending" || s === "draft" || s === "in_progress") {
      return '<span class="pill pill--orange">' + Dash.escape(Dash.titleCase(s)) + '</span>';
    }
    if (s === "archived" || s === "completed") {
      return '<span class="pill pill--muted">' + Dash.escape(Dash.titleCase(s)) + '</span>';
    }
    if (s === "rejected" || s === "suspended" || s === "dropped") {
      return '<span class="pill pill--reject">' + Dash.escape(Dash.titleCase(s)) + '</span>';
    }
    return '<span class="pill pill--muted">' + Dash.escape(Dash.titleCase(s || "Unknown")) + '</span>';
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

    var validSections = [
      "#overview",
      "#approvals",
      "#user-management",
      "#course-management",
      "#announcements-management",
      "#taxonomy-management",
      "#profile"
    ];

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

  // 1. Dashboard Metrics
  async function loadDashboardMetrics() {
    try {
      var d = await API.get("admin/dashboard");
      state.stats = d;

      Dash.setStat("stat-approvals", d.pending_approvals || 0);
      Dash.setStat("stat-trainees", d.total_trainees || 0);
      Dash.setStat("stat-trainers", d.total_trainers || 0);
      Dash.setStat("stat-courses", d.total_courses || 0);
      Dash.setStat("stat-active", d.active_users || 0);
      Dash.setStat("stat-completed", d.completed_enrollments || 0);

      var navCount = document.getElementById("nav-approval-count");
      if (navCount) {
        navCount.textContent = d.pending_approvals || 0;
        navCount.hidden = !d.pending_approvals;
      }
    } catch (err) {
      console.warn("Failed to load admin dashboard metrics:", err);
    }
  }

  // 2. Approvals
  async function loadApprovals() {
    var panel = document.getElementById("panel-approvals");
    if (!panel) return;

    Dash.renderSkeletonTable(panel, 3, 5);

    try {
      var data = await API.get("admin/approvals?status=pending");
      var items = (data && data.items) || (Array.isArray(data) ? data : []);
      state.approvals = items;

      var navCount = document.getElementById("nav-approval-count");
      if (navCount) {
        navCount.textContent = items.length;
        navCount.hidden = items.length === 0;
      }
      Dash.setStat("stat-approvals", items.length);

      renderApprovalsTable();
    } catch (err) {
      console.error("Failed to load approvals:", err);
      Dash.renderError(panel, "Could not load approvals: " + (err.message || "Network error"), function () {
        loadApprovals();
      });
    }
  }

  // 3. Users
  async function loadUsers() {
    var traineePanel = document.getElementById("panel-trainees");
    var trainerPanel = document.getElementById("panel-trainers");
    if (traineePanel) Dash.renderSkeletonTable(traineePanel, 4, 6);
    if (trainerPanel) Dash.renderSkeletonTable(trainerPanel, 4, 6);

    try {
      var data = await API.get("admin/users?limit=200");
      var users = (data && data.items) || (Array.isArray(data) ? data : []);
      state.users = users;
      renderUsersTables();
    } catch (err) {
      console.error("Failed to load users:", err);
      if (traineePanel) {
        Dash.renderError(traineePanel, "Could not load users: " + (err.message || "Network error"), function () {
          loadUsers();
        });
      }
    }
  }

  // 4. Subjects / Taxonomy
  async function loadSubjects() {
    var panel = document.getElementById("panel-taxonomy");
    if (panel) Dash.renderSkeletonTable(panel, 3, 4);

    try {
      var subs = await API.get("subjects");
      state.subjects = Array.isArray(subs) ? subs : [];

      // Populate subject filter dropdown in Course Management
      var filterSub = document.getElementById("admin-courses-subject-filter");
      if (filterSub) {
        var opts = '<option value="">All Subjects</option>';
        state.subjects.forEach(function (s) {
          opts += '<option value="' + Dash.escape(s.id) + '">' + Dash.escape(s.name) + '</option>';
        });
        filterSub.innerHTML = opts;
      }

      renderTaxonomyTable();
    } catch (err) {
      console.error("Failed to load subjects:", err);
      if (panel) {
        Dash.renderError(panel, "Could not load subjects: " + (err.message || "Network error"), function () {
          loadSubjects();
        });
      }
    }
  }

  // 5. Courses
  async function loadCourses() {
    var panel = document.getElementById("panel-courses");
    if (panel) Dash.renderSkeletonTable(panel, 4, 6);

    try {
      var data = await API.get("courses?limit=200");
      var courses = (data && data.items) || (Array.isArray(data) ? data : []);
      state.courses = courses;
      renderCoursesTable();
    } catch (err) {
      console.error("Failed to load courses:", err);
      if (panel) {
        Dash.renderError(panel, "Could not load platform courses: " + (err.message || "Network error"), function () {
          loadCourses();
        });
      }
    }
  }

  // 6. News & Announcements
  async function loadAnnouncements() {
    var panel = document.getElementById("panel-announcements");
    if (panel) Dash.renderSkeletonTable(panel, 3, 5);

    try {
      var data = await API.get("notifications/admin?limit=100");
      var items = (data && data.items) || (Array.isArray(data) ? data : []);
      state.announcements = items;
      renderAnnouncementsTable();
    } catch (err) {
      console.error("Failed to load announcements:", err);
      if (panel) {
        Dash.renderError(panel, "Could not load announcements: " + (err.message || "Network error"), function () {
          loadAnnouncements();
        });
      }
    }
  }

  /* ------------------------------------------------------------------------
     Renderers
     ------------------------------------------------------------------------ */

  // 1. Approvals Table
  function renderApprovalsTable() {
    var panel = document.getElementById("panel-approvals");
    if (!panel) return;

    if (!state.approvals.length) {
      Dash.renderEmpty(
        panel,
        "No Pending Account Approvals",
        "All trainer applications and account requests have been reviewed."
      );
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Applicant Name</th>';
    html += '<th scope="col">Email Address</th>';
    html += '<th scope="col">Employee ID</th>';
    html += '<th scope="col">Requested Role</th>';
    html += '<th scope="col">Status</th>';
    html += '<th scope="col" style="text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    state.approvals.forEach(function (appr) {
      var displayName = appr.user_name || appr.name || "Applicant";
      var displayEmail = appr.user_email || appr.email || "—";
      var reqId = appr.id || appr.user_id;

      html += '<tr>';
      html += '  <td class="cell-strong">' + Dash.escape(displayName) + '</td>';
      html += '  <td>' + Dash.escape(displayEmail) + '</td>';
      html += '  <td>' + Dash.escape(appr.employee_id || "—") + '</td>';
      html += '  <td><span class="role-badge role-badge--trainer">' + Dash.escape(Dash.titleCase(appr.requested_role || "trainer")) + '</span></td>';
      html += '  <td>' + statusPill(appr.status) + '</td>';
      html += '  <td style="text-align:right;">';
      html += '    <div style="display:inline-flex; gap:6px;">';
      html += '      <button class="btn btn--sm btn--approve btn-approval-action" type="button" data-appr-id="' + Dash.escape(reqId) + '" data-user-id="' + Dash.escape(appr.user_id) + '" data-decision="approved">✓ Approve</button>';
      html += '      <button class="btn btn--sm btn--reject btn-approval-action" type="button" data-appr-id="' + Dash.escape(reqId) + '" data-user-id="' + Dash.escape(appr.user_id) + '" data-decision="rejected">✕ Reject</button>';
      html += '    </div>';
      html += '  </td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    panel.innerHTML = html;
  }

  // 2. Users Tables
  function renderUsersTables() {
    var traineePanel = document.getElementById("panel-trainees");
    var trainerPanel = document.getElementById("panel-trainers");

    var trainees = state.users.filter(function (u) { return u.role === "trainee"; });
    var trainers = state.users.filter(function (u) { return u.role === "trainer"; });

    function buildUserTable(userList, roleLabel) {
      if (!userList.length) {
        return '<div style="padding: 24px; text-align:center; color:var(--text-muted);">No ' + roleLabel + ' accounts registered yet.</div>';
      }

      var h = '<div class="table-scroll"><table class="data-table">';
      h += '<thead><tr>';
      h += '<th scope="col">Full Name</th>';
      h += '<th scope="col">Email Address</th>';
      h += '<th scope="col">Employee ID</th>';
      h += '<th scope="col">Account Status</th>';
      h += '<th scope="col">Joined</th>';
      h += '<th scope="col" style="text-align:right;">Manage Status</th>';
      h += '</tr></thead><tbody>';

      userList.forEach(function (u) {
        var isApproved = u.status === "approved" || u.status === "active";
        var isSuspended = u.status === "suspended";

        h += '<tr>';
        h += '  <td class="cell-strong">' + Dash.escape(u.name || "—") + '</td>';
        h += '  <td>' + Dash.escape(u.email || "—") + '</td>';
        h += '  <td>' + Dash.escape(u.employee_id || "—") + '</td>';
        h += '  <td>' + statusPill(u.status) + '</td>';
        h += '  <td>' + Dash.escape(formatDateTime(u.created_at)) + '</td>';
        h += '  <td style="text-align:right;">';
        h += '    <div style="display:inline-flex; gap:6px;">';
        if (!isApproved) {
          h += '      <button class="btn btn--sm btn--approve btn-user-status" type="button" data-user-id="' + Dash.escape(u.id) + '" data-status="approved" title="Approve Account">Approve</button>';
        }
        if (!isSuspended) {
          h += '      <button class="btn btn--sm btn--reject btn-user-status" type="button" data-user-id="' + Dash.escape(u.id) + '" data-status="suspended" title="Suspend Account">Suspend</button>';
        } else {
          h += '      <button class="btn btn--sm btn--approve btn-user-status" type="button" data-user-id="' + Dash.escape(u.id) + '" data-status="approved" title="Reactivate Account">Reactivate</button>';
        }
        h += '    </div>';
        h += '  </td>';
        h += '</tr>';
      });

      h += '</tbody></table></div>';
      return h;
    }

    if (traineePanel) traineePanel.innerHTML = buildUserTable(trainees, "trainee");
    if (trainerPanel) trainerPanel.innerHTML = buildUserTable(trainers, "trainer");
  }

  // 3. Courses Table
  function renderCoursesTable() {
    var panel = document.getElementById("panel-courses");
    if (!panel) return;

    var searchVal = (document.getElementById("admin-courses-search") ? document.getElementById("admin-courses-search").value : "").toLowerCase().trim();
    var statusVal = document.getElementById("admin-courses-status-filter") ? document.getElementById("admin-courses-status-filter").value : "";
    var subjectVal = document.getElementById("admin-courses-subject-filter") ? document.getElementById("admin-courses-subject-filter").value : "";

    var filtered = state.courses.filter(function (c) {
      if (statusVal && c.status !== statusVal) return false;
      if (subjectVal && c.subject_id !== subjectVal) return false;
      if (searchVal) {
        var matchTitle = (c.title || "").toLowerCase().indexOf(searchVal) !== -1;
        var matchTrainer = (c.trainer_name || "").toLowerCase().indexOf(searchVal) !== -1;
        var matchSub = (c.subject_name || "").toLowerCase().indexOf(searchVal) !== -1;
        if (!matchTitle && !matchTrainer && !matchSub) return false;
      }
      return true;
    });

    if (!filtered.length) {
      Dash.renderEmpty(
        panel,
        "No courses found",
        "No platform courses match your current filter criteria."
      );
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Course Title</th>';
    html += '<th scope="col">Subject</th>';
    html += '<th scope="col">Author / Trainer</th>';
    html += '<th scope="col">Status</th>';
    html += '<th scope="col">Created</th>';
    html += '<th scope="col" style="text-align:right;">Admin Actions</th>';
    html += '</tr></thead><tbody>';

    filtered.forEach(function (c) {
      html += '<tr>';
      html += '  <td class="cell-strong">';
      html += '    <div style="font-weight:700; color:var(--primary-blue-dark);">' + Dash.escape(c.title) + '</div>';
      if (c.description) {
        html += '    <div style="font-size:0.75rem; color:var(--text-muted); max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + Dash.escape(c.description) + '</div>';
      }
      html += '  </td>';
      html += '  <td>' + (c.subject_name ? '<span class="pill pill--orange">' + Dash.escape(c.subject_name) + '</span>' : '<span class="cell-muted">Uncategorized</span>') + '</td>';
      html += '  <td>' + Dash.escape(c.trainer_name || "Trainer") + '</td>';
      html += '  <td>' + statusPill(c.status) + '</td>';
      html += '  <td>' + Dash.escape(formatDateTime(c.created_at)) + '</td>';
      html += '  <td style="text-align:right;">';
      html += '    <div style="display:inline-flex; gap:6px;">';
      if (c.status !== "published") {
        html += '      <button class="btn btn--sm btn--approve btn-course-status" type="button" data-course-id="' + Dash.escape(c.id) + '" data-status="published" title="Publish Course">Publish</button>';
      } else {
        html += '      <button class="btn btn--sm btn--outline btn-course-status" type="button" data-course-id="' + Dash.escape(c.id) + '" data-status="draft" title="Revert to Draft">Unpublish</button>';
      }
      if (c.status !== "archived") {
        html += '      <button class="btn btn--sm btn--outline btn-course-status" type="button" data-course-id="' + Dash.escape(c.id) + '" data-status="archived" title="Archive Course">Archive</button>';
      }
      html += '      <button class="btn btn--sm btn--reject btn-delete-course" type="button" data-course-id="' + Dash.escape(c.id) + '" title="Delete Course">Delete</button>';
      html += '    </div>';
      html += '  </td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    panel.innerHTML = html;
  }

  // 4. Announcements Table
  function renderAnnouncementsTable() {
    var panel = document.getElementById("panel-announcements");
    if (!panel) return;

    var searchVal = (document.getElementById("admin-announcements-search") ? document.getElementById("admin-announcements-search").value : "").toLowerCase().trim();
    var statusVal = document.getElementById("admin-announcements-status-filter") ? document.getElementById("admin-announcements-status-filter").value : "";
    var audienceVal = document.getElementById("admin-announcements-audience-filter") ? document.getElementById("admin-announcements-audience-filter").value : "";

    var filtered = state.announcements.filter(function (ann) {
      if (statusVal && ann.status !== statusVal) return false;
      if (audienceVal && ann.target_role !== audienceVal) return false;
      if (searchVal) {
        var matchTitle = (ann.title || "").toLowerCase().indexOf(searchVal) !== -1;
        var matchBody = (ann.body || "").toLowerCase().indexOf(searchVal) !== -1;
        var matchSummary = (ann.summary || "").toLowerCase().indexOf(searchVal) !== -1;
        if (!matchTitle && !matchBody && !matchSummary) return false;
      }
      return true;
    });

    if (!filtered.length) {
      Dash.renderEmpty(
        panel,
        "No Announcements Found",
        "Create announcements to broadcast official notifications across the portal."
      );
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Headline / Title</th>';
    html += '<th scope="col">Category</th>';
    html += '<th scope="col">Target Audience</th>';
    html += '<th scope="col">Status</th>';
    html += '<th scope="col">Updated</th>';
    html += '<th scope="col" style="text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    filtered.forEach(function (ann) {
      var audienceLabel = "All Users";
      if (ann.target_role === "trainee") audienceLabel = "Trainees";
      if (ann.target_role === "trainer") audienceLabel = "Trainers";
      if (ann.target_role === "admin") audienceLabel = "Admins";

      html += '<tr>';
      html += '  <td class="cell-strong">';
      html += '    <div style="font-weight:700; color:var(--primary-blue-dark);">' + Dash.escape(ann.title) + '</div>';
      if (ann.summary) {
        html += '    <div style="font-size:0.75rem; color:var(--text-muted); max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + Dash.escape(ann.summary) + '</div>';
      }
      html += '  </td>';
      html += '  <td>' + (ann.category ? '<span class="pill pill--orange">' + Dash.escape(ann.category) + '</span>' : '<span class="cell-muted">General</span>') + '</td>';
      html += '  <td><span class="role-badge role-badge--' + (ann.target_role || "all") + '">' + Dash.escape(audienceLabel) + '</span></td>';
      html += '  <td>' + statusPill(ann.status) + '</td>';
      html += '  <td>' + Dash.escape(formatDateTime(ann.updated_at || ann.created_at || ann.published_at)) + '</td>';
      html += '  <td style="text-align:right;">';
      html += '    <div style="display:inline-flex; gap:6px;">';
      html += '      <button class="btn btn--sm btn--outline btn-preview-ann" type="button" data-ann-id="' + Dash.escape(ann.id) + '" title="Preview Announcement">Preview</button>';
      html += '      <button class="btn btn--sm btn--outline btn-edit-ann" type="button" data-ann-id="' + Dash.escape(ann.id) + '" title="Edit Announcement">Edit</button>';
      if (ann.status !== "published") {
        html += '      <button class="btn btn--sm btn--approve btn-ann-status" type="button" data-ann-id="' + Dash.escape(ann.id) + '" data-status="published" title="Publish Announcement">Publish</button>';
      } else {
        html += '      <button class="btn btn--sm btn--outline btn-ann-status" type="button" data-ann-id="' + Dash.escape(ann.id) + '" data-status="draft" title="Unpublish (Revert to Draft)">Unpublish</button>';
      }
      html += '      <button class="btn btn--sm btn--reject btn-delete-ann" type="button" data-ann-id="' + Dash.escape(ann.id) + '" title="Delete Announcement">✕</button>';
      html += '    </div>';
      html += '  </td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    panel.innerHTML = html;
  }

  // 5. Taxonomy Table
  function renderTaxonomyTable() {
    var panel = document.getElementById("panel-taxonomy");
    if (!panel) return;

    if (!state.subjects.length) {
      Dash.renderEmpty(
        panel,
        "No Subject Taxonomies",
        "Add subject categories for curriculum mapping and skill competency alignment."
      );
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Subject Name</th>';
    html += '<th scope="col">Category</th>';
    html += '<th scope="col" style="text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    state.subjects.forEach(function (s) {
      html += '<tr>';
      html += '  <td class="cell-strong">' + Dash.escape(s.name) + '</td>';
      html += '  <td>' + (s.category ? '<span class="pill pill--orange">' + Dash.escape(s.category) + '</span>' : '<span class="cell-muted">—</span>') + '</td>';
      html += '  <td style="text-align:right;">';
      html += '    <div style="display:inline-flex; gap:6px;">';
      html += '      <button class="btn btn--sm btn--reject btn-delete-subject" type="button" data-subject-id="' + Dash.escape(s.id) + '" title="Delete Subject">✕ Remove</button>';
      html += '    </div>';
      html += '  </td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    panel.innerHTML = html;
  }

  // 6. Admin Profile View
  function renderProfileView() {
    var body = document.getElementById("profile-body");
    if (!body) return;

    var u = state.user || {};
    var rows = [
      ["Full Name", Dash.escape(u.name || "Administrator")],
      ["Email Address", Dash.escape(u.email || "—")],
      ["Role", '<span class="role-badge role-badge--admin">Admin</span>'],
      ["Employee ID", u.employee_id ? Dash.escape(u.employee_id) : '<span class="cell-muted">Not provided</span>'],
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
     Action Handlers & Mutations
     ------------------------------------------------------------------------ */

  // 1. Approval Decisions
  async function handleApprovalDecision(reqOrUserId, decision, btnEl) {
    if (!reqOrUserId || !decision) return;

    var normalizedDecision = decision === "approve" ? "approved" : (decision === "reject" ? "rejected" : decision);
    var actionLabel = normalizedDecision === "approved" ? "Approving…" : "Rejecting…";
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = actionLabel; }

    try {
      await API.post("admin/approvals/" + reqOrUserId + "/decision", {
        decision: normalizedDecision
      });

      showToast("Applicant " + (normalizedDecision === "approved" ? "approved" : "rejected") + " successfully.", "success", "Approval Processed");
      await loadApprovals();
      await loadUsers();
      await loadDashboardMetrics();
    } catch (err) {
      console.error("Approval decision failed:", err);
      showToast("Approval error: " + (err.message || "Failed to process application"), "error", "Action Failed");
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = normalizedDecision === "approved" ? "✓ Approve" : "✕ Reject";
      }
    }
  }

  // 2. User Status Mutation
  async function handleUserStatusChange(userId, newStatus) {
    confirmAction("Are you sure you want to set this user account status to " + newStatus + "?", async function () {
      try {
        await API.patch("admin/users/" + userId + "/status", { status: newStatus });
        showToast("User status updated to " + newStatus + ".", "success", "Status Updated");
        await loadUsers();
        await loadDashboardMetrics();
      } catch (err) {
        console.error("User status update failed:", err);
        showToast("Failed to update user status: " + (err.message || "Error"), "error", "Update Failed");
      }
    }, "Update User Status");
  }

  // 3. Course Status Mutation & Deletion
  async function handleCourseStatusChange(courseId, newStatus) {
    try {
      await API.patch("courses/" + courseId, { status: newStatus });
      showToast("Course status updated to " + newStatus + ".", "success", "Course Updated");
      await loadCourses();
      await loadDashboardMetrics();
    } catch (err) {
      console.error("Course status update failed:", err);
      showToast("Failed to update course status: " + (err.message || "Error"), "error", "Update Failed");
    }
  }

  function handleDeleteCourse(courseId) {
    confirmAction("Are you sure you want to delete this course? This action cannot be undone if no trainees are enrolled.", async function () {
      try {
        await API.del("courses/" + courseId);
        showToast("Course deleted successfully.", "success", "Course Deleted");
        await loadCourses();
        await loadDashboardMetrics();
      } catch (err) {
        console.error("Delete course failed:", err);
        showToast("Cannot delete course: " + (err.message || "It may have active enrollments. Try archiving instead."), "error", "Delete Failed");
      }
    }, "Delete Course");
  }

  // 4. News & Announcements Mutations
  async function handleCreateAnnouncement(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("create-ann-error");
    var submitBtn = document.getElementById("btn-submit-create-ann");
    if (errorEl) errorEl.hidden = true;

    var title = form.title.value.trim();
    var summary = form.summary.value.trim() || null;
    var body = form.body.value.trim() || null;
    var category = form.category.value.trim() || null;
    var targetRole = form.targetRole.value;
    var annStatus = form.status.value;

    if (!title) {
      if (errorEl) { errorEl.textContent = "Title is required."; errorEl.hidden = false; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      await API.post("notifications", {
        type: "announcement",
        title: title,
        summary: summary,
        body: body,
        category: category,
        targetRole: targetRole,
        status: annStatus
      });

      showToast("Announcement " + (annStatus === "published" ? "published" : "saved as draft") + " successfully.", "success", "Announcement Saved");
      closeModal("modal-create-announcement");
      form.reset();
      await loadAnnouncements();
    } catch (err) {
      console.error("Create announcement failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to create announcement.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save & Broadcast"; }
    }
  }

  async function handleEditAnnouncement(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("edit-ann-error");
    var submitBtn = document.getElementById("btn-submit-edit-ann");
    if (errorEl) errorEl.hidden = true;

    var annId = document.getElementById("edit-ann-id").value;
    var title = form.title.value.trim();
    var summary = form.summary.value.trim() || null;
    var body = form.body.value.trim() || null;
    var category = form.category.value.trim() || null;
    var targetRole = form.targetRole.value;
    var annStatus = form.status.value;

    if (!title) {
      if (errorEl) { errorEl.textContent = "Title is required."; errorEl.hidden = false; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      await API.patch("notifications/" + annId, {
        title: title,
        summary: summary,
        body: body,
        category: category,
        targetRole: targetRole,
        status: annStatus
      });

      showToast("Announcement updated successfully.", "success", "Announcement Saved");
      closeModal("modal-edit-announcement");
      await loadAnnouncements();
    } catch (err) {
      console.error("Edit announcement failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to save announcement.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Changes"; }
    }
  }

  async function handleAnnouncementStatusChange(annId, newStatus) {
    try {
      await API.patch("notifications/" + annId, { status: newStatus });
      showToast("Announcement status updated to " + newStatus + ".", "success", "Announcement Updated");
      await loadAnnouncements();
    } catch (err) {
      console.error("Announcement status update failed:", err);
      showToast("Failed to update announcement: " + (err.message || "Error"), "error", "Update Failed");
    }
  }

  function handleDeleteAnnouncement(annId) {
    confirmAction("Are you sure you want to permanently delete this announcement?", async function () {
      try {
        await API.del("notifications/" + annId);
        showToast("Announcement deleted.", "success", "Announcement Deleted");
        await loadAnnouncements();
      } catch (err) {
        console.error("Delete announcement failed:", err);
        showToast("Failed to delete announcement: " + (err.message || "Error"), "error", "Delete Failed");
      }
    }, "Delete Announcement");
  }

  function previewAnnouncement(title, summary, body, category, targetRole) {
    var previewBody = document.getElementById("preview-ann-body-content");
    if (!previewBody) return;

    var audienceLabel = "All Users";
    if (targetRole === "trainee") audienceLabel = "Trainees";
    if (targetRole === "trainer") audienceLabel = "Trainers";
    if (targetRole === "admin") audienceLabel = "Admins";

    var html = '<article class="announcement-card" style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius-md); padding:20px;">';
    html += '  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:12px;">';
    html += '    <h3 style="font-size:1.125rem; font-weight:700; color:var(--primary-blue-dark); margin:0;">' + Dash.escape(title || "Untitled Announcement") + '</h3>';
    if (category) html += '    <span class="pill pill--orange" style="font-size:0.75rem;">' + Dash.escape(category) + '</span>';
    html += '  </div>';
    if (summary) {
      html += '  <p style="font-size:0.875rem; font-weight:600; color:var(--text-dark); margin:0 0 8px 0;">' + Dash.escape(summary) + '</p>';
    }
    if (body) {
      html += '  <p style="font-size:0.875rem; color:var(--text-muted); line-height:1.6; margin:0 0 12px 0;">' + Dash.escape(body) + '</p>';
    }
    html += '  <div style="font-size:0.75rem; color:var(--text-muted); display:flex; justify-content:space-between; border-top:1px solid var(--border-light); padding-top:10px;">';
    html += '    <span>Target Audience: <strong>' + Dash.escape(audienceLabel) + '</strong></span>';
    html += '    <span>Preview Mode</span>';
    html += '  </div>';
    html += '</article>';

    previewBody.innerHTML = html;
    openModal("modal-preview-announcement");
  }

  // 5. Subject / Taxonomy Mutations
  async function handleCreateSubject(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("subject-error");
    var submitBtn = document.getElementById("btn-submit-subject");
    if (errorEl) errorEl.hidden = true;

    var nameVal = form.name.value.trim();
    var catVal = form.category.value.trim() || null;

    if (!nameVal) {
      if (errorEl) { errorEl.textContent = "Subject name is required."; errorEl.hidden = false; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      await API.post("subjects", {
        name: nameVal,
        category: catVal
      });

      showToast("Subject taxonomy created successfully.", "success", "Subject Added");
      closeModal("modal-subject");
      form.reset();
      await loadSubjects();
    } catch (err) {
      console.error("Create subject failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to add subject.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Subject"; }
    }
  }

  function handleDeleteSubject(subjectId) {
    confirmAction("Are you sure you want to remove this subject taxonomy?", async function () {
      try {
        await API.del("subjects/" + subjectId);
        showToast("Subject taxonomy removed.", "success", "Subject Removed");
        await loadSubjects();
      } catch (err) {
        console.error("Delete subject failed:", err);
        showToast("Failed to remove subject: " + (err.message || "It may be referenced by courses."), "error", "Delete Failed");
      }
    }, "Remove Subject");
  }

  /* ------------------------------------------------------------------------
     Global Events & Subtab Wiring
     ------------------------------------------------------------------------ */

  function wireEvents() {
    // Navigation routing
    window.addEventListener("hashchange", function () {
      switchSection(window.location.hash);
    });

    // Subtabs for User Management (Trainees / Trainers)
    var tabTrainees = document.getElementById("tab-trainees");
    var tabTrainers = document.getElementById("tab-trainers");
    var pTrainees = document.getElementById("panel-trainees");
    var pTrainers = document.getElementById("panel-trainers");

    if (tabTrainees && tabTrainers) {
      tabTrainees.addEventListener("click", function () {
        tabTrainees.setAttribute("aria-selected", "true");
        tabTrainers.setAttribute("aria-selected", "false");
        if (pTrainees) pTrainees.hidden = false;
        if (pTrainers) pTrainers.hidden = true;
      });

      tabTrainers.addEventListener("click", function () {
        tabTrainees.setAttribute("aria-selected", "false");
        tabTrainers.setAttribute("aria-selected", "true");
        if (pTrainees) pTrainees.hidden = true;
        if (pTrainers) pTrainers.hidden = false;
      });
    }

    // Modal Close buttons
    document.querySelectorAll("[data-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var modal = btn.closest(".modal-backdrop");
        if (modal) {
          modal.classList.remove("is-open");
          modal.setAttribute("aria-hidden", "true");
        }
      });
    });

    // Modal Backdrop click
    document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) {
          backdrop.classList.remove("is-open");
          backdrop.setAttribute("aria-hidden", "true");
        }
      });
    });

    // Confirm Action Modal button
    var confirmBtn = document.getElementById("btn-confirm-action");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", async function () {
        if (typeof state.pendingConfirmAction === "function") {
          var action = state.pendingConfirmAction;
          state.pendingConfirmAction = null;
          closeModal("modal-confirm");
          await action();
        } else {
          closeModal("modal-confirm");
        }
      });
    }

    // Open Modal buttons
    var btnOpenCreateAnn = document.getElementById("btn-open-create-announcement");
    if (btnOpenCreateAnn) {
      btnOpenCreateAnn.addEventListener("click", function () {
        var f = document.getElementById("form-create-announcement");
        if (f) f.reset();
        openModal("modal-create-announcement");
      });
    }

    var btnOpenCreateSub = document.getElementById("btn-open-create-subject");
    if (btnOpenCreateSub) {
      btnOpenCreateSub.addEventListener("click", function () {
        var f = document.getElementById("form-subject");
        if (f) f.reset();
        openModal("modal-subject");
      });
    }

    // Refresh Buttons
    var btnRefreshApprovals = document.getElementById("btn-refresh-approvals");
    if (btnRefreshApprovals) {
      btnRefreshApprovals.addEventListener("click", function () {
        loadApprovals();
        loadDashboardMetrics();
      });
    }

    var btnRefreshCourses = document.getElementById("btn-refresh-courses");
    if (btnRefreshCourses) {
      btnRefreshCourses.addEventListener("click", function () {
        loadCourses();
      });
    }

    // Filter changes
    var searchCourse = document.getElementById("admin-courses-search");
    var filterCourseStatus = document.getElementById("admin-courses-status-filter");
    var filterCourseSub = document.getElementById("admin-courses-subject-filter");
    if (searchCourse) searchCourse.addEventListener("input", debounce(renderCoursesTable, 200));
    if (filterCourseStatus) filterCourseStatus.addEventListener("change", renderCoursesTable);
    if (filterCourseSub) filterCourseSub.addEventListener("change", renderCoursesTable);

    var searchAnn = document.getElementById("admin-announcements-search");
    var filterAnnStatus = document.getElementById("admin-announcements-status-filter");
    var filterAnnAudience = document.getElementById("admin-announcements-audience-filter");
    if (searchAnn) searchAnn.addEventListener("input", debounce(renderAnnouncementsTable, 200));
    if (filterAnnStatus) filterAnnStatus.addEventListener("change", renderAnnouncementsTable);
    if (filterAnnAudience) filterAnnAudience.addEventListener("change", renderAnnouncementsTable);

    // Form Submissions
    var formCreateAnn = document.getElementById("form-create-announcement");
    if (formCreateAnn) formCreateAnn.addEventListener("submit", handleCreateAnnouncement);

    var formEditAnn = document.getElementById("form-edit-announcement");
    if (formEditAnn) formEditAnn.addEventListener("submit", handleEditAnnouncement);

    var formSubject = document.getElementById("form-subject");
    if (formSubject) formSubject.addEventListener("submit", handleCreateSubject);

    // Preview buttons inside create & edit announcement forms
    var btnPrevCreate = document.getElementById("btn-preview-create-ann");
    if (btnPrevCreate && formCreateAnn) {
      btnPrevCreate.addEventListener("click", function () {
        previewAnnouncement(
          formCreateAnn.title.value,
          formCreateAnn.summary.value,
          formCreateAnn.body.value,
          formCreateAnn.category.value,
          formCreateAnn.targetRole.value
        );
      });
    }

    var btnPrevEdit = document.getElementById("btn-preview-edit-ann");
    if (btnPrevEdit && formEditAnn) {
      btnPrevEdit.addEventListener("click", function () {
        previewAnnouncement(
          formEditAnn.title.value,
          formEditAnn.summary.value,
          formEditAnn.body.value,
          formEditAnn.category.value,
          formEditAnn.targetRole.value
        );
      });
    }

    // Delegated click actions
    document.addEventListener("click", function (e) {
      // 1. Approval Decisions
      var apprBtn = e.target.closest(".btn-approval-action");
      if (apprBtn) {
        var apprId = apprBtn.getAttribute("data-appr-id");
        var userId = apprBtn.getAttribute("data-user-id");
        var decision = apprBtn.getAttribute("data-decision");
        handleApprovalDecision(apprId || userId, decision, apprBtn);
        return;
      }

      // 2. User Status Toggles
      var userStatusBtn = e.target.closest(".btn-user-status");
      if (userStatusBtn) {
        var uId = userStatusBtn.getAttribute("data-user-id");
        var nStatus = userStatusBtn.getAttribute("data-status");
        handleUserStatusChange(uId, nStatus);
        return;
      }

      // 3. Course Status Toggles & Delete
      var courseStatusBtn = e.target.closest(".btn-course-status");
      if (courseStatusBtn) {
        var cId = courseStatusBtn.getAttribute("data-course-id");
        var cStatus = courseStatusBtn.getAttribute("data-status");
        handleCourseStatusChange(cId, cStatus);
        return;
      }

      var delCourseBtn = e.target.closest(".btn-delete-course");
      if (delCourseBtn) {
        var dCId = delCourseBtn.getAttribute("data-course-id");
        handleDeleteCourse(dCId);
        return;
      }

      // 4. Announcement Edit / Preview / Status / Delete
      var editAnnBtn = e.target.closest(".btn-edit-ann");
      if (editAnnBtn) {
        var aId = editAnnBtn.getAttribute("data-ann-id");
        var ann = state.announcements.find(function (item) { return item.id === aId; });
        if (ann) {
          document.getElementById("edit-ann-id").value = ann.id;
          document.getElementById("edit-ann-title").value = ann.title || "";
          document.getElementById("edit-ann-summary").value = ann.summary || "";
          document.getElementById("edit-ann-body").value = ann.body || "";
          document.getElementById("edit-ann-category").value = ann.category || "";
          document.getElementById("edit-ann-target").value = ann.target_role || "all";
          document.getElementById("edit-ann-status").value = ann.status || "published";
          openModal("modal-edit-announcement");
        }
        return;
      }

      var prevAnnBtn = e.target.closest(".btn-preview-ann");
      if (prevAnnBtn) {
        var pAId = prevAnnBtn.getAttribute("data-ann-id");
        var pAnn = state.announcements.find(function (item) { return item.id === pAId; });
        if (pAnn) {
          previewAnnouncement(pAnn.title, pAnn.summary, pAnn.body, pAnn.category, pAnn.target_role);
        }
        return;
      }

      var annStatusBtn = e.target.closest(".btn-ann-status");
      if (annStatusBtn) {
        var stAId = annStatusBtn.getAttribute("data-ann-id");
        var stStatus = annStatusBtn.getAttribute("data-status");
        handleAnnouncementStatusChange(stAId, stStatus);
        return;
      }

      var delAnnBtn = e.target.closest(".btn-delete-ann");
      if (delAnnBtn) {
        var dAId = delAnnBtn.getAttribute("data-ann-id");
        handleDeleteAnnouncement(dAId);
        return;
      }

      // 5. Subject Delete
      var delSubBtn = e.target.closest(".btn-delete-subject");
      if (delSubBtn) {
        var dSId = delSubBtn.getAttribute("data-subject-id");
        handleDeleteSubject(dSId);
        return;
      }
    });
  }

  /* ------------------------------------------------------------------------
     Bootstrapping
     ------------------------------------------------------------------------ */

  Dash.init({
    role: "admin",
    onReady: async function (ctx) {
      wireEvents();

      // Render overview section immediately so the dashboard shell is interactive
      switchSection(window.location.hash || "#overview");

      try {
        var mePromise = API.get("auth/me").then(function (me) {
          state.user = me;
          var topName = document.getElementById("user-name");
          if (topName) topName.textContent = me.name || ctx.name;
          var topSub = document.getElementById("user-sub");
          if (topSub) topSub.textContent = me.email || ctx.user.email;
          var welcomeName = document.getElementById("welcome-name");
          if (welcomeName) welcomeName.textContent = (me.name || ctx.name || "").split(" ")[0] || "Admin";
          renderProfileView();
          return me;
        }).catch(function (e) {
          console.warn("admin auth/me notice:", e);
        });

        await Promise.allSettled([
          mePromise,
          loadDashboardMetrics(),
          loadApprovals(),
          loadUsers(),
          loadSubjects(),
          loadCourses(),
          loadAnnouncements()
        ]);
      } catch (err) {
        console.error("Admin initialization error:", err);
        showToast("Error initializing admin dashboard: " + (err.message || "Please refresh"), "error");
      }
    }
  });

})(window, document);
