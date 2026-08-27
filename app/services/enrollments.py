"""Enrollment and progress services (FR-5.x).

Ownership (Section 4): a trainee reads and writes only their OWN enrollment rows.
The authoring trainer and admins may read the participant list for a course but
never edit someone else's progress.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.db.models import Course, Enrollment, Profile, TraineeProfile
from app.deps import CurrentUser
from app.services import audit, courses as course_service


async def enroll(
    db: AsyncSession, current_user: CurrentUser, course_id: uuid.UUID
) -> Enrollment:
    """Self-enroll the calling trainee into a published course."""
    if current_user.trainee_profile_id is None:
        raise Conflict("Only trainees can enroll", code="trainee_profile_missing")

    course = await course_service.get_course(db, current_user, course_id)
    if course.status != "published":
        raise Conflict("This course is not open for enrollment", code="course_not_published")

    existing = await db.scalar(
        select(Enrollment).where(
            Enrollment.trainee_profile_id == current_user.trainee_profile_id,
            Enrollment.course_id == course_id,
        )
    )
    if existing is not None:
        if existing.status == "dropped":
            # Re-joining reuses the row so history and the unique constraint both hold.
            existing.status = "enrolled"
            existing.enrolled_at = dt.datetime.now(dt.timezone.utc)
            await db.flush()
            return existing
        raise Conflict("You are already enrolled in this course", code="already_enrolled")

    enrollment = Enrollment(
        trainee_profile_id=current_user.trainee_profile_id,
        course_id=course_id,
        status="enrolled",
        progress_percent=0,
    )
    db.add(enrollment)
    await db.flush()
    await audit.record(
        db,
        actor_id=current_user.id,
        action="enrollment.created",
        target_entity="enrollments",
        target_id=enrollment.id,
        meta={"course_id": str(course_id)},
    )
    return enrollment


async def get_own_enrollment(
    db: AsyncSession, current_user: CurrentUser, enrollment_id: uuid.UUID
) -> Enrollment:
    enrollment = await db.get(Enrollment, enrollment_id)
    if enrollment is None or enrollment.trainee_profile_id != current_user.trainee_profile_id:
        raise NotFound("Enrollment not found", code="enrollment_not_found")
    return enrollment


async def update_progress(
    db: AsyncSession,
    current_user: CurrentUser,
    enrollment_id: uuid.UUID,
    *,
    progress_percent: int,
    status: str | None = None,
) -> Enrollment:
    """Update the caller's own progress, deriving status when not given explicitly."""
    enrollment = await get_own_enrollment(db, current_user, enrollment_id)

    enrollment.progress_percent = progress_percent

    if status is not None:
        enrollment.status = status
    elif progress_percent >= 100:
        enrollment.status = "completed"
    elif progress_percent > 0 and enrollment.status == "enrolled":
        enrollment.status = "in_progress"

    if enrollment.status == "completed" and enrollment.completed_at is None:
        enrollment.completed_at = dt.datetime.now(dt.timezone.utc)
    elif enrollment.status != "completed":
        enrollment.completed_at = None

    await db.flush()
    return enrollment


async def drop(
    db: AsyncSession, current_user: CurrentUser, enrollment_id: uuid.UUID
) -> Enrollment:
    enrollment = await get_own_enrollment(db, current_user, enrollment_id)
    enrollment.status = "dropped"
    enrollment.completed_at = None
    await db.flush()
    await audit.record(
        db,
        actor_id=current_user.id,
        action="enrollment.dropped",
        target_entity="enrollments",
        target_id=enrollment.id,
    )
    return enrollment


async def list_own_enrollments(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    if current_user.trainee_profile_id is None:
        return [], 0

    query = (
        select(Enrollment, Course.title)
        .join(Course, Course.id == Enrollment.course_id)
        .where(Enrollment.trainee_profile_id == current_user.trainee_profile_id)
    )
    count_q = select(func.count(Enrollment.id)).where(
        Enrollment.trainee_profile_id == current_user.trainee_profile_id
    )
    if status:
        query = query.where(Enrollment.status == status)
        count_q = count_q.where(Enrollment.status == status)

    total = (await db.scalar(count_q)) or 0
    rows = await db.execute(
        query.order_by(Enrollment.enrolled_at.desc()).limit(limit).offset(offset)
    )
    items = [
        _serialize(enrollment, course_title=title) for enrollment, title in rows.all()
    ]
    return items, total


async def list_course_participants(
    db: AsyncSession,
    current_user: CurrentUser,
    course_id: uuid.UUID,
    *,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """Participant roster for a course — authoring trainer or admin only."""
    course = await course_service.get_course(db, current_user, course_id)
    if not current_user.is_admin and not course_service._is_owner(course, current_user):
        raise Forbidden(
            "Only the course owner or an admin can view participants", code="not_course_owner"
        )

    query = (
        select(Enrollment, Profile.name, Profile.email)
        .join(TraineeProfile, TraineeProfile.id == Enrollment.trainee_profile_id)
        .join(Profile, Profile.id == TraineeProfile.user_id)
        .where(Enrollment.course_id == course_id)
    )
    count_q = select(func.count(Enrollment.id)).where(Enrollment.course_id == course_id)
    if status:
        query = query.where(Enrollment.status == status)
        count_q = count_q.where(Enrollment.status == status)

    total = (await db.scalar(count_q)) or 0
    rows = await db.execute(
        query.order_by(Enrollment.enrolled_at.desc()).limit(limit).offset(offset)
    )
    items = [
        _serialize(enrollment, course_title=course.title, trainee_name=name, trainee_email=email)
        for enrollment, name, email in rows.all()
    ]
    return items, total


def _serialize(
    enrollment: Enrollment,
    *,
    course_title: str | None = None,
    trainee_name: str | None = None,
    trainee_email: str | None = None,
) -> dict[str, Any]:
    return {
        "id": enrollment.id,
        "trainee_profile_id": enrollment.trainee_profile_id,
        "course_id": enrollment.course_id,
        "course_title": course_title,
        "status": enrollment.status,
        "progress_percent": enrollment.progress_percent or 0,
        "enrolled_at": enrollment.enrolled_at,
        "completed_at": enrollment.completed_at,
        "trainee_name": trainee_name,
        "trainee_email": trainee_email,
    }


serialize = _serialize


async def is_enrolled(
    db: AsyncSession, trainee_profile_id: uuid.UUID, course_id: uuid.UUID
) -> bool:
    count = await db.scalar(
        select(func.count(Enrollment.id)).where(
            Enrollment.trainee_profile_id == trainee_profile_id,
            Enrollment.course_id == course_id,
        )
    )
    return bool(count)
