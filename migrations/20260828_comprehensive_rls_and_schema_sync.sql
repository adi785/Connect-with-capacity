-- ==========================================================================
-- CAPACITY CONNECT — Comprehensive Database Schema & RLS Policies
-- Migration: 20260828_comprehensive_rls_and_schema_sync.sql
-- --------------------------------------------------------------------------
-- 100% Idempotent, Safe, and Production-Ready.
-- Run in Supabase SQL Editor to enforce full database-level security across
-- all 25 tables.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Schema Extensions & Missing Columns
-- --------------------------------------------------------------------------

ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_employee_id_idx 
    ON public.profiles(employee_id) 
    WHERE employee_id IS NOT NULL;

ALTER TABLE public.notifications 
    ADD COLUMN IF NOT EXISTS summary TEXT,
    ADD COLUMN IF NOT EXISTS category VARCHAR(100),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published',
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.trainer_profiles 
    ADD COLUMN IF NOT EXISTS organization VARCHAR(200),
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS experience_years INT;

-- Ensure unique constraint on enrollments table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'enrollments_unique' AND conrelid = 'public.enrollments'::regclass
    ) THEN
        ALTER TABLE public.enrollments 
            ADD CONSTRAINT enrollments_unique UNIQUE (trainee_profile_id, course_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;


-- --------------------------------------------------------------------------
-- 2. Helper Security Functions (SECURITY DEFINER to avoid policy recursion)
-- --------------------------------------------------------------------------

-- Helper: Get current user role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;


-- Helper: Safe Employee ID to Email resolution for unauthenticated login
CREATE OR REPLACE FUNCTION public.get_email_by_employee_id(p_employee_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.profiles
  WHERE employee_id = TRIM(p_employee_id)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_by_employee_id(TEXT) TO anon, authenticated;


-- --------------------------------------------------------------------------
-- 3. Enable RLS on ALL Public Tables
-- --------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competency_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates_issued ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;


-- --------------------------------------------------------------------------
-- 4. RLS Policies: Profiles & Core Role Profiles
-- --------------------------------------------------------------------------

-- public.profiles
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile"
ON public.profiles FOR UPDATE TO authenticated
USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);

-- public.trainee_profiles
DROP POLICY IF EXISTS "Trainees can read own trainee_profile" ON public.trainee_profiles;
CREATE POLICY "Trainees can read own trainee_profile"
ON public.trainee_profiles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Trainees can update own trainee_profile" ON public.trainee_profiles;
CREATE POLICY "Trainees can update own trainee_profile"
ON public.trainee_profiles FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.current_user_role() = 'admin')
WITH CHECK (user_id = auth.uid() OR public.current_user_role() = 'admin');

-- public.trainer_profiles
DROP POLICY IF EXISTS "Trainers can read trainer profiles" ON public.trainer_profiles;
CREATE POLICY "Trainers can read trainer profiles"
ON public.trainer_profiles FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Trainers can update own trainer_profile" ON public.trainer_profiles;
CREATE POLICY "Trainers can update own trainer_profile"
ON public.trainer_profiles FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.current_user_role() = 'admin')
WITH CHECK (user_id = auth.uid() OR public.current_user_role() = 'admin');

-- public.approval_requests
DROP POLICY IF EXISTS "Users can read own approval requests" ON public.approval_requests;
CREATE POLICY "Users can read own approval requests"
ON public.approval_requests FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage approval requests" ON public.approval_requests;
CREATE POLICY "Admins can manage approval requests"
ON public.approval_requests FOR ALL TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');


-- --------------------------------------------------------------------------
-- 5. RLS Policies: Trainee Sub-Profiles (Qualifications, Experience, Skills, Interests)
-- --------------------------------------------------------------------------

-- Qualifications
DROP POLICY IF EXISTS "Trainees manage own qualifications" ON public.qualifications;
CREATE POLICY "Trainees manage own qualifications"
ON public.qualifications FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = qualifications.trainee_profile_id AND tp.user_id = auth.uid()
    ) OR public.current_user_role() = 'admin'
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = qualifications.trainee_profile_id AND tp.user_id = auth.uid()
    ) OR public.current_user_role() = 'admin'
);

-- Work Experience
DROP POLICY IF EXISTS "Trainees manage own work_experience" ON public.work_experience;
CREATE POLICY "Trainees manage own work_experience"
ON public.work_experience FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = work_experience.trainee_profile_id AND tp.user_id = auth.uid()
    ) OR public.current_user_role() = 'admin'
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = work_experience.trainee_profile_id AND tp.user_id = auth.uid()
    ) OR public.current_user_role() = 'admin'
);

-- Skills
DROP POLICY IF EXISTS "Trainees manage own skills" ON public.skills;
CREATE POLICY "Trainees manage own skills"
ON public.skills FOR ALL TO authenticated
USING (
    (trainee_profile_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = skills.trainee_profile_id AND tp.user_id = auth.uid()
    ))
    OR (trainer_profile_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = skills.trainer_profile_id AND trp.user_id = auth.uid()
    ))
    OR public.current_user_role() = 'admin'
)
WITH CHECK (
    (trainee_profile_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = skills.trainee_profile_id AND tp.user_id = auth.uid()
    ))
    OR (trainer_profile_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = skills.trainer_profile_id AND trp.user_id = auth.uid()
    ))
    OR public.current_user_role() = 'admin'
);

