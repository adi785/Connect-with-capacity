-- Initial database schema for CAPACITY CONNECT LMS
-- PostgreSQL / Supabase compatible

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ PROFILES & ROLES ============

-- Profiles table - join key is firebase_uid linking to Firebase Auth
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid TEXT UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'trainee'
        CHECK (role IN ('trainee', 'trainer', 'admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    mfa_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- Index on firebase_uid for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_firebase_uid ON public.profiles(firebase_uid);

-- ============ TRAINEE PROFILE EXTENSION ============

CREATE TABLE IF NOT EXISTS public.trainee_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    headline VARCHAR(200),
    bio TEXT,
    profile_photo_url VARCHAR(500),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============ QUALIFICATIONS ============
CREATE TABLE IF NOT EXISTS public.qualifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_profile_id UUID NOT NULL REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    degree VARCHAR(150),
    institution VARCHAR(200),
    year_of_completion INT
);

-- ============ WORK EXPERIENCE ============
CREATE TABLE IF NOT EXISTS public.work_experience (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_profile_id UUID NOT NULL REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    organization VARCHAR(200),
    designation VARCHAR(150),
    start_date DATE,
    end_date DATE,
    description TEXT
);

-- ============ INTERESTS ============
CREATE TABLE IF NOT EXISTS public.interests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_profile_id UUID NOT NULL REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    interest_name VARCHAR(100)
);

-- ============ CERTIFICATES (trainee-declared, not platform-issued) ============
-- Distinct from certificates_issued below: this is a credential the trainee uploads
-- themselves as part of their profile. See certificates_issued for completion certs.
CREATE TABLE IF NOT EXISTS public.certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_profile_id UUID NOT NULL REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    issuing_body VARCHAR(200),
    issue_date DATE,
    file_url VARCHAR(500)
);

-- ============ TRAINER PROFILE ============
-- Must be created before public.skills, which carries an FK to it.
CREATE TABLE IF NOT EXISTS public.trainer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    bio TEXT,
    designation VARCHAR(150),
    profile_photo_url VARCHAR(500),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============ SKILLS ============
-- Shared by both profile kinds, hence two nullable FKs plus a CHECK that at least one
-- is set. Depends on trainee_profiles AND trainer_profiles, so it is created after both.
CREATE TABLE IF NOT EXISTS public.skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_profile_id UUID REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    trainer_profile_id UUID REFERENCES public.trainer_profiles(id) ON DELETE CASCADE,
    skill_name VARCHAR(100) NOT NULL,
    proficiency_level VARCHAR(20) NOT NULL
        CHECK (proficiency_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    CHECK (
        trainee_profile_id IS NOT NULL OR trainer_profile_id IS NOT NULL
    )
);

-- ============ SUBJECTS ============
CREATE TABLE IF NOT EXISTS public.subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) UNIQUE NOT NULL,
    category VARCHAR(100)
);

-- ============ COMPETENCY MAP ============
CREATE TABLE IF NOT EXISTS public.competency_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_profile_id UUID NOT NULL REFERENCES public.trainer_profiles(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    proficiency_score NUMERIC(4,2),
    source VARCHAR(20) NOT NULL
        CHECK (source IN ('self_declared', 'admin_assigned', 'system_derived')),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (trainer_profile_id, subject_id)
);

-- ============ COURSES ============
CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    subject_id UUID REFERENCES public.subjects(id),
    created_by UUID NOT NULL REFERENCES public.trainer_profiles(id),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============ COURSE MODULES ============
CREATE TABLE IF NOT EXISTS public.course_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    sequence_no INT NOT NULL
);

-- ============ LEARNING RESOURCES ============
CREATE TABLE IF NOT EXISTS public.learning_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('lecture_video', 'presentation', 'document', 'link')),
    title VARCHAR(200) NOT NULL,
    file_url VARCHAR(500),
    uploaded_by UUID NOT NULL REFERENCES public.trainer_profiles(id),
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- ============ ENROLLMENTS ============
CREATE TABLE IF NOT EXISTS public.enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_profile_id UUID NOT NULL REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'enrolled'
        CHECK (status IN ('enrolled', 'in_progress', 'completed', 'dropped')),
    progress_percent INT DEFAULT 0,
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE (trainee_profile_id, course_id)
);

-- ============ ASSESSMENTS ============
CREATE TABLE IF NOT EXISTS public.assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES public.subjects(id),
    title VARCHAR(200) NOT NULL,
    created_by UUID NOT NULL REFERENCES public.trainer_profiles(id),
    deadline TIMESTAMPTZ,
    time_limit_minutes INT,
    pass_percentage INT DEFAULT 50,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'closed'))
);

-- ============ QUESTIONS ============
CREATE TABLE IF NOT EXISTS public.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    marks INT DEFAULT 1
);

-- ============ QUESTION OPTIONS ============
CREATE TABLE IF NOT EXISTS public.question_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    option_text VARCHAR(500) NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE
);

-- ============ ASSESSMENT ATTEMPTS ============
CREATE TABLE IF NOT EXISTS public.assessment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    trainee_profile_id UUID NOT NULL REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ DEFAULT now(),
    submitted_at TIMESTAMPTZ,
    score NUMERIC(6,2),
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'submitted', 'expired')),
    UNIQUE (assessment_id, trainee_profile_id, started_at)
);

-- ============ ATTEMPT ANSWERS ============
CREATE TABLE IF NOT EXISTS public.attempt_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    selected_option_id UUID REFERENCES public.question_options(id),
    is_correct BOOLEAN
);

-- ============ CERTIFICATES ISSUED ============
CREATE TABLE IF NOT EXISTS public.certificates_issued (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_profile_id UUID NOT NULL REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    course_id UUID REFERENCES public.courses(id),
    issue_date DATE DEFAULT now(),
    certificate_url VARCHAR(500)
);

-- ============ FEEDBACK ============
CREATE TABLE IF NOT EXISTS public.feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_profile_id UUID NOT NULL REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    comments TEXT,
    submitted_at TIMESTAMPTZ DEFAULT now()
);

-- ============ APPROVAL REQUESTS ============
CREATE TABLE IF NOT EXISTS public.approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    requested_role VARCHAR(20) NOT NULL
        CHECK (requested_role IN ('trainee', 'trainer')),
    reviewed_by UUID REFERENCES public.profiles(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(30) NOT NULL
        CHECK (type IN ('announcement', 'achievement', 'new_content', 'deadline_reminder')),
    title VARCHAR(200) NOT NULL,
    body TEXT,
    published_by UUID NOT NULL REFERENCES public.profiles(id),
    target_role VARCHAR(20) DEFAULT 'all'
        CHECK (target_role IN ('all', 'trainee', 'trainer', 'admin')),
    published_at TIMESTAMPTZ DEFAULT now()
);

-- ============ NOTIFICATION READS ============
CREATE TABLE IF NOT EXISTS public.notification_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ,
    UNIQUE (notification_id, user_id)
);

-- ============ AUDIT LOGS ============
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id),
    action VARCHAR(150) NOT NULL,
    target_entity VARCHAR(100),
    target_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_enrollments_trainee_course ON public.enrollments(trainee_profile_id, course_id);
CREATE INDEX IF NOT EXISTS idx_attempts_assessment_trainee ON public.assessment_attempts(assessment_id, trainee_profile_id);
CREATE INDEX IF NOT EXISTS idx_competency_trainer_subject ON public.competency_map(trainer_profile_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_notifications_published_at ON public.notifications(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_status_subject ON public.courses(status, subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_assessment ON public.questions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_options_question ON public.question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_resources_module ON public.learning_resources(course_module_id);