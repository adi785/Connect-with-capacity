"""Notification services (FR-8.x).

Notifications are broadcast rows targeted at a role; per-user read state lives in
`notification_reads`. Only admins may publish (the system also publishes achievement
notifications internally, attributed to the acting user).
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


async def publish(
    db: AsyncSession,
    admin: CurrentUser,
    *,
    type: str,
    title: str,
    body: str | None,
    target_role: str,
) -> Notification:
    notification = Notification(
        type=type,
        title=title,
        body=body,
        published_by=admin.id,
        target_role=target_role,
    )
    db.add(notification)
    await db.flush()
    await audit.record(
        db,
        actor_id=admin.id,
        action="notification.published",
        target_entity="notifications",
        target_id=notification.id,
        meta={"title": title, "target_role": target_role},
    )
    return notification


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
    """The caller's notification feed with read state and an unread count."""
    audience = _audience_filter(current_user)

    read_rows = await db.execute(
        select(NotificationRead.notification_id, NotificationRead.read_at).where(
            NotificationRead.user_id == current_user.id
        )
    )
    read_map = dict(read_rows.all())

    total = (
        await db.scalar(select(func.count(Notification.id)).where(audience))
    ) or 0

    query = select(Notification, Profile.name).outerjoin(
        Profile, Profile.id == Notification.published_by
    ).where(audience)

    if unread_only and read_map:
        query = query.where(Notification.id.not_in(list(read_map.keys())))

    rows = await db.execute(
        query.order_by(Notification.published_at.desc()).limit(limit).offset(offset)
    )

    items = [
        {
            "id": n.id,
            "type": n.type,
            "title": n.title,
            "body": n.body,
            "target_role": n.target_role or "all",
            "published_by": n.published_by,
            "published_by_name": publisher,
            "published_at": n.published_at,
            "read": n.id in read_map,
            "read_at": read_map.get(n.id),
        }
        for n, publisher in rows.all()
    ]

    return {
        "items": items,
        "unread_count": max(total - len(read_map), 0),
        "total": total,
    }


async def unread_count(db: AsyncSession, current_user: CurrentUser) -> int:
    audience = _audience_filter(current_user)
    total = (await db.scalar(select(func.count(Notification.id)).where(audience))) or 0
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
    audience = _audience_filter(current_user)
    already = select(NotificationRead.notification_id).where(
        NotificationRead.user_id == current_user.id
    )
    rows = await db.scalars(
        select(Notification.id).where(audience, Notification.id.not_in(already))
    )

    now = dt.datetime.now(dt.timezone.utc)
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
