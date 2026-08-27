"""Admin, approval-workflow, and dashboard/reporting schemas."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal, Optional

from pydantic import Field

from app.schemas.base import APIModel, ResponseModel

ApprovalStatus = Literal["pending", "approved", "rejected"]


class ApprovalRequestResponse(ResponseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    requested_role: str
    status: ApprovalStatus
    requested_at: Optional[dt.datetime] = None
    reviewed_at: Optional[dt.datetime] = None
    reviewed_by: Optional[uuid.UUID] = None
    # Denormalized for the admin review table.
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_status: Optional[str] = None


class ApprovalDecision(APIModel):
    decision: Literal["approved", "rejected"]
    note: Optional[str] = Field(default=None, max_length=1000)


class RoleChangeRequest(APIModel):
    role: Literal["trainee", "trainer", "admin"]


class StatusChangeRequest(APIModel):
    status: Literal["pending", "approved", "rejected", "suspended"]


class AdminUserResponse(ResponseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    status: str
    created_at: Optional[dt.datetime] = None
    last_login_at: Optional[dt.datetime] = None


class AuditLogResponse(ResponseModel):
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    actor_name: Optional[str] = None
    action: str
    target_entity: Optional[str] = None
    target_id: Optional[uuid.UUID] = None
    meta: Optional[dict] = Field(default=None, alias="metadata")
    created_at: Optional[dt.datetime] = None


# ------------------------------- Dashboard -------------------------------


class CoursePopularity(ResponseModel):
    course_id: uuid.UUID
    title: str
    enrollment_count: int = 0
    completion_count: int = 0
    average_rating: Optional[float] = None


class AdminDashboardResponse(ResponseModel):
    users_total: int = 0
    users_pending: int = 0
    users_by_role: dict[str, int] = Field(default_factory=dict)
    courses_total: int = 0
    courses_by_status: dict[str, int] = Field(default_factory=dict)
    enrollments_total: int = 0
    enrollments_by_status: dict[str, int] = Field(default_factory=dict)
    completion_rate: float = 0.0
    assessments_total: int = 0
    attempts_total: int = 0
    attempts_submitted: int = 0
    average_score: Optional[float] = None
    pass_rate: Optional[float] = None
    certificates_issued: int = 0
    average_course_rating: Optional[float] = None
    top_courses: list[CoursePopularity] = Field(default_factory=list)


class TrainerDashboardResponse(ResponseModel):
    courses_total: int = 0
    courses_published: int = 0
    enrollments_total: int = 0
    completions_total: int = 0
    assessments_total: int = 0
    attempts_submitted: int = 0
    average_score: Optional[float] = None
    average_course_rating: Optional[float] = None
    top_courses: list[CoursePopularity] = Field(default_factory=list)


class TraineeDashboardResponse(ResponseModel):
    enrollments_total: int = 0
    in_progress: int = 0
    completed: int = 0
    average_progress: float = 0.0
    attempts_submitted: int = 0
    average_score: Optional[float] = None
    certificates_earned: int = 0
    unread_notifications: int = 0
