"""Course, module, resource, and enrollment endpoints.

Visibility and ownership are decided in `app.services.courses` — routes here only
pick the right role gate and shape the response.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import (
    CurrentUser,
    require_approved,
    require_trainee_profile,
    require_trainer_or_admin,
)
from app.schemas.base import Message, Page
from app.schemas.courses import (
    CourseCreate,
    CourseDetailResponse,
    CourseResponse,
    CourseUpdate,
    EnrollmentProgressUpdate,
    EnrollmentResponse,
    ModuleCreate,
    ModuleResponse,
    ModuleUpdate,
    ResourceLinkCreate,
    ResourceResponse,
    ResourceUploadRequest,
    ResourceUploadResponse,
)
from app.services import courses as service
from app.services import enrollments as enrollment_service

router = APIRouter(prefix="/courses", tags=["courses"])


# -------------------------------- Catalog --------------------------------


@router.get("", response_model=Page[CourseResponse], summary="Browse the course catalog")
async def list_courses(
    subject_id: Optional[uuid.UUID] = None,
    status_filter: Optional[str] = Query(
        default=None, alias="status", pattern="^(draft|published|archived)$"
    ),
    search: Optional[str] = Query(default=None, max_length=200),
    mine: bool = Query(default=False, description="Trainers: only courses you authored"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> Page[CourseResponse]:
    items, total = await service.list_courses(
        db,
        current_user,
        subject_id=subject_id,
        status=status_filter,
        search=search,
        mine=mine,
        limit=limit,
        offset=offset,
    )
    return Page[CourseResponse](
        items=[CourseResponse.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{course_id}",
    response_model=CourseDetailResponse,
    summary="Course detail with modules and resources",
)
async def get_course(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> CourseDetailResponse:
    """Resource links are only signed for the course owner, admins, and enrolled trainees."""
    return CourseDetailResponse.model_validate(
        await service.get_course_detail(db, current_user, course_id)
    )


@router.post(
    "",
    response_model=CourseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a course (trainer/admin)",
)
async def create_course(
    payload: CourseCreate,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> CourseResponse:
    course = await service.create_course(
        db,
        current_user,
        title=payload.title,
        description=payload.description,
        subject_id=payload.subject_id,
        status=payload.status,
    )
    detail = await service.get_course_detail(db, current_user, course.id)
    return CourseResponse.model_validate(detail)


@router.patch(
    "/{course_id}", response_model=CourseResponse, summary="Update a course you own"
)
async def update_course(
    course_id: uuid.UUID,
    payload: CourseUpdate,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> CourseResponse:
    await service.update_course(
        db, current_user, course_id, payload.model_dump(exclude_unset=True)
    )
    detail = await service.get_course_detail(db, current_user, course_id)
    return CourseResponse.model_validate(detail)


@router.delete(
    "/{course_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a course with no enrollments",
)
async def delete_course(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_course(db, current_user, course_id)


# -------------------------------- Modules --------------------------------


@router.post(
    "/{course_id}/modules",
    response_model=ModuleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a module to a course you own",
)
async def create_module(
    course_id: uuid.UUID,
    payload: ModuleCreate,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> ModuleResponse:
    module = await service.create_module(
        db, current_user, course_id, title=payload.title, sequence_no=payload.sequence_no
    )
    return ModuleResponse.model_validate(
        await service.serialize_module(db, current_user, module)
    )


module_router = APIRouter(prefix="/modules", tags=["courses"])


@module_router.patch(
    "/{module_id}", response_model=ModuleResponse, summary="Rename or reorder a module"
)
async def update_module(
    module_id: uuid.UUID,
    payload: ModuleUpdate,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> ModuleResponse:
    module = await service.update_module(
        db, current_user, module_id, payload.model_dump(exclude_unset=True)
    )
    return ModuleResponse.model_validate(
        await service.serialize_module(db, current_user, module)
    )


@module_router.delete(
    "/{module_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a module"
)
async def delete_module(
    module_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_module(db, current_user, module_id)


# ------------------------------- Resources -------------------------------


@module_router.post(
    "/{module_id}/resources/upload-url",
    response_model=ResourceUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reserve a resource and get a signed Supabase upload URL",
)
async def request_resource_upload(
    module_id: uuid.UUID,
    payload: ResourceUploadRequest,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> ResourceUploadResponse:
    """The object path is chosen server-side; the client only receives a signed target."""
    result = await service.request_resource_upload(
        db,
        current_user,
        module_id,
        title=payload.title,
        resource_type=payload.type,
        filename=payload.filename,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
    )
    return ResourceUploadResponse.model_validate(result)


@module_router.post(
    "/{module_id}/resources/link",
    response_model=ResourceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Attach an external link as a resource",
)
async def create_link_resource(
    module_id: uuid.UUID,
    payload: ResourceLinkCreate,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> ResourceResponse:
    resource = await service.create_link_resource(
        db, current_user, module_id, title=payload.title, url=payload.url
    )
    return ResourceResponse.model_validate(
        {
            "id": resource.id,
            "course_module_id": resource.course_module_id,
            "type": resource.type,
            "title": resource.title,
            "file_url": resource.file_url,
            "uploaded_by": resource.uploaded_by,
            "uploaded_at": resource.uploaded_at,
        }
    )


resource_router = APIRouter(prefix="/resources", tags=["courses"])


@resource_router.get(
    "/{resource_id}/download-url",
    response_model=dict,
    summary="Mint a short-lived signed download URL",
)
async def get_resource_download_url(
    resource_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Trainees must be enrolled in the parent course to receive a URL."""
    url = await service.get_resource_download_url(db, current_user, resource_id)
    return {"url": url}


