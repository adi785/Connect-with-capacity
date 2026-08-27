"""Dashboard and reporting aggregates (FR-9.x).

Each role gets a different scope: admins see platform-wide totals, trainers see only
their own courses, and trainees see only their own activity. Scoping is applied in the
query, so a trainer dashboard can never sum another trainer's enrollments.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Assessment,
    AssessmentAttempt,
    CertificateIssued,
    Course,
    Enrollment,
    Feedback,
    Notification,
    NotificationRead,
    Profile,
)
from app.deps import CurrentUser


async def _counts_by(db: AsyncSession, column, base: Select) -> dict[str, int]:
    rows = await db.execute(base.group_by(column))
    return {str(key): int(count) for key, count in rows.all() if key is not None}


async def _top_courses(
    db: AsyncSession, *, course_ids: list[uuid.UUID] | None = None, limit: int = 5
) -> list[dict[str, Any]]:
    """Most-enrolled courses, with completion counts and average rating."""
    enrollments = (
        select(
            Enrollment.course_id.label("course_id"),
            func.count(Enrollment.id).label("total"),
            func.count(Enrollment.id).filter(Enrollment.status == "completed").label("done"),
        )
        .group_by(Enrollment.course_id)
        .subquery()
    )
    ratings = (
        select(Feedback.course_id.label("course_id"), func.avg(Feedback.rating).label("avg"))
        .group_by(Feedback.course_id)
        .subquery()
    )

    query = (
        select(
            Course.id,
            Course.title,
            func.coalesce(enrollments.c.total, 0),
            func.coalesce(enrollments.c.done, 0),
            ratings.c.avg,
        )
        .outerjoin(enrollments, enrollments.c.course_id == Course.id)
        .outerjoin(ratings, ratings.c.course_id == Course.id)
        .order_by(func.coalesce(enrollments.c.total, 0).desc(), Course.title)
        .limit(limit)
    )
    if course_ids is not None:
        if not course_ids:
            return []
        query = query.where(Course.id.in_(course_ids))

    rows = await db.execute(query)
    return [
        {
            "course_id": course_id,
            "title": title,
            "enrollment_count": int(total),
            "completion_count": int(done),
            "average_rating": round(float(avg), 2) if avg is not None else None,
        }
        for course_id, title, total, done, avg in rows.all()
    ]


# ------------------------------- Admin view -------------------------------


async def admin_dashboard(db: AsyncSession) -> dict[str, Any]:
    users_total = (await db.scalar(select(func.count(Profile.id)))) or 0
    users_pending = (
        await db.scalar(select(func.count(Profile.id)).where(Profile.status == "pending"))
    ) or 0
    users_by_role = await _counts_by(
        db, Profile.role, select(Profile.role, func.count(Profile.id))
    )

    courses_total = (await db.scalar(select(func.count(Course.id)))) or 0
    courses_by_status = await _counts_by(
        db, Course.status, select(Course.status, func.count(Course.id))
    )

    enrollments_total = (await db.scalar(select(func.count(Enrollment.id)))) or 0
    enrollments_by_status = await _counts_by(
        db, Enrollment.status, select(Enrollment.status, func.count(Enrollment.id))
    )
    completed = enrollments_by_status.get("completed", 0)

    assessments_total = (await db.scalar(select(func.count(Assessment.id)))) or 0
    attempts_total = (await db.scalar(select(func.count(AssessmentAttempt.id)))) or 0
    attempts_submitted = (
        await db.scalar(
            select(func.count(AssessmentAttempt.id)).where(
                AssessmentAttempt.status == "submitted"
            )
        )
    ) or 0

    average_score = await db.scalar(
        select(func.avg(AssessmentAttempt.score)).where(
            AssessmentAttempt.status == "submitted"
        )
    )
    pass_rate = await _pass_rate(db)

    certificates = (await db.scalar(select(func.count(CertificateIssued.id)))) or 0
    average_rating = await db.scalar(select(func.avg(Feedback.rating)))

    return {
        "users_total": users_total,
        "users_pending": users_pending,
        "users_by_role": users_by_role,
        "courses_total": courses_total,
        "courses_by_status": courses_by_status,
        "enrollments_total": enrollments_total,
        "enrollments_by_status": enrollments_by_status,
        "completion_rate": round(completed / enrollments_total * 100, 2)
        if enrollments_total
        else 0.0,
        "assessments_total": assessments_total,
        "attempts_total": attempts_total,
        "attempts_submitted": attempts_submitted,
        "average_score": round(float(average_score), 2) if average_score is not None else None,
        "pass_rate": pass_rate,
        "certificates_issued": certificates,
        "average_course_rating": round(float(average_rating), 2)
        if average_rating is not None
        else None,
        "top_courses": await _top_courses(db),
    }


async def _pass_rate(
    db: AsyncSession, assessment_ids: list[uuid.UUID] | None = None
) -> float | None:
    """Share of submitted attempts at or above their assessment's pass mark."""
    query = (
        select(
            func.count(AssessmentAttempt.id),
            func.count(AssessmentAttempt.id).filter(
                AssessmentAttempt.score >= Assessment.pass_percentage
            ),
        )
        .join(Assessment, Assessment.id == AssessmentAttempt.assessment_id)
        .where(AssessmentAttempt.status == "submitted")
    )
    if assessment_ids is not None:
        if not assessment_ids:
            return None
        query = query.where(AssessmentAttempt.assessment_id.in_(assessment_ids))

    row = (await db.execute(query)).one_or_none()
    if not row or not row[0]:
        return None
    return round(row[1] / row[0] * 100, 2)


