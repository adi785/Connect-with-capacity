-- ============================================================================
-- CAPACITY CONNECT — Security hardening
-- --------------------------------------------------------------------------
-- Apply after 20260828_comprehensive_rls_and_schema_sync.sql.
-- This migration does not rewrite existing profiles or assessment data.
-- ============================================================================

-- Supabase user_metadata is editable by the account owner. Normalize signup
-- roles before the existing auth.users -> public.profiles sync trigger reads it.
-- Self-service signup may request trainee or trainer; administrator access must
-- come from trusted server-side provisioning or an existing administrator.
CREATE OR REPLACE FUNCTION public.sanitize_signup_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    requested_role TEXT;
BEGIN
    requested_role := lower(btrim(COALESCE(NEW.raw_user_meta_data ->> 'role', 'trainee')));

    IF requested_role NOT IN ('trainee', 'trainer') THEN
        requested_role := 'trainee';
    END IF;

    NEW.raw_user_meta_data := pg_catalog.jsonb_set(
        COALESCE(NEW.raw_user_meta_data, '{}'::jsonb),
        '{role}',
        pg_catalog.to_jsonb(requested_role),
        true
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_role_sanitized ON auth.users;
CREATE TRIGGER on_auth_user_role_sanitized
BEFORE INSERT OR UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_signup_role();


-- The previous guard checked current_user inside a SECURITY DEFINER function.
-- PostgreSQL changes current_user to the function owner in that context, so the
-- old check could incorrectly treat every caller as a trusted database role.
-- Use the request identity/JWT role instead, and guard both INSERT and UPDATE.
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_jwt_role TEXT := COALESCE(auth.jwt() ->> 'role', '');
BEGIN
    -- Calls without an end-user identity are trusted server-side operations
    -- (auth sync triggers and the backend's direct Postgres connection).
    IF auth.uid() IS NULL OR v_jwt_role = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF public.current_user_role() = 'admin' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Users may only create their own profile.'
                USING errcode = '42501';
        END IF;

        IF NEW.role IS NULL OR NEW.role NOT IN ('trainee', 'trainer') THEN
            RAISE EXCEPTION 'Self-service profile creation cannot grant administrator access.'
                USING errcode = '42501';
        END IF;

        -- Trainers still require approval; trainee signup follows the existing
        -- product workflow and is approved automatically.
        NEW.status := CASE WHEN NEW.role = 'trainer' THEN 'pending' ELSE 'approved' END;
        RETURN NEW;
    END IF;

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
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_privileges();


-- Assessment answer keys live in question_options.is_correct. The existing
-- "Trainers manage ..." FOR ALL policies already allow course-owning trainers
-- and admins to read/write these rows. Remove the permissive SELECT policies so
-- trainees cannot bypass the API's answer-key-free response schema via PostgREST.
DROP POLICY IF EXISTS "Read questions policy" ON public.questions;
DROP POLICY IF EXISTS "Read question options policy" ON public.question_options;

-- Existing admin assignments are deliberately left untouched. Review them
-- separately after applying this migration:
-- SELECT id, email, created_at FROM public.profiles WHERE role = 'admin';
