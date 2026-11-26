-- Minimal Supabase-compatible PostgreSQL fixture for the security migration.
-- This runs only in the disposable PostgreSQL service used by GitHub Actions.

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
    );
$$;

GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    role text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.profiles (id, email, role, status) VALUES
    ('00000000-0000-0000-0000-000000000001', 'trainee@example.test', 'trainee', 'approved'),
    ('00000000-0000-0000-0000-000000000002', 'trainer@example.test', 'trainer', 'approved'),
    ('00000000-0000-0000-0000-000000000003', 'admin@example.test', 'admin', 'approved');

CREATE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id);
CREATE POLICY "Admins can read all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.current_user_role() = 'admin');
CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins can update any profile"
ON public.profiles FOR UPDATE TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

CREATE TABLE public.trainer_profiles (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(id)
);
CREATE TABLE public.courses (
    id uuid PRIMARY KEY,
    created_by uuid NOT NULL REFERENCES public.trainer_profiles(id)
);
CREATE TABLE public.assessments (
    id uuid PRIMARY KEY,
    course_id uuid NOT NULL REFERENCES public.courses(id)
);
CREATE TABLE public.questions (
    id uuid PRIMARY KEY,
    assessment_id uuid NOT NULL REFERENCES public.assessments(id)
);
CREATE TABLE public.question_options (
    id uuid PRIMARY KEY,
    question_id uuid NOT NULL REFERENCES public.questions(id),
    is_correct boolean NOT NULL DEFAULT false
);

INSERT INTO public.trainer_profiles (id, user_id) VALUES
    ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.courses (id, created_by) VALUES
    ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000102');
INSERT INTO public.assessments (id, course_id) VALUES
    ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201');
INSERT INTO public.questions (id, assessment_id) VALUES
    ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000301');
INSERT INTO public.question_options (id, question_id, is_correct) VALUES
    ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000401', true);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions, public.question_options TO authenticated;
GRANT SELECT ON public.trainer_profiles, public.courses, public.assessments TO authenticated;

-- These reproduce the permissive policies in the current comprehensive migration.
CREATE POLICY "Read questions policy"
ON public.questions FOR SELECT TO authenticated
USING (true);
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

CREATE POLICY "Read question options policy"
ON public.question_options FOR SELECT TO authenticated
USING (true);
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
