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
NotificationStatus = Literal["draft", "published", "archived"]


class NotificationCreate(APIModel):
    type: NotificationType = "announcement"
    title: str = Field(min_length=1, max_length=200)
    summary: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=100)
    target_role: TargetRole = Field(default="all", alias="targetRole")
    status: NotificationStatus = "published"
    expires_at: Optional[dt.datetime] = Field(default=None, alias="expiresAt")


class NotificationUpdate(APIModel):
    type: Optional[NotificationType] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    summary: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=100)
    target_role: Optional[TargetRole] = Field(default=None, alias="targetRole")
    status: Optional[NotificationStatus] = None
    expires_at: Optional[dt.datetime] = Field(default=None, alias="expiresAt")


class NotificationResponse(ResponseModel):
    id: uuid.UUID
    type: NotificationType
    title: str
    summary: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    target_role: TargetRole = "all"
    status: NotificationStatus = "published"
    published_by: uuid.UUID
    published_by_name: Optional[str] = None
    published_at: Optional[dt.datetime] = None
    expires_at: Optional[dt.datetime] = None
    created_at: Optional[dt.datetime] = None
    updated_at: Optional[dt.datetime] = None
    read: bool = False
    read_at: Optional[dt.datetime] = None


class NotificationFeed(ResponseModel):
    items: list[NotificationResponse] = Field(default_factory=list)
    unread_count: int = 0
    total: int = 0
