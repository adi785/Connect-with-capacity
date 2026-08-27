"""Course feedback endpoints (FR-7.x).

A trainee may only review a course they are enrolled in, and gets one review per course
(re-submitting edits it in place). The aggregate view is open to any approved user, but
`app.services.feedback` attaches reviewer names only for the course owner and admins —
to a fellow trainee the reviews stay anonymous, and they see only their own in the list.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, require_approved, require_trainee_profile
from app.schemas.feedback import FeedbackCreate, FeedbackResponse, FeedbackSummary
from app.services import feedback as service

router = APIRouter(prefix="/courses", tags=["feedback"])


@router.post(
    "/{course_id}/feedback",
    response_model=FeedbackResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit or update your review of an enrolled course",
)
async def submit_feedback(
    course_id: uuid.UUID,
    payload: FeedbackCreate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> FeedbackResponse:
    """Re-submitting edits the existing review rather than being rejected as a duplicate."""
    row = await service.submit_feedback(
        db, current_user, course_id, rating=payload.rating, comments=payload.comments
    )
    return FeedbackResponse.model_validate(row)


@router.get(
    "/{course_id}/feedback",
    response_model=FeedbackSummary,
    summary="Aggregate rating and reviews for a course",
)
async def course_feedback(
    course_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> FeedbackSummary:
    """Everyone sees the aggregate; only the owner and admins see who said what."""
    return FeedbackSummary.model_validate(
        await service.course_feedback_summary(
            db, current_user, course_id, limit=limit, offset=offset
        )
    )


@router.get(
    "/{course_id}/feedback/me",
    response_model=Optional[FeedbackResponse],
    summary="Your own review of a course, if you have left one",
)
async def own_feedback(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> Optional[FeedbackResponse]:
    """Returns null rather than 404 so the client can render an empty review form."""
    row = await service.get_own_feedback(db, current_user, course_id)
    return FeedbackResponse.model_validate(row) if row is not None else None


feedback_router = APIRouter(prefix="/feedback", tags=["feedback"])


@feedback_router.delete(
    "/{feedback_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete your own review, or any review as an admin",
)
async def delete_feedback(
    feedback_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_feedback(db, current_user, feedback_id)
