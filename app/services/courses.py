"""Course, module, and learning-resource services (FR-4.x, FR-5.x).

Visibility (Section 4):
  * trainee  - published courses only
  * trainer  - published courses plus every course they authored (any status)
  * admin    - everything

Write access to a course and everything beneath it (modules, resources, assessments)
belongs to the authoring trainer (`courses.created_by`) or an admin. `_assert_can_edit`
is the single place that decision is made.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select, func, inspect as sa_inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.core.storage import (
    ALLOWED_MIME_TYPES,
    build_object_path,
    create_signed_upload_url,
    try_signed_download_url,
    validate_upload,
)
from app.db.models import (
    Assessment,
    Course,
    CourseModule,
    Enrollment,
    Feedback,
    LearningResource,
    Profile,
    Subject,
    TrainerProfile,
)
from app.deps import CurrentUser
from app.services import audit

# ------------------------------ Visibility ------------------------------


def _visibility_filter(query: Select, current_user: CurrentUser) -> Select:
    """Restrict a course query to what this caller is allowed to see."""
    if current_user.is_admin:
        return query
    if current_user.is_trainer and current_user.trainer_profile_id:
        return query.where(
            or_(
                Course.status == "published",
                Course.created_by == current_user.trainer_profile_id,
            )
        )
    return query.where(Course.status == "published")


async def get_course(
    db: AsyncSession, current_user: CurrentUser, course_id: uuid.UUID
) -> Course:
    """Load a course the caller is allowed to see, else 404.

    A draft course returns 404 rather than 403 for non-owners: its existence is
    itself private until published.
    """
    course = await db.get(Course, course_id)
    if course is None:
        raise NotFound("Course not found", code="course_not_found")

    if current_user.is_admin:
        return course
    if course.status == "published":
        return course
    if (
        current_user.is_trainer
        and current_user.trainer_profile_id is not None
        and course.created_by == current_user.trainer_profile_id
    ):
        return course

    raise NotFound("Course not found", code="course_not_found")


def _assert_can_edit(course: Course, current_user: CurrentUser) -> None:
    """Only the authoring trainer or an admin may mutate a course."""
    if current_user.is_admin:
        return
    if (
        current_user.trainer_profile_id is not None
        and course.created_by == current_user.trainer_profile_id
    ):
        return
    raise Forbidden("You can only modify courses you created", code="not_course_owner")


async def get_editable_course(
    db: AsyncSession, current_user: CurrentUser, course_id: uuid.UUID
) -> Course:
    course = await get_course(db, current_user, course_id)
    _assert_can_edit(course, current_user)
    return course


# -------------------------------- Listing --------------------------------


async def list_courses(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    subject_id: uuid.UUID | None = None,
    status: str | None = None,
    search: str | None = None,
    mine: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """Paginated course catalog with per-course counts and the caller's enrollment."""
    query = _visibility_filter(select(Course), current_user)
    count_q = _visibility_filter(select(func.count(Course.id)), current_user)

    filters = []
    if subject_id:
        filters.append(Course.subject_id == subject_id)
    if status:
        filters.append(Course.status == status)
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(or_(Course.title.ilike(pattern), Course.description.ilike(pattern)))
    if mine and current_user.trainer_profile_id:
        filters.append(Course.created_by == current_user.trainer_profile_id)

    for f in filters:
        query = query.where(f)
        count_q = count_q.where(f)

    total = (await db.scalar(count_q)) or 0
    rows = await db.scalars(
        query.order_by(Course.created_at.desc()).limit(limit).offset(offset)
    )
    courses = list(rows.all())
    if not courses:
        return [], total

    return await _decorate_courses(db, current_user, courses), total


