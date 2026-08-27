-- CAPACITY CONNECT — demo seed data.
--
-- Apply AFTER 20260824_initial_schema.sql:
--     psql "$DATABASE_URL" -f migrations/20260824_seed.sql
--
-- Idempotent: every statement is ON CONFLICT DO NOTHING and every row uses a fixed
-- UUID, so re-running changes nothing and the IDs below stay stable for API testing.
--
-- IMPORTANT — how these accounts sign in:
--   profiles.firebase_uid is the join key to Firebase Auth. The UIDs seeded here
--   ('dev-admin', 'dev-trainer', 'dev-trainee') are placeholders that only resolve
--   when AUTH_MODE=dev, where the backend accepts a self-describing unsigned token.
--   With AUTH_MODE=firebase you must instead create the users in the Firebase console
--   and UPDATE these rows to their real UIDs, e.g.
--       UPDATE public.profiles SET firebase_uid = '<real-uid>' WHERE email = '...';
--   Do not ship this file to production.


-- ============================== SUBJECTS ==============================

INSERT INTO public.subjects (id, name, category) VALUES
    ('11111111-0000-0000-0000-000000000001', 'Occupational Safety & Hazard Control', 'Compliance'),
    ('11111111-0000-0000-0000-000000000002', 'Data Protection & Privacy',            'Compliance'),
    ('11111111-0000-0000-0000-000000000003', 'Project Management Fundamentals',      'Management'),
    ('11111111-0000-0000-0000-000000000004', 'Effective Technical Communication',    'Soft Skills'),
    ('11111111-0000-0000-0000-000000000005', 'Industrial Automation & PLC Basics',   'Technical'),
    ('11111111-0000-0000-0000-000000000006', 'Quality Assurance & Six Sigma',        'Technical'),
    ('11111111-0000-0000-0000-000000000007', 'Leadership & Team Development',        'Management'),
    ('11111111-0000-0000-0000-000000000008', 'Financial Literacy for Managers',      'Business')
ON CONFLICT DO NOTHING;


-- =============================== PEOPLE ===============================
-- One approved account per role. Statuses are already 'approved' so you can exercise
-- the API immediately without first walking the approval queue.

