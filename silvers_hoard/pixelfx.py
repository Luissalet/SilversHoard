"""Which pixelfx effect a move, a type, a status, the weather or a terrain plays (the "pixelfx" animation style): read from
presets/pixelfx_map.json, which `node scripts/gen_pixelfx_map.mjs` writes from the table the battle screens use
(client/src/battle/pixelfx/mapping.js), plus the effects pinned to moves by hand (the effects explorer), kept in
data/pixelfx_pins.json. A pinned effect wins over the automatic mapping in every battle screen."""

from __future__ import annotations

import json
import re
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

MAP_PATH = Path(__file__).resolve().parent / "presets" / "pixelfx_map.json"
PINS_FILE = "pixelfx_pins.json"
ROLES = ("impact", "projectile", "beam", "area", "drop", "self")
_LOCK = threading.Lock()
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


@lru_cache(maxsize=1)
def _map() -> dict[str, Any]:
    return json.loads(MAP_PATH.read_text(encoding="utf-8"))


def _id(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _title(text: str) -> str:
    return str(text or "").strip().capitalize()


# ------------------------------------------------------------------ pins (the explorer's choices)
def _pins_path(data_dir: Path | str) -> Path:
    return Path(data_dir) / PINS_FILE


def load_pins(data_dir: Path | str | None) -> dict[str, dict[str, Any]]:
    """move id -> {effect, tint, color, role}; empty when nothing is pinned or the file is unreadable."""
    if not data_dir:
        return {}
    path = _pins_path(data_dir)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    pins = raw.get("pins", raw) if isinstance(raw, dict) else {}
    return {k: v for k, v in pins.items() if isinstance(v, dict) and v.get("effect")}


def _save_pins(data_dir: Path | str, pins: dict[str, dict[str, Any]]) -> None:
    path = _pins_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"pins": dict(sorted(pins.items()))}, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def _pin_rows(data_dir: Path | str | None) -> list[dict[str, Any]]:
    moves = _map()["moves"]
    out = []
    for move, pin in sorted(load_pins(data_dir).items()):
        row = moves.get(move, {})
        out.append({"move": move, "name": row.get("name", move), "type": row.get("type", ""), **pin,
                    "auto": {"effect": row.get("effect"), "role": row.get("role")} if row else None})
    return out


def pins_list(data_dir: Path | str | None) -> dict[str, Any]:
    rows = _pin_rows(data_dir)
    return {"pins": rows, "count": len(rows)}


def pin_set(data_dir: Path | str, move: str, effect: str, tint: bool = False, color: str = "", role: str = "") -> dict[str, Any]:
    """Pin an effect to a move by hand: it then plays instead of the automatic one (real time, turn-based screen, mass battles)."""
    data = _map()
    mid = _id(move)
    if mid not in data["moves"]:
        raise ValueError(f"unknown move {move!r}")
    eff = str(effect or "").strip()
    if eff not in data["catalog"]:
        raise ValueError(f"unknown effect {effect!r}: see pixelfx_effects")
    if color and not _HEX.match(color):
        raise ValueError("color must look like #rrggbb")
    if role and role not in ROLES:
        raise ValueError(f"role must be one of {', '.join(ROLES)}")
    pin = {"effect": eff, "tint": bool(tint or color)}
    if color:
        pin["color"] = color.lower()
    if role:
        pin["role"] = role
    with _LOCK:
        pins = load_pins(data_dir)
        pins[mid] = pin
        _save_pins(data_dir, pins)
    return {"ok": True, "move": mid, "name": data["moves"][mid]["name"], **pin, "pins": len(pins)}


def pin_remove(data_dir: Path | str, move: str) -> dict[str, Any]:
    """Drop a move's pinned effect: the automatic mapping plays again."""
    mid = _id(move)
    with _LOCK:
        pins = load_pins(data_dir)
        had = pins.pop(mid, None)
        if had is not None:
            _save_pins(data_dir, pins)
    return {"ok": True, "move": mid, "removed": had is not None, "pins": len(pins)}


