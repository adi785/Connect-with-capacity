"""Admin endpoints: approval queue, user management, audit log, and reports.

Every route here is gated by `require_admin`.
"""

from __future__ import annotations

import csv
import io
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, require_admin
from app.schemas.admin import (
    AdminDashboardResponse,
    AdminUserResponse,
    ApprovalDecision,
    ApprovalRequestResponse,
    AuditLogResponse,
    RoleChangeRequest,
    StatusChangeRequest,
)
from app.schemas.base import Page
from app.services import admin as service
from app.services import dashboard as dashboard_service

router = APIRouter(prefix="/admin", tags=["admin"])


# ------------------------------- Approvals -------------------------------


@router.get(
    "/approvals",
    response_model=Page[ApprovalRequestResponse],
    summary="List account approval requests",
)
async def list_approvals(
    status_filter: Optional[str] = Query(
        default="pending", alias="status", pattern="^(pending|approved|rejected)$"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Page[ApprovalRequestResponse]:
    items, total = await service.list_approval_requests(
        db, status=status_filter, limit=limit, offset=offset
    )
    return Page[ApprovalRequestResponse](
        items=[ApprovalRequestResponse.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/approvals/{request_id}/decision",
    response_model=ApprovalRequestResponse,
    summary="Approve or reject a pending account",
)
async def decide_approval(
    request_id: uuid.UUID,
    payload: ApprovalDecision,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApprovalRequestResponse:
    """Approving flips the account to usable and provisions its role records."""
    result = await service.decide_approval(
        db, admin, request_id, decision=payload.decision, note=payload.note
    )
    return ApprovalRequestResponse.model_validate(result)


# ------------------------------ User management ------------------------------


@router.get("/users", response_model=Page[AdminUserResponse], summary="List all users")
async def list_users(
    role: Optional[str] = Query(default=None, pattern="^(trainee|trainer|admin)$"),
    status_filter: Optional[str] = Query(
        default=None, alias="status", pattern="^(pending|approved|rejected|suspended)$"
    ),
    search: Optional[str] = Query(default=None, max_length=150),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Page[AdminUserResponse]:
    users, total = await service.list_users(
        db, role=role, status=status_filter, search=search, limit=limit, offset=offset
    )
    return Page[AdminUserResponse](
        items=[AdminUserResponse.model_validate(u) for u in users],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch(
    "/users/{user_id}/role",
    response_model=AdminUserResponse,
    summary="Change a user's role",
)
async def change_user_role(
    user_id: uuid.UUID,
    payload: RoleChangeRequest,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserResponse:
    profile = await service.change_user_role(db, admin, user_id, payload.role)
    return AdminUserResponse.model_validate(profile)


@router.patch(
    "/users/{user_id}/status",
    response_model=AdminUserResponse,
    summary="Approve, reject, or suspend an account",
)
async def change_user_status(
    user_id: uuid.UUID,
    payload: StatusChangeRequest,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserResponse:
    profile = await service.change_user_status(db, admin, user_id, payload.status)
    return AdminUserResponse.model_validate(profile)


# -------------------------------- Audit log --------------------------------


@router.get(
    "/audit-logs", response_model=Page[AuditLogResponse], summary="Read the audit trail"
)
async def list_audit_logs(
    action: Optional[str] = Query(default=None, max_length=150),
    user_id: Optional[uuid.UUID] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Page[AuditLogResponse]:
    items, total = await service.list_audit_logs(
        db, action=action, user_id=user_id, limit=limit, offset=offset
    )
    return Page[AuditLogResponse](
        items=[AuditLogResponse.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


# ------------------------------- Reporting -------------------------------


@router.get(
    "/dashboard",
    response_model=AdminDashboardResponse,
    summary="Platform-wide dashboard metrics",
)
async def admin_dashboard(
    _: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminDashboardResponse:
    return AdminDashboardResponse.model_validate(
        await dashboard_service.admin_dashboard(db)
    )


@router.get(
    "/reports/courses.csv",
    summary="Export per-course enrollment and completion figures as CSV",
    response_class=Response,
)
async def export_course_report(
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Streamed as a CSV attachment so it can be opened directly in a spreadsheet."""
    rows = await dashboard_service.course_report_rows(db, admin)
    headers = [
        "course_id",
        "title",
        "status",
        "enrollments",
        "completions",
        "completion_rate_percent",
        "average_rating",
        "created_at",
    ]

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=headers)
    writer.writeheader()
    writer.writerows(rows)

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="course-report.csv"'},
        status_code=status.HTTP_200_OK,
    )
