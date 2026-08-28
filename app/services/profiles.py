"""Profile services: the caller's own profile plus trainee/trainer detail records.

Ownership rule (Section 4): a user may only read and write their OWN profile rows.
Admins may read any profile. Every function here takes the acting `CurrentUser` and
enforces that itself rather than trusting the router.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.db.models import (
    ApprovalRequest,
    Certificate,
    CompetencyMap,
    Course,
    Interest,
    Profile,
    Qualification,
    Skill,
    Subject,
    TraineeProfile,
    TrainerProfile,
    WorkExperience,
)
from app.deps import CurrentUser
from app.services import audit

# ------------------------------ Core profile ------------------------------


async def get_profile(db: AsyncSession, profile_id: uuid.UUID) -> Profile:
    profile = await db.get(Profile, profile_id)
    if profile is None:
        raise NotFound("Profile not found", code="profile_not_found")
    return profile


async def register_profile(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    name: str | None,
    email: str | None,
    role: str,
) -> tuple[Profile, uuid.UUID | None, uuid.UUID | None]:
    """Complete first-time registration for an already-authenticated Firebase user.

    The profile row itself was created when the token was first verified; this call
    fills in the display name and the requested role, then files an approval request.
    Re-registering is idempotent for the profile but never re-opens an approved
    account for a second review.
    """
    profile = await get_profile(db, current_user.id)

    if name:
        profile.name = name[:150]
    if email:
        profile.email = email.lower().strip()[:150]

    # An admin (bootstrap or promoted) keeps their role; nobody self-assigns admin.
    if profile.role != "admin":
        if profile.status == "approved" and profile.role != role:
            raise Conflict(
                "Your account is already approved as "
                f"'{profile.role}'. Ask an administrator to change your role.",
                code="role_locked",
            )
        profile.role = role

    await db.flush()

    trainee_id, trainer_id = await ensure_role_records(db, profile)
    await _ensure_approval_request(db, profile)

    profile.last_login_at = dt.datetime.now(dt.timezone.utc)
    await db.flush()

    await audit.record(
        db,
        actor_id=profile.id,
        action="profile.registered",
        target_entity="profiles",
        target_id=profile.id,
        meta={"role": profile.role, "status": profile.status},
    )
    return profile, trainee_id, trainer_id


async def ensure_role_records(
    db: AsyncSession, profile: Profile
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """Create the trainee/trainer side row matching the profile's current role."""
    trainee_id = await db.scalar(
        select(TraineeProfile.id).where(TraineeProfile.user_id == profile.id)
    )
    trainer_id = await db.scalar(
        select(TrainerProfile.id).where(TrainerProfile.user_id == profile.id)
    )

    if profile.role == "trainee" and trainee_id is None:
        row = TraineeProfile(user_id=profile.id)
        db.add(row)
        await db.flush()
        trainee_id = row.id
    elif profile.role == "trainer" and trainer_id is None:
        row = TrainerProfile(user_id=profile.id)
        db.add(row)
        await db.flush()
        trainer_id = row.id

    return trainee_id, trainer_id


async def _ensure_approval_request(db: AsyncSession, profile: Profile) -> None:
    """Open a pending approval request unless one already exists or isn't needed."""
    if profile.role == "admin" or profile.status != "pending":
        return

    existing = await db.scalar(
        select(ApprovalRequest.id).where(
            ApprovalRequest.user_id == profile.id,
            ApprovalRequest.status == "pending",
        )
    )
    if existing is not None:
        # Keep the open request pointing at the role the user is actually asking for.
        request = await db.get(ApprovalRequest, existing)
        if request is not None and request.requested_role != profile.role:
            request.requested_role = profile.role
            await db.flush()
        return

    db.add(ApprovalRequest(user_id=profile.id, requested_role=profile.role, status="pending"))
    await db.flush()


async def update_profile(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    name: str | None = None,
    mfa_enabled: bool | None = None,
) -> Profile:
    """Update the caller's own core profile. Role and status are admin-only."""
    profile = await get_profile(db, current_user.id)
    if name is not None:
        profile.name = name[:150]
    if mfa_enabled is not None:
        profile.mfa_enabled = mfa_enabled
    await db.flush()
    return profile


# ----------------------------- Trainee profile -----------------------------


