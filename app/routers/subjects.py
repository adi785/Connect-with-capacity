"""Subject taxonomy and trainer-competency endpoints.

Reads are open to any approved user; subject writes are admin-only, and competency
writes are admin-for-anyone / trainer-for-themselves (enforced in the service).
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, require_admin, require_approved, require_trainer_profile
from app.schemas.subjects import (
    CompetencyMapResponse,
    CompetencyMapUpsert,
    CompetencySelfDeclare,
    SubjectCreate,
    SubjectResponse,
    SubjectUpdate,
    SuggestedTrainerResponse,
)
from app.services import subjects as service

router = APIRouter(prefix="/subjects", tags=["subjects"])


@router.get("", response_model=list[SubjectResponse], summary="List subjects")
async def list_subjects(
    category: Optional[str] = Query(default=None, max_length=100),
    search: Optional[str] = Query(default=None, max_length=150),
    _: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> list[SubjectResponse]:
    rows = await service.list_subjects(db, category=category, search=search)
    return [SubjectResponse.model_validate(r) for r in rows]


@router.get("/{subject_id}", response_model=SubjectResponse, summary="Read one subject")
async def get_subject(
    subject_id: uuid.UUID,
    _: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> SubjectResponse:
    return SubjectResponse.model_validate(await service.get_subject(db, subject_id))


@router.post(
    "",
    response_model=SubjectResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a subject (admin)",
)
async def create_subject(
    payload: SubjectCreate,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> SubjectResponse:
    subject = await service.create_subject(
        db, admin, name=payload.name, category=payload.category
    )
    return SubjectResponse.model_validate(subject)


@router.patch(
    "/{subject_id}", response_model=SubjectResponse, summary="Update a subject (admin)"
)
async def update_subject(
    subject_id: uuid.UUID,
    payload: SubjectUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> SubjectResponse:
    subject = await service.update_subject(
        db, admin, subject_id, payload.model_dump(exclude_unset=True)
    )
    return SubjectResponse.model_validate(subject)


@router.delete(
    "/{subject_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an unused subject (admin)",
)
async def delete_subject(
    subject_id: uuid.UUID,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_subject(db, admin, subject_id)


# ----------------------------- Trainer matching -----------------------------


@router.get(
    "/{subject_id}/trainers",
    response_model=list[SuggestedTrainerResponse],
    summary="Suggest trainers competent in a subject, ranked by proficiency",
)
async def suggest_trainers(
    subject_id: uuid.UUID,
    min_score: Optional[float] = Query(default=None, ge=0, le=10),
    limit: int = Query(default=20, ge=1, le=100),
    _: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> list[SuggestedTrainerResponse]:
    rows = await service.suggest_trainers(db, subject_id, min_score=min_score, limit=limit)
    return [SuggestedTrainerResponse.model_validate(r) for r in rows]


# ----------------------------- Competency map -----------------------------

competency_router = APIRouter(prefix="/competencies", tags=["competencies"])


@competency_router.get(
    "/trainer/{trainer_profile_id}",
    response_model=list[CompetencyMapResponse],
    summary="List a trainer's subject competencies",
)
async def list_trainer_competencies(
    trainer_profile_id: uuid.UUID,
    _: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> list[CompetencyMapResponse]:
    rows = await service.list_trainer_competencies(db, trainer_profile_id)
    return [CompetencyMapResponse.model_validate(r) for r in rows]


@competency_router.post(
    "",
    response_model=CompetencyMapResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Assign a trainer's proficiency for a subject (admin)",
)
async def upsert_competency(
    payload: CompetencyMapUpsert,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CompetencyMapResponse:
    row = await service.upsert_competency(
        db,
        admin,
        trainer_profile_id=payload.trainer_profile_id,
        subject_id=payload.subject_id,
        proficiency_score=payload.proficiency_score,
        source=payload.source,
    )
    return CompetencyMapResponse.model_validate(row)


@competency_router.post(
    "/self",
    response_model=CompetencyMapResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Declare your own competency for a subject (trainer)",
)
async def self_declare_competency(
    payload: CompetencySelfDeclare,
    current_user: CurrentUser = Depends(require_trainer_profile),
    db: AsyncSession = Depends(get_db),
) -> CompetencyMapResponse:
    """Always recorded as 'self_declared' so it cannot pass for an admin assessment."""
    row = await service.upsert_competency(
        db,
        current_user,
        trainer_profile_id=current_user.trainer_profile_id,
        subject_id=payload.subject_id,
        proficiency_score=payload.proficiency_score,
        source="self_declared",
    )
    return CompetencyMapResponse.model_validate(row)


@competency_router.delete(
    "/{competency_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a competency entry",
)
async def delete_competency(
    competency_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_competency(db, current_user, competency_id)