async def _decorate_courses(
    db: AsyncSession, current_user: CurrentUser, courses: list[Course]
) -> list[dict[str, Any]]:
    """Attach subject/trainer names, counts, ratings, and own-enrollment in bulk.

    Done with grouped queries rather than per-course lookups to keep the catalog at
    a fixed number of round-trips regardless of page size.
    """
    course_ids = [c.id for c in courses]

    subject_ids = {c.subject_id for c in courses if c.subject_id}
    subject_names: dict[uuid.UUID, str] = {}
    if subject_ids:
        rows = await db.execute(
            select(Subject.id, Subject.name).where(Subject.id.in_(subject_ids))
        )
        subject_names = dict(rows.all())

    trainer_ids = {c.created_by for c in courses}
    trainer_names: dict[uuid.UUID, str] = {}
    if trainer_ids:
        rows = await db.execute(
            select(TrainerProfile.id, Profile.name)
            .join(Profile, Profile.id == TrainerProfile.user_id)
            .where(TrainerProfile.id.in_(trainer_ids))
        )
        trainer_names = dict(rows.all())

    module_counts = dict(
        (
            await db.execute(
                select(CourseModule.course_id, func.count(CourseModule.id))
                .where(CourseModule.course_id.in_(course_ids))
                .group_by(CourseModule.course_id)
            )
        ).all()
    )
    enrollment_counts = dict(
        (
            await db.execute(
                select(Enrollment.course_id, func.count(Enrollment.id))
                .where(Enrollment.course_id.in_(course_ids))
                .group_by(Enrollment.course_id)
            )
        ).all()
    )
    ratings = dict(
        (
            await db.execute(
                select(Feedback.course_id, func.avg(Feedback.rating))
                .where(Feedback.course_id.in_(course_ids))
                .group_by(Feedback.course_id)
            )
        ).all()
    )

    own_enrollments: dict[uuid.UUID, tuple[str, int]] = {}
    if current_user.trainee_profile_id:
        rows = await db.execute(
            select(Enrollment.course_id, Enrollment.status, Enrollment.progress_percent).where(
                Enrollment.trainee_profile_id == current_user.trainee_profile_id,
                Enrollment.course_id.in_(course_ids),
            )
        )
        own_enrollments = {cid: (st, prog or 0) for cid, st, prog in rows.all()}

    result = []
    for course in courses:
        enrollment = own_enrollments.get(course.id)
        rating = ratings.get(course.id)
        result.append(
            {
                "id": course.id,
                "title": course.title,
                "description": course.description,
                "subject_id": course.subject_id,
                "subject_name": subject_names.get(course.subject_id) if course.subject_id else None,
                "created_by": course.created_by,
                "trainer_name": trainer_names.get(course.created_by),
                "status": course.status,
                "created_at": course.created_at,
                "updated_at": course.updated_at,
                "module_count": module_counts.get(course.id, 0),
                "enrollment_count": enrollment_counts.get(course.id, 0),
                "average_rating": round(float(rating), 2) if rating is not None else None,
                "enrollment_status": enrollment[0] if enrollment else None,
                "progress_percent": enrollment[1] if enrollment else None,
            }
        )
    return result


async def get_course_detail(
    db: AsyncSession, current_user: CurrentUser, course_id: uuid.UUID
) -> dict[str, Any]:
    """Course header plus its modules and signed resource URLs.

    Trainees only get resource links once enrolled; the module outline itself stays
    visible so the catalog can advertise what a course covers.
    """
    course = await get_course(db, current_user, course_id)
    payload = (await _decorate_courses(db, current_user, [course]))[0]

    may_see_files = current_user.is_admin or _is_owner(course, current_user)
    if not may_see_files and current_user.trainee_profile_id:
        may_see_files = (
            await db.scalar(
                select(func.count(Enrollment.id)).where(
                    Enrollment.trainee_profile_id == current_user.trainee_profile_id,
                    Enrollment.course_id == course.id,
                )
            )
        ) > 0

    modules = sorted(course.modules, key=lambda m: m.sequence_no)
    payload_modules = []
    for module in modules:
        res_list = []
        for resource in sorted(module.resources, key=lambda r: (r.uploaded_at or r.title)):
            res_list.append(await _serialize_resource(resource, include_url=may_see_files))
        payload_modules.append(
            {
                "id": module.id,
                "course_id": module.course_id,
                "title": module.title,
                "sequence_no": module.sequence_no,
                "resources": res_list,
            }
        )
    payload["modules"] = payload_modules
    return payload


def _is_owner(course: Course, current_user: CurrentUser) -> bool:
    return (
        current_user.trainer_profile_id is not None
        and course.created_by == current_user.trainer_profile_id
    )


async def _serialize_resource(
    resource: LearningResource, *, include_url: bool
) -> dict[str, Any]:
    """Serialize a resource, signing its storage path only for permitted callers."""
    file_url = None
    if include_url:
        file_url = await try_signed_download_url(
            settings.bucket_lecture_resources, resource.file_url
        )
    return {
        "id": resource.id,
        "course_module_id": resource.course_module_id,
        "type": resource.type,
        "title": resource.title,
        "file_url": file_url,
        "uploaded_by": resource.uploaded_by,
        "uploaded_at": resource.uploaded_at,
    }


# --------------------------- Course mutations ---------------------------