INSERT INTO public.profiles (id, firebase_uid, name, email, role, status, mfa_enabled) VALUES
    ('22222222-0000-0000-0000-00000000000a', 'dev-admin',   'Asha Menon',    'admin@capacityconnect.test',   'admin',   'approved', FALSE),
    ('22222222-0000-0000-0000-00000000000b', 'dev-trainer', 'Ravi Iyer',     'trainer@capacityconnect.test', 'trainer', 'approved', FALSE),
    ('22222222-0000-0000-0000-00000000000c', 'dev-trainee', 'Neha Kulkarni', 'trainee@capacityconnect.test', 'trainee', 'approved', FALSE),
    -- A second trainer and a pending trainee, so the admin approval queue and the
    -- "browse trainers by subject" endpoints both have something to return.
    ('22222222-0000-0000-0000-00000000000d', 'dev-trainer2','Farah Sheikh',  'trainer2@capacityconnect.test','trainer', 'approved', FALSE),
    ('22222222-0000-0000-0000-00000000000e', 'dev-pending', 'Vikram Rao',    'pending@capacityconnect.test', 'trainee', 'pending',  FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO public.trainer_profiles (id, user_id, bio, designation) VALUES
    ('33333333-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-00000000000b',
     'Twelve years in plant safety auditing; certified NEBOSH lead auditor.', 'Senior Safety Trainer'),
    ('33333333-0000-0000-0000-00000000000d', '22222222-0000-0000-0000-00000000000d',
     'PMP-certified delivery lead, specialising in agile transformation programmes.', 'Principal Consultant')
ON CONFLICT DO NOTHING;

INSERT INTO public.trainee_profiles (id, user_id, headline, bio) VALUES
    ('44444444-0000-0000-0000-00000000000c', '22222222-0000-0000-0000-00000000000c',
     'Graduate Engineer Trainee — Operations',
     'Mechanical engineering graduate rotating through the maintenance and QA functions.'),
    ('44444444-0000-0000-0000-00000000000e', '22222222-0000-0000-0000-00000000000e',
     'Junior Analyst', 'Awaiting account approval.')
ON CONFLICT DO NOTHING;

-- The approval request behind the pending trainee, so GET /admin/approvals is non-empty.
INSERT INTO public.approval_requests (id, user_id, requested_role, status) VALUES
    ('55555555-0000-0000-0000-00000000000e', '22222222-0000-0000-0000-00000000000e', 'trainee', 'pending')
ON CONFLICT DO NOTHING;


-- ========================= TRAINEE CREDENTIALS =========================
-- Exercises the profile sub-resources: qualifications, experience, interests,
-- skills and self-declared certificates.

INSERT INTO public.qualifications (id, trainee_profile_id, degree, institution, year_of_completion) VALUES
    ('66666666-0000-0000-0000-000000000001', '44444444-0000-0000-0000-00000000000c',
     'B.E. Mechanical Engineering', 'College of Engineering, Pune', 2024)
ON CONFLICT DO NOTHING;

INSERT INTO public.work_experience (id, trainee_profile_id, organization, designation, start_date, end_date, description) VALUES
    ('66666666-0000-0000-0000-000000000002', '44444444-0000-0000-0000-00000000000c',
     'Kirloskar Brothers', 'Summer Intern', '2023-05-15', '2023-07-14',
     'Assisted the reliability team with vibration analysis on centrifugal pumps.')
ON CONFLICT DO NOTHING;

INSERT INTO public.interests (id, trainee_profile_id, interest_name) VALUES
    ('66666666-0000-0000-0000-000000000003', '44444444-0000-0000-0000-00000000000c', 'Predictive Maintenance'),
    ('66666666-0000-0000-0000-000000000004', '44444444-0000-0000-0000-00000000000c', 'Industrial Safety')
ON CONFLICT DO NOTHING;

INSERT INTO public.certificates (id, trainee_profile_id, title, issuing_body, issue_date) VALUES
    ('66666666-0000-0000-0000-000000000005', '44444444-0000-0000-0000-00000000000c',
     'Forklift Operation — Level 1', 'National Safety Council', '2024-11-20')
ON CONFLICT DO NOTHING;

-- skills carries two nullable FKs plus a CHECK that at least one is set, so it is
-- seeded for both a trainee and a trainer.
INSERT INTO public.skills (id, trainee_profile_id, trainer_profile_id, skill_name, proficiency_level) VALUES
    ('77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-00000000000c', NULL, 'AutoCAD',           'intermediate'),
    ('77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-00000000000c', NULL, 'Root Cause Analysis','beginner'),
    ('77777777-0000-0000-0000-000000000003', NULL, '33333333-0000-0000-0000-00000000000b', 'Hazard Identification', 'expert'),
    ('77777777-0000-0000-0000-000000000004', NULL, '33333333-0000-0000-0000-00000000000d', 'Agile Coaching',        'advanced')
ON CONFLICT DO NOTHING;


-- ============================ COMPETENCY MAP ===========================
-- Drives "which trainers can teach subject X". UNIQUE (trainer_profile_id, subject_id).

INSERT INTO public.competency_map (id, trainer_profile_id, subject_id, proficiency_score, source) VALUES
    ('88888888-0000-0000-0000-000000000001', '33333333-0000-0000-0000-00000000000b',
     '11111111-0000-0000-0000-000000000001', 9.50, 'admin_assigned'),
    ('88888888-0000-0000-0000-000000000002', '33333333-0000-0000-0000-00000000000b',
     '11111111-0000-0000-0000-000000000006', 7.25, 'self_declared'),
    ('88888888-0000-0000-0000-000000000003', '33333333-0000-0000-0000-00000000000d',
     '11111111-0000-0000-0000-000000000003', 9.00, 'admin_assigned'),
    ('88888888-0000-0000-0000-000000000004', '33333333-0000-0000-0000-00000000000d',
     '11111111-0000-0000-0000-000000000007', 8.75, 'self_declared')
ON CONFLICT DO NOTHING;


-- =============================== COURSES ==============================
-- One published course with full content, plus a draft so the status filter on
-- GET /courses has something to exclude for trainees.

INSERT INTO public.courses (id, title, description, subject_id, created_by, status) VALUES
    ('99999999-0000-0000-0000-000000000001',
     'Workplace Hazard Identification & Control',
     'A practical four-module induction covering hazard classes, the control hierarchy, '
     'permit-to-work systems, and incident reporting. Mandatory for all plant staff.',
     '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-00000000000b', 'published'),
    ('99999999-0000-0000-0000-000000000002',
     'Agile Delivery for First-Time Leads',
     'Backlog shaping, estimation without false precision, and running a retrospective '
     'people actually speak in.',
     '11111111-0000-0000-0000-000000000003', '33333333-0000-0000-0000-00000000000d', 'published'),
    ('99999999-0000-0000-0000-000000000003',
     'Six Sigma Green Belt — Measurement Systems',
     'Work in progress: gauge R&R, measurement error, and capability indices.',
     '11111111-0000-0000-0000-000000000006', '33333333-0000-0000-0000-00000000000b', 'draft')
ON CONFLICT DO NOTHING;

INSERT INTO public.course_modules (id, course_id, title, sequence_no) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', 'Hazard Classes & Recognition',   1),
    ('aaaaaaaa-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000001', 'The Hierarchy of Controls',      2),
    ('aaaaaaaa-0000-0000-0000-000000000003', '99999999-0000-0000-0000-000000000001', 'Permit-to-Work in Practice',     3),
    ('aaaaaaaa-0000-0000-0000-000000000004', '99999999-0000-0000-0000-000000000001', 'Incident Reporting & Follow-up', 4),
    ('aaaaaaaa-0000-0000-0000-000000000005', '99999999-0000-0000-0000-000000000002', 'Shaping a Backlog',              1),
    ('aaaaaaaa-0000-0000-0000-000000000006', '99999999-0000-0000-0000-000000000002', 'Estimation & Forecasting',       2)
ON CONFLICT DO NOTHING;

-- learning_resources.type IN (lecture_video, presentation, document, link).
-- file_url is left as an external link for the 'link' type; the storage-backed types
-- would normally hold an object path minted by POST /modules/{id}/resources/upload-url,
-- so they are seeded NULL rather than with a fake path that would 404 on download.
INSERT INTO public.learning_resources (id, course_module_id, type, title, file_url, uploaded_by) VALUES
    ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
     'link', 'ILO — Safety and Health at Work (overview)',
     'https://www.ilo.org/topics/safety-and-health-work', '33333333-0000-0000-0000-00000000000b'),
    ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
     'presentation', 'Hierarchy of Controls — slide deck', NULL, '33333333-0000-0000-0000-00000000000b'),
    ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003',
     'document', 'Permit-to-work template (PDF)', NULL, '33333333-0000-0000-0000-00000000000b')
