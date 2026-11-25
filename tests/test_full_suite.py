import base64
import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.core.security import VerifiedToken
from app.deps import get_or_create_profile


def create_dev_token(uid: str, email: str, role: str, name: str = "Test User", status: str = "approved") -> str:
    """Create a dev-mode token accepted by app.core.security in non-production mode."""
    payload = {
        "uid": uid,
        "sub": uid,
        "email": email,
        "name": name,
        "role": role,
        "status": status,
    }
    raw = json.dumps(payload).encode("utf-8")
    return base64.b64encode(raw).decode("utf-8")


ADMIN_TOKEN = create_dev_token("admin-user-001", "admin@test.gov.in", "admin", "Admin User")
TRAINER_TOKEN = create_dev_token("trainer-user-001", "trainer@test.gov.in", "trainer", "Trainer User")
TRAINEE_TOKEN = create_dev_token("trainee-user-001", "trainee@test.gov.in", "trainee", "Trainee User")


@pytest.mark.asyncio
async def test_meta_and_health_routes(client: AsyncClient):
    """Verify meta endpoints, OpenAPI schema, and Swagger UI."""
    res = await client.get("/")
    assert res.status_code == 200
    assert "CAPACITY CONNECT API" in res.json()["name"]

    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    res = await client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    res = await client.get("/docs")
    assert res.status_code == 200

    res = await client.get("/openapi.json")
    assert res.status_code == 200
    paths = res.json()["paths"]
    assert "/api/v1/courses" in paths
    assert "/api/v1/notifications" in paths
    assert "/api/v1/admin/dashboard" in paths


