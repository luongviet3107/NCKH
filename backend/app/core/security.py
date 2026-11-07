from __future__ import annotations

from fastapi import Header

from app.config import settings
from app.core.errors import ApiError


def require_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    """Optional API-key protection. Enabled only when AUTODS_API_KEY is configured."""
    if settings.api_key and x_api_key != settings.api_key:
        raise ApiError('Cần cung cấp khóa API hợp lệ trong tiêu đề X-API-Key.', 401, "unauthorized")