# ------------------------------ Trainer view ------------------------------


async def trainer_dashboard(db: AsyncSession, current_user: CurrentUser) -> dict[str, Any]:
    """Aggregates limited to courses this trainer authored."""
    trainer_id = current_user.trainer_profile_id
    if trainer_id is None:
        return {}

    course_ids = list(
        (
            await db.scalars(select(Course.id).where(Course.created_by == trainer_id))
        ).all()
    )
    if not course_ids:
        return {
            "courses_total": 0,
            "courses_published": 0,
            "enrollments_total": 0,
            "completions_total": 0,
            "assessments_total": 0,
            "attempts_submitted": 0,
            "average_score": None,
            "average_course_rating": None,
            "top_courses": [],
        }

    courses_published = (
        await db.scalar(
            select(func.count(Course.id)).where(
                Course.created_by == trainer_id, Course.status == "published"
            )
        )
    ) or 0

    enrollments_total = (
        await db.scalar(
            select(func.count(Enrollment.id)).where(Enrollment.course_id.in_(course_ids))
        )
    ) or 0
    completions_total = (
        await db.scalar(
            select(func.count(Enrollment.id)).where(
                Enrollment.course_id.in_(course_ids), Enrollment.status == "completed"
            )
        )
    ) or 0

    assessment_ids = list(
        (
            await db.scalars(
                select(Assessment.id).where(Assessment.course_id.in_(course_ids))
            )
        ).all()
    )

    attempts_submitted = 0
    average_score = None
    if assessment_ids:
        attempts_submitted = (
            await db.scalar(
                select(func.count(AssessmentAttempt.id)).where(
                    AssessmentAttempt.assessment_id.in_(assessment_ids),
                    AssessmentAttempt.status == "submitted",
                )
            )
        ) or 0
        average_score = await db.scalar(
            select(func.avg(AssessmentAttempt.score)).where(
                AssessmentAttempt.assessment_id.in_(assessment_ids),
                AssessmentAttempt.status == "submitted",
            )
        )

    average_rating = await db.scalar(
        select(func.avg(Feedback.rating)).where(Feedback.course_id.in_(course_ids))
    )

    return {
        "courses_total": len(course_ids),
        "courses_published": courses_published,
        "enrollments_total": enrollments_total,
        "completions_total": completions_total,
        "assessments_total": len(assessment_ids),
        "attempts_submitted": attempts_submitted,
        "average_score": round(float(average_score), 2) if average_score is not None else None,
        "average_course_rating": round(float(average_rating), 2)
        if average_rating is not None
        else None,
        "top_courses": await _top_courses(db, course_ids=course_ids),
    }


# ------------------------------ Trainee view ------------------------------


