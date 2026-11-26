-- Verify the migration's behavior using the disposable Supabase-compatible fixture.

INSERT INTO auth.users (id, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000010', '{"role":"admin"}'::jsonb);
INSERT INTO auth.users (id, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000011', '{"role":"  TRAINER "}'::jsonb);

DO $$
BEGIN
    IF (SELECT raw_user_meta_data ->> 'role' FROM auth.users
        WHERE id = '00000000-0000-0000-0000-000000000010') <> 'trainee' THEN
        RAISE EXCEPTION 'Signup metadata granted or retained an admin role';
    END IF;

    IF (SELECT raw_user_meta_data ->> 'role' FROM auth.users
        WHERE id = '00000000-0000-0000-0000-000000000011') <> 'trainer' THEN
        RAISE EXCEPTION 'Allowed trainer signup role was not normalized';
    END IF;
END;
$$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
);
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
    true
);

DO $$
BEGIN
    BEGIN
        UPDATE public.profiles SET role = 'admin'
        WHERE id = '00000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'Expected self-promotion to admin to fail';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        NULL;
    END;

    BEGIN
        UPDATE public.profiles SET status = 'suspended'
        WHERE id = '00000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'Expected self-service status change to fail';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        NULL;
    END;

    PERFORM set_config(
        'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true
    );
    PERFORM set_config(
        'request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}',
        true
    );

    BEGIN
        INSERT INTO public.profiles (id, email, role, status)
        VALUES (
            '00000000-0000-0000-0000-000000000004',
            'self-admin@example.test', 'admin', 'approved'
        );
        RAISE EXCEPTION 'Expected self-service admin profile creation to fail';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        NULL;
    END;

    INSERT INTO public.profiles (id, email, role, status)
    VALUES (
        '00000000-0000-0000-0000-000000000004',
        'self-trainer@example.test', 'trainer', 'approved'
    );

    IF (SELECT status FROM public.profiles
        WHERE id = '00000000-0000-0000-0000-000000000004') <> 'pending' THEN
        RAISE EXCEPTION 'Self-registered trainer was not forced into pending approval';
    END IF;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true
);
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',
    true
);
UPDATE public.profiles
SET role = 'trainer', status = 'pending'
WHERE id = '00000000-0000-0000-0000-000000000001';
DO $$
BEGIN
    IF (SELECT role FROM public.profiles
        WHERE id = '00000000-0000-0000-0000-000000000001') <> 'trainer' THEN
        RAISE EXCEPTION 'Administrator could not update a profile role';
    END IF;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    visible_rows integer;
BEGIN
    PERFORM set_config(
        'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
    );
    PERFORM set_config(
        'request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
        true
    );
    SELECT count(*) INTO visible_rows FROM public.questions;
    IF visible_rows <> 0 THEN
        RAISE EXCEPTION 'Trainee can read assessment questions directly';
    END IF;
    SELECT count(*) INTO visible_rows FROM public.question_options;
    IF visible_rows <> 0 THEN
        RAISE EXCEPTION 'Trainee can read answer options directly';
    END IF;

    PERFORM set_config(
        'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true
    );
    PERFORM set_config(
        'request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
        true
    );
    SELECT count(*) INTO visible_rows FROM public.questions;
    IF visible_rows <> 1 THEN
        RAISE EXCEPTION 'Owning trainer cannot read their assessment questions';
    END IF;
    SELECT count(*) INTO visible_rows FROM public.question_options;
    IF visible_rows <> 1 THEN
        RAISE EXCEPTION 'Owning trainer cannot read their assessment options';
    END IF;

    PERFORM set_config(
        'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true
    );
    PERFORM set_config(
        'request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',
        true
    );
    SELECT count(*) INTO visible_rows FROM public.questions;
    IF visible_rows <> 1 THEN
        RAISE EXCEPTION 'Administrator cannot read assessment questions';
    END IF;
    SELECT count(*) INTO visible_rows FROM public.question_options;
    IF visible_rows <> 1 THEN
        RAISE EXCEPTION 'Administrator cannot read assessment options';
    END IF;
END;
$$;
ROLLBACK;
