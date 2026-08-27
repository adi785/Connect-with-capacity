"""Course feedback services (FR-7.x).

Ownership (Section 4): a trainee submits feedback only for a course they are enrolled
in, and only once. Trainees read their own feedback; the authoring trainer and admins
read all feedback for their course, which is where the aggregate view is used.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.db.models import Course, Feedback, Profile, TraineeProfile
from app.deps import CurrentUser
from app.services import audit, courses as course_service, enrollments as enrollment_service


async def submit_feedback(
    db: AsyncSession,
    current_user: CurrentUser,
    course_id: uuid.UUID,
    *,
    rating: int,
    comments: str | None,
) -> Feedback:
    """Record or update the caller's feedback for an enrolled course."""
    if current_user.trainee_profile_id is None:
        raise Conflict("Only trainees can submit feedback", code="trainee_profile_missing")

    await course_service.get_course(db, current_user, course_id)

    if not await enrollment_service.is_enrolled(
        db, current_user.trainee_profile_id, course_id
    ):
        raise Forbidden(
            "You can only review a course you are enrolled in", code="not_enrolled"
        )

    existing = await db.scalar(
        select(Feedback).where(
            Feedback.trainee_profile_id == current_user.trainee_profile_id,
            Feedback.course_id == course_id,
        )
    )
    if existing is not None:
        # Editing a review is friendlier than rejecting it, and keeps one row per pair.
        existing.rating = rating
        existing.comments = comments
        await db.flush()
        return existing

    feedback = Feedback(
        trainee_profile_id=current_user.trainee_profile_id,
        course_id=course_id,
        rating=rating,
        comments=comments,
    )
    db.add(feedback)
    await db.flush()
    await audit.record(
        db,
        actor_id=current_user.id,
        action="feedback.submitted",
        target_entity="feedback",
        target_id=feedback.id,
        meta={"course_id": str(course_id), "rating": rating},
    )
    return feedback


async def get_own_feedback(
    db: AsyncSession, current_user: CurrentUser, course_id: uuid.UUID
) -> Feedback | None:
    if current_user.trainee_profile_id is None:
        return None
    return await db.scalar(
        select(Feedback).where(
            Feedback.trainee_profile_id == current_user.trainee_profile_id,
            Feedback.course_id == course_id,
        )
    )


async def course_feedback_summary(
    db: AsyncSession,
    current_user: CurrentUser,
    course_id: uuid.UUID,
    *,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Aggregate rating plus the individual reviews.

    Trainee names are only attached for the course owner and admins; to a fellow
    trainee the reviews stay anonymous.
    """
    course = await course_service.get_course(db, current_user, course_id)
    privileged = current_user.is_admin or course_service._is_owner(course, current_user)

    average = await db.scalar(
        select(func.avg(Feedback.rating)).where(Feedback.course_id == course_id)
    )
    total = (
        await db.scalar(
            select(func.count(Feedback.id)).where(Feedback.course_id == course_id)
        )
    ) or 0

    breakdown_rows = await db.execute(
        select(Feedback.rating, func.count(Feedback.id))
        .where(Feedback.course_id == course_id)
        .group_by(Feedback.rating)
    )
    breakdown = {int(rating): count for rating, count in breakdown_rows.all() if rating}

    query = select(Feedback, Profile.name).join(
        TraineeProfile, TraineeProfile.id == Feedback.trainee_profile_id
    ).join(Profile, Profile.id == TraineeProfile.user_id).where(
        Feedback.course_id == course_id
    )

    if not privileged:
        # A plain trainee only ever sees their own review in the list.
        if current_user.trainee_profile_id is None:
            rows = []
        else:
            query = query.where(
                Feedback.trainee_profile_id == current_user.trainee_profile_id
            )
            rows = (
                await db.execute(query.order_by(Feedback.submitted_at.desc()))
            ).all()
    else:
        rows = (
            await db.execute(
                query.order_by(Feedback.submitted_at.desc()).limit(limit).offset(offset)
            )
        ).all()

    items = [
        {
            "id": feedback.id,
            "course_id": feedback.course_id,
            "trainee_profile_id": feedback.trainee_profile_id,
            "rating": feedback.rating,
            "comments": feedback.comments,
            "submitted_at": feedback.submitted_at,
            "trainee_name": name if privileged else None,
        }
        for feedback, name in rows
    ]

    return {
        "course_id": course_id,
        "average_rating": round(float(average), 2) if average is not None else None,
        "total_responses": total,
        "rating_breakdown": breakdown,
        "items": items,
    }


async def delete_feedback(
    db: AsyncSession, current_user: CurrentUser, feedback_id: uuid.UUID
) -> None:
    """Remove feedback. Own review, or an admin moderating."""
    feedback = await db.get(Feedback, feedback_id)
    if feedback is None:
        raise NotFound("Feedback not found", code="feedback_not_found")

    if not current_user.is_admin and feedback.trainee_profile_id != current_user.trainee_profile_id:
        raise NotFound("Feedback not found", code="feedback_not_found")

    await db.delete(feedback)
    await db.flush()
    await audit.record(
        db,
        actor_id=current_user.id,
        action="feedback.deleted",
        target_entity="feedback",
        target_id=feedback_id,
    )
