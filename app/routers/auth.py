"""Auth and profile endpoints.

Firebase owns signup, login, password reset, email verification, and MFA — all of
that happens client-side. These endpoints only deal with the application-side
profile that a verified Firebase identity maps onto.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import sensitive_rate_limit
from app.db.session import get_db
from app.deps import (
    CurrentUser,
    get_current_user,
    require_approved,
    require_trainee_profile,
    require_trainer_profile,
)
from app.schemas.auth import (
    CertificateCreate,
    CertificateResponse,
    InterestCreate,
    InterestResponse,
    MeResponse,
    ProfileResponse,
    ProfileUpdate,
    QualificationCreate,
    QualificationResponse,
    QualificationUpdate,
    RegisterProfileRequest,
    SkillCreate,
    SkillResponse,
    TraineeProfileResponse,
    TraineeProfileUpdate,
    TrainerProfileResponse,
    TrainerProfileUpdate,
    WorkExperienceCreate,
    WorkExperienceResponse,
    WorkExperienceUpdate,
)
from app.services import profiles as service
router = APIRouter(prefix="/auth", tags=["auth"])
profile_router = APIRouter(prefix="/profile", tags=["profile"])


# --------------------------------- Auth ---------------------------------


@router.post(
    "/register-profile",
    response_model=MeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Complete registration for a verified Firebase user",
)
@sensitive_rate_limit
async def register_profile(
    request: Request,
    payload: RegisterProfileRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    """Create/complete the caller's profile and file an approval request.

    Reachable while `status='pending'` by design — a brand-new account must be able
    to finish registering before an admin has looked at it.
    """
    profile, trainee_id, trainer_id = await service.register_profile(
        db,
        current_user,
        name=payload.name,
        email=payload.email,
        role=payload.role,
    )
    return MeResponse.model_validate(
        {
            **{c: getattr(profile, c) for c in (
                "id", "supabase_uid", "firebase_uid", "name", "email", "role", "status",
                "mfa_enabled", "created_at", "updated_at", "last_login_at",
            )},
            "trainee_profile_id": trainee_id,
            "trainer_profile_id": trainer_id,
        }
    )


@router.get("/me", response_model=MeResponse, summary="The caller's own profile")
async def me(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    profile = await service.get_profile(db, current_user.id)
    return MeResponse.model_validate(
        {
            **{c: getattr(profile, c) for c in (
                "id", "supabase_uid", "firebase_uid", "name", "email", "role", "status",
                "mfa_enabled", "created_at", "updated_at", "last_login_at",
            )},
            "trainee_profile_id": current_user.trainee_profile_id,
            "trainer_profile_id": current_user.trainer_profile_id,
        }
    )


@router.patch("/me", response_model=ProfileResponse, summary="Update own core profile")
async def update_me(
    payload: ProfileUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileResponse:
    profile = await service.update_profile(
        db, current_user, name=payload.name, mfa_enabled=payload.mfa_enabled
    )
    return ProfileResponse.model_validate(profile)


@router.get(
    "/status",
    response_model=dict,
    summary="Lightweight approval-status probe for the client",
)
async def auth_status(current_user: CurrentUser = Depends(get_current_user)) -> dict:
    """Lets the frontend decide between the app shell and a 'pending approval' screen."""
    return {
        "authenticated": True,
        "role": current_user.role,
        "status": current_user.status,
        "approved": current_user.is_approved,
    }


# ----------------------------- Trainee profile -----------------------------


@profile_router.get(
    "/trainee",
    response_model=TraineeProfileResponse,
    summary="Own trainee profile with all detail",
)
async def get_trainee_profile(
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> TraineeProfileResponse:
    profile = await service.get_trainee_profile(db, current_user)
    return TraineeProfileResponse.model_validate(service.serialize_trainee_profile(profile))


@profile_router.get(
    "/trainee/{trainee_profile_id}",
    response_model=TraineeProfileResponse,
    summary="Read a trainee profile (admin, or your own)",
)
async def get_trainee_profile_by_id(
    trainee_profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> TraineeProfileResponse:
    profile = await service.get_trainee_profile(db, current_user, trainee_profile_id)
    return TraineeProfileResponse.model_validate(service.serialize_trainee_profile(profile))


@profile_router.patch(
    "/trainee", response_model=TraineeProfileResponse, summary="Update own trainee profile"
)
async def update_trainee_profile(
    payload: TraineeProfileUpdate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> TraineeProfileResponse:
    profile = await service.update_trainee_profile(
        db, current_user, payload.model_dump(exclude_unset=True)
    )
    return TraineeProfileResponse.model_validate(service.serialize_trainee_profile(profile))


# Qualifications -----------------------------------------------------------


@profile_router.post(
    "/trainee/qualifications",
    response_model=QualificationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_qualification(
    payload: QualificationCreate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> QualificationResponse:
    row = await service.add_trainee_child(
        db, current_user, "qualifications", payload.model_dump()
    )
    return QualificationResponse.model_validate(row)


@profile_router.patch(
    "/trainee/qualifications/{qualification_id}", response_model=QualificationResponse
)
async def update_qualification(
    qualification_id: uuid.UUID,
    payload: QualificationUpdate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> QualificationResponse:
    row = await service.update_trainee_child(
        db, current_user, "qualifications", qualification_id,
        payload.model_dump(exclude_unset=True),
    )
    return QualificationResponse.model_validate(row)


@profile_router.delete(
    "/trainee/qualifications/{qualification_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_qualification(
    qualification_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_trainee_child(db, current_user, "qualifications", qualification_id)


# Work experience ----------------------------------------------------------


@profile_router.post(
    "/trainee/experience",
    response_model=WorkExperienceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_experience(
    payload: WorkExperienceCreate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> WorkExperienceResponse:
    row = await service.add_trainee_child(
        db, current_user, "work_experience", payload.model_dump()
    )
    return WorkExperienceResponse.model_validate(row)


@profile_router.patch(
    "/trainee/experience/{experience_id}", response_model=WorkExperienceResponse
)
async def update_experience(
    experience_id: uuid.UUID,
    payload: WorkExperienceUpdate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> WorkExperienceResponse:
    row = await service.update_trainee_child(
        db, current_user, "work_experience", experience_id,
        payload.model_dump(exclude_unset=True),
    )
    return WorkExperienceResponse.model_validate(row)


@profile_router.delete(
    "/trainee/experience/{experience_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_experience(
    experience_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_trainee_child(db, current_user, "work_experience", experience_id)


# Interests ----------------------------------------------------------------


@profile_router.post(
    "/trainee/interests",
    response_model=InterestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_interest(
    payload: InterestCreate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> InterestResponse:
    row = await service.add_trainee_child(db, current_user, "interests", payload.model_dump())
    return InterestResponse.model_validate(row)


@profile_router.delete(
    "/trainee/interests/{interest_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_interest(
    interest_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_trainee_child(db, current_user, "interests", interest_id)


# Self-declared certificates ------------------------------------------------


@profile_router.post(
    "/trainee/certificates",
    response_model=CertificateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a certificate the trainee already holds",
)
async def add_certificate(
    payload: CertificateCreate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> CertificateResponse:
    row = await service.add_trainee_child(
        db, current_user, "certificates", payload.model_dump()
    )
    return CertificateResponse.model_validate(row)


@profile_router.delete(
    "/trainee/certificates/{certificate_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_certificate(
    certificate_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_trainee_child(db, current_user, "certificates", certificate_id)


# --------------------------------- Skills ---------------------------------


@profile_router.post(
    "/skills",
    response_model=SkillResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a skill to whichever role profile the caller has",
)
async def add_skill(
    payload: SkillCreate,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> SkillResponse:
    row = await service.add_skill(
        db,
        current_user,
        skill_name=payload.skill_name,
        proficiency_level=payload.proficiency_level,
    )
    return SkillResponse.model_validate(row)


@profile_router.delete("/skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(
    skill_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_skill(db, current_user, skill_id)


# ----------------------------- Trainer profile -----------------------------


@profile_router.get(
    "/trainer", response_model=TrainerProfileResponse, summary="Own trainer profile"
)
async def get_trainer_profile(
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> TrainerProfileResponse:
    profile = await service.get_trainer_profile(db, current_user)
    return TrainerProfileResponse.model_validate(
        await service.serialize_trainer_profile(db, profile)
    )


@profile_router.get(
    "/trainer/{trainer_profile_id}",
    response_model=TrainerProfileResponse,
    summary="Read any trainer's public profile",
)
async def get_trainer_profile_by_id(
    trainer_profile_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> TrainerProfileResponse:
    profile = await service.get_trainer_profile(db, current_user, trainer_profile_id)
    return TrainerProfileResponse.model_validate(
        await service.serialize_trainer_profile(db, profile)
    )


@profile_router.patch(
    "/trainer", response_model=TrainerProfileResponse, summary="Update own trainer profile"
)
async def update_trainer_profile(
    payload: TrainerProfileUpdate,
    current_user: CurrentUser = Depends(require_trainer_profile),
    db: AsyncSession = Depends(get_db),
) -> TrainerProfileResponse:
    profile = await service.update_trainer_profile(
        db, current_user, payload.model_dump(exclude_unset=True)
    )
    return TrainerProfileResponse.model_validate(
        await service.serialize_trainer_profile(db, profile)
    )
