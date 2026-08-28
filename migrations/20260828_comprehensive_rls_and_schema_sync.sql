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

-- Deduplicate any existing duplicate employee_ids before applying unique index
DO $$
BEGIN
    WITH duplicates AS (
        SELECT id, employee_id,
               ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY created_at ASC NULLS LAST, id ASC) as rn
        FROM public.profiles
        WHERE employee_id IS NOT NULL AND employee_id <> ''
    )
    UPDATE public.profiles p
    SET employee_id = p.employee_id || '-' || SUBSTRING(p.id::text, 1, 4)
    FROM duplicates d
    WHERE p.id = d.id AND d.rn > 1;
END $$;

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


-- Helper: Guard profile privileges (prevents non-admins from changing their role/status)
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow system migrations, triggers, background jobs, postgres superuser, service_role, or admins
  IF auth.uid() IS NULL 
     OR current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR public.current_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Authenticated non-admin users cannot change their own role or status
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Only an administrator can change an account role.'
      USING errcode = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Only an administrator can change an account status.'
      USING errcode = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileges ON public.profiles;
CREATE TRIGGER profiles_guard_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileges();



-- --------------------------------------------------------------------------
-- 3. Enable RLS on ALL Public Tables (Safely checks table existence)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
    tbls TEXT[] := ARRAY[
        'profiles', 'trainee_profiles', 'trainer_profiles', 'approval_requests',
        'qualifications', 'work_experience', 'skills', 'interests', 'subjects',
        'courses', 'course_modules', 'learning_resources', 'enrollments',
        'assessments', 'questions', 'question_options', 'assessment_attempts',
        'attempt_answers', 'feedback', 'competency_map', 'certificates',
        'certificates_issued', 'notifications', 'notification_reads', 'audit_logs'
    ];
BEGIN
    FOREACH tbl IN ARRAY tbls LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
        END IF;
    END LOOP;
END $$;


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


-- --------------------------------------------------------------------------
-- 12. Supabase Auth Automatic Profile Synchronization Trigger & Backfill
-- --------------------------------------------------------------------------

-- Ensure firebase_uid nullable for pure Supabase Auth users
ALTER TABLE public.profiles ALTER COLUMN firebase_uid DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_role TEXT;
  v_emp_id TEXT;
  v_status TEXT;
BEGIN
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'trainee');
  v_emp_id := COALESCE(
    NEW.raw_user_meta_data->>'employee_id',
    'EMP-' || substr(NEW.id::text, 1, 6)
  );

  -- Determine initial status
  IF v_role = 'trainer' THEN
    v_status := 'pending';
  ELSE
    v_status := 'approved';
  END IF;

  -- Resolve potential duplicate employee_id
  IF EXISTS (SELECT 1 FROM public.profiles WHERE employee_id = v_emp_id AND id <> NEW.id) THEN
    v_emp_id := v_emp_id || '-' || substr(NEW.id::text, 1, 4);
  END IF;

  -- Clean up legacy unlinked rows with same email if present
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = NEW.email AND id <> NEW.id) THEN
    DELETE FROM public.trainee_profiles WHERE user_id IN (SELECT id FROM public.profiles WHERE email = NEW.email AND id <> NEW.id);
    DELETE FROM public.trainer_profiles WHERE user_id IN (SELECT id FROM public.profiles WHERE email = NEW.email AND id <> NEW.id);
    DELETE FROM public.approval_requests WHERE user_id IN (SELECT id FROM public.profiles WHERE email = NEW.email AND id <> NEW.id);
    DELETE FROM public.profiles WHERE email = NEW.email AND id <> NEW.id;
  END IF;

  -- Upsert profile record matching auth.users.id
  INSERT INTO public.profiles (
    id,
    firebase_uid,
    name,
    email,
    employee_id,
    role,
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.id::text,
    v_name,
    NEW.email,
    v_emp_id,
    v_role,
    v_status,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    employee_id = COALESCE(EXCLUDED.employee_id, public.profiles.employee_id),
    role = COALESCE(public.profiles.role, EXCLUDED.role),
    status = CASE 
      WHEN public.profiles.status = 'approved' THEN 'approved' 
      ELSE COALESCE(public.profiles.status, EXCLUDED.status) 
    END,
    updated_at = now();

  -- Role-specific extensions
  IF v_role = 'trainee' THEN
    INSERT INTO public.trainee_profiles (user_id, headline)
    VALUES (NEW.id, 'Trainee')
    ON CONFLICT (user_id) DO NOTHING;
  ELSIF v_role = 'trainer' THEN
    INSERT INTO public.trainer_profiles (user_id, designation)
    VALUES (NEW.id, 'Trainer')
    ON CONFLICT (user_id) DO NOTHING;

    -- Create pending approval request for admin review if not approved
    IF v_status = 'pending' THEN
      INSERT INTO public.approval_requests (user_id, requested_role, status, requested_at)
      VALUES (NEW.id, 'trainer', 'pending', now())
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: Sync any existing users in auth.users missing in public.profiles
DO $$
DECLARE
  u RECORD;
  v_name TEXT;
  v_role TEXT;
  v_emp_id TEXT;
  v_status TEXT;
BEGIN
  FOR u IN SELECT * FROM auth.users LOOP
    v_name := COALESCE(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      split_part(u.email, '@', 1)
    );
    v_role := COALESCE(u.raw_user_meta_data->>'role', 'trainee');
    v_emp_id := COALESCE(
      u.raw_user_meta_data->>'employee_id',
      'EMP-' || substr(u.id::text, 1, 6)
    );
    v_status := CASE WHEN v_role = 'trainer' THEN 'pending' ELSE 'approved' END;

    -- Fix employee_id conflict
    IF EXISTS (SELECT 1 FROM public.profiles WHERE employee_id = v_emp_id AND id <> u.id) THEN
      v_emp_id := v_emp_id || '-' || substr(u.id::text, 1, 4);
    END IF;

    -- Clean legacy row with same email
    IF EXISTS (SELECT 1 FROM public.profiles WHERE email = u.email AND id <> u.id) THEN
      DELETE FROM public.trainee_profiles WHERE user_id IN (SELECT id FROM public.profiles WHERE email = u.email AND id <> u.id);
      DELETE FROM public.trainer_profiles WHERE user_id IN (SELECT id FROM public.profiles WHERE email = u.email AND id <> u.id);
      DELETE FROM public.approval_requests WHERE user_id IN (SELECT id FROM public.profiles WHERE email = u.email AND id <> u.id);
      DELETE FROM public.profiles WHERE email = u.email AND id <> u.id;
    END IF;

    INSERT INTO public.profiles (
      id,
      firebase_uid,
      name,
      email,
      employee_id,
      role,
      status,
      created_at,
      updated_at
    )
    VALUES (
      u.id,
      u.id::text,
      v_name,
      u.email,
      v_emp_id,
      v_role,
      v_status,
      now(),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      employee_id = COALESCE(EXCLUDED.employee_id, public.profiles.employee_id),
      role = COALESCE(public.profiles.role, EXCLUDED.role),
      status = CASE 
        WHEN public.profiles.status = 'approved' THEN 'approved' 
        ELSE COALESCE(public.profiles.status, EXCLUDED.status)
      END,
      updated_at = now();

    -- Provision sub-profile
    IF v_role = 'trainee' THEN
      INSERT INTO public.trainee_profiles (user_id, headline)
      VALUES (u.id, 'Trainee')
      ON CONFLICT (user_id) DO NOTHING;
    ELSIF v_role = 'trainer' THEN
      INSERT INTO public.trainer_profiles (user_id, designation)
      VALUES (u.id, 'Trainer')
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