async def trainee_dashboard(db: AsyncSession, current_user: CurrentUser) -> dict[str, Any]:
    """Aggregates limited to this trainee's own activity."""
    trainee_id = current_user.trainee_profile_id
    if trainee_id is None:
        return {}

    by_status = await _counts_by(
        db,
        Enrollment.status,
        select(Enrollment.status, func.count(Enrollment.id)).where(
            Enrollment.trainee_profile_id == trainee_id
        ),
    )
    enrollments_total = sum(by_status.values())

    average_progress = await db.scalar(
        select(func.avg(Enrollment.progress_percent)).where(
            Enrollment.trainee_profile_id == trainee_id
        )
    )

    attempts_submitted = (
        await db.scalar(
            select(func.count(AssessmentAttempt.id)).where(
                AssessmentAttempt.trainee_profile_id == trainee_id,
                AssessmentAttempt.status == "submitted",
            )
        )
    ) or 0
    average_score = await db.scalar(
        select(func.avg(AssessmentAttempt.score)).where(
            AssessmentAttempt.trainee_profile_id == trainee_id,
            AssessmentAttempt.status == "submitted",
        )
    )

    certificates = (
        await db.scalar(
            select(func.count(CertificateIssued.id)).where(
                CertificateIssued.trainee_profile_id == trainee_id
            )
        )
    ) or 0

    unread = await _unread_for(db, current_user)

    return {
        "enrollments_total": enrollments_total,
        "in_progress": by_status.get("in_progress", 0) + by_status.get("enrolled", 0),
        "completed": by_status.get("completed", 0),
        "average_progress": round(float(average_progress), 2)
        if average_progress is not None
        else 0.0,
        "attempts_submitted": attempts_submitted,
        "average_score": round(float(average_score), 2) if average_score is not None else None,
        "certificates_earned": certificates,
        "unread_notifications": unread,
    }


async def _unread_for(db: AsyncSession, current_user: CurrentUser) -> int:
    from sqlalchemy import or_

    audience = or_(
        Notification.target_role == "all",
        Notification.target_role.is_(None),
        Notification.target_role == current_user.role,
    )
    total = (await db.scalar(select(func.count(Notification.id)).where(audience))) or 0
    read = (
        await db.scalar(
            select(func.count(NotificationRead.id)).where(
                NotificationRead.user_id == current_user.id
            )
        )
    ) or 0
    return max(total - read, 0)


# ------------------------------ CSV reporting ------------------------------


async def course_report_rows(
    db: AsyncSession, current_user: CurrentUser
) -> list[dict[str, Any]]:
    """Flat per-course rows for CSV export, scoped to what the caller may see."""
    query = select(Course)
    if not current_user.is_admin:
        if current_user.trainer_profile_id is None:
            return []
        query = query.where(Course.created_by == current_user.trainer_profile_id)

    courses = list((await db.scalars(query.order_by(Course.title))).all())
    if not courses:
        return []

    course_ids = [c.id for c in courses]
    enrollments = dict(
        (
            await db.execute(
                select(Enrollment.course_id, func.count(Enrollment.id))
                .where(Enrollment.course_id.in_(course_ids))
                .group_by(Enrollment.course_id)
            )
        ).all()
    )
    completions = dict(
        (
            await db.execute(
                select(Enrollment.course_id, func.count(Enrollment.id))
                .where(
                    Enrollment.course_id.in_(course_ids),
                    Enrollment.status == "completed",
                )
                .group_by(Enrollment.course_id)
            )
        ).all()
    )
    ratings = dict(
        (
            await db.execute(
                select(Feedback.course_id, func.avg(Feedback.rating))
                .where(Feedback.course_id.in_(course_ids))
                .group_by(Feedback.course_id)
            )
        ).all()
    )

    rows = []
    for course in courses:
        enrolled = enrollments.get(course.id, 0)
        done = completions.get(course.id, 0)
        rating = ratings.get(course.id)
        rows.append(
            {
                "course_id": str(course.id),
                "title": course.title,
                "status": course.status,
                "enrollments": enrolled,
                "completions": done,
                "completion_rate_percent": round(done / enrolled * 100, 2) if enrolled else 0.0,
                "average_rating": round(float(rating), 2) if rating is not None else "",
                "created_at": course.created_at.isoformat() if course.created_at else "",
            }
        )
    return rows
