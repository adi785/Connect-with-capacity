"""Notification endpoints (FR-8.x).

Notifications are broadcast rows targeted at a role; per-user read state lives in a
separate table, so the feed is the join of "addressed to me" and "have I read it".
Only admins may publish or delete.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, require_admin, require_approved
from app.schemas.base import Message
from app.schemas.notifications import (
    NotificationCreate,
    NotificationFeed,
    NotificationResponse,
)
from app.services import notifications as service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationFeed, summary="The caller's notification feed")
async def feed(
    unread_only: bool = Query(default=False, alias="unreadOnly"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> NotificationFeed:
    """Includes rows targeted at 'all' plus rows targeted at the caller's own role."""
    return NotificationFeed.model_validate(
        await service.feed(
            db, current_user, unread_only=unread_only, limit=limit, offset=offset
        )
    )


@router.get(
    "/unread-count",
    response_model=dict,
    summary="Unread badge count",
)
async def unread_count(
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Split out from the feed so a client can poll it cheaply."""
    return {"unread_count": await service.unread_count(db, current_user)}


@router.post(
    "",
    response_model=NotificationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Publish a notification (admin)",
)
async def publish(
    payload: NotificationCreate,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> NotificationResponse:
    notification = await service.publish(
        db,
        admin,
        type=payload.type,
        title=payload.title,
        body=payload.body,
        target_role=payload.target_role,
    )
    return NotificationResponse.model_validate(notification)


@router.post(
    "/read-all",
    response_model=Message,
    summary="Mark every notification addressed to you as read",
)
async def mark_all_read(
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> Message:
    count = await service.mark_all_read(db, current_user)
    return Message(message=f"Marked {count} notification(s) as read")


@router.post(
    "/{notification_id}/read",
    response_model=Message,
    summary="Mark one notification as read",
)
async def mark_read(
    notification_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_approved),
    db: AsyncSession = Depends(get_db),
) -> Message:
    """Idempotent — marking an already-read notification is not an error."""
    await service.mark_read(db, current_user, notification_id)
    return Message(message="Notification marked as read")


@router.delete(
    "/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a notification for everyone (admin)",
)
async def delete_notification(
    notification_id: uuid.UUID,
    admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete(db, admin, notification_id)
