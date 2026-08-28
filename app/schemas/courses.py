"""Course, module, resource, and enrollment schemas."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal, Optional

from pydantic import Field

from app.schemas.base import APIModel, ResponseModel

CourseStatus = Literal["draft", "published", "archived"]
ResourceType = Literal["lecture_video", "presentation", "document", "link"]
EnrollmentStatus = Literal["enrolled", "in_progress", "completed", "dropped"]


# -------------------------------- Courses --------------------------------


class CourseCreate(APIModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    subject_id: Optional[uuid.UUID] = Field(default=None, alias="subjectId")
    status: CourseStatus = "draft"


class CourseUpdate(APIModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    subject_id: Optional[uuid.UUID] = Field(default=None, alias="subjectId")
    status: Optional[CourseStatus] = None


class CourseResponse(ResponseModel):
    id: uuid.UUID
    title: str
    description: Optional[str] = None
    subject_id: Optional[uuid.UUID] = None
    subject_name: Optional[str] = None
    created_by: uuid.UUID
    trainer_name: Optional[str] = None
    status: CourseStatus
    created_at: Optional[dt.datetime] = None
    updated_at: Optional[dt.datetime] = None
    module_count: int = 0
    enrollment_count: int = 0
    average_rating: Optional[float] = None
    # Present when the caller is a trainee, describing their own enrollment.
    enrollment_status: Optional[EnrollmentStatus] = None
    progress_percent: Optional[int] = None


# -------------------------------- Modules --------------------------------


class ModuleCreate(APIModel):
    title: str = Field(min_length=1, max_length=200)
    sequence_no: Optional[int] = Field(default=None, ge=1, alias="sequenceNo")


class ModuleUpdate(APIModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    sequence_no: Optional[int] = Field(default=None, ge=1, alias="sequenceNo")


class ResourceResponse(ResponseModel):
    id: uuid.UUID
    course_module_id: uuid.UUID
    type: ResourceType
    title: str
    # A freshly signed, short-lived URL; null when storage is unconfigured.
    file_url: Optional[str] = None
    uploaded_by: uuid.UUID
    uploaded_at: Optional[dt.datetime] = None


class ModuleResponse(ResponseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    sequence_no: int
    resources: list[ResourceResponse] = Field(default_factory=list)


class CourseDetailResponse(CourseResponse):
    modules: list[ModuleResponse] = Field(default_factory=list)


# ------------------------------- Resources -------------------------------


class ResourceLinkCreate(APIModel):
    """Register a resource that is an external link (no upload needed)."""

    title: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=500)


class ResourceUploadRequest(APIModel):
    """Ask for a signed upload URL for a lecture resource."""

    title: str = Field(min_length=1, max_length=200)
    type: Literal["lecture_video", "presentation", "document"]
    filename: str = Field(min_length=1, max_length=200)
    content_type: str = Field(min_length=1, max_length=150, alias="contentType")
    size_bytes: Optional[int] = Field(default=None, ge=1, alias="sizeBytes")


class ResourceUploadResponse(ResponseModel):
    """Signed target plus the resource row that was reserved for it."""

    resource_id: uuid.UUID
    bucket: str
    path: str
    upload_url: str
    token: Optional[str] = None
    expires_in: int


# ------------------------------ Enrollments ------------------------------


class EnrollmentResponse(ResponseModel):
    id: uuid.UUID
    trainee_profile_id: uuid.UUID
    course_id: uuid.UUID
    course_title: Optional[str] = None
    status: EnrollmentStatus
    progress_percent: int = 0
    enrolled_at: Optional[dt.datetime] = None
    completed_at: Optional[dt.datetime] = None
    # Populated on trainer/admin participation views.
    trainee_name: Optional[str] = None
    trainee_email: Optional[str] = None


class EnrollmentProgressUpdate(APIModel):
    progress_percent: int = Field(ge=0, le=100)
    status: Optional[EnrollmentStatus] = None
