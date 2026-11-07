from __future__ import annotations

from typing import Any
from app.core.localization import text


class ApiError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400,
        code: str = "bad_request",
        details: Any | None = None,
    ) -> None:
        self.message = text(message)
        self.status_code = status_code
        self.code = code
        self.details = details
        super().__init__(self.message)


def error_payload(code: str, message: str, details: Any | None = None) -> dict:
    payload: dict[str, Any] = {
        "success": False,
        "error": {"code": code, "message": text(message)},
    }
    if details is not None:
        payload["error"]["details"] = details
    return payload
