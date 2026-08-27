-- ==========================================================================
-- CAPACITY CONNECT — Supabase Auth Trigger & Profiles Sync
-- --------------------------------------------------------------------------
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- Why this is needed:
--   When a user registers via Supabase Auth (signUp), Supabase puts them into
--   the private `auth.users` table. This trigger automatically creates their
--   matching profile record in `public.profiles` so their name, employee_id,
--   and role appear in the database and dashboards immediately.
-- ==========================================================================

-- 1. Ensure `profiles` table columns are compatible
ALTER TABLE public.profiles ALTER COLUMN firebase_uid DROP NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100);

-- 2. Create the trigger function to copy auth.users into public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_name TEXT;
  v_role TEXT;
  v_emp_id TEXT;
  v_status TEXT;
BEGIN
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'trainee');
  v_emp_id := COALESCE(NEW.raw_user_meta_data->>'employee_id', 'EMP-' || substr(NEW.id::text, 1, 6));
  
  -- Trainers require admin approval (status = 'pending'); Trainees are auto-approved.
  IF v_role = 'trainer' THEN
    v_status := 'pending';
  ELSE
    v_status := 'approved';
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
    role = EXCLUDED.role,
    status = EXCLUDED.status,
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

    -- Create pending approval request for admin review
    INSERT INTO public.approval_requests (user_id, requested_role, status, requested_at)
    VALUES (NEW.id, 'trainer', 'pending', now())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Sync any users ALREADY registered in auth.users that are missing in public.profiles
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
SELECT 
  u.id, 
  u.id::text, 
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)), 
  u.email, 
  COALESCE(u.raw_user_meta_data->>'employee_id', 'EMP-' || substr(u.id::text, 1, 6)), 
  COALESCE(u.raw_user_meta_data->>'role', 'trainee'), 
  'approved',
  now(),
  now()
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
  status = 'approved';

-- Also backfill trainee_profiles for synced users
INSERT INTO public.trainee_profiles (user_id, headline)
SELECT p.id, 'Trainee'
FROM public.profiles p
WHERE p.role = 'trainee'
ON CONFLICT (user_id) DO NOTHING;