async def create_course(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    title: str,
    description: str | None,
    subject_id: uuid.UUID | None,
    status: str,
) -> Course:
    """Create a course owned by the calling trainer (or, for an admin, by them too)."""
    if current_user.trainer_profile_id is None:
        raise Conflict(
            "Only accounts with a trainer profile can create courses",
            code="trainer_profile_missing",
        )
    if subject_id is not None and await db.get(Subject, subject_id) is None:
        raise NotFound("Subject not found", code="subject_not_found")

    course = Course(
        title=title,
        description=description,
        subject_id=subject_id,
        created_by=current_user.trainer_profile_id,
        status=status,
    )
    db.add(course)
    await db.flush()
    await audit.record(
        db,
        actor_id=current_user.id,
        action="course.created",
        target_entity="courses",
        target_id=course.id,
        meta={"title": title, "status": status},
    )
    return course


async def update_course(
    db: AsyncSession, current_user: CurrentUser, course_id: uuid.UUID, values: dict[str, Any]
) -> Course:
    course = await get_editable_course(db, current_user, course_id)

    if values.get("subject_id") is not None and await db.get(Subject, values["subject_id"]) is None:
        raise NotFound("Subject not found", code="subject_not_found")

    previous_status = course.status
    for field in ("title", "description", "subject_id", "status"):
        if field in values and values[field] is not None:
            setattr(course, field, values[field])

    await db.flush()

    if "status" in values and values["status"] and values["status"] != previous_status:
        await audit.record(
            db,
            actor_id=current_user.id,
            action=f"course.{values['status']}",
            target_entity="courses",
            target_id=course.id,
            meta={"from": previous_status, "to": values["status"]},
        )
    return course


async def delete_course(
    db: AsyncSession, current_user: CurrentUser, course_id: uuid.UUID
) -> None:
    """Delete a course, refusing once trainees have enrolled.

    Enrollments cascade, so an accidental delete would silently erase progress
    history; archiving is the safe path once anyone has joined.
    """
    course = await get_editable_course(db, current_user, course_id)

    enrolled = await db.scalar(
        select(func.count(Enrollment.id)).where(Enrollment.course_id == course_id)
    )
    if enrolled:
        raise Conflict(
            f"{enrolled} trainee(s) are enrolled. Archive the course instead of deleting it.",
            code="course_has_enrollments",
        )

    await db.delete(course)
    await db.flush()
    await audit.record(
        db,
        actor_id=current_user.id,
        action="course.deleted",
        target_entity="courses",
        target_id=course_id,
        meta={"title": course.title},
    )


# ------------------------------- Modules -------------------------------


async def create_module(
    db: AsyncSession,
    current_user: CurrentUser,
    course_id: uuid.UUID,
    *,
    title: str,
    sequence_no: int | None,
) -> CourseModule:
    """Append a module, defaulting its position to the end of the course."""
    await get_editable_course(db, current_user, course_id)

    if sequence_no is None:
        highest = await db.scalar(
            select(func.max(CourseModule.sequence_no)).where(CourseModule.course_id == course_id)
        )
        sequence_no = (highest or 0) + 1

    module = CourseModule(course_id=course_id, title=title, sequence_no=sequence_no)
    db.add(module)
    await db.flush()
    return module


async def get_editable_module(
    db: AsyncSession, current_user: CurrentUser, module_id: uuid.UUID
) -> CourseModule:
    """Load a module and verify the caller may edit its parent course."""
    module = await db.get(CourseModule, module_id)
    if module is None:
        raise NotFound("Module not found", code="module_not_found")
    await get_editable_course(db, current_user, module.course_id)
    return module


async def update_module(
    db: AsyncSession, current_user: CurrentUser, module_id: uuid.UUID, values: dict[str, Any]
) -> CourseModule:
    module = await get_editable_module(db, current_user, module_id)
    for field in ("title", "sequence_no"):
        if field in values and values[field] is not None:
            setattr(module, field, values[field])
    await db.flush()
    return module


async def delete_module(
    db: AsyncSession, current_user: CurrentUser, module_id: uuid.UUID
) -> None:
    module = await get_editable_module(db, current_user, module_id)
    await db.delete(module)
    await db.flush()


async def serialize_module(
    db: AsyncSession, current_user: CurrentUser, module: CourseModule
) -> dict[str, Any]:
    """Editor-facing module payload; resource URLs are always signed here.

    A module that was just inserted has no loaded `resources` collection, and an
    implicit lazy load under asyncio would raise `MissingGreenlet` — so load it
    explicitly rather than relying on the relationship's eager strategy.
    """
    if "resources" in sa_inspect(module).unloaded:
        await db.refresh(module, attribute_names=["resources"])

    include_url = True  # only reachable from editor endpoints
    return {
        "id": module.id,
        "course_id": module.course_id,
        "title": module.title,
        "sequence_no": module.sequence_no,
        "resources": [
            await _serialize_resource(r, include_url=include_url) for r in module.resources
        ],
    }


