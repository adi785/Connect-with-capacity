-- CAPACITY CONNECT Performance Indexes Migration
-- Speeds up dashboard aggregation, filtered course lists, enrollment rosters, and user approval queues.

CREATE INDEX IF NOT EXISTS idx_courses_created_by_status ON courses(created_by, status);
CREATE INDEX IF NOT EXISTS idx_courses_status_created_at ON courses(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_subject_id ON courses(subject_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_course_id_status ON enrollments(course_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_trainee_status ON enrollments(trainee_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_enrolled_at ON enrollments(enrolled_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status_requested_at ON approval_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_user_id ON approval_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_assessment_status ON assessment_attempts(assessment_id, status);
CREATE INDEX IF NOT EXISTS idx_assessments_course_id ON assessments(course_id);

CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON profiles(role, status);
CREATE INDEX IF NOT EXISTS idx_profiles_employee_id ON profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_profiles_firebase_uid ON profiles(firebase_uid);

CREATE INDEX IF NOT EXISTS idx_course_modules_course_id ON course_modules(course_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_course_module_id ON learning_resources(course_module_id);

CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON notifications(target_role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_course_id ON feedback(course_id);