ON CONFLICT DO NOTHING;


-- ============================= ENROLLMENTS =============================
-- UNIQUE (trainee_profile_id, course_id). Two different states so the trainee
-- dashboard shows both an in-progress and a completed course.

INSERT INTO public.enrollments (id, trainee_profile_id, course_id, status, progress_percent, completed_at) VALUES
    ('cccccccc-0000-0000-0000-000000000001', '44444444-0000-0000-0000-00000000000c',
     '99999999-0000-0000-0000-000000000001', 'in_progress', 50, NULL),
    ('cccccccc-0000-0000-0000-000000000002', '44444444-0000-0000-0000-00000000000c',
     '99999999-0000-0000-0000-000000000002', 'completed',  100, now())
ON CONFLICT DO NOTHING;


-- ============================= ASSESSMENT ==============================
-- A published quiz on the safety course. NOTE: question_options.is_correct is the
-- answer key — the API never serialises it to a trainee before submission
-- (GET /assessments/{id} returns a shape with no such field at all; the key is only
-- reachable via GET /assessments/{id}/full, which is course-owner/admin only).

INSERT INTO public.assessments (id, course_id, subject_id, title, created_by, deadline, time_limit_minutes, pass_percentage, status) VALUES
    ('dddddddd-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001',
     '11111111-0000-0000-0000-000000000001', 'Hazard Control — Module 1 & 2 Check',
     '33333333-0000-0000-0000-00000000000b', now() + interval '30 days', 20, 60, 'published')