# ------------------------------ Resources ------------------------------


async def request_resource_upload(
    db: AsyncSession,
    current_user: CurrentUser,
    module_id: uuid.UUID,
    *,
    title: str,
    resource_type: str,
    filename: str,
    content_type: str,
    size_bytes: int | None,
) -> dict[str, Any]:
    """Reserve a resource row and hand back a signed Supabase upload target.

    The row is created up front so the client has an id to confirm against, and the
    object path is derived server-side — a client can never choose where its bytes land.
    """
    module = await get_editable_module(db, current_user, module_id)
    if current_user.trainer_profile_id is None:
        raise Conflict("A trainer profile is required to upload", code="trainer_profile_missing")

    validate_upload(
        mime_type=content_type,
        size_bytes=size_bytes,
        allowed=ALLOWED_MIME_TYPES.get(resource_type, set()),
        label=resource_type,
    )

    path = build_object_path(
        str(module.course_id), str(module.id), filename=filename
    )
    signed = await create_signed_upload_url(settings.bucket_lecture_resources, path)

    resource = LearningResource(
        course_module_id=module.id,
        type=resource_type,
        title=title,
        file_url=path,
        uploaded_by=current_user.trainer_profile_id,
    )
    db.add(resource)
    await db.flush()

    await audit.record(
        db,
        actor_id=current_user.id,
        action="resource.upload_requested",
        target_entity="learning_resources",
        target_id=resource.id,
        meta={"type": resource_type, "content_type": content_type, "size_bytes": size_bytes},
    )

    return {
        "resource_id": resource.id,
        "bucket": signed.bucket,
        "path": signed.path,
        "upload_url": signed.upload_url,
        "token": signed.token,
        "expires_in": settings.signed_url_ttl_seconds,
    }


async def create_link_resource(
    db: AsyncSession,
    current_user: CurrentUser,
    module_id: uuid.UUID,
    *,
    title: str,
    url: str,
) -> LearningResource:
    """Register an external link as a resource (no upload involved)."""
    module = await get_editable_module(db, current_user, module_id)
    if current_user.trainer_profile_id is None:
        raise Conflict("A trainer profile is required", code="trainer_profile_missing")
    if not url.startswith(("http://", "https://")):
        raise BadRequest("Link must start with http:// or https://", code="invalid_url")

    resource = LearningResource(
        course_module_id=module.id,
        type="link",
        title=title,
        file_url=url,
        uploaded_by=current_user.trainer_profile_id,
    )
    db.add(resource)
    await db.flush()
    return resource


async def delete_resource(
    db: AsyncSession, current_user: CurrentUser, resource_id: uuid.UUID
) -> None:
    resource = await db.get(LearningResource, resource_id)
    if resource is None:
        raise NotFound("Resource not found", code="resource_not_found")
    await get_editable_module(db, current_user, resource.course_module_id)

    await db.delete(resource)
    await db.flush()
    await audit.record(
        db,
        actor_id=current_user.id,
        action="resource.deleted",
        target_entity="learning_resources",
        target_id=resource_id,
        meta={"title": resource.title},
    )


async def get_resource_download_url(
    db: AsyncSession, current_user: CurrentUser, resource_id: uuid.UUID
) -> str:
    """Mint a signed URL, requiring enrollment for trainees (Section 4, point 2)."""
    resource = await db.get(LearningResource, resource_id)
    if resource is None:
        raise NotFound("Resource not found", code="resource_not_found")

    module = await db.get(CourseModule, resource.course_module_id)
    if module is None:
        raise NotFound("Resource not found", code="resource_not_found")

    course = await get_course(db, current_user, module.course_id)

    if not (current_user.is_admin or _is_owner(course, current_user)):
        if current_user.trainee_profile_id is None:
            raise Forbidden("Enroll in this course to access its resources", code="not_enrolled")
        enrolled = await db.scalar(
            select(func.count(Enrollment.id)).where(
                Enrollment.trainee_profile_id == current_user.trainee_profile_id,
                Enrollment.course_id == course.id,
            )
        )
        if not enrolled:
            raise Forbidden("Enroll in this course to access its resources", code="not_enrolled")

    if not resource.file_url:
        raise NotFound("This resource has no file yet", code="resource_empty")
    if resource.file_url.startswith(("http://", "https://")):
        return resource.file_url

    from app.core.storage import create_signed_download_url

    return await create_signed_download_url(
        settings.bucket_lecture_resources, resource.file_url
    )


async def count_course_assessments(db: AsyncSession, course_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count(Assessment.id)).where(Assessment.course_id == course_id)
        )
    ) or 0
