"""Which pixelfx effect a move, a type or a status plays (the "pixelfx" animation style): read from presets/pixelfx_map.json, which
`node scripts/gen_pixelfx_map.mjs` writes from the table the battle screens use (client/src/battle/pixelfx/mapping.js)."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

MAP_PATH = Path(__file__).resolve().parent / "presets" / "pixelfx_map.json"


@lru_cache(maxsize=1)
def _map() -> dict[str, Any]:
    return json.loads(MAP_PATH.read_text(encoding="utf-8"))


def _id(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _title(text: str) -> str:
    return str(text or "").strip().capitalize()


def pixelfx_map(move: str = "", type: str = "", category: str = "", shape: str = "", status: str = "") -> dict[str, Any]:
    """The effect for a move, or for a type (+ category or shape), or for a status; with nothing, the whole catalog summary."""
    data = _map()
    if status:
        plan = data["status"].get(_id(status))
        return {"status": _id(status), "plan": plan} if plan else {"error": f"no effect for the status {status!r}", "statuses": sorted(data["status"])}
    if move:
        row = data["moves"].get(_id(move))
        return dict(row, id=_id(move)) if row else {"error": f"unknown move {move!r}"}
    if type:
        t = data["types"].get(_title(type))
        if not t:
            return {"error": f"unknown type {type!r}", "types": sorted(data["types"])}
        if shape:
            plan = t["by_shape"].get(_id(shape))
            return {"type": _title(type), "shape": _id(shape), "plan": plan} if plan else {"error": f"unknown shape {shape!r}", "shapes": sorted(t["by_shape"])}
        if category:
            plan = t["by_category"].get(_title(category))
            return {"type": _title(type), "category": _title(category), "plan": plan} if plan else {"error": f"unknown category {category!r}", "categories": sorted(t["by_category"])}
        return {"type": _title(type), "color": t["color"], "hit": t["hit"], "by_category": t["by_category"], "by_shape": t["by_shape"]}
    return {
        "source": data["source"],
        "effects": len(data["effects"]),
        "effect_ids": data["effects"],
        "types": sorted(data["types"]),
        "moves": len(data["moves"]),
        "statuses": sorted(data["status"]),
        "events": data["events"],
        "roles": data["roles"],
    }