@pytest.mark.asyncio
async def test_unauthenticated_requests_blocked(client: AsyncClient):
    """Verify unauthenticated requests are rejected with 401."""
    res = await client.get("/api/v1/auth/me")
    assert res.status_code == 401

    res = await client.get("/api/v1/admin/dashboard")
    assert res.status_code == 401

    res = await client.post("/api/v1/courses", json={"title": "Unauthorized Course"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_rbac_enforcement(client: AsyncClient):
    """Verify strict role-based access control across Trainee, Trainer, and Admin."""
    # 1. Trainee cannot access admin dashboard
    res = await client.get(
        "/api/v1/admin/dashboard",
        headers={"Authorization": f"Bearer {TRAINEE_TOKEN}"},
    )
    assert res.status_code == 403

    # 2. Trainee cannot create courses
    res = await client.post(
        "/api/v1/courses",
        headers={"Authorization": f"Bearer {TRAINEE_TOKEN}"},
        json={"title": "Disallowed Trainee Course"},
    )
    assert res.status_code == 403

    # 3. Trainer cannot access admin users list
    res = await client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {TRAINER_TOKEN}"},
    )
    assert res.status_code == 403

    # 4. Trainer cannot publish global platform announcements
    res = await client.post(
        "/api/v1/notifications",
        headers={"Authorization": f"Bearer {TRAINER_TOKEN}"},
        json={"title": "Trainer Notice", "body": "Disallowed"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_auth_me_profiles(client: AsyncClient):
    """Verify /auth/me and /profile/me work for all roles."""
    for token, expected_role in [
        (ADMIN_TOKEN, "admin"),
        (TRAINER_TOKEN, "trainer"),
        (TRAINEE_TOKEN, "trainee"),
    ]:
        res = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        assert res.json()["role"] == expected_role

        # Profile alias route test
        res_alias = await client.get(
            "/api/v1/profile/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res_alias.status_code == 200
        assert res_alias.json()["role"] == expected_role


@pytest.mark.asyncio
async def test_admin_taxonomies_and_announcements(client: AsyncClient):
    """Verify Admin subject taxonomy and announcement creation, list, and feed."""
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}

    # 1. Create a subject
    unique_sub_name = f"DevOps Testing {uuid.uuid4().hex[:6]}"
    sub_res = await client.post(
        "/api/v1/subjects",
        headers=headers,
        json={"name": unique_sub_name, "category": "Technology"},
    )
    assert sub_res.status_code in (200, 201)
    subject_id = sub_res.json()["id"]

    # 2. List subjects (accessible to approved users)
    subs_list = await client.get("/api/v1/subjects", headers=headers)
    assert subs_list.status_code == 200
    assert any(s["id"] == subject_id for s in subs_list.json())

    # 3. Create announcement
    ann_res = await client.post(
        "/api/v1/notifications",
        headers=headers,
        json={
            "type": "announcement",
            "title": "Welcome to Capacity Connect 2026",
            "summary": "Platform launch announcement",
            "body": "Detailed onboarding information for all trainees and trainers.",
            "category": "General",
            "targetRole": "all",
            "status": "published",
        },
    )
    assert ann_res.status_code in (200, 201)
    ann_id = ann_res.json()["id"]

    # 4. Read notification feed as trainee
    feed_res = await client.get(
        "/api/v1/notifications?limit=50",
        headers={"Authorization": f"Bearer {TRAINEE_TOKEN}"},
    )
    assert feed_res.status_code == 200
    assert any(n["id"] == ann_id for n in feed_res.json()["items"])


@pytest.mark.asyncio
async def test_course_management_e2e(client: AsyncClient):
    """End-to-end Course lifecycle:
    Trainer creates course -> adds module -> links study material -> publishes
    Trainee browses catalog -> enrolls -> updates progress.
    """
    trainer_headers = {"Authorization": f"Bearer {TRAINER_TOKEN}"}
    trainee_headers = {"Authorization": f"Bearer {TRAINEE_TOKEN}"}

    # 1. Trainer creates a draft course
    course_res = await client.post(
        "/api/v1/courses",
        headers=trainer_headers,
        json={
            "title": "Advanced Microservices with FastAPI & PostgreSQL",
            "description": "Comprehensive engineering course on scalable asynchronous services.",
            "status": "draft",
        },
    )
    assert course_res.status_code in (200, 201)
    course_id = course_res.json()["id"]

    # 2. Trainer adds a module
    module_res = await client.post(
        f"/api/v1/courses/{course_id}/modules",
        headers=trainer_headers,
        json={"title": "Module 1: Asynchronous Architecture", "sequenceNo": 1},
    )
    assert module_res.status_code in (200, 201)
    module_id = module_res.json()["id"]

    # 3. Trainer attaches an external study resource
    resource_res = await client.post(
        f"/api/v1/modules/{module_id}/resources/link",
        headers=trainer_headers,
        json={
            "title": "FastAPI & SQLAlchemy Async Reference Guide",
            "url": "https://fastapi.tiangolo.com/advanced/async-sql/",
        },
    )
    assert resource_res.status_code in (200, 201)

    # 4. Trainer publishes the course
    publish_res = await client.patch(
        f"/api/v1/courses/{course_id}",
        headers=trainer_headers,
        json={"status": "published"},
    )
    assert publish_res.status_code == 200
    assert publish_res.json()["status"] == "published"

    # 5. Trainee browses catalog and sees the published course
    catalog_res = await client.get("/api/v1/courses", headers=trainee_headers)
    assert catalog_res.status_code == 200
    assert any(c["id"] == course_id for c in catalog_res.json()["items"])

    # 6. Trainee enrolls in the course
    enroll_res = await client.post(
        f"/api/v1/courses/{course_id}/enroll",
        headers=trainee_headers,
    )
    assert enroll_res.status_code in (200, 201)
    enrollment_id = enroll_res.json()["id"]

    # 7. Trainee updates their learning progress
    progress_res = await client.patch(
        f"/api/v1/enrollments/{enrollment_id}/progress",
        headers=trainee_headers,
        json={"progress_percent": 50, "status": "in_progress"},
    )
    assert progress_res.status_code == 200
    assert progress_res.json()["progress_percent"] == 50

    # 8. Trainer creates an assessment for this course
    assess_res = await client.post(
        "/api/v1/assessments",
        headers=trainer_headers,
        json={
            "course_id": course_id,
            "title": "FastAPI & PostgreSQL Comprehensive Exam",
            "pass_percentage": 70,
            "time_limit_minutes": 30,
            "status": "draft",
        },
    )
    assert assess_res.status_code in (200, 201)
    assessment_id = assess_res.json()["id"]

    # 9. Trainer adds a multiple-choice question
    q_res = await client.post(
        f"/api/v1/assessments/{assessment_id}/questions",
        headers=trainer_headers,
        json={
            "questions": [
                {
                    "question_text": "Which HTTP method is idempotent and removes a resource?",
                    "type": "single_choice",
                    "marks": 10,
                    "options": [
                        {"option_text": "POST", "is_correct": False, "sequence_no": 1},
                        {"option_text": "DELETE", "is_correct": True, "sequence_no": 2},
                        {"option_text": "PATCH", "is_correct": False, "sequence_no": 3},
                        {"option_text": "OPTIONS", "is_correct": False, "sequence_no": 4},
                    ],
                }
            ]
        },
    )
    assert q_res.status_code in (200, 201)
    full_assessment = q_res.json()
    assert len(full_assessment["questions"]) == 1
    q_id = full_assessment["questions"][0]["id"]
    correct_opt_id = [opt["id"] for opt in full_assessment["questions"][0]["options"] if opt["is_correct"]][0]

    # 10. Trainer publishes the assessment
    pub_assess_res = await client.patch(
        f"/api/v1/assessments/{assessment_id}",
        headers=trainer_headers,
        json={"status": "published"},
    )
    assert pub_assess_res.status_code == 200
    assert pub_assess_res.json()["status"] == "published"

    # 11. Enrolled trainee starts the assessment attempt
    attempt_res = await client.post(
        f"/api/v1/assessments/{assessment_id}/attempts",
        headers=trainee_headers,
    )
    assert attempt_res.status_code in (200, 201)
    attempt_id = attempt_res.json()["id"]

    # 12. Trainee submits the correct answer and passes
    submit_res = await client.post(
        f"/api/v1/attempts/{attempt_id}/submit",
        headers=trainee_headers,
        json={
            "answers": [
                {"question_id": q_id, "selected_option_id": correct_opt_id}
            ]
        },
    )
    assert submit_res.status_code == 200
    result_data = submit_res.json()
    assert result_data["passed"] is True
    assert result_data["score"] == 100
    assert result_data["obtained_marks"] == 10
    assert result_data["total_marks"] == 10

@pytest.mark.asyncio
async def test_bootstrap_admin_promotes_profile_created_by_auth_sync(monkeypatch):
    """The trusted bootstrap allowlist must work when Supabase already inserted the profile."""
    monkeypatch.setattr(settings, "bootstrap_admin_emails", "bootstrap@example.gov")

    profile = SimpleNamespace(
        firebase_uid="bootstrap-user-001",
        role="trainee",
        status="pending",
    )
    db = SimpleNamespace(
        scalar=AsyncMock(return_value=profile),
        flush=AsyncMock(),
    )
    token = VerifiedToken(
        uid="bootstrap-user-001",
        email="bootstrap@example.gov",
        raw_claims={"role": "trainee", "status": "pending"},
    )

    resolved = await get_or_create_profile(db, token)

    assert resolved.role == "admin"
    assert resolved.status == "approved"
    assert db.flush.await_count == 2

