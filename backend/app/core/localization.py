"""Vietnamese display text; identifiers and uploaded business data stay intact."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_DIRECTORY = Path(__file__).parent
LABELS: dict[str, str] = json.loads((_DIRECTORY / "vi_labels.json").read_text(encoding="utf-8"))
for _line in (_DIRECTORY / "vi_extra.txt").read_text(encoding="utf-8").splitlines():
    if " => " in _line:
        _english, _vietnamese = _line.split(" => ", 1)
        LABELS[_english] = _vietnamese
PROSE: dict[str, str] = {}
_CAPTURES: dict[str, dict[str, str]] = json.loads((_DIRECTORY / "vi_captures.json").read_text(encoding="utf-8"))
for _line in (_DIRECTORY / "vi_prose.txt").read_text(encoding="utf-8").splitlines():
    if " => " in _line:
        _english, _vietnamese = _line.split(" => ", 1)
        PROSE[_english] = _vietnamese


def label(value: Any) -> str:
    text = str(value) if value is not None else "Không có dữ liệu"
    return LABELS.get(text, PROSE.get(text, text))


def _pattern(template: str) -> re.Pattern[str]:
    parts = re.split(r"(\{\d+\})", template)
    fragments = []
    for part in parts:
        if re.fullmatch(r"\{\d+\}", part):
            index = part[1:-1]
            kind = _CAPTURES.get(template, {}).get(index)
            capture = r"[-+\d.,]+|None|N/A|unavailable|not available" if kind == "number" else r".+?"
            fragments.append(rf"(?P<p{index}>{capture})")
        else:
            fragments.append(re.escape(part))
    return re.compile("".join(fragments), re.DOTALL)


_TEMPLATES = sorted(
    [(_pattern(english), vietnamese, _CAPTURES.get(english, {})) for english, vietnamese in PROSE.items() if re.search(r"\{\d+\}", english)],
    key=lambda item: len(item[0].pattern), reverse=True,
)


@lru_cache(maxsize=2048)
def _translate_one(value: str) -> str:
    """Translate stored application prose, including reports created before Vietnamese support."""
    if value in PROSE:
        return PROSE[value]
    if value in LABELS:
        return LABELS[value]
    for pattern, translated, captures in _TEMPLATES:
        match = pattern.fullmatch(value)
        if match:
            def render(token: re.Match[str]) -> str:
                index = token[1]
                captured = match.group(f"p{index}")
                if captures.get(index) == "label":
                    return label(captured)
                if captures.get(index) == "prose":
                    return text(captured)
                return captured
            return re.sub(r"\{(\d+)\}", render, translated)
    return value


@lru_cache(maxsize=2048)
def text(value: str) -> str:
    translated = _translate_one(value)
    if translated != value:
        return translated
    # Older deterministic summaries join several independently generated sentences.
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", value)
    if len(sentences) < 2:
        return value
    result, index = [], 0
    while index < len(sentences):
        for count in range(min(3, len(sentences) - index), 0, -1):
            part = " ".join(sentences[index:index + count])
            translated = _translate_one(part)
            if translated != part:
                result.append(translated)
                index += count
                break
        else:
            result.append(sentences[index])
            index += 1
    return " ".join(result)


# Do not translate status tokens, IDs, model keys, uploaded cells, or column names.
_TEXT_FIELDS = {
    "title", "summary", "description", "detail", "message", "reason", "action", "actions",
    "issue", "cause", "evidence", "expected_impact", "notes", "note", "suggestion",
    "affected", "warnings", "limitations", "conclusion", "narrative", "executive_summary",
    "label_definition", "methodology", "definition", "growth_comparison", "count_basis",
    "data_source_label", "segmentation_reason", "churn_reason", "eoq_note", "forecast_model_notes",
    "safety_stock_formula", "reorder_point_formula", "eoq_formula", "coverage_formula", "steps_taken",
    "reasons", "suggestions", "assumptions", "task_label", "criterion", "target", "method", "features",
    "model_label", "source_agent", "stock_value_basis", "growth_basis", "order_count_basis",
    "bestseller_definition", "forecast_note", "explanation", "data_quality_findings", "human_checkpoint",
    "assumption",
}
_RAW_FIELDS = {"preview", "sample", "sample_values", "columns", "mapping", "raw", "rows"}


def payload(value: Any, field: str = "") -> Any:
    if isinstance(value, dict):
        return {key: item if key in _RAW_FIELDS else payload(item, key) for key, item in value.items()}
    if isinstance(value, list):
        return [payload(item, field) for item in value]
    if isinstance(value, str) and field in _TEXT_FIELDS:
        return text(value)
    return value
