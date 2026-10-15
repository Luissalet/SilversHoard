"""Arenas of the real-time mode drawn by hand in the arena designer: up to 16 round rocks placed on the 28 x 17 m field and the look
of its ground. A battle asks for one as ``rt_arena="custom:<id>"``; the battle keeps the arena itself (name, floor, rocks) in its
replay, so editing or deleting the arena later never changes a battle already played. A gym can fight on one, and it travels with the
gym when it is exported (file, code or playable page).

The engine (engine/src/realtime/sim.mjs customRocks) applies the same limits again, so a battle replays the same everywhere."""

from __future__ import annotations

import json
import math
import re
from typing import TYPE_CHECKING, Any, Optional, Union

from .errors import SilverError

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services

ARENA_W, ARENA_H = 28.0, 17.0
HOME = ((5.0, 8.5), (23.0, 8.5))        # where each trainer's Pokémon comes in (sim.mjs HOME)
FLOORS = ("grass", "sand", "ice", "cave", "indoor", "water", "pyre", "summit", "meteor", "champion", "castle")
MAX_ROCKS = 16
R_MIN, R_MAX = 0.4, 3.0
CUSTOM = re.compile(r"^custom:([A-Za-z0-9_]{1,80})$")


def _num(v: Any) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise SilverError("invalid", "Each rock is {x, y, r} in metres.") from None
    if not math.isfinite(x):
        raise SilverError("invalid", "Each rock is {x, y, r} in metres.")
    return x


def clean_rocks(rocks: Any, *, mirror: bool = False) -> list[dict[str, float]]:
    """The rocks as the battle will use them, or SilverError naming what is wrong: inside the field, 0.4-3 m of radius, off the
    spots the Pokémon come in on, 16 at most. ``mirror`` adds the left-right copy of each rock (one on the centre line stays one)."""
    if not isinstance(rocks, list):
        raise SilverError("invalid", "rocks is a list of {x, y, r}.")
    out: list[dict[str, float]] = []
    for i, rk in enumerate(rocks):
        if not isinstance(rk, dict):
            raise SilverError("invalid", "rocks is a list of {x, y, r}.")
        x, y, r = _num(rk.get("x")), _num(rk.get("y")), _num(rk.get("r"))
        if not R_MIN <= r <= R_MAX:
            raise SilverError("invalid", f"Rock {i + 1}: its radius goes from {R_MIN} to {R_MAX} m.")
        if not (r <= x <= ARENA_W - r and r <= y <= ARENA_H - r):
            raise SilverError("invalid", f"Rock {i + 1} goes past the edge of the field (28 x 17 m).")
        pts = [(x, y)] + ([(ARENA_W - x, y)] if mirror and abs(ARENA_W / 2 - x) > 0.05 else [])
        for px, py in pts:
            if any(math.hypot(px - hx, py - hy) < r + 1.2 for hx, hy in HOME):
                raise SilverError("invalid", f"Rock {i + 1} covers the spot where a Pokémon comes in; leave 1.2 m around it.")
            out.append({"x": round(px, 3), "y": round(py, 3), "r": round(r, 3)})
    if len(out) > MAX_ROCKS:
        raise SilverError("invalid", f"At most {MAX_ROCKS} rocks.")
    return out


def _key(arena: dict[str, Any]) -> str:
    return json.dumps({"floor": arena.get("floor") or "grass", "rocks": arena.get("rocks") or []}, sort_keys=True)


def same(a: Any, b: Any) -> bool:
    """Whether two custom arenas are the same field (name aside)."""
    return isinstance(a, dict) and isinstance(b, dict) and _key(a) == _key(b)


class Arenas:
    def __init__(self, svc: "Services"):
        self.svc = svc

    def view(self, a: dict[str, Any]) -> dict[str, Any]:
        gyms = [g["name"] for g in self.svc.store.gyms() if g.get("rt_arena") == f"custom:{a['id']}"]
        return {**a, "value": f"custom:{a['id']}", "used_by": gyms}

    def list(self) -> list[dict[str, Any]]:
        return [self.view(a) for a in self.svc.store.arenas()]

    def get(self, id_: str) -> dict[str, Any]:
        return self.view(self.svc.store.arena(id_))

    def save(self, id_: str = "", *, name: Optional[str] = None, floor: Optional[str] = None, rocks: Any = None, mirror: bool = False) -> dict[str, Any]:
        values: dict[str, Any] = {}
        if name is not None:
            values["name"] = str(name).strip()[:60]
            if not values["name"]:
                raise SilverError("invalid", "The arena needs a name.")
        if floor is not None:
            if floor not in FLOORS:
                raise SilverError("invalid", f"floor is one of {', '.join(FLOORS)}")
            values["floor"] = floor
        if rocks is not None:
            values["rocks"] = clean_rocks(rocks, mirror=mirror)
        if id_:
            self.svc.store.arena(id_)
            self.svc.store.update_arena(id_, values)
        else:
            if not values.get("name"):
                raise SilverError("invalid", "The arena needs a name.")
            values.setdefault("owner", self.svc.settings["player_name"])
            id_ = self.svc.store.add_arena(values)
            self.svc.emit("arena.created", {"id": id_, "name": values["name"]})
        return self.get(id_)

    def delete(self, ids: list[str]) -> dict[str, Any]:
        return {"deleted": self.svc.store.delete_arenas(ids)}

    # ------------------------------------------------------------ battles
    def spec(self, value: Union[str, dict[str, Any], None]) -> Union[str, dict[str, Any]]:
        """What a battle's spec carries for an arena choice: "open", "rocks", or the custom arena itself."""
        if isinstance(value, dict):
            return {"name": str(value.get("name") or "")[:60], "floor": value.get("floor") if value.get("floor") in FLOORS else "grass",
                    "rocks": clean_rocks(value.get("rocks") or [])}
        v = str(value or "rocks")
        m = CUSTOM.match(v)
        if not m:
            return v if v in ("open", "rocks") else "rocks"
        try:
            a = self.svc.store.arena(m.group(1))
        except SilverError:
            raise SilverError("not_found", "That arena no longer exists.", hint="arenas_list shows them.") from None
        return {"id": a["id"], "name": a["name"], "floor": a["floor"], "rocks": a["rocks"]}

    # ------------------------------------------------------------ sharing
    def export_value(self, value: str) -> Union[str, dict[str, Any]]:
        """A gym's arena as it travels: "open"/"rocks"/"" as they are, a custom one as the field itself."""
        if CUSTOM.match(value or ""):
            try:
                a = self.spec(value)
            except SilverError:
                return ""
            return {k: a[k] for k in ("name", "floor", "rocks")}
        return value or ""

    def import_value(self, value: Any) -> str:
        """The arena a gym brings: kept as it is, or saved as an arena here (the same field already here is reused)."""
        if isinstance(value, str):
            return value if value in ("", "open", "rocks") else ""
        if not isinstance(value, dict):
            return ""
        a = self.spec(value)
        for mine in self.svc.store.arenas():
            if same(mine, a):
                return f"custom:{mine['id']}"
        id_ = self.svc.store.add_arena({"name": a["name"] or "Arena", "floor": a["floor"], "rocks": a["rocks"], "origin": "import"})
        return f"custom:{id_}"