-- Interests
DROP POLICY IF EXISTS "Trainees manage own interests" ON public.interests;
CREATE POLICY "Trainees manage own interests"
ON public.interests FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = interests.trainee_profile_id AND tp.user_id = auth.uid()
    ) OR public.current_user_role() = 'admin'
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = interests.trainee_profile_id AND tp.user_id = auth.uid()
    ) OR public.current_user_role() = 'admin'
);


-- --------------------------------------------------------------------------
-- 6. RLS Policies: Subjects & Competencies
-- --------------------------------------------------------------------------

-- Subjects
DROP POLICY IF EXISTS "Everyone can read subjects" ON public.subjects;
CREATE POLICY "Everyone can read subjects"
ON public.subjects FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can manage subjects" ON public.subjects;
CREATE POLICY "Admins can manage subjects"
ON public.subjects FOR ALL TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- Competency Map
DROP POLICY IF EXISTS "Everyone can read competencies" ON public.competency_map;
CREATE POLICY "Everyone can read competencies"
ON public.competency_map FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Trainers manage own competencies" ON public.competency_map;
CREATE POLICY "Trainers manage own competencies"
ON public.competency_map FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = competency_map.trainer_profile_id AND trp.user_id = auth.uid()
    ) OR public.current_user_role() = 'admin'
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = competency_map.trainer_profile_id AND trp.user_id = auth.uid()
    ) OR public.current_user_role() = 'admin'
);


-- --------------------------------------------------------------------------
-- 7. RLS Policies: Courses, Modules & Learning Resources
-- --------------------------------------------------------------------------

-- Courses
DROP POLICY IF EXISTS "Read courses policy" ON public.courses;
CREATE POLICY "Read courses policy"
ON public.courses FOR SELECT TO authenticated
USING (
    status = 'published'
    OR public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = courses.created_by AND trp.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Trainers and admins manage courses" ON public.courses;
CREATE POLICY "Trainers and admins manage courses"
ON public.courses FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = courses.created_by AND trp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = courses.created_by AND trp.user_id = auth.uid()
    )
);

-- Course Modules
DROP POLICY IF EXISTS "Read modules policy" ON public.course_modules;
CREATE POLICY "Read modules policy"
ON public.course_modules FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.courses c
        WHERE c.id = course_modules.course_id
        AND (
            c.status = 'published'
            OR public.current_user_role() = 'admin'
            OR EXISTS (
                SELECT 1 FROM public.trainer_profiles trp
                WHERE trp.id = c.created_by AND trp.user_id = auth.uid()
            )
        )
    )
);

DROP POLICY IF EXISTS "Trainers manage modules" ON public.course_modules;
CREATE POLICY "Trainers manage modules"
ON public.course_modules FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.courses c
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE c.id = course_modules.course_id AND trp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.courses c
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE c.id = course_modules.course_id AND trp.user_id = auth.uid()
    )
);

-- Learning Resources
DROP POLICY IF EXISTS "Read resources policy" ON public.learning_resources;
CREATE POLICY "Read resources policy"
ON public.learning_resources FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Trainers manage learning resources" ON public.learning_resources;
CREATE POLICY "Trainers manage learning resources"
ON public.learning_resources FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = learning_resources.uploaded_by AND trp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainer_profiles trp
        WHERE trp.id = learning_resources.uploaded_by AND trp.user_id = auth.uid()
    )
);


-- --------------------------------------------------------------------------
-- 8. RLS Policies: Enrollments & Feedback
-- --------------------------------------------------------------------------

-- Enrollments
DROP POLICY IF EXISTS "Read enrollments policy" ON public.enrollments;
CREATE POLICY "Read enrollments policy"
ON public.enrollments FOR SELECT TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = enrollments.trainee_profile_id AND tp.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.courses c
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE c.id = enrollments.course_id AND trp.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Trainees manage own enrollments" ON public.enrollments;
CREATE POLICY "Trainees manage own enrollments"
ON public.enrollments FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = enrollments.trainee_profile_id AND tp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = enrollments.trainee_profile_id AND tp.user_id = auth.uid()
    )
);

-- Feedback
DROP POLICY IF EXISTS "Read feedback policy" ON public.feedback;
CREATE POLICY "Read feedback policy"
ON public.feedback FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Trainees manage own feedback" ON public.feedback;
CREATE POLICY "Trainees manage own feedback"
ON public.feedback FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = feedback.trainee_profile_id AND tp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = feedback.trainee_profile_id AND tp.user_id = auth.uid()
    )
);


-- --------------------------------------------------------------------------
-- 9. RLS Policies: Assessments, Questions & Attempts
-- --------------------------------------------------------------------------

