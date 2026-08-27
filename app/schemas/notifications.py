"""Notification schemas."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal, Optional

from pydantic import Field

from app.schemas.base import APIModel, ResponseModel

NotificationType = Literal[
    "announcement", "achievement", "new_content", "deadline_reminder"
]
TargetRole = Literal["all", "trainee", "trainer", "admin"]


class NotificationCreate(APIModel):
    type: NotificationType = "announcement"
    title: str = Field(min_length=1, max_length=200)
    body: Optional[str] = None
    target_role: TargetRole = Field(default="all", alias="targetRole")


class NotificationResponse(ResponseModel):
    id: uuid.UUID
    type: NotificationType
    title: str
    body: Optional[str] = None
    target_role: TargetRole = "all"
    published_by: uuid.UUID
    published_by_name: Optional[str] = None
    published_at: Optional[dt.datetime] = None
    read: bool = False
    read_at: Optional[dt.datetime] = None


class NotificationFeed(ResponseModel):
    items: list[NotificationResponse] = Field(default_factory=list)
    unread_count: int = 0
    total: int = 0
