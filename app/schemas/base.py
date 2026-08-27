"""Shared Pydantic v2 base classes and common response envelopes."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class APIModel(BaseModel):
    """Base for request/response models.

    * ``from_attributes`` lets responses be built directly from ORM rows.
    * ``populate_by_name`` accepts either the field name or its camelCase alias.
    * ``extra='forbid'`` rejects unknown fields on input (Section 8).
    """

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


class ResponseModel(APIModel):
    """Base for outbound models: tolerate extra ORM attributes rather than reject."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        extra="ignore",
        str_strip_whitespace=True,
    )


class Message(ResponseModel):
    """Generic acknowledgement body."""

    message: str


class Page(ResponseModel, Generic[T]):
    """Simple offset-paginated envelope."""

    items: list[T]
    total: int
    limit: int
    offset: int
