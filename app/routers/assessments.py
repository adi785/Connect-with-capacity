"""Assessment, question, and attempt endpoints (FR-6.x).

The answer key is kept out of trainee responses *structurally* rather than by a runtime
branch inside one endpoint:

  * `GET /assessments/{id}`      -> `AssessmentTakeResponse`, which has no `is_correct`
                                    field anywhere in its schema.
  * `GET /assessments/{id}/full` -> `AssessmentFullResponse`, reachable only when
                                    `get_assessment_for_caller` reports `may_see_key`.

Splitting them means the declared `response_model` is statically the correct shape for
each audience, so a mistake in the handler body cannot serialize a key into the public
view — Pydantic has no field to put it in.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden
from app.db.session import get_db
from app.deps import (
    CurrentUser,
    require_approved,
    require_trainee_profile,
    require_trainer_or_admin,
)
from app.schemas.assessments import (
    AssessmentCreate,
    AssessmentFullResponse,
    AssessmentSummary,
    AssessmentTakeResponse,
    AssessmentUpdate,
    AttemptResultResponse,
    AttemptStartResponse,
    AttemptSubmit,
    QuestionBulkCreate,
)
from app.schemas.base import Page
from app.services import assessments as service

router = APIRouter(prefix="/assessments", tags=["assessments"])


# ------------------------------- Authoring -------------------------------


@router.post(
    "",
    response_model=AssessmentSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Create an assessment under a course you own",
)
async def create_assessment(
    payload: AssessmentCreate,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> AssessmentSummary:
    assessment = await service.create_assessment(
        db,
        current_user,
        course_id=payload.course_id,
        subject_id=payload.subject_id,
        title=payload.title,
        deadline=payload.deadline,
        time_limit_minutes=payload.time_limit_minutes,
        pass_percentage=payload.pass_percentage,
        status=payload.status,
    )
    return AssessmentSummary.model_validate(service.serialize_summary(assessment))


@router.patch(
    "/{assessment_id}",
    response_model=AssessmentSummary,
    summary="Update an assessment you own",
)
async def update_assessment(
    assessment_id: uuid.UUID,
    payload: AssessmentUpdate,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> AssessmentSummary:
    """Publishing is refused while the assessment has no questions."""
    assessment = await service.update_assessment(
        db, current_user, assessment_id, payload.model_dump(exclude_unset=True)
    )
    return AssessmentSummary.model_validate(service.serialize_summary(assessment))


@router.delete(
    "/{assessment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an assessment that has no attempts",
)
async def delete_assessment(
    assessment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Refused once attempts exist — close the assessment instead of erasing results."""
    await service.delete_assessment(db, current_user, assessment_id)


@router.post(
    "/{assessment_id}/questions",
    response_model=AssessmentFullResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Bulk-add questions and their answer key",
)
async def add_questions(
    assessment_id: uuid.UUID,
    payload: QuestionBulkCreate,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> AssessmentFullResponse:
    """Each question must carry exactly one correct option (enforced by the schema).

    Returning the full shape is safe: only the course owner or an admin can reach this.
    """
    assessment = await service.add_questions(
        db,
        current_user,
        assessment_id,
        [q.model_dump() for q in payload.questions],
    )
    return AssessmentFullResponse.model_validate(service.serialize_full(assessment))


# -------------------------------- Reading --------------------------------


@router.get(
    "",
    response_model=Page[AssessmentSummary],
    summary="List assessments visible to the caller",
)
async def list_assessments(
    course_id: Optional[uuid.UUID] = Query(default=None, alias="courseId"),
    status_filter: Optional[str] = Query(
        default=None, alias="status", pattern="^(draft|published|closed)$"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> Page[AssessmentSummary]:
    """A trainee only sees published assessments on courses they are enrolled in."""
    items, total = await service.list_assessments(
        db,
        current_user,
        course_id=course_id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )
    return Page[AssessmentSummary](
        items=[AssessmentSummary.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{assessment_id}",
    response_model=AssessmentTakeResponse,
    summary="Read an assessment paper without the answer key",
)
async def get_assessment(
    assessment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> AssessmentTakeResponse:
    """The no-key view, for every audience including the author (as a trainee preview)."""
    assessment, _may_see_key = await service.get_assessment_for_caller(
        db, current_user, assessment_id
    )
    return AssessmentTakeResponse.model_validate(service.serialize_for_taking(assessment))


@router.get(
    "/{assessment_id}/full",
    response_model=AssessmentFullResponse,
    summary="Read an assessment including its answer key (author/admin only)",
)
async def get_assessment_full(
    assessment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> AssessmentFullResponse:
    """Gated on the authorization result, never on anything the caller sends."""
    assessment, may_see_key = await service.get_assessment_for_caller(
        db, current_user, assessment_id
    )
    if not may_see_key:
        raise Forbidden(
            "Only the course owner or an admin can view the answer key",
            code="answer_key_forbidden",
        )
    return AssessmentFullResponse.model_validate(service.serialize_full(assessment))


question_router = APIRouter(prefix="/questions", tags=["assessments"])


@question_router.delete(
    "/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a question from an assessment you own",
)
async def delete_question(
    question_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_question(db, current_user, question_id)


# -------------------------------- Attempts --------------------------------


@router.post(
    "/{assessment_id}/attempts",
    response_model=AttemptStartResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start or resume an attempt",
)
async def start_attempt(
    assessment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> AttemptStartResponse:
    """Resumes an unfinished attempt rather than starting a second one.

    The embedded paper is the no-key shape, and `expires_at` is derived from the
    server's own `started_at` so a client cannot extend its own time limit.
    """
    return AttemptStartResponse.model_validate(
        await service.start_attempt(db, current_user, assessment_id)
    )


attempt_router = APIRouter(prefix="/attempts", tags=["attempts"])


@attempt_router.post(
    "/{attempt_id}/submit",
    response_model=AttemptResultResponse,
    summary="Submit an attempt and receive the scored result",
)
async def submit_attempt(
    attempt_id: uuid.UUID,
    payload: AttemptSubmit,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> AttemptResultResponse:
    """Scoring is done server-side from the stored key; the body carries only selections.

    The answer key appears in this response because the attempt is now final — that is
    the first moment a trainee is allowed to see it.
    """
    return AttemptResultResponse.model_validate(
        await service.submit_attempt(
            db,
            current_user,
            attempt_id,
            [a.model_dump() for a in payload.answers],
        )
    )


@attempt_router.get(
    "",
    response_model=Page[AttemptResultResponse],
    summary="List attempts the caller may read",
)
async def list_attempts(
    assessment_id: Optional[uuid.UUID] = Query(default=None, alias="assessmentId"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> Page[AttemptResultResponse]:
    """Trainees see only their own; trainers see attempts on their courses.

    Summary rows only — per-answer detail and certificate state come from the
    single-attempt endpoint.
    """
    items, total = await service.list_attempts(
        db, current_user, assessment_id=assessment_id, limit=limit, offset=offset
    )
    return Page[AttemptResultResponse](
        items=[AttemptResultResponse.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@attempt_router.get(
    "/{attempt_id}",
    response_model=AttemptResultResponse,
    summary="Read a submitted attempt with its answer key",
)
async def get_attempt_result(
    attempt_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> AttemptResultResponse:
    """Refused while the attempt is still in progress, so the key stays hidden mid-exam."""
    return AttemptResultResponse.model_validate(
        await service.get_attempt_result(db, current_user, attempt_id)
    )
