"""Consistent JSON error envelope and exception handlers.

Every error response has the shape required by the spec (Section 8):

    {"error": {"code": "not_found", "message": "Course not found"}}
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

# Maps HTTP status codes onto stable, machine-readable error codes.
_STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


def error_payload(status_code: int, message: str, **extra) -> dict:
    body = {"code": _STATUS_CODES.get(status_code, "error"), "message": message}
    if extra:
        body.update(extra)
    return {"error": body}


class AppError(HTTPException):
    """Domain error raised by the service layer.

    Carrying an explicit code lets services signal intent (e.g. "already_enrolled")
    while still mapping onto the right HTTP status.
    """

    def __init__(self, status_code: int, message: str, code: str | None = None):
        super().__init__(status_code=status_code, detail=message)
        self.code = code


class NotFound(AppError):
    def __init__(self, message: str = "Resource not found", code: str | None = None):
        super().__init__(status.HTTP_404_NOT_FOUND, message, code)


class Forbidden(AppError):
    def __init__(self, message: str = "Not permitted", code: str | None = None):
        super().__init__(status.HTTP_403_FORBIDDEN, message, code)


class Conflict(AppError):
    def __init__(self, message: str = "Conflicting state", code: str | None = None):
        super().__init__(status.HTTP_409_CONFLICT, message, code)


class BadRequest(AppError):
    def __init__(self, message: str = "Invalid request", code: str | None = None):
        super().__init__(status.HTTP_400_BAD_REQUEST, message, code)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "Request failed"
        payload = error_payload(exc.status_code, message)
        code = getattr(exc, "code", None)
        if code:
            payload["error"]["code"] = code
        return JSONResponse(
            status_code=exc.status_code,
            content=payload,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=error_payload(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Request validation failed",
                details=jsonable_encoder(exc.errors()),
            ),
        )

    @app.exception_handler(IntegrityError)
    async def _integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
        # Unique/FK/CHECK violations are caller errors, not server faults. The driver
        # message can leak schema details, so log it and return something generic.
        logger.warning("Database integrity error: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=error_payload(
                status.HTTP_409_CONFLICT,
                "The request conflicts with existing data or violates a constraint",
            ),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=error_payload(
                status.HTTP_500_INTERNAL_SERVER_ERROR, "Internal server error"
            ),
        )
