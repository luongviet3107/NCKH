from __future__ import annotations

import json
import logging

import httpx

from app.config import settings

logger = logging.getLogger("autods.llm")

SYSTEM_PROMPT = """You are the narrative layer of AutoDS, a business decision-support system.
You may ONLY use the quantitative facts provided in the JSON payload.
Do not invent numbers, savings, probabilities, causes or external facts.
Write all narrative text in Vietnamese, preserving product names, identifiers and metric abbreviations.
Write a concise executive summary (4-6 sentences) and no more than five
decision recommendations. Every recommendation must cite a supplied metric as evidence.
If evidence is insufficient, say so explicitly. Return plain text, not markdown tables."""


def llm_status() -> dict:
    return {
        "configured": settings.llm_configured,
        "model": settings.llm_model if settings.llm_configured else None,
        "base_url": settings.llm_base_url if settings.llm_configured else None,
        "message": (
            'Đã cấu hình chức năng tạo diễn giải bằng mô hình ngôn ngữ.'
            if settings.llm_configured
            else 'Chưa cấu hình khóa API cho mô hình ngôn ngữ. Các chức năng phân tích vẫn hoạt động đầy đủ.'
        ),
    }


def generate_grounded_narrative(payload: dict) -> tuple[str | None, bool, str | None]:
    """Return (narrative, llm_used, error). Never raises for LLM connectivity issues."""
    if not settings.llm_configured:
        return None, False, 'Chưa cấu hình khóa API cho mô hình ngôn ngữ.'
    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    try:
        response = httpx.post(
            url,
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.llm_model,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": "Ground every statement in this JSON of computed results:\n"
                        + json.dumps(payload, ensure_ascii=False)[:18000],
                    },
                ],
            },
            timeout=30.0,
        )
        response.raise_for_status()
        body = response.json()
        content = body["choices"][0]["message"]["content"].strip()
        if not content:
            return None, False, 'Mô hình ngôn ngữ trả về phản hồi trống.'
        return content[:6000], True, None
    except Exception as exc:
        logger.warning("LLM call failed: %s", exc)
        return None, False, "Không thể tạo diễn giải bằng mô hình ngôn ngữ. Hệ thống tiếp tục sử dụng kết quả phân tích có sẵn."
