"""Subject taxonomy and trainer competency mapping (FR-3.x).

Authorization split (Section 4):
  * subjects        - read: any approved user; write: admin only
  * competency_map  - read: any approved user (needed for trainer suggestions);
                      write: admin for any trainer, or a trainer for their OWN row
                      (recorded as 'self_declared' so admin-assigned scores are
                      distinguishable from claims).
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.db.models import CompetencyMap, Course, Profile, Subject, TrainerProfile
from app.deps import CurrentUser
from app.services import audit

# -------------------------------- Subjects --------------------------------


async def list_subjects(
    db: AsyncSession, *, category: str | None = None, search: str | None = None
) -> list[Subject]:
    query = select(Subject)
    if category:
        query = query.where(Subject.category == category)
    if search:
        query = query.where(Subject.name.ilike(f"%{search.strip()}%"))
    rows = await db.scalars(query.order_by(Subject.category.nulls_last(), Subject.name))
    return list(rows.all())


async def get_subject(db: AsyncSession, subject_id: uuid.UUID) -> Subject:
    subject = await db.get(Subject, subject_id)
    if subject is None:
        raise NotFound("Subject not found", code="subject_not_found")
    return subject


async def create_subject(
    db: AsyncSession, admin: CurrentUser, *, name: str, category: str | None
) -> Subject:
    existing = await db.scalar(select(Subject.id).where(func.lower(Subject.name) == name.lower()))
    if existing is not None:
        raise Conflict(f"A subject named '{name}' already exists", code="subject_exists")

    subject = Subject(name=name, category=category)
    db.add(subject)
    await db.flush()
    await audit.record(
        db,
        actor_id=admin.id,
        action="subject.created",
        target_entity="subjects",
        target_id=subject.id,
        meta={"name": name, "category": category},
    )
    return subject


async def update_subject(
    db: AsyncSession, admin: CurrentUser, subject_id: uuid.UUID, values: dict
) -> Subject:
    subject = await get_subject(db, subject_id)
    if "name" in values and values["name"]:
        clash = await db.scalar(
            select(Subject.id).where(
                func.lower(Subject.name) == values["name"].lower(), Subject.id != subject_id
            )
        )
        if clash is not None:
            raise Conflict("Another subject already uses that name", code="subject_exists")
        subject.name = values["name"]
    if "category" in values:
        subject.category = values["category"]

    await db.flush()
    await audit.record(
        db,
        actor_id=admin.id,
        action="subject.updated",
        target_entity="subjects",
        target_id=subject.id,
        meta=values,
    )
    return subject


async def delete_subject(db: AsyncSession, admin: CurrentUser, subject_id: uuid.UUID) -> None:
    """Delete a subject, refusing while courses still reference it.

    `courses.subject_id` has no ON DELETE clause, so the FK would raise a raw
    IntegrityError; failing loudly here gives the admin an actionable message.
    """
    subject = await get_subject(db, subject_id)

    in_use = await db.scalar(
        select(func.count(Course.id)).where(Course.subject_id == subject_id)
    )
    if in_use:
        raise Conflict(
            f"{in_use} course(s) still use this subject. Reassign them first.",
            code="subject_in_use",
        )

    await db.delete(subject)
    await db.flush()
    await audit.record(
        db,
        actor_id=admin.id,
        action="subject.deleted",
        target_entity="subjects",
        target_id=subject_id,
        meta={"name": subject.name},
    )


# ----------------------------- Competency map -----------------------------


async def upsert_competency(
    db: AsyncSession,
    actor: CurrentUser,
    *,
    trainer_profile_id: uuid.UUID,
    subject_id: uuid.UUID,
    proficiency_score: float,
    source: str,
) -> CompetencyMap:
    """Set a trainer's proficiency for a subject (unique per trainer+subject).

    A trainer may only write their own row, and it is always stored as
    'self_declared' no matter what they send, so a self-claim can never masquerade
    as an admin assessment.
    """
    if not actor.is_admin:
        if trainer_profile_id != actor.trainer_profile_id:
            raise Forbidden(
                "You may only declare your own competencies", code="not_competency_owner"
            )
        source = "self_declared"

    if await db.get(TrainerProfile, trainer_profile_id) is None:
        raise NotFound("Trainer profile not found", code="trainer_profile_not_found")
    await get_subject(db, subject_id)

    row = await db.scalar(
        select(CompetencyMap).where(
            CompetencyMap.trainer_profile_id == trainer_profile_id,
            CompetencyMap.subject_id == subject_id,
        )
    )
    if row is None:
        row = CompetencyMap(
            trainer_profile_id=trainer_profile_id,
            subject_id=subject_id,
            proficiency_score=Decimal(str(proficiency_score)),
            source=source,
        )
        db.add(row)
    else:
        row.proficiency_score = Decimal(str(proficiency_score))
        row.source = source

    await db.flush()
    await audit.record(
        db,
        actor_id=actor.id,
        action="competency.upserted",
        target_entity="competency_map",
        target_id=row.id,
        meta={
            "trainer_profile_id": str(trainer_profile_id),
            "subject_id": str(subject_id),
            "score": proficiency_score,
            "source": source,
        },
    )
    return row


async def delete_competency(
    db: AsyncSession, actor: CurrentUser, competency_id: uuid.UUID
) -> None:
    row = await db.get(CompetencyMap, competency_id)
    if row is None:
        raise NotFound("Competency entry not found", code="competency_not_found")
    if not actor.is_admin and row.trainer_profile_id != actor.trainer_profile_id:
        raise NotFound("Competency entry not found", code="competency_not_found")

    await db.delete(row)
    await db.flush()
    await audit.record(
        db,
        actor_id=actor.id,
        action="competency.deleted",
        target_entity="competency_map",
        target_id=competency_id,
    )


async def list_trainer_competencies(
    db: AsyncSession, trainer_profile_id: uuid.UUID
) -> list[dict]:
    rows = await db.execute(
        select(CompetencyMap, Subject.name)
        .join(Subject, Subject.id == CompetencyMap.subject_id)
        .where(CompetencyMap.trainer_profile_id == trainer_profile_id)
        .order_by(CompetencyMap.proficiency_score.desc().nulls_last())
    )
    return [
        {
            "id": row.id,
            "trainer_profile_id": row.trainer_profile_id,
            "subject_id": row.subject_id,
            "subject_name": subject_name,
            "proficiency_score": float(row.proficiency_score)
            if row.proficiency_score is not None
            else None,
            "source": row.source,
            "updated_at": row.updated_at,
        }
        for row, subject_name in rows.all()
    ]


async def suggest_trainers(
    db: AsyncSession,
    subject_id: uuid.UUID,
    *,
    min_score: float | None = None,
    limit: int = 20,
) -> list[dict]:
    """Rank approved trainers for a subject by proficiency (FR-3.3).

    Only approved accounts are suggested — a pending or suspended trainer should
    never surface as assignable.
    """
    await get_subject(db, subject_id)

    course_counts = (
        select(Course.created_by.label("trainer_id"), func.count(Course.id).label("n"))
        .group_by(Course.created_by)
        .subquery()
    )

    query = (
        select(
            TrainerProfile.id,
            TrainerProfile.user_id,
            Profile.name,
            Profile.email,
            TrainerProfile.designation,
            TrainerProfile.bio,
            TrainerProfile.profile_photo_url,
            CompetencyMap.proficiency_score,
            CompetencyMap.source,
            func.coalesce(course_counts.c.n, 0),
        )
        .join(CompetencyMap, CompetencyMap.trainer_profile_id == TrainerProfile.id)
        .join(Profile, Profile.id == TrainerProfile.user_id)
        .outerjoin(course_counts, course_counts.c.trainer_id == TrainerProfile.id)
        .where(CompetencyMap.subject_id == subject_id, Profile.status == "approved")
        .order_by(CompetencyMap.proficiency_score.desc().nulls_last(), Profile.name)
        .limit(limit)
    )
    if min_score is not None:
        query = query.where(CompetencyMap.proficiency_score >= Decimal(str(min_score)))

    rows = await db.execute(query)
    return [
        {
            "trainer_profile_id": tp_id,
            "user_id": user_id,
            "name": name,
            "email": email,
            "designation": designation,
            "bio": bio,
            "profile_photo_url": photo,
            "proficiency_score": float(score) if score is not None else None,
            "source": source,
            "courses_authored": authored,
        }
        for (
            tp_id, user_id, name, email, designation, bio, photo, score, source, authored
        ) in rows.all()
    ]