@resource_router.delete(
    "/{resource_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a resource"
)
async def delete_resource(
    resource_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_resource(db, current_user, resource_id)


# ------------------------------ Enrollments ------------------------------


@router.post(
    "/{course_id}/enroll",
    response_model=EnrollmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Enroll in a published course",
)
async def enroll(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    enrollment = await enrollment_service.enroll(db, current_user, course_id)
    return EnrollmentResponse.model_validate(enrollment_service.serialize(enrollment))


@router.get(
    "/trainer/participants",
    response_model=Page[EnrollmentResponse],
    summary="All participants enrolled across courses you authored (trainer/admin)",
)
async def list_trainer_participants(
    course_id: Optional[uuid.UUID] = None,
    status_filter: Optional[str] = Query(
        default=None, alias="status", pattern="^(enrolled|in_progress|completed|dropped)$"
    ),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> Page[EnrollmentResponse]:
    items, total = await enrollment_service.list_trainer_participants(
        db, current_user, course_id=course_id, status=status_filter, limit=limit, offset=offset
    )
    return Page[EnrollmentResponse](
        items=[EnrollmentResponse.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{course_id}/participants",
    response_model=Page[EnrollmentResponse],
    summary="Roster for a course you own (trainer/admin)",
)
async def list_participants(
    course_id: uuid.UUID,
    status_filter: Optional[str] = Query(
        default=None, alias="status", pattern="^(enrolled|in_progress|completed|dropped)$"
    ),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_trainer_or_admin),
    db: AsyncSession = Depends(get_db),
) -> Page[EnrollmentResponse]:
    items, total = await enrollment_service.list_course_participants(
        db, current_user, course_id, status=status_filter, limit=limit, offset=offset
    )
    return Page[EnrollmentResponse](
        items=[EnrollmentResponse.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


enrollment_router = APIRouter(prefix="/enrollments", tags=["enrollments"])


@enrollment_router.get(
    "", response_model=Page[EnrollmentResponse], summary="Your own enrollments"
)
async def list_own_enrollments(
    status_filter: Optional[str] = Query(
        default=None, alias="status", pattern="^(enrolled|in_progress|completed|dropped)$"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> Page[EnrollmentResponse]:
    items, total = await enrollment_service.list_own_enrollments(
        db, current_user, status=status_filter, limit=limit, offset=offset
    )
    return Page[EnrollmentResponse](
        items=[EnrollmentResponse.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@enrollment_router.patch(
    "/{enrollment_id}/progress",
    response_model=EnrollmentResponse,
    summary="Update your own progress",
)
async def update_progress(
    enrollment_id: uuid.UUID,
    payload: EnrollmentProgressUpdate,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentResponse:
    enrollment = await enrollment_service.update_progress(
        db,
        current_user,
        enrollment_id,
        progress_percent=payload.progress_percent,
        status=payload.status,
    )
    return EnrollmentResponse.model_validate(enrollment_service.serialize(enrollment))


@enrollment_router.post(
    "/{enrollment_id}/drop", response_model=Message, summary="Drop a course"
)
async def drop_enrollment(
    enrollment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_trainee_profile),
    db: AsyncSession = Depends(get_db),
) -> Message:
    await enrollment_service.drop(db, current_user, enrollment_id)
    return Message(message="Enrollment dropped")
