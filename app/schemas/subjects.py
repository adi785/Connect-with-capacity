"""Subject taxonomy and trainer competency-mapping schemas."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal, Optional

from pydantic import Field

from app.schemas.base import APIModel, ResponseModel

CompetencySource = Literal["self_declared", "admin_assigned", "system_derived"]


class SubjectCreate(APIModel):
    name: str = Field(min_length=1, max_length=150)
    category: Optional[str] = Field(default=None, max_length=100)


class SubjectUpdate(APIModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    category: Optional[str] = Field(default=None, max_length=100)


class SubjectResponse(ResponseModel):
    id: uuid.UUID
    name: str
    category: Optional[str] = None


class CompetencyMapUpsert(APIModel):
    """Admin sets or overrides a trainer's proficiency for a subject."""

    trainer_profile_id: uuid.UUID = Field(alias="trainerProfileId")
    subject_id: uuid.UUID = Field(alias="subjectId")
    proficiency_score: float = Field(ge=0, le=10)
    source: CompetencySource = "admin_assigned"


class CompetencySelfDeclare(APIModel):
    """A trainer declaring their own competency for a subject."""

    subject_id: uuid.UUID = Field(alias="subjectId")
    proficiency_score: float = Field(ge=0, le=10)


class CompetencyMapResponse(ResponseModel):
    id: uuid.UUID
    trainer_profile_id: uuid.UUID
    subject_id: uuid.UUID
    proficiency_score: Optional[float] = None
    source: Optional[str] = None
    updated_at: Optional[dt.datetime] = None


class SuggestedTrainerResponse(ResponseModel):
    """A trainer suggested for a subject, ranked by proficiency."""

    trainer_profile_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    email: str
    designation: Optional[str] = None
    bio: Optional[str] = None
    profile_photo_url: Optional[str] = None
    proficiency_score: Optional[float] = None
    source: Optional[str] = None
    courses_authored: int = 0