async def get_trainee_profile(
    db: AsyncSession, current_user: CurrentUser, trainee_profile_id: uuid.UUID | None = None
) -> TraineeProfile:
    """Load a trainee profile with all nested detail.

    Passing no id means "mine". Passing an id is admin-only, except that it's also
    allowed when it happens to be the caller's own profile.
    """
    target_id = trainee_profile_id or current_user.trainee_profile_id
    if target_id is None:
        raise NotFound("No trainee profile for this account", code="trainee_profile_missing")

    if target_id != current_user.trainee_profile_id and not current_user.is_admin:
        raise Forbidden("You may only view your own profile", code="not_profile_owner")

    profile = await db.get(TraineeProfile, target_id)
    if profile is None:
        raise NotFound("Trainee profile not found", code="trainee_profile_not_found")
    return profile


async def _own_trainee_profile(db: AsyncSession, current_user: CurrentUser) -> TraineeProfile:
    if current_user.trainee_profile_id is None:
        raise Conflict("No trainee profile for this account", code="trainee_profile_missing")
    profile = await db.get(TraineeProfile, current_user.trainee_profile_id)
    if profile is None:
        raise NotFound("Trainee profile not found", code="trainee_profile_not_found")
    return profile


async def update_trainee_profile(
    db: AsyncSession, current_user: CurrentUser, data: dict[str, Any]
) -> TraineeProfile:
    profile = await _own_trainee_profile(db, current_user)
    for field in ("headline", "bio", "profile_photo_url"):
        if field in data:
            setattr(profile, field, data[field])
    await db.flush()
    return profile


# Each trainee sub-entity behaves identically: scope writes to the caller's own
# trainee profile, so one generic helper covers add/delete for all of them.
_TRAINEE_CHILDREN: dict[str, type] = {
    "qualifications": Qualification,
    "work_experience": WorkExperience,
    "interests": Interest,
    "certificates": Certificate,
}


async def add_trainee_child(
    db: AsyncSession, current_user: CurrentUser, kind: str, values: dict[str, Any]
):
    """Append a qualification / experience / interest / certificate to own profile."""
    model = _TRAINEE_CHILDREN[kind]
    profile = await _own_trainee_profile(db, current_user)
    row = model(trainee_profile_id=profile.id, **values)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def update_trainee_child(
    db: AsyncSession,
    current_user: CurrentUser,
    kind: str,
    child_id: uuid.UUID,
    values: dict[str, Any],
):
    model = _TRAINEE_CHILDREN[kind]
    row = await _get_owned_child(db, current_user, model, child_id)
    for key, value in values.items():
        setattr(row, key, value)
    await db.flush()
    return row


async def delete_trainee_child(
    db: AsyncSession, current_user: CurrentUser, kind: str, child_id: uuid.UUID
) -> None:
    model = _TRAINEE_CHILDREN[kind]
    row = await _get_owned_child(db, current_user, model, child_id)
    await db.delete(row)
    await db.flush()


async def _get_owned_child(
    db: AsyncSession, current_user: CurrentUser, model: type, child_id: uuid.UUID
):
    """Fetch a child row and verify it hangs off the caller's own trainee profile.

    Returning 404 (not 403) for someone else's row avoids confirming that the id
    exists at all.
    """
    row = await db.get(model, child_id)
    if row is None or row.trainee_profile_id != current_user.trainee_profile_id:
        raise NotFound("Record not found", code="record_not_found")
    return row


# -------------------------------- Skills --------------------------------


async def add_skill(
    db: AsyncSession, current_user: CurrentUser, *, skill_name: str, proficiency_level: str
) -> Skill:
    """Attach a skill to whichever side-profile the caller has."""
    if current_user.trainee_profile_id:
        row = Skill(
            trainee_profile_id=current_user.trainee_profile_id,
            skill_name=skill_name,
            proficiency_level=proficiency_level,
        )
    elif current_user.trainer_profile_id:
        row = Skill(
            trainer_profile_id=current_user.trainer_profile_id,
            skill_name=skill_name,
            proficiency_level=proficiency_level,
        )
    else:
        raise Conflict("No role profile for this account", code="role_profile_missing")

    db.add(row)
    await db.flush()
    return row


async def delete_skill(db: AsyncSession, current_user: CurrentUser, skill_id: uuid.UUID) -> None:
    row = await db.get(Skill, skill_id)
    owned = row is not None and (
        (row.trainee_profile_id is not None
         and row.trainee_profile_id == current_user.trainee_profile_id)
        or (row.trainer_profile_id is not None
            and row.trainer_profile_id == current_user.trainer_profile_id)
    )
    if not owned:
        raise NotFound("Skill not found", code="skill_not_found")
    await db.delete(row)
    await db.flush()


# ----------------------------- Trainer profile -----------------------------


