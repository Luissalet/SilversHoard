"""One error type for every expected failure, so the API, the agent tools and the UI report it the same way."""

from __future__ import annotations

from typing import Any

from .hoard_link.agentkit import AppError


class SilverError(AppError):
    """An expected, explainable failure with a stable ``code``, a message and an actionable ``hint``."""

    STATUS = {
        "not_found": 404,
        "forbidden": 403,
        "invalid": 400,
        "invalid_team": 400,
        "invalid_format": 400,
        "invalid_choice": 400,
        "empty_team": 400,
        "unknown_species": 400,
        "not_your_turn": 409,
        "ended": 409,
        "conflict": 409,
        "busy": 409,
        "confirm_required": 400,
        "engine_unavailable": 503,
        "unavailable": 503,
        "too_large": 413,
        "timeout": 504,
        "cancelled": 409,
        "match_not_loaded": 409,
    }

    def __init__(self, code: str, message: str, hint: str = "", *, status: int | None = None, **details: Any):
        super().__init__(code, message, hint=hint, status=status or self.STATUS.get(code, 400), details=details)

    def to_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {**self.details, "error": self.message, "code": self.code}
        if self.hint:
            body["hint"] = self.hint
        return body
