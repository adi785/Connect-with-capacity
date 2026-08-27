-- ==========================================================================
-- CAPACITY CONNECT — Row Level Security policies for public.profiles
-- --------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor > New query).
--
-- Why this file exists
--   The dashboards read the signed-in user's role from the database, never
--   from the browser. That means the DATABASE is the real security boundary:
--   the JavaScript guard only decides what to render, and a determined visitor
--   can bypass it. These policies are what actually stop one account reading
--   another's data.
--
-- What it does
--   1. Keeps RLS enabled on profiles.
--   2. Lets every signed-in user read their own profile row.
--   3. Lets admins read every profile row  -> makes the Admin dashboard's
--      trainee/trainer lists and totals return real data.
--   4. Blocks self-service privilege escalation: a trainee cannot promote
--      themselves to admin or reactivate their own suspended account.
--
-- Never put the service_role key in frontend JavaScript. It bypasses every
-- policy below. The frontend uses the publishable anon key only.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 0. Make sure RLS is on. Without this, the anon key can read every profile.
-- --------------------------------------------------------------------------

alter table public.profiles enable row level security;


-- --------------------------------------------------------------------------
-- 1. Role lookup helper
--
-- A policy ON profiles must not itself SELECT FROM profiles — that recurses
-- and Postgres aborts with "infinite recursion detected in policy". Wrapping
-- the lookup in a SECURITY DEFINER function sidesteps it: the function runs as
-- its owner, so it is not subject to the calling user's policies.
--
-- STABLE lets the planner call it once per statement rather than once per row.
-- --------------------------------------------------------------------------

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid();
$$;

revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;


-- --------------------------------------------------------------------------
-- 2. Read policies
--
-- Postgres combines multiple PERMISSIVE policies with OR, so these two sit
-- side by side: everyone gets their own row, admins additionally get all rows.
-- --------------------------------------------------------------------------

drop policy if exists "Users can read own profile" on public.profiles;

create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);


drop policy if exists "Admins can read all profiles" on public.profiles;

create policy "Admins can read all profiles"
on public.profiles
for select
to authenticated
using (public.current_user_role() = 'admin');


-- --------------------------------------------------------------------------
-- 3. Write policies
--
-- Users may edit their own row, but section 4 stops them touching the columns
-- that grant power. Admins may edit any row.
-- --------------------------------------------------------------------------

drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);


drop policy if exists "Admins can update any profile" on public.profiles;

create policy "Admins can update any profile"
on public.profiles
for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');


-- --------------------------------------------------------------------------
-- 4. Privilege escalation guard
--
-- This is the important one. "Users can update own profile" would otherwise
-- let a trainee run:
--     update profiles set role = 'admin' where id = auth.uid();
-- straight from the browser with the anon key, and the frontend role check
-- would happily wave them into the admin dashboard afterwards.
--
-- A row-level policy cannot express "any column except these two", so the
-- restriction is enforced with a trigger instead.
-- --------------------------------------------------------------------------

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admins are allowed to change role and status.
  if public.current_user_role() = 'admin' then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only an administrator can change an account role.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    raise exception 'Only an administrator can change an account status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;

create trigger profiles_guard_privileges
before update on public.profiles
for each row
execute function public.guard_profile_privileges();


-- --------------------------------------------------------------------------
-- 5. Trainer visibility — template, not yet active
--
-- The trainer dashboard's "My Trainees" list needs to read the profile rows of
-- learners enrolled in that trainer's courses. That requires the course and
-- enrolment tables, which do not exist yet, so this is left commented out.
--
-- Uncomment and correct the table/column names once those tables exist, then
-- fill in the matching SCHEMA block in trainer-dashboard/app.js.
-- --------------------------------------------------------------------------

-- drop policy if exists "Trainers can read their trainees" on public.profiles;
--
-- create policy "Trainers can read their trainees"
-- on public.profiles
-- for select
-- to authenticated
-- using (
--   public.current_user_role() = 'trainer'
--   and exists (
--     select 1
--     from public.enrollments e
--     join public.courses c on c.id = e.course_id
--     where e.user_id = public.profiles.id
--       and c.trainer_id = auth.uid()
--   )
-- );


-- --------------------------------------------------------------------------
-- 5. Approval Requests Policies
-- --------------------------------------------------------------------------

alter table public.approval_requests enable row level security;

drop policy if exists "Users can read own approval requests" on public.approval_requests;
create policy "Users can read own approval requests"
on public.approval_requests
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own approval request" on public.approval_requests;
create policy "Users can insert own approval request"
on public.approval_requests
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Admins can read all approval requests" on public.approval_requests;
create policy "Admins can read all approval requests"
on public.approval_requests
for select
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Admins can update approval requests" on public.approval_requests;
create policy "Admins can update approval requests"
on public.approval_requests
for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');


-- --------------------------------------------------------------------------
-- 6. Trainee & Trainer Profile Extensions
-- --------------------------------------------------------------------------

alter table public.trainee_profiles enable row level security;

drop policy if exists "Trainees can read own profile or admins read all" on public.trainee_profiles;
create policy "Trainees can read own profile or admins read all"
on public.trainee_profiles
for select
to authenticated
using (auth.uid() = user_id or public.current_user_role() = 'admin');

drop policy if exists "Trainees can manage own trainee profile" on public.trainee_profiles;
create policy "Trainees can manage own trainee profile"
on public.trainee_profiles
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

alter table public.trainer_profiles enable row level security;

drop policy if exists "Authenticated users can read trainer profiles" on public.trainer_profiles;
create policy "Authenticated users can read trainer profiles"
on public.trainer_profiles
for select
to authenticated
using (true);

drop policy if exists "Trainers can manage own trainer profile" on public.trainer_profiles;
create policy "Trainers can manage own trainer profile"
on public.trainer_profiles
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);


-- --------------------------------------------------------------------------
-- 7. Verify
--
-- Run these after applying the file. The first should list the policies above;
-- the second should return your own role.
-- --------------------------------------------------------------------------

-- select policyname, cmd from pg_policies
-- where schemaname = 'public' and tablename = 'profiles'
-- order by policyname;

-- select public.current_user_role();
