"""Notification & Announcement services (FR-8.x).

Notifications/Announcements are broadcast rows targeted at a role; per-user read state lives in
`notification_reads`. Only admins may publish, edit, or delete.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.db.models import Notification, NotificationRead, Profile
from app.deps import CurrentUser
from app.services import audit


def _serialize_notification(
    n: Notification,
    publisher_name: str | None = None,
    read: bool = False,
    read_at: dt.datetime | None = None,
) -> dict[str, Any]:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "summary": n.summary,
        "body": n.body,
        "category": n.category,
        "target_role": n.target_role or "all",
        "status": getattr(n, "status", "published") or "published",
        "published_by": n.published_by,
        "published_by_name": publisher_name,
        "published_at": n.published_at,
        "expires_at": n.expires_at,
        "created_at": n.created_at,
        "updated_at": n.updated_at,
        "read": read,
        "read_at": read_at,
    }


async def publish(
    db: AsyncSession,
    admin: CurrentUser,
    *,
    type: str = "announcement",
    title: str,
    summary: str | None = None,
    body: str | None = None,
    category: str | None = None,
    target_role: str = "all",
    status: str = "published",
    expires_at: dt.datetime | None = None,
) -> dict[str, Any]:
    now = dt.datetime.now(dt.timezone.utc)
    notification = Notification(
        type=type,
        title=title,
        summary=summary,
        body=body,
        category=category,
        published_by=admin.id,
        target_role=target_role,
        status=status,
        published_at=now if status == "published" else None,
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(notification)
    await db.flush()
    await db.refresh(notification)

    await audit.record(
        db,
        actor_id=admin.id,
        action=f"notification.{status}",
        target_entity="notifications",
        target_id=notification.id,
        meta={"title": title, "target_role": target_role, "status": status},
    )
    return _serialize_notification(notification, publisher_name=admin.name)


async def update_notification(
    db: AsyncSession,
    admin: CurrentUser,
    notification_id: uuid.UUID,
    data: dict[str, Any],
) -> dict[str, Any]:
    notification = await db.get(Notification, notification_id)
    if notification is None:
        raise NotFound("Notification not found", code="notification_not_found")

    prev_status = getattr(notification, "status", "published")
    new_status = data.get("status")

    for field in ("type", "title", "summary", "body", "category", "target_role", "status", "expires_at"):
        if field in data and data[field] is not None:
            setattr(notification, field, data[field])

    now = dt.datetime.now(dt.timezone.utc)
    notification.updated_at = now
    if new_status == "published" and prev_status != "published" and not notification.published_at:
        notification.published_at = now

    await db.flush()
    await db.refresh(notification)

    publisher_name = await db.scalar(
        select(Profile.name).where(Profile.id == notification.published_by)
    )

    await audit.record(
        db,
        actor_id=admin.id,
        action="notification.updated",
        target_entity="notifications",
        target_id=notification.id,
        meta={"title": notification.title, "status": getattr(notification, "status", "published")},
    )
    return _serialize_notification(notification, publisher_name=publisher_name)


def _audience_filter(current_user: CurrentUser):
    """Rows addressed to everyone or to this caller's role."""
    return or_(
        Notification.target_role == "all",
        Notification.target_role.is_(None),
        Notification.target_role == current_user.role,
    )


