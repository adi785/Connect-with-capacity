"""Audit logging for privileged and state-changing actions (Section 8).

Audit writes must never break the action they describe: if the log insert fails we
warn and move on rather than rolling back a legitimate approval or role change.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog

logger = logging.getLogger(__name__)


async def record(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID | None,
    action: str,
    target_entity: str | None = None,
    target_id: uuid.UUID | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    """Append an audit entry in the caller's transaction.

    `action` is a stable verb like "user.role_changed" or "course.published"; the
    admin audit view filters on it, so keep the vocabulary consistent.
    """
    try:
        db.add(
            AuditLog(
                user_id=actor_id,
                action=action,
                target_entity=target_entity,
                target_id=target_id,
                meta=meta,
            )
        )
        await db.flush()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to write audit log for %s: %s", action, exc)
