"""Assessment, question, attempt, and result schemas.

Security-critical: `QuestionOptionPublic` has NO `is_correct` field. Trainees only
ever receive this shape until their attempt is submitted (Section 4, point 3).
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.schemas.base import APIModel, ResponseModel

AssessmentStatus = Literal["draft", "published", "closed"]
AttemptStatus = Literal["in_progress", "submitted", "expired"]


# --------------------------- Authoring (trainer) ---------------------------


class AssessmentCreate(APIModel):
    course_id: uuid.UUID = Field(alias="courseId")
    subject_id: Optional[uuid.UUID] = Field(default=None, alias="subjectId")
    title: str = Field(min_length=1, max_length=200)
    deadline: Optional[dt.datetime] = None
    time_limit_minutes: Optional[int] = Field(default=None, ge=1, le=480)
    pass_percentage: int = Field(default=50, ge=1, le=100)
    status: AssessmentStatus = "draft"


class AssessmentUpdate(APIModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    subject_id: Optional[uuid.UUID] = Field(default=None, alias="subjectId")
    deadline: Optional[dt.datetime] = None
    time_limit_minutes: Optional[int] = Field(default=None, ge=1, le=480)
    pass_percentage: Optional[int] = Field(default=None, ge=1, le=100)
    status: Optional[AssessmentStatus] = None


class OptionCreate(APIModel):
    option_text: str = Field(min_length=1, max_length=500)
    is_correct: bool = False
    sequence_no: Optional[int] = Field(default=None, alias="sequenceNo")


class QuestionCreate(APIModel):
    question_text: str = Field(min_length=1)
    type: Optional[str] = "single_choice"
    marks: int = Field(default=1, ge=1)
    options: list[OptionCreate] = Field(min_length=2, max_length=10)

    @field_validator("options")
    @classmethod
    def _exactly_one_correct(cls, options: list[OptionCreate]) -> list[OptionCreate]:
        correct = sum(1 for o in options if o.is_correct)
        if correct != 1:
            raise ValueError("each question must have exactly one correct option")
        return options


class QuestionBulkCreate(APIModel):
    questions: list[QuestionCreate] = Field(min_length=1)


# ------------------------------ Option views ------------------------------


class QuestionOptionPublic(ResponseModel):
    """Trainee-facing option: intentionally omits `is_correct`."""

    id: uuid.UUID
    option_text: str


class QuestionOptionFull(ResponseModel):
    """Trainer/admin/post-submission option, including the answer key."""

    id: uuid.UUID
    option_text: str
    is_correct: bool


# ----------------------------- Question views -----------------------------


class QuestionPublic(ResponseModel):
    id: uuid.UUID
    question_text: str
    marks: int
    options: list[QuestionOptionPublic] = Field(default_factory=list)


class QuestionFull(ResponseModel):
    id: uuid.UUID
    question_text: str
    marks: int
    options: list[QuestionOptionFull] = Field(default_factory=list)


# ---------------------------- Assessment views ----------------------------


class AssessmentSummary(ResponseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    subject_id: Optional[uuid.UUID] = None
    title: str
    deadline: Optional[dt.datetime] = None
    time_limit_minutes: Optional[int] = None
    pass_percentage: int = 50
    status: AssessmentStatus
    created_by: uuid.UUID
    question_count: int = 0
    total_marks: int = 0


class AssessmentTakeResponse(AssessmentSummary):
    """What a trainee sees when taking the assessment (no answer key)."""

    questions: list[QuestionPublic] = Field(default_factory=list)


class AssessmentFullResponse(AssessmentSummary):
    """What a trainer/admin sees (full answer key included)."""

    questions: list[QuestionFull] = Field(default_factory=list)


# -------------------------------- Attempts --------------------------------


class AttemptStartResponse(ResponseModel):
    id: uuid.UUID
    assessment_id: uuid.UUID
    trainee_profile_id: uuid.UUID
    started_at: Optional[dt.datetime] = None
    status: AttemptStatus
    time_limit_minutes: Optional[int] = None
    expires_at: Optional[dt.datetime] = None
    assessment: AssessmentTakeResponse


class AnswerSubmission(APIModel):
    question_id: uuid.UUID = Field(alias="questionId")
    selected_option_id: uuid.UUID = Field(alias="selectedOptionId")


class AttemptSubmit(APIModel):
    answers: list[AnswerSubmission] = Field(min_length=1)


class AnswerResult(ResponseModel):
    question_id: uuid.UUID
    selected_option_id: Optional[uuid.UUID] = None
    correct_option_id: Optional[uuid.UUID] = None
    is_correct: bool = False
    marks_awarded: int = 0


class AttemptResultResponse(ResponseModel):
    id: uuid.UUID
    assessment_id: uuid.UUID
    trainee_profile_id: uuid.UUID
    started_at: Optional[dt.datetime] = None
    submitted_at: Optional[dt.datetime] = None
    score: Optional[float] = None
    status: AttemptStatus
    total_marks: int = 0
    obtained_marks: int = 0
    pass_percentage: int = 50
    passed: bool = False
    certificate_issued: bool = False
    certificate_url: Optional[str] = None
    answers: list[AnswerResult] = Field(default_factory=list)
