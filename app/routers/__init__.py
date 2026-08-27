"""Router registry.

Each module exposes one or more `APIRouter`s that already carry their own prefix and
tags, so `main.py` just mounts everything in `ALL_ROUTERS` under the API prefix.

Order matters where two routers share a prefix segment: `feedback` adds paths under
`/courses/{course_id}/feedback`, which is a deeper path than anything in `courses`, so
neither shadows the other. Keep new course-scoped routes deeper than `/courses/{id}`.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.routers import (
    admin,
    assessments,
    auth,
    courses,
    dashboard,
    feedback,
    notifications,
    subjects,
)

ALL_ROUTERS: tuple[APIRouter, ...] = (
    auth.router,
    auth.profile_router,
    admin.router,
    subjects.router,
    subjects.competency_router,
    courses.router,
    courses.module_router,
    courses.resource_router,
    courses.enrollment_router,
    assessments.router,
    assessments.question_router,
    assessments.attempt_router,
    feedback.router,
    feedback.feedback_router,
    notifications.router,
    dashboard.router,
)

__all__ = ["ALL_ROUTERS"]
