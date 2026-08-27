"""Dashboard endpoints for trainers and trainees (FR-9.x).

The admin dashboard and platform-wide CSV export live in `app.routers.admin`. Scoping is
applied inside the queries in `app.services.dashboard`, so a trainer's totals can never
include another trainer's courses.
"""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, require_approved, require_trainer_or_admin
from app.schemas.admin import TraineeDashboardResponse, TrainerDashboardResponse
from app.services import dashboard as service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "/trainer",
    response_model=TrainerDashboardResponse,
    summary="Metrics for the calling trainer's own courses",
)
async def trainer_dashboard(
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> TrainerDashboardResponse:
    """An admin without a trainer profile gets zeros rather than an error."""
    return TrainerDashboardResponse.model_validate(
        await service.trainer_dashboard(db, current_user)
    )


@router.get(
    "/trainee",
    response_model=TraineeDashboardResponse,
    summary="Metrics for the calling trainee's own activity",
)
async def trainee_dashboard(
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> TraineeDashboardResponse:
    return TraineeDashboardResponse.model_validate(
        await service.trainee_dashboard(db, current_user)
    )


@router.get(
    "/reports/courses.csv",
    summary="Export your own courses' enrollment and completion figures as CSV",
    response_class=Response,
)
async def export_own_course_report(
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Same generator as the admin export; it scopes rows to the caller's own courses."""
    rows = await service.course_report_rows(db, current_user)
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
        headers={"Content-Disposition": 'attachment; filename="my-course-report.csv"'},
        status_code=status.HTTP_200_OK,
    )