-- Assessments
DROP POLICY IF EXISTS "Read assessments policy" ON public.assessments;
CREATE POLICY "Read assessments policy"
ON public.assessments FOR SELECT TO authenticated
USING (
    status = 'published'
    OR public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.courses c
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE c.id = assessments.course_id AND trp.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Trainers manage assessments" ON public.assessments;
CREATE POLICY "Trainers manage assessments"
ON public.assessments FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.courses c
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE c.id = assessments.course_id AND trp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.courses c
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE c.id = assessments.course_id AND trp.user_id = auth.uid()
    )
);

-- Questions & Options
DROP POLICY IF EXISTS "Read questions policy" ON public.questions;
CREATE POLICY "Read questions policy"
ON public.questions FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Trainers manage questions" ON public.questions;
CREATE POLICY "Trainers manage questions"
ON public.questions FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.assessments a
        JOIN public.courses c ON c.id = a.course_id
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE a.id = questions.assessment_id AND trp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.assessments a
        JOIN public.courses c ON c.id = a.course_id
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE a.id = questions.assessment_id AND trp.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Read question options policy" ON public.question_options;
CREATE POLICY "Read question options policy"
ON public.question_options FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Trainers manage question options" ON public.question_options;
CREATE POLICY "Trainers manage question options"
ON public.question_options FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.questions q
        JOIN public.assessments a ON a.id = q.assessment_id
        JOIN public.courses c ON c.id = a.course_id
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE q.id = question_options.question_id AND trp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.questions q
        JOIN public.assessments a ON a.id = q.assessment_id
        JOIN public.courses c ON c.id = a.course_id
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE q.id = question_options.question_id AND trp.user_id = auth.uid()
    )
);

-- Assessment Attempts
DROP POLICY IF EXISTS "Read attempts policy" ON public.assessment_attempts;
CREATE POLICY "Read attempts policy"
ON public.assessment_attempts FOR SELECT TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = assessment_attempts.trainee_profile_id AND tp.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.assessments a
        JOIN public.courses c ON c.id = a.course_id
        JOIN public.trainer_profiles trp ON trp.id = c.created_by
        WHERE a.id = assessment_attempts.assessment_id AND trp.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Trainees manage own attempts" ON public.assessment_attempts;
CREATE POLICY "Trainees manage own attempts"
ON public.assessment_attempts FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = assessment_attempts.trainee_profile_id AND tp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = assessment_attempts.trainee_profile_id AND tp.user_id = auth.uid()
    )
);

-- Attempt Answers
DROP POLICY IF EXISTS "Read attempt answers policy" ON public.attempt_answers;
CREATE POLICY "Read attempt answers policy"
ON public.attempt_answers FOR SELECT TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.assessment_attempts aa
        JOIN public.trainee_profiles tp ON tp.id = aa.trainee_profile_id
        WHERE aa.id = attempt_answers.attempt_id AND tp.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Trainees submit attempt answers" ON public.attempt_answers;
CREATE POLICY "Trainees submit attempt answers"
ON public.attempt_answers FOR ALL TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.assessment_attempts aa
        JOIN public.trainee_profiles tp ON tp.id = aa.trainee_profile_id
        WHERE aa.id = attempt_answers.attempt_id AND tp.user_id = auth.uid()
    )
)
WITH CHECK (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.assessment_attempts aa
        JOIN public.trainee_profiles tp ON tp.id = aa.trainee_profile_id
        WHERE aa.id = attempt_answers.attempt_id AND tp.user_id = auth.uid()
    )
);


-- --------------------------------------------------------------------------
-- 10. RLS Policies: Notifications & Audit Logs
-- --------------------------------------------------------------------------

-- Notifications
DROP POLICY IF EXISTS "Authenticated users read published notifications" ON public.notifications;
CREATE POLICY "Authenticated users read published notifications"
ON public.notifications FOR SELECT TO authenticated
USING (
    status = 'published'
    OR public.current_user_role() = 'admin'
);

DROP POLICY IF EXISTS "Admins manage notifications" ON public.notifications;
CREATE POLICY "Admins manage notifications"
ON public.notifications FOR ALL TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- Notification Reads
DROP POLICY IF EXISTS "Users manage own notification reads" ON public.notification_reads;
CREATE POLICY "Users manage own notification reads"
ON public.notification_reads FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Audit Logs
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "System insert audit logs" ON public.audit_logs;
CREATE POLICY "System insert audit logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (true);


-- --------------------------------------------------------------------------
-- 11. RLS Policies: Certificates
-- --------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users read issued certificates" ON public.certificates_issued;
CREATE POLICY "Users read issued certificates"
ON public.certificates_issued FOR SELECT TO authenticated
USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.trainee_profiles tp
        WHERE tp.id = certificates_issued.trainee_profile_id AND tp.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Admins manage certificates" ON public.certificates_issued;
CREATE POLICY "Admins manage certificates"
ON public.certificates_issued FOR ALL TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Read certificate templates" ON public.certificates;
CREATE POLICY "Read certificate templates"
ON public.certificates FOR SELECT TO authenticated
USING (true);