async def get_trainer_profile(
    db: AsyncSession, current_user: CurrentUser, trainer_profile_id: uuid.UUID | None = None
) -> TrainerProfile:
    """Load a trainer profile. Trainer profiles are readable by any approved user.

    Trainee-facing "who teaches this" views need them, and they hold no private data
    beyond a bio and designation.
    """
    target_id = trainer_profile_id or current_user.trainer_profile_id
    if target_id is None:
        raise NotFound("No trainer profile for this account", code="trainer_profile_missing")

    query = (
        select(TrainerProfile)
        .options(
            selectinload(TrainerProfile.skills),
            selectinload(TrainerProfile.competencies),
        )
        .where(TrainerProfile.id == target_id)
    )
    profile = await db.scalar(query)
    if profile is None:
        raise NotFound("Trainer profile not found", code="trainer_profile_not_found")
    return profile


async def update_trainer_profile(
    db: AsyncSession, current_user: CurrentUser, data: dict[str, Any]
) -> TrainerProfile:
    if current_user.trainer_profile_id is None:
        raise Conflict("No trainer profile for this account", code="trainer_profile_missing")

    query = (
        select(TrainerProfile)
        .options(
            selectinload(TrainerProfile.skills),
            selectinload(TrainerProfile.competencies),
        )
        .where(TrainerProfile.id == current_user.trainer_profile_id)
    )
    profile = await db.scalar(query)
    if profile is None:
        raise NotFound("Trainer profile not found", code="trainer_profile_not_found")

    for field in ("bio", "designation", "organization", "phone", "experience_years", "profile_photo_url"):
        if field in data:
            setattr(profile, field, data[field])
    now = dt.datetime.now(dt.timezone.utc)
    profile.updated_at = now
    await db.flush()

    query = (
        select(TrainerProfile)
        .options(
            selectinload(TrainerProfile.skills),
            selectinload(TrainerProfile.competencies),
        )
        .where(TrainerProfile.id == current_user.trainer_profile_id)
    )
    profile = await db.scalar(query)
    return profile


# ------------------------------ Serialization ------------------------------


def serialize_skill(skill: Skill) -> dict[str, Any]:
    return {
        "id": skill.id,
        "skill_name": skill.skill_name,
        "proficiency_level": skill.proficiency_level,
    }


def serialize_trainee_profile(profile: TraineeProfile) -> dict[str, Any]:
    """Flatten a trainee profile and its eager-loaded children for the response model."""
    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "headline": profile.headline,
        "bio": profile.bio,
        "profile_photo_url": profile.profile_photo_url,
        "updated_at": profile.updated_at,
        "qualifications": [
            {
                "id": q.id,
                "degree": q.degree,
                "institution": q.institution,
                "year_of_completion": q.year_of_completion,
            }
            for q in profile.qualifications
        ],
        "work_experience": [
            {
                "id": w.id,
                "organization": w.organization,
                "designation": w.designation,
                "start_date": w.start_date,
                "end_date": w.end_date,
                "description": w.description,
            }
            for w in profile.work_experience
        ],
        "interests": [{"id": i.id, "interest_name": i.interest_name} for i in profile.interests],
        "skills": [serialize_skill(s) for s in profile.skills],
        "certificates": [
            {
                "id": c.id,
                "title": c.title,
                "issuing_body": c.issuing_body,
                "issue_date": c.issue_date,
                "file_url": c.file_url,
            }
            for c in profile.certificates
        ],
    }


async def serialize_trainer_profile(
    db: AsyncSession, profile: TrainerProfile
) -> dict[str, Any]:
    """Flatten a trainer profile, resolving subject names for its competencies."""
    subject_names: dict[uuid.UUID, str] = {}
    subject_ids = [c.subject_id for c in profile.competencies]
    if subject_ids:
        rows = await db.execute(
            select(Subject.id, Subject.name).where(Subject.id.in_(subject_ids))
        )
        subject_names = {sid: name for sid, name in rows.all()}

    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "bio": profile.bio,
        "designation": profile.designation,
        "organization": profile.organization,
        "phone": profile.phone,
        "experience_years": profile.experience_years,
        "profile_photo_url": profile.profile_photo_url,
        "updated_at": profile.updated_at,
        "skills": [serialize_skill(s) for s in profile.skills],
        "competencies": [
            {
                "id": c.id,
                "subject_id": c.subject_id,
                "subject_name": subject_names.get(c.subject_id),
                "proficiency_score": float(c.proficiency_score)
                if c.proficiency_score is not None
                else None,
                "source": c.source,
            }
            for c in profile.competencies
        ],
    }


async def count_courses_authored(db: AsyncSession, trainer_profile_id: uuid.UUID) -> int:
    from sqlalchemy import func

    return (
        await db.scalar(
            select(func.count(Course.id)).where(Course.created_by == trainer_profile_id)
        )
    ) or 0