async def feed(
    db: AsyncSession,
    current_user: CurrentUser,
    *,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """The caller's published notification feed with read state and an unread count."""
    now = dt.datetime.now(dt.timezone.utc)
    audience = _audience_filter(current_user)

    # Filter out drafts and expired items for non-admins (and admins using user feed)
    published_filter = or_(
        Notification.status == "published",
        Notification.status.is_(None),
    )
    not_expired = or_(
        Notification.expires_at.is_(None),
        Notification.expires_at > now,
    )

    base_filter = [audience, published_filter, not_expired]

    read_rows = await db.execute(
        select(NotificationRead.notification_id, NotificationRead.read_at).where(
            NotificationRead.user_id == current_user.id
        )
    )
    read_map = dict(read_rows.all())

    count_q = select(func.count(Notification.id))
    for f in base_filter:
        count_q = count_q.where(f)
    total = (await db.scalar(count_q)) or 0

    query = select(Notification, Profile.name).outerjoin(
        Profile, Profile.id == Notification.published_by
    )
    for f in base_filter:
        query = query.where(f)

    if unread_only and read_map:
        query = query.where(Notification.id.not_in(list(read_map.keys())))

    rows = await db.execute(
        query.order_by(
            func.coalesce(Notification.published_at, Notification.created_at).desc()
        ).limit(limit).offset(offset)
    )

    items = [
        _serialize_notification(
            n,
            publisher_name=publisher,
            read=n.id in read_map,
            read_at=read_map.get(n.id),
        )
        for n, publisher in rows.all()
    ]

    return {
        "items": items,
        "unread_count": max(total - len(read_map), 0),
        "total": total,
    }


async def list_admin(
    db: AsyncSession,
    _: CurrentUser,
    *,
    status: str | None = None,
    category: str | None = None,
    target_role: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """Admin-facing full list including drafts and archived announcements."""
    query = select(Notification, Profile.name).outerjoin(
        Profile, Profile.id == Notification.published_by
    )
    count_q = select(func.count(Notification.id))

    filters = []
    if status:
        filters.append(Notification.status == status)
    if category:
        filters.append(Notification.category == category)
    if target_role:
        filters.append(Notification.target_role == target_role)
    if search:
        pat = f"%{search.strip()}%"
        filters.append(or_(Notification.title.ilike(pat), Notification.body.ilike(pat), Notification.summary.ilike(pat)))

    for f in filters:
        query = query.where(f)
        count_q = count_q.where(f)

    total = (await db.scalar(count_q)) or 0
    rows = await db.execute(
        query.order_by(
            func.coalesce(Notification.updated_at, Notification.created_at, Notification.published_at).desc()
        ).limit(limit).offset(offset)
    )

    items = [
        _serialize_notification(n, publisher_name=publisher)
        for n, publisher in rows.all()
    ]
    return items, total


async def unread_count(db: AsyncSession, current_user: CurrentUser) -> int:
    now = dt.datetime.now(dt.timezone.utc)
    audience = _audience_filter(current_user)
    published_filter = or_(Notification.status == "published", Notification.status.is_(None))
    not_expired = or_(Notification.expires_at.is_(None), Notification.expires_at > now)

    total = (
        await db.scalar(
            select(func.count(Notification.id)).where(audience, published_filter, not_expired)
        )
    ) or 0
    read = (
        await db.scalar(
            select(func.count(NotificationRead.id)).where(
                NotificationRead.user_id == current_user.id
            )
        )
    ) or 0
    return max(total - read, 0)


async def mark_read(
    db: AsyncSession, current_user: CurrentUser, notification_id: uuid.UUID
) -> None:
    """Mark one notification read for the caller (idempotent)."""
    notification = await db.get(Notification, notification_id)
    if notification is None:
        raise NotFound("Notification not found", code="notification_not_found")

    existing = await db.scalar(
        select(NotificationRead.id).where(
            NotificationRead.notification_id == notification_id,
            NotificationRead.user_id == current_user.id,
        )
    )
    if existing is not None:
        return

    db.add(
        NotificationRead(
            notification_id=notification_id,
            user_id=current_user.id,
            read_at=dt.datetime.now(dt.timezone.utc),
        )
    )
    await db.flush()


async def mark_all_read(db: AsyncSession, current_user: CurrentUser) -> int:
    """Mark every notification currently addressed to the caller as read."""
    now = dt.datetime.now(dt.timezone.utc)
    audience = _audience_filter(current_user)
    published_filter = or_(Notification.status == "published", Notification.status.is_(None))
    not_expired = or_(Notification.expires_at.is_(None), Notification.expires_at > now)

    already = select(NotificationRead.notification_id).where(
        NotificationRead.user_id == current_user.id
    )
    rows = await db.scalars(
        select(Notification.id).where(
            audience,
            published_filter,
            not_expired,
            Notification.id.not_in(already),
        )
    )

    count = 0
    for notification_id in rows.all():
        db.add(
            NotificationRead(
                notification_id=notification_id, user_id=current_user.id, read_at=now
            )
        )
        count += 1

    await db.flush()
    return count


async def delete(
    db: AsyncSession, admin: CurrentUser, notification_id: uuid.UUID
) -> None:
    notification = await db.get(Notification, notification_id)
    if notification is None:
        raise NotFound("Notification not found", code="notification_not_found")
    await db.delete(notification)
    await db.flush()
    await audit.record(
        db,
        actor_id=admin.id,
        action="notification.deleted",
        target_entity="notifications",
        target_id=notification_id,
    )