# ------------------------------------------------------------------ lookups
def pixelfx_effects(category: str = "", query: str = "", limit: int = 0) -> dict[str, Any]:
    """The whole vendored catalog (244 effects of pixelfx, MIT): id, category, what it does, loop or one-shot, its options."""
    data = _map()
    cat = str(category or "").strip().lower()
    q = str(query or "").strip().lower()
    rows = []
    for eid, row in data["catalog"].items():
        if cat and row["category"] != cat:
            continue
        if q and q not in eid and q not in row["title"].lower() and q not in row["desc"].lower() and not any(q in t for t in row["tags"]):
            continue
        rows.append({"id": eid, **row, "used_by": data["usage"].get(eid, 0)})
    total = len(rows)
    if limit and limit > 0:
        rows = rows[:limit]
    return {"effects": rows, "count": total, "categories": data["categories"], "source": data["source"]}


def pixelfx_moves(data_dir: Path | str | None = None, type: str = "", source: str = "", effect: str = "", query: str = "",
                  limit: int = 0) -> dict[str, Any]:
    """Every move with the effect it plays now (pinned, its own, or its type's), filtered by type, source, effect or words."""
    data = _map()
    pins = load_pins(data_dir)
    want_type, want_src, want_fx, q = _title(type), str(source or "").strip().lower(), str(effect or "").strip(), _id(query)
    rows = []
    for mid, row in data["moves"].items():
        cur = dict(row, id=mid)
        pin = pins.get(mid)
        if pin:
            cur.update({"effect": pin["effect"], "tinted": bool(pin.get("tint")), "source": "pin", "pinned": True,
                        "auto_effect": row.get("effect")})
            if pin.get("color"):
                cur["color"] = pin["color"]
            if pin.get("role"):
                cur["role"] = pin["role"]
        if want_type and cur["type"] != want_type:
            continue
        if want_src and cur["source"] != want_src:
            continue
        if want_fx and cur["effect"] != want_fx and cur.get("hit", {}).get("effect") != want_fx:
            continue
        if q and q not in mid and q not in _id(cur["name"]):
            continue
        rows.append(cur)
    total = len(rows)
    if limit and limit > 0:
        rows = rows[:limit]
    return {"moves": rows, "count": total, "pinned": len(pins)}


def pixelfx_map(move: str = "", type: str = "", category: str = "", shape: str = "", status: str = "", weather: str = "",
                terrain: str = "", data_dir: Path | str | None = None) -> dict[str, Any]:
    """The effect for a move (a pinned one first), or for a type (+ category or shape), a status, a weather or a terrain; with nothing,
    the catalog summary."""
    data = _map()
    if status:
        plan = data["status"].get(_id(status))
        return {"status": _id(status), "plan": plan} if plan else {"error": f"no effect for the status {status!r}", "statuses": sorted(data["status"])}
    if weather:
        plan = data["weather"].get(_id(weather))
        return {"weather": _id(weather), "plan": plan} if plan else {"error": f"no effect for the weather {weather!r}", "weathers": sorted(data["weather"])}
    if terrain:
        plan = data["terrain"].get(_id(terrain))
        return {"terrain": _id(terrain), "plan": plan} if plan else {"error": f"no effect for the terrain {terrain!r}", "terrains": sorted(data["terrain"])}
    if move:
        mid = _id(move)
        row = data["moves"].get(mid)
        if not row:
            return {"error": f"unknown move {move!r}"}
        out = dict(row, id=mid)
        pin = load_pins(data_dir).get(mid)
        if pin:
            out["auto"] = {k: row.get(k) for k in ("effect", "tinted", "color", "role", "source") if k in row}
            out.update({"effect": pin["effect"], "tinted": bool(pin.get("tint")), "source": "pin", "pinned": True})
            if pin.get("color"):
                out["color"] = pin["color"]
            if pin.get("role"):
                out["role"] = pin["role"]
        return out
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
    pins = load_pins(data_dir)
    return {
        "source": data["source"],
        "effects": len(data["effects"]),
        "effect_ids": data["effects"],
        "coverage": data["coverage"],
        "types": sorted(data["types"]),
        "moves": len(data["moves"]),
        "own_moves": data["coverage"]["moves_own"],
        "pinned_moves": len(pins),
        "pins": [{"move": k, **v} for k, v in sorted(pins.items())],
        "statuses": sorted(data["status"]),
        "conditions": sorted(data["conditions"]),
        "weathers": sorted(data["weather"]),
        "terrains": sorted(data["terrain"]),
        "events": data["events"],
        "roles": data["roles"],
    }
