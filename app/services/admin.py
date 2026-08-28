"""Admin services: approval workflow, user management, and audit log access.

Every function here assumes the caller has already passed `require_admin`; the
checks that remain are about domain safety (e.g. an admin cannot demote themselves
into a locked-out state) rather than role gating.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.db.models import ApprovalRequest, AuditLog, Notification, Profile
from app.deps import CurrentUser
from app.services import audit, profiles as profile_service

# ---------------------------- Approval workflow ----------------------------


async def list_approval_requests(
    db: AsyncSession,
    *,
    status: str | None = "pending",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """List approval requests joined with the requesting user's details."""
    base = select(ApprovalRequest).join(Profile, Profile.id == ApprovalRequest.user_id)
    count_q = select(func.count(ApprovalRequest.id))
    if status:
        base = base.where(ApprovalRequest.status == status)
        count_q = count_q.where(ApprovalRequest.status == status)

    total = (await db.scalar(count_q)) or 0

    rows = await db.execute(
        base.add_columns(Profile.name, Profile.email, Profile.status)
        .order_by(ApprovalRequest.requested_at.desc())
        .limit(limit)
        .offset(offset)
    )

    items = [
        {
            "id": req.id,
            "user_id": req.user_id,
            "requested_role": req.requested_role,
            "status": req.status,
            "requested_at": req.requested_at,
            "reviewed_at": req.reviewed_at,
            "reviewed_by": req.reviewed_by,
            "user_name": name,
            "user_email": email,
            "user_status": user_status,
        }
        for req, name, email, user_status in rows.all()
    ]
    return items, total


async def decide_approval(
    db: AsyncSession,
    admin: CurrentUser,
    request_id: uuid.UUID,
    *,
    decision: str,
    note: str | None = None,
) -> dict:
    """Approve or reject a pending request and sync the user's account status.

    Approval is what makes an account usable (FR-1.7): it flips
    `profiles.status` to 'approved' and provisions the matching role side-table row.
    """
    decision = "approved" if decision in ("approve", "approved") else ("rejected" if decision in ("reject", "rejected") else decision)

    request = await db.get(ApprovalRequest, request_id)
    if request is None:
        request = await db.scalar(
            select(ApprovalRequest).where(
                ApprovalRequest.user_id == request_id,
                ApprovalRequest.status == "pending",
            )
        )
    if request is None:
        raise NotFound("Approval request not found", code="approval_not_found")
    if request.status != "pending":
        raise Conflict(
            f"This request was already {request.status}", code="approval_already_decided"
        )

    profile = await db.get(Profile, request.user_id)
    if profile is None:
        raise NotFound("The requesting user no longer exists", code="user_not_found")

    request.status = decision
    request.reviewed_by = admin.id
    request.reviewed_at = dt.datetime.now(dt.timezone.utc)

    if decision == "approved":
        profile.status = "approved"
        # Honour the role the user actually asked for at registration time.
        if profile.role != "admin":
            profile.role = request.requested_role
        await db.flush()
        await profile_service.ensure_role_records(db, profile)
        db.add(
            Notification(
                type="announcement",
                title="Your account has been approved",
                body=note or f"You now have full access as a {profile.role}.",
                published_by=admin.id,
                target_role="all",
            )
        )
    else:
        profile.status = "rejected"

    await db.flush()
    await audit.record(
        db,
        actor_id=admin.id,
        action=f"approval.{decision}",
        target_entity="approval_requests",
        target_id=request.id,
        meta={"user_id": str(profile.id), "role": profile.role, "note": note},
    )

    return {
        "id": request.id,
        "user_id": request.user_id,
        "requested_role": request.requested_role,
        "status": request.status,
        "requested_at": request.requested_at,
        "reviewed_at": request.reviewed_at,
        "reviewed_by": request.reviewed_by,
        "user_name": profile.name,
        "user_email": profile.email,
        "user_status": profile.status,
    }


# ----------------------------- User management -----------------------------


async def list_users(
    db: AsyncSession,
    *,
    role: str | None = None,
    status: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Profile], int]:
    query = select(Profile)
    count_q = select(func.count(Profile.id))

    filters = []
    if role:
        filters.append(Profile.role == role)
    if status:
        filters.append(Profile.status == status)
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(Profile.name.ilike(pattern) | Profile.email.ilike(pattern))

    for f in filters:
        query = query.where(f)
        count_q = count_q.where(f)

    total = (await db.scalar(count_q)) or 0
    rows = await db.execute(
        query.order_by(Profile.created_at.desc()).limit(limit).offset(offset)
    )
    return list(rows.scalars().all()), total


async def change_user_role(
    db: AsyncSession, admin: CurrentUser, user_id: uuid.UUID, new_role: str
) -> Profile:
    """Change a user's role, provisioning the matching role side-table row."""
    profile = await db.get(Profile, user_id)
    if profile is None:
        raise NotFound("User not found", code="user_not_found")

    if profile.id == admin.id and new_role != "admin":
        raise Conflict(
            "You cannot remove your own admin role", code="cannot_demote_self"
        )

    previous = profile.role
    if previous == new_role:
        return profile

    profile.role = new_role
    await db.flush()
    await profile_service.ensure_role_records(db, profile)

    await audit.record(
        db,
        actor_id=admin.id,
        action="user.role_changed",
        target_entity="profiles",
        target_id=profile.id,
        meta={"from": previous, "to": new_role},
    )
    return profile


async def change_user_status(
    db: AsyncSession, admin: CurrentUser, user_id: uuid.UUID, new_status: str
) -> Profile:
    """Approve, reject, or suspend an account."""
    profile = await db.get(Profile, user_id)
    if profile is None:
        raise NotFound("User not found", code="user_not_found")

    if profile.id == admin.id and new_status != "approved":
        raise Conflict(
            "You cannot suspend or reject your own account", code="cannot_lock_self"
        )

    previous = profile.status
    profile.status = new_status

    if new_status == "approved":
        await db.flush()
        await profile_service.ensure_role_records(db, profile)
        # Close any request still sitting in the queue so it can't be decided twice.
        pending = await db.scalars(
            select(ApprovalRequest).where(
                ApprovalRequest.user_id == profile.id,
                ApprovalRequest.status == "pending",
            )
        )
        for request in pending.all():
            request.status = "approved"
            request.reviewed_by = admin.id
            request.reviewed_at = dt.datetime.now(dt.timezone.utc)

    await db.flush()
    await audit.record(
        db,
        actor_id=admin.id,
        action="user.status_changed",
        target_entity="profiles",
        target_id=profile.id,
        meta={"from": previous, "to": new_status},
    )
    return profile


# -------------------------------- Audit log --------------------------------


async def list_audit_logs(
    db: AsyncSession,
    *,
    action: str | None = None,
    user_id: uuid.UUID | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    actor = aliased(Profile)
    query = select(AuditLog, actor.name).outerjoin(actor, actor.id == AuditLog.user_id)
    count_q = select(func.count(AuditLog.id))

    if action:
        query = query.where(AuditLog.action == action)
        count_q = count_q.where(AuditLog.action == action)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
        count_q = count_q.where(AuditLog.user_id == user_id)

    total = (await db.scalar(count_q)) or 0
    rows = await db.execute(
        query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    )

    items = [
        {
            "id": log.id,
            "user_id": log.user_id,
            "actor_name": actor_name,
            "action": log.action,
            "target_entity": log.target_entity,
            "target_id": log.target_id,
            "metadata": log.meta,
            "created_at": log.created_at,
        }
        for log, actor_name in rows.all()
    ]
    return items, total
