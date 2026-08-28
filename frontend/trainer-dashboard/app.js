/* ==========================================================================
   CAPACITY CONNECT — Trainer Workspace Controller
   Fully integrated with FastAPI REST API endpoints via CapacityConnectAPI.
   Zero direct Supabase course/enrollment table queries.
   ========================================================================== */

(function (window, document) {
  "use strict";

  // Check API client availability
  var API = window.CapacityConnectAPI;
  if (!API) {
    console.error("CapacityConnectAPI client is not loaded.");
  }

  /* ------------------------------------------------------------------------
     Application State
     ------------------------------------------------------------------------ */
  var state = {
    user: null, // From /auth/me
    trainerProfileId: null, // Resolved trainer_profile_id
    profile: null, // Full trainer profile from /profile/trainer
    subjects: [], // Platform taxonomy subjects from /subjects
    courses: [], // Trainer's authored courses from /courses?mine=true
    activeCourseId: null, // Currently opened course in Course Builder
    activeCourse: null, // Full course detail with modules[] & resources[]
    competencies: [], // Trainer competencies
    trainees: [], // Trainee participants across courses
    announcements: [], // Platform announcements & news feed
    stats: null, // Metrics from /dashboard/trainer
    selectedUploadFile: null, // Currently selected file for resource upload
    pendingConfirmAction: null // Callback for modal confirm
  };

  /* ------------------------------------------------------------------------
     Toast Notifications
     ------------------------------------------------------------------------ */
  function showToast(message, type, title) {
    type = type || "info"; // "success", "error", "info"
    var container = document.getElementById("toast-container");
    if (!container) return;

    var toast = document.createElement("div");
    toast.className = "toast toast--" + type;

    var iconSvg = "";
    if (type === "success") {
      iconSvg = '<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
    } else if (type === "error") {
      iconSvg = '<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    } else {
      iconSvg = '<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    var titleHtml = title ? '<div class="toast__title">' + Dash.escape(title) + '</div>' : '';
    toast.innerHTML = iconSvg + '<div class="toast__body">' + titleHtml + '<div>' + Dash.escape(message) + '</div></div>';

    container.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, 4500);
  }

  /* ------------------------------------------------------------------------
     Modal Management
     ------------------------------------------------------------------------ */
  function openModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    var firstInput = modal.querySelector("input:not([type=hidden]), select, textarea, button[type=submit]");
    if (firstInput) firstInput.focus();
  }

  function closeModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function closeAllModals() {
    var modals = document.querySelectorAll(".modal-backdrop.is-open");
    modals.forEach(function (m) {
      m.classList.remove("is-open");
      m.setAttribute("aria-hidden", "true");
    });
  }

  function confirmAction(message, onConfirm, title) {
    var modal = document.getElementById("modal-confirm");
    var msgEl = document.getElementById("modal-confirm-message");
    var titleEl = document.getElementById("modal-confirm-title");
    if (!modal || !msgEl) return;

    titleEl.textContent = title || "Confirm Action";
    msgEl.textContent = message;
    state.pendingConfirmAction = onConfirm;
    openModal("modal-confirm");
  }

  /* ------------------------------------------------------------------------
     Navigation & Routing
     ------------------------------------------------------------------------ */
  function switchSection(targetHash) {
    var hash = targetHash || window.location.hash || "#overview";
    if (!hash.startsWith("#")) hash = "#" + hash;

    // Allowed sections
    var validSections = ["#overview", "#my-courses", "#course-builder", "#competencies", "#my-trainees", "#announcements", "#profile"];
    if (validSections.indexOf(hash) === -1) {
      hash = "#overview";
    }

    // Toggle sections visibility
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

    // Update nav links active state
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

    // Toggle builder nav item visibility
    var builderNavItem = document.getElementById("nav-item-course-builder");
    if (builderNavItem) {
      if (state.activeCourseId || hash === "#course-builder") {
        builderNavItem.removeAttribute("hidden");
      } else {
        builderNavItem.setAttribute("hidden", "true");
      }
    }

    // Scroll to top of main area
    var main = document.getElementById("main");
    if (main) main.scrollTop = 0;
  }

  /* ------------------------------------------------------------------------
     Helpers & Render Utilities
     ------------------------------------------------------------------------ */
  function getSubjectName(subjectId) {
    if (!subjectId) return null;
    for (var i = 0; i < state.subjects.length; i++) {
      if (state.subjects[i].id === subjectId) {
        return state.subjects[i].name;
      }
    }
    return null;
  }

  function populateSubjectDropdowns() {
    var selects = [
      document.getElementById("create-course-subject"),
      document.getElementById("edit-course-subject"),
      document.getElementById("declare-competency-subject")
    ];

    selects.forEach(function (select) {
      if (!select) return;
      var currentVal = select.value;
      select.innerHTML = '<option value="">Select subject…</option>';
      state.subjects.forEach(function (sub) {
        var opt = document.createElement("option");
        opt.value = sub.id;
        opt.textContent = sub.name + (sub.category ? " (" + sub.category + ")" : "");
        select.appendChild(opt);
      });
      if (currentVal) select.value = currentVal;
    });
  }

  function statusPill(status) {
    var val = String(status || "").toLowerCase();
    if (val === "published" || val === "active" || val === "completed") {
      return '<span class="pill pill--active">' + Dash.escape(Dash.titleCase(val)) + '</span>';
    }
    if (val === "draft" || val === "in_progress" || val === "pending") {
      return '<span class="pill pill--orange">' + Dash.escape(Dash.titleCase(val)) + '</span>';
    }
    return '<span class="pill pill--muted">' + Dash.escape(Dash.titleCase(val || "Not set")) + '</span>';
  }

  function formatDateTime(dt) {
    if (!dt) return "—";
    try {
      var d = new Date(dt);
      if (isNaN(d.getTime())) return String(dt);
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return String(dt);
    }
  }

  /* ------------------------------------------------------------------------
     API Loaders
     ------------------------------------------------------------------------ */

  // 1. Dashboard Metrics
  async function loadDashboardMetrics() {
    try {
      var res = await API.get("dashboard/trainer");
      state.stats = res;
      Dash.setStat("stat-courses", res.courses_total || 0);
      Dash.setStat("stat-active", res.courses_published || 0);
      Dash.setStat("stat-trainees", res.enrollments_total || 0);
      Dash.setStat("stat-completed", res.completions_total || 0);
    } catch (err) {
      console.warn("Could not load trainer dashboard metrics:", err);
      Dash.setStat("stat-courses", state.courses.length || 0);
      Dash.setStat("stat-active", state.courses.filter(function (c) { return c.status === "published"; }).length || 0);
    }
  }

  // 2. Subjects Taxonomy
  async function loadSubjects() {
    try {
      var subjects = await API.get("subjects");
      state.subjects = Array.isArray(subjects) ? subjects : [];
      populateSubjectDropdowns();
    } catch (err) {
      console.error("Failed to load subjects:", err);
      state.subjects = [];
    }
  }

  // 3. Courses List
  async function loadCourses() {
    var body = document.getElementById("courses-body");
    if (body) Dash.renderLoading(body, "Loading your courses…");

    try {
      var res = await API.get("courses?mine=true&limit=100");
      var courses = (res && res.items) || (Array.isArray(res) ? res : []);
      state.courses = courses;

      renderCoursesList();
      populateTraineeCourseFilter();
      loadDashboardMetrics();
    } catch (err) {
      console.error("Failed to load courses:", err);
      if (body) {
        Dash.renderError(body, "We could not load your courses: " + (err.message || "Network error"), function () {
          loadCourses();
        });
      }
    }
  }

  // 4. Competencies
  async function loadCompetencies() {
    var body = document.getElementById("competencies-body");
    if (body) Dash.renderLoading(body, "Loading your competency records…");

    if (!state.trainerProfileId) {
      if (body) Dash.renderEmpty(body, "No trainer profile found.", "Your trainer account record is missing profile mapping.");
      return;
    }

    try {
      var res = await API.get("competencies/trainer/" + state.trainerProfileId);
      state.competencies = Array.isArray(res) ? res : [];
      renderCompetencies();
    } catch (err) {
      console.error("Failed to load competencies:", err);
      if (body) {
        Dash.renderError(body, "Could not load competencies: " + (err.message || "Network error"), function () {
          loadCompetencies();
        });
      }
    }
  }

  // 5. Trainer Profile & Skills
  async function loadProfile() {
    var body = document.getElementById("profile-body");
    if (body) Dash.renderLoading(body, "Loading profile information…");

    try {
      var trainerProfile = await API.get("profile/trainer");
      state.profile = trainerProfile;
      renderProfileView();
    } catch (err) {
      console.error("Failed to load trainer profile:", err);
      if (body) {
        Dash.renderError(body, "Could not load profile: " + (err.message || "Network error"), function () {
          loadProfile();
        });
      }
    }
  }

  // 6. Trainees
  async function loadTrainees() {
    var body = document.getElementById("trainees-body");
    if (body) Dash.renderLoading(body, "Loading trainee participant rosters…");

    if (!state.courses || !state.courses.length) {
      if (body) Dash.renderEmpty(body, "No trainees enrolled yet.", "Learners who enrol in your published courses will be listed here.");
      return;
    }

    try {
      var allTrainees = [];
      // Fetch participants for each course
      for (var i = 0; i < state.courses.length; i++) {
        var course = state.courses[i];
        try {
          var partRes = await API.get("courses/" + course.id + "/participants?limit=100");
          var items = (partRes && partRes.items) || (Array.isArray(partRes) ? partRes : []);
          items.forEach(function (t) {
            t.course_title = course.title;
            t.course_id = course.id;
            allTrainees.push(t);
          });
        } catch (subErr) {
          console.warn("Could not fetch participants for course " + course.id, subErr);
        }
      }

      state.trainees = allTrainees;
      renderTraineesList();
    } catch (err) {
      console.error("Failed to load trainees:", err);
      if (body) {
        Dash.renderError(body, "Could not load trainee rosters: " + (err.message || "Network error"), function () {
          loadTrainees();
        });
      }
    }
  }

  // 7. Announcements
  async function loadAnnouncements() {
    var body = document.getElementById("announcements-body");
    if (body) Dash.renderLoading(body, "Loading announcements & updates…");

    try {
      var res = await API.get("notifications?limit=50");
      var items = (res && res.items) || (Array.isArray(res) ? res : []);
      state.announcements = items;
      renderAnnouncements();
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

  function renderAnnouncements() {
    var body = document.getElementById("announcements-body");
    if (!body) return;

    if (!state.announcements.length) {
      Dash.renderEmpty(
        body,
        "No announcements at this time.",
        "Official platform notices and trainer schedules will appear here."
      );
      return;
    }

    var html = '<div class="announcement-feed" style="padding:20px; display:flex; flex-direction:column; gap:16px;">';
    state.announcements.forEach(function (ann) {
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

  // 1. Courses List View
  function renderCoursesList() {
    var body = document.getElementById("courses-body");
    if (!body) return;

    var searchVal = (document.getElementById("courses-search") ? document.getElementById("courses-search").value : "").toLowerCase().trim();
    var statusVal = (document.getElementById("courses-status-filter") ? document.getElementById("courses-status-filter").value : "").toLowerCase().trim();

    var filtered = state.courses.filter(function (course) {
      var matchesSearch = !searchVal ||
        (course.title && course.title.toLowerCase().indexOf(searchVal) !== -1) ||
        (course.description && course.description.toLowerCase().indexOf(searchVal) !== -1);

      var matchesStatus = !statusVal || (course.status && course.status.toLowerCase() === statusVal);
      return matchesSearch && matchesStatus;
    });

    if (!filtered.length) {
      if (state.courses.length === 0) {
        Dash.renderEmpty(
          body,
          "No courses created yet.",
          "Click '+ Create Course' above to author your first training curriculum."
        );
      } else {
        Dash.renderEmpty(
          body,
          "No courses match your filter.",
          "Try clearing search keywords or selecting a different status filter."
        );
      }
      return;
    }

    var html = '<div class="course-grid">';
    filtered.forEach(function (c) {
      var subjectLabel = c.subject_name || getSubjectName(c.subject_id) || "General Subject";
      var desc = c.description ? Dash.escape(c.description) : "No description provided.";
      var modCount = c.module_count !== undefined ? c.module_count : "—";
      var enrolCount = c.enrollment_count !== undefined ? c.enrollment_count : 0;
      var rating = c.average_rating ? Number(c.average_rating).toFixed(1) + " ★" : "No ratings";

      html += '<article class="course-card" data-course-id="' + Dash.escape(c.id) + '">';
      html += '  <div class="course-card__header">';
      html += '    <div>';
      html += '      <h3 class="course-card__title">' + Dash.escape(c.title) + '</h3>';
      html += '      <span class="course-card__subject">' + Dash.escape(subjectLabel) + '</span>';
      html += '    </div>';
      html += '    <div>' + statusPill(c.status) + '</div>';
      html += '  </div>';

      html += '  <div class="course-card__body">';
      html += '    <p class="course-card__desc">' + desc + '</p>';
      html += '    <div class="course-card__stats">';
      html += '      <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/></svg> ' + modCount + ' Modules</span>';
      html += '      <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8.5" r="3.25"/><path d="M3.5 19.5c0-3.1 2.5-5.2 5.5-5.2s5.5 2.1 5.5 5.2"/></svg> ' + enrolCount + ' Trainees</span>';
      html += '      <span>' + Dash.escape(rating) + '</span>';
      html += '    </div>';
      html += '  </div>';

      html += '  <div class="course-card__footer">';
      html += '    <button class="btn btn--orange btn--sm btn-open-builder" type="button" data-course-id="' + Dash.escape(c.id) + '">';
      html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Manage &amp; Build';
      html += '    </button>';
      html += '    <div style="display: flex; gap: 6px;">';
      html += '      <button class="btn btn--outline btn--sm btn-edit-course" type="button" data-course-id="' + Dash.escape(c.id) + '" title="Edit details">Edit</button>';
      html += '      <button class="btn btn--reject btn--sm btn-delete-course" type="button" data-course-id="' + Dash.escape(c.id) + '" title="Delete course">Delete</button>';
      html += '    </div>';
      html += '  </div>';
      html += '</article>';
    });
    html += '</div>';

    body.innerHTML = html;
  }

  // 2. Course Builder View
  async function openCourseBuilder(courseId) {
    if (!courseId) return;
    state.activeCourseId = courseId;

    var builderBody = document.getElementById("builder-body");
    if (builderBody) Dash.renderLoading(builderBody, "Loading course curriculum & modules…");

    // Switch view
    switchSection("#course-builder");
    window.location.hash = "#course-builder";

    try {
      var courseDetail = await API.get("courses/" + courseId);
      state.activeCourse = courseDetail;
      renderCourseBuilder();
    } catch (err) {
      console.error("Failed to load course detail:", err);
      if (builderBody) {
        Dash.renderError(builderBody, "Failed to load course details: " + (err.message || "Network error"), function () {
          openCourseBuilder(courseId);
        });
      }
    }
  }

  function renderCourseBuilder() {
    var container = document.getElementById("builder-body");
    if (!container || !state.activeCourse) return;

    var c = state.activeCourse;
    var subjectLabel = c.subject_name || getSubjectName(c.subject_id) || "General Subject";
    var modules = Array.isArray(c.modules) ? c.modules : [];

    // Sort modules by sequence_no
    modules.sort(function (a, b) {
      return (a.sequence_no || 0) - (b.sequence_no || 0);
    });

    var html = '';

    // Header Banner
    html += '<div class="builder-banner">';
    html += '  <div class="builder-banner__info">';
    html += '    <a class="builder-banner__back" href="#my-courses" id="btn-back-to-courses">';
    html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to My Courses';
    html += '    </a>';
    html += '    <h1 class="builder-banner__title">' + Dash.escape(c.title) + '</h1>';
    html += '    <div class="builder-banner__meta">';
    html += '      <span><strong>Subject:</strong> ' + Dash.escape(subjectLabel) + '</span>';
    html += '      <span>' + statusPill(c.status) + '</span>';
    html += '      <span><strong>Modules:</strong> ' + modules.length + '</span>';
    html += '      <span><strong>Trainees:</strong> ' + (c.enrollment_count || 0) + '</span>';
    html += '    </div>';
    html += '  </div>';

    html += '  <div class="builder-banner__actions">';
    html += '    <button class="btn btn--outline btn--sm" style="background:#fff; color:var(--primary-blue);" type="button" id="btn-builder-edit-info">';
    html += '      Edit Information';
    html += '    </button>';
    if (c.status === "draft") {
      html += '    <button class="btn btn--approve btn--sm" type="button" id="btn-builder-publish">';
      html += '      Publish Course';
      html += '    </button>';
    } else if (c.status === "published") {
      html += '    <button class="btn btn--outline btn--sm" style="background:#fff; color:var(--accent-orange-dark);" type="button" id="btn-builder-archive">';
      html += '      Archive Course';
      html += '    </button>';
    } else {
      html += '    <button class="btn btn--outline btn--sm" style="background:#fff; color:var(--primary-blue);" type="button" id="btn-builder-draft">';
      html += '      Revert to Draft';
      html += '    </button>';
    }
    html += '    <button class="btn btn--orange btn--sm" type="button" id="btn-builder-add-module">';
    html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 5v14M5 12h14"/></svg> + Add Module';
    html += '    </button>';
    html += '  </div>';
    html += '</div>';

    // Modules List
    if (!modules.length) {
      html += '<div class="panel" style="padding: 30px; text-align: center;">';
      html += '  <h3 style="color:var(--primary-blue-dark); margin-bottom:8px;">Curriculum is empty</h3>';
      html += '  <p style="color:var(--text-muted); font-size:0.875rem; margin-bottom:18px;">Start designing your syllabus by adding the first lesson module.</p>';
      html += '  <button class="btn btn--orange btn--sm" type="button" id="btn-empty-add-module">+ Add First Module</button>';
      html += '</div>';
    } else {
      html += '<div class="module-list">';
      modules.forEach(function (m, idx) {
        var seq = m.sequence_no !== undefined ? m.sequence_no : (idx + 1);
        var resources = Array.isArray(m.resources) ? m.resources : [];

        html += '<article class="module-card" data-module-id="' + Dash.escape(m.id) + '">';
        html += '  <div class="module-card__head">';
        html += '    <div class="module-card__title-wrap">';
        html += '      <span class="module-badge">' + seq + '</span>';
        html += '      <h3 class="module-card__title">' + Dash.escape(m.title) + '</h3>';
        html += '    </div>';
        html += '    <div class="module-card__actions">';
        html += '      <button class="btn btn--orange btn--sm btn-module-add-resource" type="button" data-module-id="' + Dash.escape(m.id) + '">';
        html += '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg> + Add Resource';
        html += '      </button>';
        html += '      <button class="btn btn--outline btn--sm btn-edit-module" type="button" data-module-id="' + Dash.escape(m.id) + '" data-title="' + Dash.escape(m.title) + '" data-seq="' + seq + '">Edit</button>';
        html += '      <button class="btn btn--reject btn--sm btn-delete-module" type="button" data-module-id="' + Dash.escape(m.id) + '">Delete</button>';
        html += '    </div>';
        html += '  </div>';

        html += '  <div class="module-card__body">';
        if (!resources.length) {
          html += '    <div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.8125rem; background: var(--warm-white); border: 1px dashed var(--border); border-radius: var(--radius-sm);">';
          html += '      No learning materials added yet. Click <strong>+ Add Resource</strong> above to upload lecture slides, video, documents, or external links.';
          html += '    </div>';
        } else {
          html += '    <div class="resource-list">';
          resources.forEach(function (res) {
            var iconClass = "resource-item__icon--document";
            var iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

            if (res.type === "lecture_video") {
              iconClass = "resource-item__icon--video";
              iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
            } else if (res.type === "presentation") {
              iconClass = "resource-item__icon--presentation";
              iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
            } else if (res.type === "link") {
              iconClass = "resource-item__icon--link";
              iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
            }

            var typeName = Dash.titleCase(String(res.type || "Resource").replace("_", " "));
            var uploadedAt = formatDateTime(res.uploaded_at);

            html += '      <div class="resource-item" data-resource-id="' + Dash.escape(res.id) + '">';
            html += '        <div class="resource-item__info">';
            html += '          <div class="resource-item__icon ' + iconClass + '">' + iconSvg + '</div>';
            html += '          <div class="resource-item__meta">';
            html += '            <div class="resource-item__title">' + Dash.escape(res.title) + '</div>';
            html += '            <div class="resource-item__sub">' + Dash.escape(typeName) + ' · Added ' + Dash.escape(uploadedAt) + '</div>';
            html += '          </div>';
            html += '        </div>';
            html += '        <div class="resource-item__actions">';
            html += '          <button class="btn btn--outline btn--sm btn-open-resource" type="button" data-resource-id="' + Dash.escape(res.id) + '" data-type="' + Dash.escape(res.type) + '" data-url="' + Dash.escape(res.file_url || '') + '">';
            html += res.type === 'link' ? 'Open Link ↗' : 'View / Download ↓';
            html += '          </button>';
            html += '          <button class="btn btn--reject btn--sm btn-delete-resource" type="button" data-resource-id="' + Dash.escape(res.id) + '" title="Delete resource">✕</button>';
            html += '        </div>';
            html += '      </div>';
          });
          html += '    </div>';
        }
        html += '  </div>';
        html += '</article>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // 3. Competency Mapping View
  function renderCompetencies() {
    var body = document.getElementById("competencies-body");
    if (!body) return;

    if (!state.competencies.length) {
      Dash.renderEmpty(
        body,
        "No subject competencies declared yet.",
        "Declare your domain competencies and proficiency scores using '+ Declare Competency' to qualify for training allocations."
      );
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Subject Taxonomy</th>';
    html += '<th scope="col">Proficiency Rating (0 - 10)</th>';
    html += '<th scope="col">Declaration Source</th>';
    html += '<th scope="col">Last Updated</th>';
    html += '<th scope="col" style="text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    state.competencies.forEach(function (item) {
      var subjectName = item.subject_name || getSubjectName(item.subject_id) || "Subject #" + String(item.subject_id).slice(0, 8);
      var score = Number(item.proficiency_score || 0);
      var pct = Math.min(100, Math.max(0, Math.round(score * 10)));
      var sourceLabel = item.source === "admin_assigned" ? '<span class="pill pill--active">Admin Verified</span>' : '<span class="pill pill--orange">Self Declared</span>';
      var updated = formatDateTime(item.updated_at);

      html += '<tr>';
      html += '  <td class="cell-strong">' + Dash.escape(subjectName) + '</td>';
      html += '  <td>';
      html += '    <div class="competency-score-bar">';
      html += '      <span class="progress"><span class="progress__fill" style="width:' + pct + '%;"></span></span>';
      html += '      <strong>' + score.toFixed(1) + '</strong> <span class="cell-muted">/ 10</span>';
      html += '    </div>';
      html += '  </td>';
      html += '  <td>' + sourceLabel + '</td>';
      html += '  <td>' + Dash.escape(updated) + '</td>';
      html += '  <td style="text-align:right;">';
      html += '    <button class="btn btn--reject btn--sm btn-delete-competency" type="button" data-competency-id="' + Dash.escape(item.id) + '">Remove</button>';
      html += '  </td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    body.innerHTML = html;
  }

  // 4. Trainees List View
  function populateTraineeCourseFilter() {
    var select = document.getElementById("trainees-course-filter");
    if (!select) return;
    var currentVal = select.value;
    select.innerHTML = '<option value="">All My Courses (' + state.courses.length + ')</option>';
    state.courses.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.title;
      select.appendChild(opt);
    });
    if (currentVal) select.value = currentVal;
  }

  function renderTraineesList() {
    var body = document.getElementById("trainees-body");
    if (!body) return;

    var courseFilter = (document.getElementById("trainees-course-filter") ? document.getElementById("trainees-course-filter").value : "");
    var statusFilter = (document.getElementById("trainees-status-filter") ? document.getElementById("trainees-status-filter").value : "").toLowerCase();

    var filtered = state.trainees.filter(function (t) {
      var matchesCourse = !courseFilter || String(t.course_id) === String(courseFilter);
      var matchesStatus = !statusFilter || String(t.status || "").toLowerCase() === statusFilter;
      return matchesCourse && matchesStatus;
    });

    if (!filtered.length) {
      if (state.trainees.length === 0) {
        Dash.renderEmpty(
          body,
          "No learners enrolled yet.",
          "Learners enrolled in your courses will be tracked here in real-time."
        );
      } else {
        Dash.renderEmpty(
          body,
          "No trainees match current filters.",
          "Select 'All My Courses' and 'All Statuses' to view all enrolled learners."
        );
      }
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Trainee Learner</th>';
    html += '<th scope="col">Course Title</th>';
    html += '<th scope="col">Progress</th>';
    html += '<th scope="col">Enrollment Status</th>';
    html += '<th scope="col">Enrolled On</th>';
    html += '<th scope="col">Completed On</th>';
    html += '</tr></thead><tbody>';

    filtered.forEach(function (t) {
      var name = t.trainee_name || t.name || t.trainee_email || "Learner #" + String(t.trainee_profile_id).slice(0, 8);
      var email = t.trainee_email ? '<br><span class="cell-muted" style="font-size:0.75rem;">' + Dash.escape(t.trainee_email) + '</span>' : '';
      var progress = Math.min(100, Math.max(0, Math.round(Number(t.progress_percent || 0))));
      var enrolled = formatDateTime(t.enrolled_at);
      var completed = t.completed_at ? formatDateTime(t.completed_at) : '—';

      html += '<tr>';
      html += '  <td class="cell-strong">' + Dash.escape(name) + email + '</td>';
      html += '  <td>' + Dash.escape(t.course_title || "—") + '</td>';
      html += '  <td>';
      html += '    <div style="display:flex; align-items:center; gap:8px;">';
      html += '      <span class="progress"><span class="progress__fill" style="width:' + progress + '%;"></span></span>';
      html += '      <span style="font-size:0.8125rem; font-weight:700;">' + progress + '%</span>';
      html += '    </div>';
      html += '  </td>';
      html += '  <td>' + statusPill(t.status) + '</td>';
      html += '  <td>' + Dash.escape(enrolled) + '</td>';
      html += '  <td>' + Dash.escape(completed) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    body.innerHTML = html;
  }

  // 5. Trainer Profile View
  function renderProfileView() {
    var body = document.getElementById("profile-body");
    if (!body) return;

    var p = state.profile || {};
    var u = state.user || {};
    var skills = Array.isArray(p.skills) ? p.skills : [];

    var html = '<div style="display:flex; flex-direction:column; gap:26px;">';

    // Top: Overview Grid
    html += '  <dl class="detail-grid">';
    html += '    <div class="detail"><dt class="detail__label">Full Name</dt><dd class="detail__value">' + Dash.escape(u.name || "—") + '</dd></div>';
    html += '    <div class="detail"><dt class="detail__label">Email Address</dt><dd class="detail__value">' + Dash.escape(u.email || "—") + '</dd></div>';
    html += '    <div class="detail"><dt class="detail__label">Role</dt><dd class="detail__value"><span class="pill pill--active">Trainer</span></dd></div>';
    html += '    <div class="detail"><dt class="detail__label">Designation</dt><dd class="detail__value">' + Dash.escape(p.designation || "Not specified") + '</dd></div>';
    html += '    <div class="detail"><dt class="detail__label">Organization</dt><dd class="detail__value">' + Dash.escape(p.organization || "Not specified") + '</dd></div>';
    html += '    <div class="detail"><dt class="detail__label">Contact Phone</dt><dd class="detail__value">' + Dash.escape(p.phone || "Not provided") + '</dd></div>';
    html += '    <div class="detail"><dt class="detail__label">Experience</dt><dd class="detail__value">' + (p.experience_years ? p.experience_years + ' Years' : "Not specified") + '</dd></div>';
    html += '    <div class="detail"><dt class="detail__label">Account Status</dt><dd class="detail__value">' + statusPill(u.status) + '</dd></div>';
    html += '  </dl>';

    // Edit Profile Form
    html += '  <div class="panel" style="border:1px solid var(--border); box-shadow:none;">';
    html += '    <div class="panel__head">';
    html += '      <h3 class="panel__title" style="font-size:1rem;">Edit Professional Profile</h3>';
    html += '    </div>';
    html += '    <div class="panel__body">';
    html += '      <form id="form-edit-trainer-profile">';
    html += '        <div class="form-row">';
    html += '          <div class="form-group">';
    html += '            <label class="form-label" for="profile-name">Full Name <span class="required">*</span></label>';
    html += '            <input type="text" class="form-input" id="profile-name" name="name" value="' + Dash.escape(u.name || "") + '" required maxlength="150" />';
    html += '          </div>';
    html += '          <div class="form-group">';
    html += '            <label class="form-label" for="profile-designation">Designation / Title</label>';
    html += '            <input type="text" class="form-input" id="profile-designation" name="designation" value="' + Dash.escape(p.designation || "") + '" maxlength="150" placeholder="e.g. Senior Technical Instructor / Capacity Specialist" />';
    html += '          </div>';
    html += '        </div>';
    html += '        <div class="form-row">';
    html += '          <div class="form-group">';
    html += '            <label class="form-label" for="profile-organization">Organization / Institution</label>';
    html += '            <input type="text" class="form-input" id="profile-organization" name="organization" value="' + Dash.escape(p.organization || "") + '" maxlength="200" placeholder="e.g. National Skill Institute / Ministry" />';
    html += '          </div>';
    html += '          <div class="form-group">';
    html += '            <label class="form-label" for="profile-phone">Contact Phone</label>';
    html += '            <input type="tel" class="form-input" id="profile-phone" name="phone" value="' + Dash.escape(p.phone || "") + '" maxlength="50" placeholder="+91 98765 43210" />';
    html += '          </div>';
    html += '          <div class="form-group" style="flex:0 1 140px;">';
    html += '            <label class="form-label" for="profile-exp">Experience (Yrs)</label>';
    html += '            <input type="number" class="form-input" id="profile-exp" name="experience_years" min="0" max="80" value="' + (p.experience_years !== undefined && p.experience_years !== null ? p.experience_years : '') + '" placeholder="Years" />';
    html += '          </div>';
    html += '        </div>';
    html += '        <div class="form-group">';
    html += '          <label class="form-label" for="profile-bio">Professional Bio &amp; Instructional Expertise</label>';
    html += '          <textarea class="form-textarea" id="profile-bio" name="bio" placeholder="Describe your instructional background, domain experience, and certifications…">' + Dash.escape(p.bio || "") + '</textarea>';
    html += '        </div>';
    html += '        <div class="form-group">';
    html += '          <label class="form-label" for="profile-photo-url">Profile Photo URL (Optional)</label>';
    html += '          <input type="url" class="form-input" id="profile-photo-url" name="profile_photo_url" value="' + Dash.escape(p.profile_photo_url || "") + '" placeholder="https://example.com/avatar.jpg" />';
    html += '        </div>';
    html += '        <div class="form-error" id="profile-edit-error" hidden></div>';
    html += '        <div style="margin-top:16px;">';
    html += '          <button class="btn btn--orange btn--sm" type="submit" id="btn-save-profile">Save Profile Changes</button>';
    html += '        </div>';
    html += '      </form>';
    html += '    </div>';
    html += '  </div>';

    // Skills & Competencies Management
    html += '  <div class="panel" style="border:1px solid var(--border); box-shadow:none;">';
    html += '    <div class="panel__head">';
    html += '      <div class="panel__titles">';
    html += '        <h3 class="panel__title" style="font-size:1rem;">Professional Skills &amp; Qualifications</h3>';
    html += '        <p class="panel__sub">Highlight individual skill competencies and technical proficiencies.</p>';
    html += '      </div>';
    html += '    </div>';
    html += '    <div class="panel__body">';
    html += '      <form id="form-add-skill" style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; margin-bottom:20px;">';
    html += '        <div class="form-group" style="flex:1 1 200px; margin-bottom:0;">';
    html += '          <label class="form-label" for="skill-name">Skill Name <span class="required">*</span></label>';
    html += '          <input type="text" class="form-input" id="skill-name" name="skill_name" required maxlength="100" placeholder="e.g. Python, Cloud Architecture, Data Governance" />';
    html += '        </div>';
    html += '        <div class="form-group" style="flex:0 1 180px; margin-bottom:0;">';
    html += '          <label class="form-label" for="skill-level">Proficiency Level</label>';
    html += '          <select class="form-select" id="skill-level" name="proficiency_level">';
    html += '            <option value="beginner">Beginner</option>';
    html += '            <option value="intermediate" selected>Intermediate</option>';
    html += '            <option value="advanced">Advanced</option>';
    html += '            <option value="expert">Expert</option>';
    html += '          </select>';
    html += '        </div>';
    html += '        <button class="btn btn--orange btn--sm" type="submit" id="btn-submit-add-skill">+ Add Skill</button>';
    html += '      </form>';

    if (!skills.length) {
      html += '      <div style="color:var(--text-muted); font-size:0.8125rem;">No skills registered yet. Use the form above to add your technical skills.</div>';
    } else {
      html += '      <div class="skill-tag-list">';
      skills.forEach(function (s) {
        html += '        <span class="skill-tag">';
        html += '          <span>' + Dash.escape(s.skill_name) + '</span>';
        html += '          <span class="skill-tag__level">' + Dash.escape(s.proficiency_level) + '</span>';
        html += '          <button class="skill-tag__remove btn-delete-skill" type="button" data-skill-id="' + Dash.escape(s.id) + '" title="Remove skill">✕</button>';
        html += '        </span>';
      });
      html += '      </div>';
    }
    html += '    </div>';
    html += '  </div>';

    html += '</div>';

    body.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Action Handlers & CRUD Mutations
     ------------------------------------------------------------------------ */

  // 1. Course Actions
  async function handleCreateCourse(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("create-course-error");
    var submitBtn = document.getElementById("btn-submit-create-course");
    if (errorEl) errorEl.hidden = true;

    var title = form.title.value.trim();
    var subjectId = form.subjectId.value ? form.subjectId.value : null;
    var description = form.description.value.trim() || null;
    var statusVal = form.status.value || "draft";

    if (!title) {
      if (errorEl) { errorEl.textContent = "Course title is required."; errorEl.hidden = false; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Creating course…"; }

    try {
      var newCourse = await API.post("courses", {
        title: title,
        subjectId: subjectId,
        description: description,
        status: statusVal
      });

      showToast("Course created successfully!", "success", "Course Created");
      closeModal("modal-create-course");
      form.reset();

      // Refresh list & metrics
      await loadCourses();

      // Open course builder
      if (newCourse && newCourse.id) {
        openCourseBuilder(newCourse.id);
      }
    } catch (err) {
      console.error("Course creation failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to create course. Please try again.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Create & Open Builder"; }
    }
  }

  async function handleEditCourse(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("edit-course-error");
    var submitBtn = document.getElementById("btn-submit-edit-course");
    if (errorEl) errorEl.hidden = true;

    var courseId = form.id.value;
    var title = form.title.value.trim();
    var subjectId = form.subjectId.value ? form.subjectId.value : null;
    var description = form.description.value.trim() || null;
    var statusVal = form.status.value;

    if (!courseId || !title) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      await API.patch("courses/" + courseId, {
        title: title,
        subjectId: subjectId,
        description: description,
        status: statusVal
      });

      showToast("Course information updated.", "success", "Saved");
      closeModal("modal-edit-course");

      await loadCourses();
      if (state.activeCourseId === courseId) {
        await openCourseBuilder(courseId);
      }
    } catch (err) {
      console.error("Course update failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to save course changes.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Changes"; }
    }
  }

  function handleDeleteCourse(courseId) {
    var course = state.courses.find(function (c) { return c.id === courseId; });
    var title = course ? course.title : "this course";

    confirmAction("Are you sure you want to permanently delete \"" + title + "\"? This action cannot be undone.", async function () {
      try {
        await API.del("courses/" + courseId);
        showToast("Course deleted successfully.", "success", "Course Deleted");
        if (state.activeCourseId === courseId) {
          state.activeCourseId = null;
          state.activeCourse = null;
          switchSection("#my-courses");
          window.location.hash = "#my-courses";
        }
        await loadCourses();
      } catch (err) {
        console.error("Course delete failed:", err);
        showToast("Cannot delete course: " + (err.message || "Course may have active enrollments."), "error", "Delete Failed");
      }
    }, "Delete Course");
  }

  async function handleToggleStatus(newStatus) {
    if (!state.activeCourse || !state.activeCourse.id) return;
    try {
      await API.patch("courses/" + state.activeCourse.id, { status: newStatus });
      showToast("Course status updated to " + newStatus, "success", "Status Updated");
      await loadCourses();
      await openCourseBuilder(state.activeCourse.id);
    } catch (err) {
      console.error("Status update failed:", err);
      showToast("Failed to update course status: " + (err.message || "Error"), "error", "Update Failed");
    }
  }

  // 2. Module Actions
  async function handleAddModule(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("add-module-error");
    var submitBtn = document.getElementById("btn-submit-add-module");
    if (errorEl) errorEl.hidden = true;

    var courseId = document.getElementById("add-module-course-id").value;
    var title = form.title.value.trim();
    var seq = form.sequence_no.value ? parseInt(form.sequence_no.value, 10) : undefined;

    if (!courseId || !title) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Adding…"; }

    try {
      await API.post("courses/" + courseId + "/modules", {
        title: title,
        sequence_no: seq
      });

      showToast("Module added to curriculum.", "success", "Module Created");
      closeModal("modal-add-module");
      form.reset();

      await openCourseBuilder(courseId);
    } catch (err) {
      console.error("Add module failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to add module.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add Module"; }
    }
  }

  async function handleEditModule(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("edit-module-error");
    var submitBtn = document.getElementById("btn-submit-edit-module");
    if (errorEl) errorEl.hidden = true;

    var moduleId = document.getElementById("edit-module-id").value;
    var title = form.title.value.trim();
    var seq = form.sequence_no.value ? parseInt(form.sequence_no.value, 10) : undefined;

    if (!moduleId || !title) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      await API.patch("modules/" + moduleId, {
        title: title,
        sequence_no: seq
      });

      showToast("Module updated.", "success", "Module Saved");
      closeModal("modal-edit-module");

      if (state.activeCourseId) {
        await openCourseBuilder(state.activeCourseId);
      }
    } catch (err) {
      console.error("Edit module failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to save module.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Module"; }
    }
  }

  function handleDeleteModule(moduleId) {
    confirmAction("Are you sure you want to delete this module and its study materials?", async function () {
      try {
        await API.del("modules/" + moduleId);
        showToast("Module deleted.", "success", "Module Deleted");
        if (state.activeCourseId) {
          await openCourseBuilder(state.activeCourseId);
        }
      } catch (err) {
        console.error("Delete module failed:", err);
        showToast("Failed to delete module: " + (err.message || "Error"), "error", "Delete Failed");
      }
    }, "Delete Module");
  }

  // 3. Resource Actions
  async function handleUploadResource(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("upload-resource-error");
    var submitBtn = document.getElementById("btn-submit-upload-resource");
    var progressBox = document.getElementById("upload-progress-container");
    var progressBar = document.getElementById("upload-progress-bar");
    var progressPct = document.getElementById("upload-progress-percent");
    var progressStatus = document.getElementById("upload-progress-status");

    if (errorEl) errorEl.hidden = true;

    var moduleId = document.getElementById("add-resource-module-id").value;
    var title = form.title.value.trim();
    var resType = form.type.value;
    var file = state.selectedUploadFile;

    if (!file) {
      if (errorEl) { errorEl.textContent = "Please select a file to upload."; errorEl.hidden = false; }
      return;
    }
    if (!title) {
      if (errorEl) { errorEl.textContent = "Resource title is required."; errorEl.hidden = false; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Uploading…"; }
    if (progressBox) progressBox.hidden = false;
    if (progressBar) progressBar.style.width = "20%";
    if (progressPct) progressPct.textContent = "20%";
    if (progressStatus) progressStatus.textContent = "Requesting signed upload URL…";

    try {
      // Step 1: Request signed upload target from FastAPI
      var uploadReq = {
        title: title,
        type: resType,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size
      };

      var signedRes = await API.post("modules/" + moduleId + "/resources/upload-url", uploadReq);

      if (progressBar) progressBar.style.width = "50%";
      if (progressPct) progressPct.textContent = "50%";
      if (progressStatus) progressStatus.textContent = "Transferring file to storage…";

      // Step 2: PUT file binary stream to the signed storage URL
      var uploadUrl = signedRes.upload_url;
      var uploadHeaders = {
        "Content-Type": file.type || "application/octet-stream"
      };

      var putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: uploadHeaders,
        body: file
      });

      if (!putRes.ok) {
        throw new Error("Storage upload failed (" + putRes.status + ")");
      }

      if (progressBar) progressBar.style.width = "100%";
      if (progressPct) progressPct.textContent = "100%";
      if (progressStatus) progressStatus.textContent = "Complete!";

      showToast("Resource uploaded successfully!", "success", "Resource Added");
      closeModal("modal-add-resource");
      form.reset();
      state.selectedUploadFile = null;
      var dropzoneLabel = document.getElementById("dropzone-label");
      if (dropzoneLabel) dropzoneLabel.textContent = "Click to browse or drag file here";

      if (state.activeCourseId) {
        await openCourseBuilder(state.activeCourseId);
      }
    } catch (err) {
      console.error("Resource upload failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Resource upload failed. Please verify file format and size.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Upload Resource"; }
      if (progressBox) progressBox.hidden = true;
    }
  }

  async function handleLinkResource(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("link-resource-error");
    var submitBtn = document.getElementById("btn-submit-link-resource");
    if (errorEl) errorEl.hidden = true;

    var moduleId = document.getElementById("add-resource-module-id").value;
    var title = form.title.value.trim();
    var url = form.url.value.trim();

    if (!moduleId || !title || !url) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      await API.post("modules/" + moduleId + "/resources/link", {
        title: title,
        url: url
      });

      showToast("External link resource added.", "success", "Link Attached");
      closeModal("modal-add-resource");
      form.reset();

      if (state.activeCourseId) {
        await openCourseBuilder(state.activeCourseId);
      }
    } catch (err) {
      console.error("Add link resource failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to attach link resource.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add Link"; }
    }
  }

  async function handleOpenResource(resourceId, type, directUrl) {
    if (type === "link" && directUrl) {
      window.open(directUrl, "_blank", "noopener,noreferrer");
      return;
    }

    try {
      var res = await API.get("resources/" + resourceId + "/download-url");
      if (res && res.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else if (directUrl) {
        window.open(directUrl, "_blank", "noopener,noreferrer");
      } else {
        showToast("Download URL not available for this resource.", "info");
      }
    } catch (err) {
      console.error("Failed to get resource download url:", err);
      showToast("Could not retrieve download link: " + (err.message || "Error"), "error");
    }
  }

  function handleDeleteResource(resourceId) {
    confirmAction("Are you sure you want to delete this resource?", async function () {
      try {
        await API.del("resources/" + resourceId);
        showToast("Resource deleted.", "success", "Resource Removed");
        if (state.activeCourseId) {
          await openCourseBuilder(state.activeCourseId);
        }
      } catch (err) {
        console.error("Delete resource failed:", err);
        showToast("Failed to delete resource: " + (err.message || "Error"), "error", "Delete Failed");
      }
    }, "Delete Resource");
  }

  // 4. Competency Actions
  async function handleDeclareCompetency(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("declare-competency-error");
    var submitBtn = document.getElementById("btn-submit-declare-competency");
    if (errorEl) errorEl.hidden = true;

    var subjectId = form.subjectId.value;
    var score = parseFloat(form.proficiency_score.value);

    if (!subjectId) {
      if (errorEl) { errorEl.textContent = "Please select a subject."; errorEl.hidden = false; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      await API.post("competencies/self", {
        subjectId: subjectId,
        proficiency_score: score
      });

      showToast("Competency self-declared successfully.", "success", "Competency Saved");
      closeModal("modal-declare-competency");
      form.reset();

      await loadCompetencies();
      await loadProfile();
    } catch (err) {
      console.error("Declare competency failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to save competency.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Competency"; }
    }
  }

  function handleDeleteCompetency(competencyId) {
    confirmAction("Are you sure you want to remove this competency mapping?", async function () {
      try {
        await API.del("competencies/" + competencyId);
        showToast("Competency removed.", "success", "Competency Removed");
        await loadCompetencies();
        await loadProfile();
      } catch (err) {
        console.error("Delete competency failed:", err);
        showToast("Failed to remove competency: " + (err.message || "Error"), "error", "Remove Failed");
      }
    }, "Remove Competency");
  }

  // 5. Profile & Skills Actions
  async function handleSaveProfile(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("profile-edit-error");
    var submitBtn = document.getElementById("btn-save-profile");
    if (errorEl) errorEl.hidden = true;

    var nameVal = form.name.value.trim();
    var designationVal = form.designation.value.trim() || null;
    var organizationVal = form.organization ? form.organization.value.trim() || null : null;
    var phoneVal = form.phone ? form.phone.value.trim() || null : null;
    var expVal = form.experience_years && form.experience_years.value ? parseInt(form.experience_years.value, 10) : null;
    var bioVal = form.bio.value.trim() || null;
    var photoVal = form.profile_photo_url.value.trim() || null;

    if (!nameVal) {
      if (errorEl) { errorEl.textContent = "Name is required."; errorEl.hidden = false; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      // 1. Update name if changed
      if (nameVal !== state.user.name) {
        await API.patch("auth/me", { name: nameVal });
        state.user.name = nameVal;
        var topName = document.getElementById("user-name");
        if (topName) topName.textContent = nameVal;
        var welcomeName = document.getElementById("welcome-name");
        if (welcomeName) welcomeName.textContent = nameVal.split(" ")[0];
      }

      // 2. Update trainer profile
      var updated = await API.patch("profile/trainer", {
        designation: designationVal,
        organization: organizationVal,
        phone: phoneVal,
        experience_years: expVal,
        bio: bioVal,
        profile_photo_url: photoVal
      });

      state.profile = updated;
      showToast("Profile details updated successfully.", "success", "Profile Saved");
      renderProfileView();
    } catch (err) {
      console.error("Profile save failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to update profile.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Profile Changes"; }
    }
  }

  async function handleAddSkill(e) {
    e.preventDefault();
    var form = e.target;
    var skillName = form.skill_name.value.trim();
    var level = form.proficiency_level.value;
    var submitBtn = document.getElementById("btn-submit-add-skill");

    if (!skillName) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Adding…"; }

    try {
      await API.post("profile/skills", {
        skill_name: skillName,
        proficiency_level: level
      });

      showToast("Skill added.", "success", "Skill Added");
      form.reset();
      await loadProfile();
    } catch (err) {
      console.error("Add skill failed:", err);
      showToast("Failed to add skill: " + (err.message || "Error"), "error");
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "+ Add Skill"; }
    }
  }

  async function handleDeleteSkill(skillId) {
    try {
      await API.del("profile/skills/" + skillId);
      showToast("Skill removed.", "success", "Skill Removed");
      await loadProfile();
    } catch (err) {
      console.error("Delete skill failed:", err);
      showToast("Failed to remove skill: " + (err.message || "Error"), "error");
    }
  }

  /* ------------------------------------------------------------------------
     Event Listeners Binding
     ------------------------------------------------------------------------ */
  function bindGlobalEvents() {
    // Navigation hash change
    window.addEventListener("hashchange", function () {
      switchSection(window.location.hash);
    });

    // Modals close buttons & backdrop click
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-modal-close]")) {
        var backdrop = e.target.closest(".modal-backdrop");
        if (backdrop) closeModal(backdrop.id);
      } else if (e.target.classList.contains("modal-backdrop")) {
        closeModal(e.target.id);
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeAllModals();
    });

    // Quick action: create course
    var quickCreateBtn = document.getElementById("btn-quick-create-course");
    if (quickCreateBtn) {
      quickCreateBtn.addEventListener("click", function () {
        openModal("modal-create-course");
      });
    }

    var openCreateCourseBtn = document.getElementById("btn-open-create-course");
    if (openCreateCourseBtn) {
      openCreateCourseBtn.addEventListener("click", function () {
        openModal("modal-create-course");
      });
    }

    // Quick action: declare competency
    var openAddCompBtn = document.getElementById("btn-open-add-competency");
    if (openAddCompBtn) {
      openAddCompBtn.addEventListener("click", function () {
        openModal("modal-declare-competency");
      });
    }

    // Confirm dialog action
    var confirmBtn = document.getElementById("btn-confirm-action");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        closeModal("modal-confirm");
        if (typeof state.pendingConfirmAction === "function") {
          state.pendingConfirmAction();
          state.pendingConfirmAction = null;
        }
      });
    }

    // Courses filter inputs
    var searchInput = document.getElementById("courses-search");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        renderCoursesList();
      });
    }

    var statusFilter = document.getElementById("courses-status-filter");
    if (statusFilter) {
      statusFilter.addEventListener("change", function () {
        renderCoursesList();
      });
    }

    // Trainees filter inputs
    var traineeCourseFilter = document.getElementById("trainees-course-filter");
    if (traineeCourseFilter) {
      traineeCourseFilter.addEventListener("change", function () {
        renderTraineesList();
      });
    }

    var traineeStatusFilter = document.getElementById("trainees-status-filter");
    if (traineeStatusFilter) {
      traineeStatusFilter.addEventListener("change", function () {
        renderTraineesList();
      });
    }

    // Competency slider range feedback
    var scoreInput = document.getElementById("declare-competency-score");
    var scoreDisplay = document.getElementById("score-display");
    if (scoreInput && scoreDisplay) {
      scoreInput.addEventListener("input", function () {
        scoreDisplay.textContent = Number(scoreInput.value).toFixed(1) + " / 10";
      });
    }

    // Resource subtabs (Upload vs Link)
    var tabUpload = document.getElementById("tab-btn-upload");
    var tabLink = document.getElementById("tab-btn-link");
    var formUpload = document.getElementById("form-upload-resource");
    var formLink = document.getElementById("form-link-resource");

    if (tabUpload && tabLink && formUpload && formLink) {
      tabUpload.addEventListener("click", function () {
        tabUpload.setAttribute("aria-selected", "true");
        tabLink.setAttribute("aria-selected", "false");
        formUpload.hidden = false;
        formLink.hidden = true;
      });

      tabLink.addEventListener("click", function () {
        tabLink.setAttribute("aria-selected", "true");
        tabUpload.setAttribute("aria-selected", "false");
        formLink.hidden = false;
        formUpload.hidden = true;
      });
    }

    // Dropzone & File Input
    var dropzone = document.getElementById("resource-dropzone");
    var fileInput = document.getElementById("upload-file-input");
    var dropzoneLabel = document.getElementById("dropzone-label");

    if (dropzone && fileInput) {
      dropzone.addEventListener("click", function () {
        fileInput.click();
      });

      fileInput.addEventListener("change", function () {
        if (fileInput.files && fileInput.files[0]) {
          state.selectedUploadFile = fileInput.files[0];
          if (dropzoneLabel) {
            dropzoneLabel.textContent = "Selected: " + fileInput.files[0].name + " (" + (fileInput.files[0].size / 1024 / 1024).toFixed(2) + " MB)";
          }
        }
      });

      dropzone.addEventListener("dragover", function (e) {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      });

      dropzone.addEventListener("dragleave", function () {
        dropzone.classList.remove("is-dragover");
      });

      dropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          state.selectedUploadFile = e.dataTransfer.files[0];
          if (dropzoneLabel) {
            dropzoneLabel.textContent = "Selected: " + e.dataTransfer.files[0].name + " (" + (e.dataTransfer.files[0].size / 1024 / 1024).toFixed(2) + " MB)";
          }
        }
      });
    }

    // Form Submissions
    var createCourseForm = document.getElementById("form-create-course");
    if (createCourseForm) createCourseForm.addEventListener("submit", handleCreateCourse);

    var editCourseForm = document.getElementById("form-edit-course");
    if (editCourseForm) editCourseForm.addEventListener("submit", handleEditCourse);

    var addModuleForm = document.getElementById("form-add-module");
    if (addModuleForm) addModuleForm.addEventListener("submit", handleAddModule);

    var editModuleForm = document.getElementById("form-edit-module");
    if (editModuleForm) editModuleForm.addEventListener("submit", handleEditModule);

    var uploadResourceForm = document.getElementById("form-upload-resource");
    if (uploadResourceForm) uploadResourceForm.addEventListener("submit", handleUploadResource);

    var linkResourceForm = document.getElementById("form-link-resource");
    if (linkResourceForm) linkResourceForm.addEventListener("submit", handleLinkResource);

    var declareCompetencyForm = document.getElementById("form-declare-competency");
    if (declareCompetencyForm) declareCompetencyForm.addEventListener("submit", handleDeclareCompetency);

    // Delegated actions across document
    document.addEventListener("click", function (e) {
      // 1. Manage / Open builder
      var openBuilderBtn = e.target.closest(".btn-open-builder");
      if (openBuilderBtn) {
        var courseId = openBuilderBtn.getAttribute("data-course-id");
        openCourseBuilder(courseId);
        return;
      }

      // 2. Edit course metadata
      var editCourseBtn = e.target.closest(".btn-edit-course");
      if (editCourseBtn) {
        var cId = editCourseBtn.getAttribute("data-course-id");
        var c = state.courses.find(function (item) { return item.id === cId; });
        if (c) {
          document.getElementById("edit-course-id").value = c.id;
          document.getElementById("edit-course-title").value = c.title || "";
          document.getElementById("edit-course-subject").value = c.subject_id || "";
          document.getElementById("edit-course-desc").value = c.description || "";
          document.getElementById("edit-course-status").value = c.status || "draft";
          openModal("modal-edit-course");
        }
        return;
      }

      // 3. Delete course
      var delCourseBtn = e.target.closest(".btn-delete-course");
      if (delCourseBtn) {
        var dCourseId = delCourseBtn.getAttribute("data-course-id");
        handleDeleteCourse(dCourseId);
        return;
      }

      // 4. Course Builder Banner Actions
      if (e.target.closest("#btn-builder-edit-info")) {
        if (state.activeCourse) {
          document.getElementById("edit-course-id").value = state.activeCourse.id;
          document.getElementById("edit-course-title").value = state.activeCourse.title || "";
          document.getElementById("edit-course-subject").value = state.activeCourse.subject_id || "";
          document.getElementById("edit-course-desc").value = state.activeCourse.description || "";
          document.getElementById("edit-course-status").value = state.activeCourse.status || "draft";
          openModal("modal-edit-course");
        }
        return;
      }

      if (e.target.closest("#btn-builder-publish")) {
        handleToggleStatus("published");
        return;
      }

      if (e.target.closest("#btn-builder-archive")) {
        handleToggleStatus("archived");
        return;
      }

      if (e.target.closest("#btn-builder-draft")) {
        handleToggleStatus("draft");
        return;
      }

      if (e.target.closest("#btn-builder-add-module") || e.target.closest("#btn-empty-add-module")) {
        if (state.activeCourseId) {
          document.getElementById("add-module-course-id").value = state.activeCourseId;
          var nextSeq = (state.activeCourse && state.activeCourse.modules) ? (state.activeCourse.modules.length + 1) : 1;
          document.getElementById("add-module-seq").value = nextSeq;
          openModal("modal-add-module");
        }
        return;
      }

      // 5. Edit Module
      var editModBtn = e.target.closest(".btn-edit-module");
      if (editModBtn) {
        var mId = editModBtn.getAttribute("data-module-id");
        var mTitle = editModBtn.getAttribute("data-title");
        var mSeq = editModBtn.getAttribute("data-seq");
        document.getElementById("edit-module-id").value = mId;
        document.getElementById("edit-module-title").value = mTitle || "";
        document.getElementById("edit-module-seq").value = mSeq || "1";
        openModal("modal-edit-module");
        return;
      }

      // 6. Delete Module
      var delModBtn = e.target.closest(".btn-delete-module");
      if (delModBtn) {
        var dModId = delModBtn.getAttribute("data-module-id");
        handleDeleteModule(dModId);
        return;
      }

      // 7. Add Resource to Module
      var addResBtn = e.target.closest(".btn-module-add-resource");
      if (addResBtn) {
        var resModId = addResBtn.getAttribute("data-module-id");
        document.getElementById("add-resource-module-id").value = resModId;
        state.selectedUploadFile = null;
        if (dropzoneLabel) dropzoneLabel.textContent = "Click to browse or drag file here";
        var fUp = document.getElementById("form-upload-resource");
        var fLk = document.getElementById("form-link-resource");
        if (fUp) fUp.reset();
        if (fLk) fLk.reset();
        openModal("modal-add-resource");
        return;
      }

      // 8. Open / Download Resource
      var openResBtn = e.target.closest(".btn-open-resource");
      if (openResBtn) {
        var rId = openResBtn.getAttribute("data-resource-id");
        var rType = openResBtn.getAttribute("data-type");
        var rUrl = openResBtn.getAttribute("data-url");
        handleOpenResource(rId, rType, rUrl);
        return;
      }

      // 9. Delete Resource
      var delResBtn = e.target.closest(".btn-delete-resource");
      if (delResBtn) {
        var dResId = delResBtn.getAttribute("data-resource-id");
        handleDeleteResource(dResId);
        return;
      }

      // 10. Delete Competency
      var delCompBtn = e.target.closest(".btn-delete-competency");
      if (delCompBtn) {
        var compId = delCompBtn.getAttribute("data-competency-id");
        handleDeleteCompetency(compId);
        return;
      }

      // 11. Delete Skill
      var delSkillBtn = e.target.closest(".btn-delete-skill");
      if (delSkillBtn) {
        var skId = delSkillBtn.getAttribute("data-skill-id");
        handleDeleteSkill(skId);
        return;
      }
    });

    // Delegated profile & skill form submissions
    document.addEventListener("submit", function (e) {
      if (e.target && e.target.id === "form-edit-trainer-profile") {
        handleSaveProfile(e);
      } else if (e.target && e.target.id === "form-add-skill") {
        handleAddSkill(e);
      }
    });
  }

  /* ------------------------------------------------------------------------
     Bootstrapping
     ------------------------------------------------------------------------ */
  Dash.init({
    role: "trainer",
    onReady: async function (ctx) {
      bindGlobalEvents();

      try {
        // 1. Resolve current user & trainer_profile_id from /auth/me
        var me = await API.get("auth/me");
        state.user = me;
        state.trainerProfileId = me.trainer_profile_id;

        // Update header user information
        var topName = document.getElementById("user-name");
        if (topName) topName.textContent = me.name || ctx.name;
        var topSub = document.getElementById("user-sub");
        if (topSub) topSub.textContent = me.email || ctx.user.email;
        var welcomeName = document.getElementById("welcome-name");
        if (welcomeName) welcomeName.textContent = (me.name || ctx.name || "").split(" ")[0] || "Trainer";

        // 2. Load subjects taxonomy
        await loadSubjects();

        // 3. Load authored courses
        await loadCourses();

        // 4. Load competencies
        await loadCompetencies();

        // 5. Load profile & skills
        await loadProfile();

        // 6. Load trainee rosters
        await loadTrainees();

        // 7. Load announcements
        await loadAnnouncements();

        // 8. Route to active section or default to #overview
        switchSection(window.location.hash || "#overview");
      } catch (err) {
        console.error("Error during trainer workspace initialization:", err);
        showToast("Error initializing workspace: " + (err.message || "Please refresh"), "error");
      }
    }
  });

})(window, document);