ON CONFLICT DO NOTHING;

INSERT INTO public.questions (id, assessment_id, question_text, marks) VALUES
    ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
     'Which control sits at the TOP of the hierarchy of controls?', 2),
    ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
     'Personal protective equipment is best described as which kind of control?', 2),
    ('eeeeeeee-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001',
     'A near-miss with no injury and no damage should be:', 1)
ON CONFLICT DO NOTHING;

INSERT INTO public.question_options (id, question_id, option_text, is_correct) VALUES
    -- Q1
    ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Elimination of the hazard',            TRUE),
    ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'Administrative controls',              FALSE),
    ('ffffffff-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000001', 'Personal protective equipment',        FALSE),
    ('ffffffff-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000001', 'Engineering controls',                 FALSE),
    -- Q2
    ('ffffffff-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-000000000002', 'The last line of defence',             TRUE),
    ('ffffffff-0000-0000-0000-000000000006', 'eeeeeeee-0000-0000-0000-000000000002', 'The first control to apply',           FALSE),
    ('ffffffff-0000-0000-0000-000000000007', 'eeeeeeee-0000-0000-0000-000000000002', 'A substitute for elimination',         FALSE),
    -- Q3
    ('ffffffff-0000-0000-0000-000000000008', 'eeeeeeee-0000-0000-0000-000000000003', 'Reported and investigated like any incident', TRUE),
    ('ffffffff-0000-0000-0000-000000000009', 'eeeeeeee-0000-0000-0000-000000000003', 'Ignored, since nothing was damaged',   FALSE),
    ('ffffffff-0000-0000-0000-00000000000a', 'eeeeeeee-0000-0000-0000-000000000003', 'Logged only if a supervisor saw it',   FALSE)
ON CONFLICT DO NOTHING;


-- ============================== FEEDBACK ===============================
-- rating has a CHECK (rating BETWEEN 1 AND 5).

INSERT INTO public.feedback (id, trainee_profile_id, course_id, rating, comments) VALUES
    ('12121212-0000-0000-0000-000000000001', '44444444-0000-0000-0000-00000000000c',
     '99999999-0000-0000-0000-000000000002', 5,
     'The estimation module alone was worth it — we stopped arguing about story points the next sprint.')
ON CONFLICT DO NOTHING;


-- ============================ NOTIFICATIONS ============================
-- type IN (announcement, achievement, new_content, deadline_reminder)
-- target_role IN (all, trainee, trainer, admin)

INSERT INTO public.notifications (id, type, title, body, published_by, target_role) VALUES
    ('13131313-0000-0000-0000-000000000001', 'announcement',
     'Q3 mandatory safety refresher is now open',
     'All plant staff must complete "Workplace Hazard Identification & Control" before 30 September.',
     '22222222-0000-0000-0000-00000000000a', 'all'),
    ('13131313-0000-0000-0000-000000000002', 'new_content',
     'New course: Agile Delivery for First-Time Leads',
     'Two modules are live now; estimation and forecasting content lands next week.',
     '22222222-0000-0000-0000-00000000000a', 'trainee'),
    ('13131313-0000-0000-0000-000000000003', 'deadline_reminder',
     'Competency self-declarations close Friday',
     'Trainers: please review your subject competency entries before the audit.',
     '22222222-0000-0000-0000-00000000000a', 'trainer')
ON CONFLICT DO NOTHING;

-- One read receipt, so the unread badge count is genuinely less than the feed size.
INSERT INTO public.notification_reads (id, notification_id, user_id, read_at) VALUES
    ('14141414-0000-0000-0000-000000000001', '13131313-0000-0000-0000-000000000002',
     '22222222-0000-0000-0000-00000000000c', now())
ON CONFLICT DO NOTHING;
