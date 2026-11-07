from __future__ import annotations

from typing import Any

from app.core.utils import json_safe
from app.core.localization import payload, text


def ok(data: Any = None, message: str | None = None) -> dict:
    return {"success": True, "data": payload(json_safe(data)), "message": text(message) if message else None}


def page(items: list, total: int, limit: int, offset: int, extra: dict | None = None) -> dict:
    payload: dict[str, Any] = {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(items) < total,
    }
    if extra:
        payload.update(extra)
    return payload
