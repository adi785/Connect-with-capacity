/* ==========================================================================
   CAPACITY CONNECT — Trainee Dashboard
   Complete end-to-end integration:
   - Trainee Metrics (/api/v1/dashboard/trainee)
   - Course Catalog & Self-Enrollment (/api/v1/courses, /api/v1/courses/{id}/enroll)
   - Enrolled Courses & Study Room (/api/v1/enrollments, /api/v1/courses/{id})
   - Learning Progress Tracking (/api/v1/enrollments/{id}/progress)
   - Interactive Assessment Taking & Instant Scoring (/api/v1/assessments, /api/v1/attempts)
   - Verified Certificates (/api/v1/profile/trainee)
   - Official Announcements Feed (/api/v1/notifications)
   - Professional Profile, Qualifications, Experience, Skills & Interests (/api/v1/profile/trainee)
   ========================================================================== */

(function (window, document) {
  "use strict";

  var API = window.CapacityConnectAPI || window.API;

  var state = {
    user: null,
    profile: null,
    catalog: [],
    subjects: [],
    enrollments: [],
    certificates: [],
    announcements: [],
    stats: null,
    activeStudyCourse: null,
    activeEnrollment: null,
    activeAttempt: null,
    timerInterval: null
  };

  /* ------------------------------------------------------------------------
     UI Helpers
     ------------------------------------------------------------------------ */

  function statusPill(status) {
    var value = String(status || "").toLowerCase();
    if (value === "active" || value === "approved" || value === "completed" || value === "passed") {
      return '<span class="pill pill--active">' + Dash.escape(Dash.titleCase(value)) + '</span>';
    }
    if (value === "in_progress" || value === "enrolled" || value === "pending") {
      return '<span class="pill pill--orange">' + Dash.escape(Dash.titleCase(value)) + '</span>';
    }
    if (value === "dropped" || value === "suspended" || value === "rejected" || value === "failed") {
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

  function showToast(message, type, title) {
    var container = document.getElementById("toast-container");
    if (!container) return;

    var toast = document.createElement("div");
    toast.className = "toast toast--" + (type || "info");

    var iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    if (type === "success") {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    } else if (type === "error") {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    }

    toast.innerHTML =
      '<div class="toast__icon">' + iconSvg + '</div>' +
      '<div class="toast__body">' +
      (title ? '<p class="toast__title">' + Dash.escape(title) + '</p>' : '') +
      '<p class="toast__text">' + Dash.escape(message) + '</p>' +
      '</div>' +
      '<button class="toast__close" type="button" aria-label="Dismiss">✕</button>';

    container.appendChild(toast);

    toast.querySelector(".toast__close").addEventListener("click", function () {
      dismissToast(toast);
    });

    setTimeout(function () {
      dismissToast(toast);
    }, 4500);
  }

  function dismissToast(el) {
    if (!el || !el.parentNode) return;
    el.style.opacity = "0";
    el.style.transform = "translateX(20px)";
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 250);
  }

  function openModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function closeAllModals() {
    document.querySelectorAll(".modal-backdrop.is-open").forEach(function (m) {
      closeModal(m.id);
    });
  }

  /* ------------------------------------------------------------------------
     Navigation
     ------------------------------------------------------------------------ */

  function switchSection(targetHash) {
    var hash = targetHash || window.location.hash || "#overview";
    if (!hash.startsWith("#")) hash = "#" + hash;

    var validSections = ["#overview", "#catalog", "#my-courses", "#course-study", "#certificates", "#announcements", "#profile"];
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

  // 2. Subjects Taxonomy
  async function loadSubjects() {
    try {
      var res = await API.get("subjects?limit=100");
      state.subjects = (res && res.items) || (Array.isArray(res) ? res : []);
      populateSubjectFilter();
    } catch (err) {
      console.warn("Could not load subjects:", err);
    }
  }

  function populateSubjectFilter() {
    var select = document.getElementById("catalog-subject-filter");
    if (!select) return;
    select.innerHTML = '<option value="">All Subjects (' + state.subjects.length + ')</option>';
    state.subjects.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
  }

  // 3. Course Catalog (Published Courses)
  async function loadCatalog() {
    var body = document.getElementById("catalog-body");
    if (body) Dash.renderLoading(body, "Loading available courses…");

    try {
      var res = await API.get("courses?status=published&limit=100");
      var items = (res && res.items) || (Array.isArray(res) ? res : []);
      state.catalog = items;
      renderCatalog();
    } catch (err) {
      console.error("Failed to load course catalog:", err);
      if (body) {
        Dash.renderError(body, "Failed to load courses: " + (err.message || "Network error"), function () {
          loadCatalog();
        });
      }
    }
  }

  // 4. Enrollments & Course Progress
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
      renderCatalog(); // update enrollment badges in catalog
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

  // 5. Certificates & Profile
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

  // 6. Announcements
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

  function isCourseEnrolled(courseId) {
    return state.enrollments.some(function (e) {
      return e.course_id === courseId && e.status !== "dropped";
    });
  }

  function getEnrollmentForCourse(courseId) {
    return state.enrollments.find(function (e) {
      return e.course_id === courseId && e.status !== "dropped";
    });
  }

  function renderCatalog() {
    var body = document.getElementById("catalog-body");
    if (!body) return;

    var searchVal = (document.getElementById("catalog-search") ? document.getElementById("catalog-search").value : "").toLowerCase().trim();
    var subjectFilter = document.getElementById("catalog-subject-filter") ? document.getElementById("catalog-subject-filter").value : "";

    var filtered = state.catalog.filter(function (c) {
      if (subjectFilter && c.subject_id !== subjectFilter) return false;
      if (searchVal) {
        var matchTitle = (c.title || "").toLowerCase().includes(searchVal);
        var matchDesc = (c.description || "").toLowerCase().includes(searchVal);
        var matchTrainer = (c.trainer_name || "").toLowerCase().includes(searchVal);
        if (!matchTitle && !matchDesc && !matchTrainer) return false;
      }
      return true;
    });

    if (!filtered.length) {
      Dash.renderEmpty(
        body,
        "No courses found.",
        searchVal || subjectFilter ? "Try adjusting your search criteria or filter." : "No published courses are currently available in the catalog."
      );
      return;
    }

    var html = '<div class="catalog-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:20px; padding:20px;">';

    filtered.forEach(function (c) {
      var enrolled = isCourseEnrolled(c.id);
      var enrObj = getEnrollmentForCourse(c.id);
      var subjectLabel = c.subject_name || "General Subject";
      var trainerLabel = c.trainer_name || "Faculty Trainer";
      var modCount = c.module_count || 0;

      html += '<article class="course-card" style="background:#fff; border:1px solid var(--border); border-radius:var(--radius-md); padding:20px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:0 1px 3px rgba(0,0,0,0.05); transition:transform 0.2s ease;">';
      html += '  <div>';
      html += '    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">';
      html += '      <span class="pill pill--orange" style="font-size:0.75rem;">' + Dash.escape(subjectLabel) + '</span>';
      if (enrolled) {
        html += '      <span class="pill pill--active">✓ Enrolled (' + (enrObj.progress_percent || 0) + '%)</span>';
      }
      html += '    </div>';
      html += '    <h3 style="font-size:1.125rem; font-weight:700; color:var(--primary-blue-dark); margin:0 0 8px 0; line-height:1.4;">' + Dash.escape(c.title) + '</h3>';
      if (c.description) {
        html += '    <p style="font-size:0.875rem; color:var(--text-muted); line-height:1.5; margin:0 0 14px 0; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">' + Dash.escape(c.description) + '</p>';
      }
      html += '  </div>';

      html += '  <div style="border-top:1px solid var(--border-light); padding-top:14px; margin-top:12px;">';
      html += '    <div style="display:flex; justify-content:space-between; font-size:0.8125rem; color:var(--text-dark); margin-bottom:12px;">';
      html += '      <span><strong>Instructor:</strong> ' + Dash.escape(trainerLabel) + '</span>';
      html += '      <span><strong>Modules:</strong> ' + modCount + '</span>';
      html += '    </div>';

      if (enrolled) {
        html += '    <button class="btn btn--orange btn--sm btn-open-study" type="button" style="width:100%;" data-course-id="' + Dash.escape(c.id) + '" data-enrollment-id="' + Dash.escape(enrObj.id) + '">';
        html += '      Open Study Room →';
        html += '    </button>';
      } else {
        html += '    <button class="btn btn--orange btn--sm btn-enroll-course" type="button" style="width:100%;" data-course-id="' + Dash.escape(c.id) + '">';
        html += '      + Enroll in Course';
        html += '    </button>';
      }
      html += '  </div>';
      html += '</article>';
    });

    html += '</div>';
    body.innerHTML = html;
  }

  function renderCourseTable(rows) {
    var body = document.getElementById("courses-body");
    if (!body) return;

    if (!rows.length) {
      Dash.renderEmpty(
        body,
        "No courses enrolled yet.",
        "Browse the available courses from the Course Catalog to start learning."
      );
      return;
    }

    var html = '<div class="table-scroll"><table class="data-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Course Title</th>';
    html += '<th scope="col">Progress</th>';
    html += '<th scope="col">Status</th>';
    html += '<th scope="col">Enrolled Date</th>';
    html += '<th scope="col" style="text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    rows.forEach(function (row) {
      var pct = Math.max(0, Math.min(100, Math.round(row.progress_percent || 0)));
      var isDone = row.status === "completed" || pct >= 100;
      var title = row.course_title || row.title || "Course " + (row.course_id || "");

      html += '<tr>';
      html += '  <td class="cell-strong">' + Dash.escape(title) + '</td>';
      html += '  <td>';
      html += '    <div style="display:flex; align-items:center; gap:8px;">';
      html += '      <span class="progress"><span class="progress__fill" style="width:' + pct + '%;"></span></span>';
      html += '      <span style="font-size:0.8125rem; font-weight:700;">' + pct + '%</span>';
      html += '    </div>';
      html += '  </td>';
      html += '  <td>' + (isDone ? '<span class="pill pill--active">Completed</span>' : statusPill(row.status || "in_progress")) + '</td>';
      html += '  <td>' + Dash.escape(formatDateTime(row.enrolled_at || row.created_at)) + '</td>';
      html += '  <td style="text-align:right;">';
      html += '    <button class="btn btn--orange btn--sm btn-open-study" type="button" data-course-id="' + Dash.escape(row.course_id) + '" data-enrollment-id="' + Dash.escape(row.id) + '">';
      html += '      Open Study Room →';
      html += '    </button>';
      html += '  </td>';
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
          : "Enrol in a course from the catalog to begin tracking your progress."
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
      '<button class="btn btn--orange btn--sm btn-open-study" type="button" data-course-id="' + Dash.escape(top.course_id) + '" data-enrollment-id="' + Dash.escape(top.id) + '">' +
      'Resume Learning →' +
      '</button>' +
      '</div>';
  }

  // 5. Course Study Room View
  async function openCourseStudy(courseId, enrollmentId) {
    if (!courseId) return;
    var studyBody = document.getElementById("study-body");
    if (studyBody) Dash.renderLoading(studyBody, "Loading course curriculum and resources…");

    switchSection("#course-study");
    window.location.hash = "#course-study";

    try {
      var course = await API.get("courses/" + courseId);
      state.activeStudyCourse = course;

      var enrollment = getEnrollmentForCourse(courseId);
      state.activeEnrollment = enrollment;

      // Load assessments for this course
      var assessments = [];
      try {
        var aRes = await API.get("assessments?courseId=" + courseId);
        assessments = (aRes && aRes.items) || (Array.isArray(aRes) ? aRes : []);
      } catch (aErr) {
        console.warn("Could not load course assessments:", aErr);
      }

      renderCourseStudy(course, enrollment, assessments);
    } catch (err) {
      console.error("Failed to load study room:", err);
      if (studyBody) {
        Dash.renderError(studyBody, "Failed to load course: " + (err.message || "Network error"), function () {
          openCourseStudy(courseId, enrollmentId);
        });
      }
    }
  }

  function renderCourseStudy(c, enr, assessments) {
    var body = document.getElementById("study-body");
    if (!body) return;

    var pct = (enr && enr.progress_percent) ? Math.min(100, Math.max(0, Math.round(enr.progress_percent))) : 0;
    var modules = Array.isArray(c.modules) ? c.modules : [];
    modules.sort(function (a, b) { return (a.sequence_no || 0) - (b.sequence_no || 0); });

    var html = '';

    // Banner
    html += '<div class="builder-banner">';
    html += '  <div class="builder-banner__info">';
    html += '    <a class="builder-banner__back" href="#my-courses" id="btn-back-to-enrolled">';
    html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to My Courses';
    html += '    </a>';
    html += '    <h1 class="builder-banner__title">' + Dash.escape(c.title) + '</h1>';
    html += '    <div class="builder-banner__meta">';
    html += '      <span><strong>Instructor:</strong> ' + Dash.escape(c.trainer_name || "Faculty") + '</span>';
    html += '      <span><strong>Modules:</strong> ' + modules.length + '</span>';
    html += '      <span><strong>Your Progress:</strong> ' + pct + '%</span>';
    html += '    </div>';
    html += '  </div>';

    // Progress Controls
    if (enr) {
      html += '  <div class="builder-banner__actions" style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">';
      html += '    <span style="font-size:0.8125rem; font-weight:700; color:#fff;">Update Progress:</span>';
      html += '    <div style="display:flex; gap:6px;">';
      html += '      <button class="btn btn--outline btn--sm btn-set-progress" type="button" data-enrollment-id="' + Dash.escape(enr.id) + '" data-pct="25" style="background:#fff; color:var(--primary-blue);">25%</button>';
      html += '      <button class="btn btn--outline btn--sm btn-set-progress" type="button" data-enrollment-id="' + Dash.escape(enr.id) + '" data-pct="50" style="background:#fff; color:var(--primary-blue);">50%</button>';
      html += '      <button class="btn btn--outline btn--sm btn-set-progress" type="button" data-enrollment-id="' + Dash.escape(enr.id) + '" data-pct="75" style="background:#fff; color:var(--primary-blue);">75%</button>';
      html += '      <button class="btn btn--approve btn--sm btn-set-progress" type="button" data-enrollment-id="' + Dash.escape(enr.id) + '" data-pct="100">100% (Complete)</button>';
      html += '    </div>';
      html += '  </div>';
    }
    html += '</div>';

    // Curriculum Modules
    html += '<div style="padding: 24px;">';
    html += '  <h2 style="font-size: 1.25rem; color: var(--primary-blue-dark); margin: 0 0 16px 0;">Curriculum &amp; Learning Materials</h2>';

    if (!modules.length) {
      html += '  <div style="padding: 20px; background: var(--warm-white); border-radius: var(--radius-sm); border: 1px dashed var(--border); text-align: center; color: var(--text-muted);">';
      html += '    No lesson modules uploaded yet by the instructor.';
      html += '  </div>';
    } else {
      html += '  <div class="module-list" style="margin-bottom: 28px;">';
      modules.forEach(function (m, idx) {
        var seq = m.sequence_no !== undefined ? m.sequence_no : (idx + 1);
        var resources = Array.isArray(m.resources) ? m.resources : [];

        html += '<article class="module-card" style="margin-bottom: 16px;">';
        html += '  <div class="module-card__head">';
        html += '    <div class="module-card__title-wrap">';
        html += '      <span class="module-badge">' + seq + '</span>';
        html += '      <h3 class="module-card__title">' + Dash.escape(m.title) + '</h3>';
        html += '    </div>';
        html += '  </div>';
        html += '  <div class="module-card__body">';

        if (!resources.length) {
          html += '    <div style="padding: 12px; color: var(--text-muted); font-size: 0.8125rem;">No study materials attached to this module.</div>';
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
            html += '      <div class="resource-item">';
            html += '        <div class="resource-item__info">';
            html += '          <div class="resource-item__icon ' + iconClass + '">' + iconSvg + '</div>';
            html += '          <div class="resource-item__meta">';
            html += '            <div class="resource-item__title">' + Dash.escape(res.title) + '</div>';
            html += '            <div class="resource-item__sub">' + Dash.escape(typeName) + '</div>';
            html += '          </div>';
            html += '        </div>';
            html += '        <button class="btn btn--outline btn--sm btn-open-resource" type="button" data-resource-id="' + Dash.escape(res.id) + '" data-type="' + Dash.escape(res.type) + '" data-url="' + Dash.escape(res.file_url || '') + '">';
            html += res.type === 'link' ? 'Open Link ↗' : 'View / Download ↓';
            html += '        </button>';
            html += '      </div>';
          });
          html += '    </div>';
        }

        html += '  </div>';
        html += '</article>';
      });
      html += '  </div>';
    }

    // Assessments Box
    html += '  <hr style="border: 0; border-top: 1px solid var(--border); margin: 24px 0;" />';
    html += '  <h2 style="font-size: 1.25rem; color: var(--primary-blue-dark); margin: 0 0 16px 0;">Course Assessment &amp; Final Exam</h2>';

    if (!assessments.length) {
      html += '  <div style="padding: 20px; background: var(--warm-white); border-radius: var(--radius-sm); text-align: center; color: var(--text-muted);">';
      html += '    No assessments currently required for this course.';
      html += '  </div>';
    } else {
      html += '  <div style="display: flex; flex-direction: column; gap: 14px;">';
      assessments.forEach(function (ass) {
        var timeLabel = ass.time_limit_minutes ? (ass.time_limit_minutes + " mins") : "Untimed";

        html += '    <div style="background: #fff; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">';
        html += '      <div>';
        html += '        <h4 style="font-size: 1.0625rem; font-weight: 700; color: var(--primary-blue-dark); margin: 0 0 6px 0;">' + Dash.escape(ass.title) + '</h4>';
        html += '        <div style="font-size: 0.8125rem; color: var(--text-muted); display: flex; gap: 14px;">';
        html += '          <span>Pass Requirement: <strong>' + (ass.pass_percentage || 70) + '%</strong></span>';
        html += '          <span>Time Limit: <strong>' + Dash.escape(timeLabel) + '</strong></span>';
        html += '        </div>';
        html += '      </div>';
        html += '      <button class="btn btn--orange btn--sm btn-start-assessment" type="button" data-assessment-id="' + Dash.escape(ass.id) + '">';
        html += '        Take Assessment →';
        html += '      </button>';
        html += '    </div>';
      });
      html += '  </div>';
    }

    html += '</div>';
    body.innerHTML = html;
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
    var quals = Array.isArray(p.qualifications) ? p.qualifications : [];
    var exps = Array.isArray(p.work_experience) ? p.work_experience : [];

    var rows = [
      ["Full Name", Dash.escape(u.name || "Trainee")],
      ["Email Address", Dash.escape(u.email || "—")],
      ["Headline", Dash.escape(p.headline || "Learner")],
      ["Bio", Dash.escape(p.bio || "No biography added.")],
      ["Employee ID", u.employee_id ? Dash.escape(u.employee_id) : '<span class="cell-muted">Not provided</span>'],
      ["Account Status", statusPill(u.status)],
      ["Member Since", Dash.escape(formatDateTime(u.created_at))]
    ];

    var html = '<div style="padding: 20px;">';
    html += '<dl class="detail-grid" style="margin-bottom: 24px;">';
    rows.forEach(function (r) {
      html += '<div class="detail"><dt class="detail__label">' + r[0] + '</dt><dd class="detail__value">' + r[1] + '</dd></div>';
    });
    html += '</dl>';

    // Qualifications list
    html += '<h3 style="font-size: 1.0625rem; color: var(--primary-blue-dark); margin: 0 0 12px 0;">Qualifications &amp; Education</h3>';
    if (!quals.length) {
      html += '<p style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 20px;">No qualifications added. Click "Edit Profile" to add degrees or certifications.</p>';
    } else {
      html += '<ul style="list-style: none; padding: 0; margin: 0 0 24px 0; display: flex; flex-direction: column; gap: 8px;">';
      quals.forEach(function (q) {
        html += '<li style="background: var(--warm-white); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">';
        html += '  <div><strong>' + Dash.escape(q.degree) + '</strong> — ' + Dash.escape(q.institution) + (q.year_completed ? ' (' + q.year_completed + ')' : '') + '</div>';
        html += '  <button class="btn btn--reject btn--sm btn-del-qual" type="button" data-qual-id="' + Dash.escape(q.id) + '">✕</button>';
        html += '</li>';
      });
      html += '</ul>';
    }

    // Work Experience list
    html += '<h3 style="font-size: 1.0625rem; color: var(--primary-blue-dark); margin: 0 0 12px 0;">Work Experience</h3>';
    if (!exps.length) {
      html += '<p style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 20px;">No work experience listed.</p>';
    } else {
      html += '<ul style="list-style: none; padding: 0; margin: 0 0 20px 0; display: flex; flex-direction: column; gap: 8px;">';
      exps.forEach(function (x) {
        html += '<li style="background: var(--warm-white); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">';
        html += '  <div><strong>' + Dash.escape(x.title) + '</strong> at ' + Dash.escape(x.company) + (x.start_year ? ' (' + x.start_year + ' - ' + (x.end_year || 'Present') + ')' : '') + '</div>';
        html += '  <button class="btn btn--reject btn--sm btn-del-exp" type="button" data-exp-id="' + Dash.escape(x.id) + '">✕</button>';
        html += '</li>';
      });
      html += '</ul>';
    }

    html += '</div>';
    body.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Actions: Enrollment, Progress, Assessment Runner, Profile
     ------------------------------------------------------------------------ */

  async function handleEnroll(courseId, btn) {
    if (!courseId) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Enrolling…";
    }

    try {
      await API.post("courses/" + courseId + "/enroll");
      showToast("Enrolled successfully in course!", "success", "Enrollment Confirmed");

      await loadEnrollments();
      await loadDashboardMetrics();
      renderCatalog();
    } catch (err) {
      console.error("Enrollment failed:", err);
      showToast(err.message || "Failed to enroll in course.", "error", "Enrollment Failed");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "+ Enroll in Course";
      }
    }
  }

  async function handleSetProgress(enrollmentId, pct) {
    if (!enrollmentId) return;
    try {
      await API.patch("enrollments/" + enrollmentId + "/progress", {
        progress_percent: parseInt(pct, 10)
      });
      showToast("Progress updated to " + pct + "%", "success", "Progress Saved");

      await loadEnrollments();
      await loadDashboardMetrics();

      if (state.activeStudyCourse) {
        await openCourseStudy(state.activeStudyCourse.id, enrollmentId);
      }
    } catch (err) {
      console.error("Update progress failed:", err);
      showToast("Failed to update progress: " + (err.message || "Error"), "error");
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
        showToast("File resource link ready.", "info");
      }
    } catch (err) {
      console.error("Download URL failed:", err);
      showToast("Could not open resource: " + (err.message || "Error"), "error");
    }
  }

  // Assessment Taking
  async function launchAssessment(assessmentId) {
    if (!assessmentId) return;
    var runnerBody = document.getElementById("assessment-runner-body");
    var submitBtn = document.getElementById("btn-submit-attempt");
    if (runnerBody) Dash.renderLoading(runnerBody, "Preparing your assessment paper…");
    if (submitBtn) submitBtn.hidden = false;

    openModal("modal-take-assessment");

    try {
      var attempt = await API.post("assessments/" + assessmentId + "/attempts");
      state.activeAttempt = attempt;
      renderAssessmentRunner(attempt);
    } catch (err) {
      console.error("Failed to start assessment attempt:", err);
      if (runnerBody) {
        Dash.renderError(runnerBody, "Could not start assessment: " + (err.message || "Please try again."), function () {
          launchAssessment(assessmentId);
        });
      }
    }
  }

  function renderAssessmentRunner(attempt) {
    var body = document.getElementById("assessment-runner-body");
    if (!body || !attempt) return;

    var paper = attempt.assessment || {};
    var questions = Array.isArray(paper.questions) ? paper.questions : [];

    if (!questions.length) {
      body.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">This assessment has no questions configured yet.</div>';
      var btn = document.getElementById("btn-submit-attempt");
      if (btn) btn.hidden = true;
      return;
    }

    var html = '<div style="display: flex; flex-direction: column; gap: 20px;">';
    html += '<div style="background: var(--warm-white); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; display: flex; justify-content: space-between; align-items: center;">';
    html += '  <div><strong>' + Dash.escape(paper.title || "Assessment") + '</strong> &nbsp;·&nbsp; Total Questions: ' + questions.length + '</div>';
    html += '  <span class="pill pill--orange">Required Pass: ' + (paper.pass_percentage || 70) + '%</span>';
    html += '</div>';

    questions.forEach(function (q, qIdx) {
      html += '<div class="quiz-question" style="background: #fff; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px;">';
      html += '  <h4 style="margin: 0 0 12px 0; font-size: 1rem; color: var(--primary-blue-dark);">' + (qIdx + 1) + '. ' + Dash.escape(q.question_text) + ' <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">(' + (q.marks || 1) + ' marks)</span></h4>';

      var options = Array.isArray(q.options) ? q.options : [];
      html += '  <div style="display: flex; flex-direction: column; gap: 8px;">';
      options.forEach(function (opt) {
        html += '    <label style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--warm-white); border: 1px solid var(--border-light); border-radius: var(--radius-sm); cursor: pointer;">';
        html += '      <input type="radio" name="question_' + Dash.escape(q.id) + '" value="' + Dash.escape(opt.id) + '" data-question-id="' + Dash.escape(q.id) + '" style="width:18px; height:18px;" />';
        html += '      <span style="font-size: 0.875rem; color: var(--text-dark);">' + Dash.escape(opt.option_text) + '</span>';
        html += '    </label>';
      });
      html += '  </div>';
      html += '</div>';
    });

    html += '</div>';
    body.innerHTML = html;
  }

  async function handleSubmitAttempt() {
    if (!state.activeAttempt) return;
    var attemptId = state.activeAttempt.id;
    var submitBtn = document.getElementById("btn-submit-attempt");

    var answers = [];
    var checkedInputs = document.querySelectorAll('#assessment-runner-body input[type="radio"]:checked');
    checkedInputs.forEach(function (input) {
      answers.push({
        question_id: input.getAttribute("data-question-id"),
        selected_option_id: input.value
      });
    });

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Scoring…"; }

    try {
      var result = await API.post("attempts/" + attemptId + "/submit", { answers: answers });
      renderAttemptResult(result);
      await loadDashboardMetrics();
      await loadProfileAndCertificates();
    } catch (err) {
      console.error("Submit attempt failed:", err);
      showToast("Submission failed: " + (err.message || "Error"), "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Assessment"; }
    }
  }

  function renderAttemptResult(res) {
    var body = document.getElementById("assessment-runner-body");
    var submitBtn = document.getElementById("btn-submit-attempt");
    if (!body || !res) return;
    if (submitBtn) submitBtn.hidden = true;

    var passed = Boolean(res.passed);
    var scorePct = res.percentage_score !== undefined ? Math.round(res.percentage_score) : Math.round(((res.score || 0) / (res.total_marks || 1)) * 100);

    var html = '<div style="text-align: center; padding: 24px 10px;">';
    if (passed) {
      html += '<div style="width: 64px; height: 64px; background: #e8f5e9; color: #2e7d32; border-radius: 50%; display: grid; place-items: center; margin: 0 auto 16px auto;">';
      html += '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="32" height="32"><polyline points="20 6 9 17 4 12"/></svg>';
      html += '</div>';
      html += '<h3 style="font-size: 1.5rem; font-weight: 800; color: #2e7d32; margin: 0 0 8px 0;">Assessment Passed!</h3>';
      html += '<p style="color: var(--text-muted); font-size: 0.9375rem; margin: 0 0 20px 0;">Congratulations! You achieved a passing grade on this course assessment.</p>';
    } else {
      html += '<div style="width: 64px; height: 64px; background: #ffebee; color: #c62828; border-radius: 50%; display: grid; place-items: center; margin: 0 auto 16px auto;">';
      html += '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="32" height="32"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      html += '</div>';
      html += '<h3 style="font-size: 1.5rem; font-weight: 800; color: #c62828; margin: 0 0 8px 0;">Assessment Not Passed</h3>';
      html += '<p style="color: var(--text-muted); font-size: 0.9375rem; margin: 0 0 20px 0;">You scored below the required passing percentage. Review the study materials and retry.</p>';
    }

    html += '<div style="display: inline-grid; grid-template-columns: 1fr 1fr; gap: 20px; background: var(--warm-white); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px 32px; margin-bottom: 24px; text-align: center;">';
    html += '  <div><div style="font-size:0.8125rem; color:var(--text-muted);">Your Score</div><div style="font-size:1.75rem; font-weight:800; color:var(--primary-blue-dark);">' + scorePct + '%</div></div>';
    html += '  <div><div style="font-size:0.8125rem; color:var(--text-muted);">Result Status</div><div style="margin-top:6px;">' + (passed ? '<span class="pill pill--active">Passed</span>' : '<span class="pill pill--reject">Failed</span>') + '</div></div>';
    html += '</div>';

    html += '<div><button class="btn btn--orange btn--sm" type="button" data-modal-close>Return to Dashboard</button></div>';
    html += '</div>';

    body.innerHTML = html;
  }

  // Profile Editor Actions
  async function handleSaveProfile(e) {
    e.preventDefault();
    var form = e.target;
    var errorEl = document.getElementById("edit-profile-error");
    var submitBtn = document.getElementById("btn-submit-save-profile");
    if (errorEl) errorEl.hidden = true;

    var headline = form.headline.value.trim() || null;
    var bio = form.bio.value.trim() || null;

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      await API.patch("profile/trainee", { headline: headline, bio: bio });
      showToast("Profile details updated.", "success", "Profile Saved");
      closeModal("modal-edit-trainee-profile");
      await loadProfileAndCertificates();
    } catch (err) {
      console.error("Save profile failed:", err);
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to update profile.";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Headline & Bio"; }
    }
  }

  async function handleAddQualification() {
    var deg = document.getElementById("new-qual-degree").value.trim();
    var inst = document.getElementById("new-qual-inst").value.trim();
    var yr = document.getElementById("new-qual-year").value ? parseInt(document.getElementById("new-qual-year").value, 10) : undefined;

    if (!deg || !inst) {
      showToast("Please enter degree and institution.", "error");
      return;
    }

    try {
      await API.post("profile/trainee/qualifications", { degree: deg, institution: inst, year_completed: yr });
      showToast("Qualification added.", "success");
      document.getElementById("new-qual-degree").value = "";
      document.getElementById("new-qual-inst").value = "";
      document.getElementById("new-qual-year").value = "";
      await loadProfileAndCertificates();
    } catch (err) {
      console.error("Add qualification failed:", err);
      showToast("Could not add qualification: " + (err.message || "Error"), "error");
    }
  }

  async function handleDeleteQualification(qualId) {
    try {
      await API.del("profile/trainee/qualifications/" + qualId);
      showToast("Qualification removed.", "info");
      await loadProfileAndCertificates();
    } catch (err) {
      console.error("Delete qualification failed:", err);
      showToast("Could not remove qualification: " + (err.message || "Error"), "error");
    }
  }

  async function handleAddExperience() {
    var title = document.getElementById("new-exp-title").value.trim();
    var comp = document.getElementById("new-exp-company").value.trim();
    var startYr = document.getElementById("new-exp-year").value ? parseInt(document.getElementById("new-exp-year").value, 10) : undefined;

    if (!title || !comp) {
      showToast("Please enter title and company.", "error");
      return;
    }

    try {
      await API.post("profile/trainee/experience", { title: title, company: comp, start_year: startYr });
      showToast("Experience record added.", "success");
      document.getElementById("new-exp-title").value = "";
      document.getElementById("new-exp-company").value = "";
      document.getElementById("new-exp-year").value = "";
      await loadProfileAndCertificates();
    } catch (err) {
      console.error("Add experience failed:", err);
      showToast("Could not add experience: " + (err.message || "Error"), "error");
    }
  }

  async function handleDeleteExperience(expId) {
    try {
      await API.del("profile/trainee/experience/" + expId);
      showToast("Experience removed.", "info");
      await loadProfileAndCertificates();
    } catch (err) {
      console.error("Delete experience failed:", err);
      showToast("Could not remove experience: " + (err.message || "Error"), "error");
    }
  }

  /* ------------------------------------------------------------------------
     Event Delegation
     ------------------------------------------------------------------------ */

  function bindEvents() {
    window.addEventListener("hashchange", function () {
      switchSection(window.location.hash);
    });

    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-modal-close]")) {
        var backdrop = e.target.closest(".modal-backdrop");
        if (backdrop) closeModal(backdrop.id);
        return;
      }

      // Catalog Search & Filter
      var searchInput = document.getElementById("catalog-search");
      var subFilter = document.getElementById("catalog-subject-filter");
      if (searchInput) searchInput.addEventListener("input", renderCatalog);
      if (subFilter) subFilter.addEventListener("change", renderCatalog);

      // Enroll in Course
      var enrollBtn = e.target.closest(".btn-enroll-course");
      if (enrollBtn) {
        var courseId = enrollBtn.getAttribute("data-course-id");
        handleEnroll(courseId, enrollBtn);
        return;
      }

      // Open Study Room
      var openStudyBtn = e.target.closest(".btn-open-study");
      if (openStudyBtn) {
        var cId = openStudyBtn.getAttribute("data-course-id");
        var enrId = openStudyBtn.getAttribute("data-enrollment-id");
        openCourseStudy(cId, enrId);
        return;
      }

      // Set Progress
      var progBtn = e.target.closest(".btn-set-progress");
      if (progBtn) {
        var enId = progBtn.getAttribute("data-enrollment-id");
        var pct = progBtn.getAttribute("data-pct");
        handleSetProgress(enId, pct);
        return;
      }

      // Open Resource
      var resBtn = e.target.closest(".btn-open-resource");
      if (resBtn) {
        var rId = resBtn.getAttribute("data-resource-id");
        var rType = resBtn.getAttribute("data-type");
        var rUrl = resBtn.getAttribute("data-url");
        handleOpenResource(rId, rType, rUrl);
        return;
      }

      // Start Assessment
      var startAssBtn = e.target.closest(".btn-start-assessment");
      if (startAssBtn) {
        var aId = startAssBtn.getAttribute("data-assessment-id");
        launchAssessment(aId);
        return;
      }

      // Open Edit Profile Modal
      if (e.target.closest("#btn-open-edit-profile")) {
        if (state.profile) {
          document.getElementById("trainee-headline").value = state.profile.headline || "";
          document.getElementById("trainee-bio").value = state.profile.bio || "";
        }
        openModal("modal-edit-trainee-profile");
        return;
      }

      // Delete Qualification
      var delQualBtn = e.target.closest(".btn-del-qual");
      if (delQualBtn) {
        handleDeleteQualification(delQualBtn.getAttribute("data-qual-id"));
        return;
      }

      // Delete Experience
      var delExpBtn = e.target.closest(".btn-del-exp");
      if (delExpBtn) {
        handleDeleteExperience(delExpBtn.getAttribute("data-exp-id"));
        return;
      }
    });

    // Add Qual & Exp Buttons
    var btnAddQ = document.getElementById("btn-add-qual");
    if (btnAddQ) btnAddQ.addEventListener("click", handleAddQualification);

    var btnAddX = document.getElementById("btn-add-exp");
    if (btnAddX) btnAddX.addEventListener("click", handleAddExperience);

    // Save Profile Form
    var formProf = document.getElementById("form-edit-trainee-profile");
    if (formProf) formProf.addEventListener("submit", handleSaveProfile);

    // Submit Attempt Button
    var btnSubAttempt = document.getElementById("btn-submit-attempt");
    if (btnSubAttempt) btnSubAttempt.addEventListener("click", handleSubmitAttempt);
  }

  /* ------------------------------------------------------------------------
     Bootstrapping
     ------------------------------------------------------------------------ */

  Dash.init({
    role: "trainee",
    onReady: async function (ctx) {
      bindEvents();

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
          loadSubjects(),
          loadCatalog(),
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
