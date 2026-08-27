"""Course feedback schemas."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from pydantic import Field

from app.schemas.base import APIModel, ResponseModel


class FeedbackCreate(APIModel):
    rating: int = Field(ge=1, le=5)
    comments: Optional[str] = Field(default=None, max_length=4000)


class FeedbackResponse(ResponseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    trainee_profile_id: uuid.UUID
    rating: Optional[int] = None
    comments: Optional[str] = None
    submitted_at: Optional[dt.datetime] = None
    # Only populated for trainer/admin review views.
    trainee_name: Optional[str] = None


class FeedbackSummary(ResponseModel):
    """Aggregate view returned alongside a course's feedback list."""

    course_id: uuid.UUID
    average_rating: Optional[float] = None
    total_responses: int = 0
    rating_breakdown: dict[int, int] = Field(default_factory=dict)
    items: list[FeedbackResponse] = Field(default_factory=list)
