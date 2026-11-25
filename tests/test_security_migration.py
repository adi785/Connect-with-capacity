"""Static regression checks for the Supabase security-hardening migration.

These checks protect the migration contract without requiring production Supabase
credentials. The SQL still needs to be applied and verified against a staging
Supabase/PostgreSQL project before deployment.
"""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations" / "20261125_security_hardening.sql"
SQL = MIGRATION.read_text(encoding="utf-8")


def function_body(name: str) -> str:
    match = re.search(
        rf"CREATE OR REPLACE FUNCTION public\.{re.escape(name)}\(\).*?AS \$\$(.*?)\$\$;",
        SQL,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if match is None:
        raise AssertionError(f"Function {name} is missing from the migration")
    return match.group(1)


class SecurityMigrationTests(unittest.TestCase):
    def test_signup_metadata_role_is_allowlisted(self) -> None:
        body = function_body("sanitize_signup_role")
        self.assertIn("requested_role NOT IN ('trainee', 'trainer')", body)
        self.assertIn("requested_role := 'trainee'", body)
        self.assertIn("pg_catalog.jsonb_set", body)

    def test_signup_sanitizer_runs_before_auth_profile_sync(self) -> None:
        self.assertRegex(
            SQL,
            r"CREATE TRIGGER on_auth_user_role_sanitized\s+"
            r"BEFORE INSERT OR UPDATE OF raw_user_meta_data ON auth\.users",
        )

    def test_profile_guard_uses_request_identity_not_security_definer_current_user(self) -> None:
        body = function_body("guard_profile_privileges")
        self.assertIn("auth.uid() IS NULL", body)
        self.assertIn("v_jwt_role = 'service_role'", body)
        self.assertIn("public.current_user_role() = 'admin'", body)
        self.assertNotIn("current_user IN", body.lower())
        self.assertIn("TG_OP = 'INSERT'", body)
        self.assertIn("NEW.role NOT IN ('trainee', 'trainer')", body)

    def test_profile_guard_covers_insert_and_update(self) -> None:
        self.assertRegex(
            SQL,
            r"CREATE TRIGGER profiles_guard_privileges\s+"
            r"BEFORE INSERT OR UPDATE ON public\.profiles",
        )

    def test_trainees_no_longer_have_broad_assessment_question_select_policies(self) -> None:
        self.assertIn(
            'DROP POLICY IF EXISTS "Read questions policy" ON public.questions;', SQL
        )
        self.assertIn(
            'DROP POLICY IF EXISTS "Read question options policy" ON public.question_options;',
            SQL,
        )


if __name__ == "__main__":
    unittest.main()
