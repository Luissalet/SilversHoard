"""A gym's map: the room you walk through to its leader, as in the games. A grid of tiles (floor, walls, water, boulders, plants, carpet,
grass), the entrance, the leader and the gym's trainers standing where the designer put them, each looking one way with a line of sight.

Walking in front of a trainer starts their battle; talking to the leader only works once every trainer of the gym is beaten, so a
challenge on a map still fights every stage, in the order you meet them (the leader always last). Saved in ``gyms.map_json``; ``{}``
means the gym has no map and its battles come one after another."""

from __future__ import annotations

import random
from collections import deque
from typing import Any, Optional

from .errors import SilverError

TILES = {".": "floor", "#": "wall", "~": "water", "o": "boulder", "*": "plant", "=": "carpet", ",": "grass"}
WALKABLE = set(".=,")
FACING = ("up", "down", "left", "right")
STEP = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
MIN_W, MIN_H, MAX_W, MAX_H = 7, 7, 32, 24


def _pos(v: Any, what: str, w: int, h: int) -> tuple[int, int]:
    try:
        x, y = int(v[0]), int(v[1])
    except (TypeError, ValueError, IndexError, KeyError):
        raise SilverError("invalid", f"map: {what} needs a position [x, y].") from None
    if not (0 <= x < w and 0 <= y < h):
        raise SilverError("invalid", f"map: {what} is outside the map.")
    return x, y


def clean(m: Any, trainer_ids: list[str]) -> dict[str, Any]:
    """The map as stored, or SilverError saying what is wrong. ``{}`` (or None) removes the map. Every trainer of the gym must stand
    somewhere, and the leader and every trainer must be reachable from the entrance (trainers block the way, like walls)."""
    if not m:
        return {}
    if not isinstance(m, dict):
        raise SilverError("invalid", "map is an object {w, h, tiles, start, leader, trainers}.")
    try:
        w, h = int(m.get("w")), int(m.get("h"))
    except (TypeError, ValueError):
        raise SilverError("invalid", "map: w and h are the size in tiles.") from None
    if not (MIN_W <= w <= MAX_W and MIN_H <= h <= MAX_H):
        raise SilverError("invalid", f"map: from {MIN_W}x{MIN_H} to {MAX_W}x{MAX_H} tiles.")
    tiles = m.get("tiles")
    if isinstance(tiles, list):
        tiles = "".join(str(r) for r in tiles)
    if not isinstance(tiles, str) or len(tiles) != w * h or any(c not in TILES for c in tiles):
        raise SilverError("invalid", f"map: tiles is {w * h} characters from {''.join(TILES)}.")
    grid = [list(tiles[y * w:(y + 1) * w]) for y in range(h)]
    start = _pos(m.get("start"), "the entrance", w, h)
    lv = m.get("leader") or {}
    leader = _pos([lv.get("x"), lv.get("y")] if isinstance(lv, dict) else lv, "the leader", w, h)
    leader_facing = (lv.get("facing") if isinstance(lv, dict) else None) or "down"
    if leader_facing not in FACING:
        raise SilverError("invalid", "map: facing is up, down, left or right.")
    taken = {start: "the entrance", leader: "the leader"}
    if start == leader:
        raise SilverError("invalid", "map: the entrance and the leader cannot share a tile.")
    placed: list[dict[str, Any]] = []
    for t in m.get("trainers") or []:
        if not isinstance(t, dict) or t.get("id") not in trainer_ids:
            raise SilverError("invalid", "map: every trainer on the map must be one of the gym's trainers.")
        if any(p["id"] == t["id"] for p in placed):
            raise SilverError("invalid", "map: each trainer stands in one place.")
        x, y = _pos([t.get("x"), t.get("y")], "a trainer", w, h)
        if (x, y) in taken:
            raise SilverError("invalid", f"map: a trainer stands on {taken[(x, y)]}.")
        facing = t.get("facing") or "down"
        if facing not in FACING:
            raise SilverError("invalid", "map: facing is up, down, left or right.")
        sight = max(1, min(int(t.get("sight") or 3), 8))
        taken[(x, y)] = "another trainer"
        placed.append({"id": t["id"], "x": x, "y": y, "facing": facing, "sight": sight})
    missing = [i for i in trainer_ids if i not in {p["id"] for p in placed}]
    if missing:
        raise SilverError("invalid", f"map: {len(missing)} of the gym's trainers are not on the map.", hint="Place every gym trainer, or remove them from the gym.")
    for (x, y), what in taken.items():
        if grid[y][x] not in WALKABLE:
            raise SilverError("invalid", f"map: {what} stands on a {TILES[grid[y][x]]} tile.")
    # who can be reached: walking over floor, trainers and the leader block the way; a person is reached from a tile next to them
    seen = {start}
    todo = deque([start])
    while todo:
        cx, cy = todo.popleft()
        for dx, dy in STEP.values():
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and grid[ny][nx] in WALKABLE and (nx, ny) not in taken:
                seen.add((nx, ny))
                todo.append((nx, ny))

    def reachable(p: tuple[int, int]) -> bool:
        return any((p[0] + dx, p[1] + dy) in seen for dx, dy in STEP.values())

    if not reachable(leader):
        raise SilverError("invalid", "map: there is no way from the entrance to the leader.")
    for p in placed:
        if not reachable((p["x"], p["y"])):
            raise SilverError("invalid", "map: a trainer cannot be reached from the entrance.")
    return {"w": w, "h": h, "tiles": tiles, "start": list(start), "leader": {"x": leader[0], "y": leader[1], "facing": leader_facing},
            "trainers": placed}


def generate(trainer_ids: list[str], seed: Optional[str] = None) -> dict[str, Any]:
    """A classic gym room for these trainers: walls around, the entrance at the bottom, the leader at the top on a carpet, the trainers
    along a winding way between rows of boulders and plants, each looking across it."""
    rng = random.Random(seed or ",".join(trainer_ids))
    n = len(trainer_ids)
    w = 13
    h = min(MAX_H - 1, max(11, 7 + 4 * ((n + 1) // 2)))
    grid = [["#" if x in (0, w - 1) or y in (0, h - 1) else "." for x in range(w)] for y in range(h)]
    for y in range(2, 5):
        for x in range(4, w - 4):
            grid[y][x] = "="
    leader = (w // 2, 2)
    start = (w // 2, h - 2)
    grid[h - 1][w // 2] = "."
    # walls with a gap that moves side to side, a trainer guarding each gap
    trainers = []
    y = h - 4
    side = rng.choice((0, 1))
    i = 0
    while y >= 6 and i < n:
        gap = 2 if side == 0 else w - 3
        for x in range(1, w - 1):
            if abs(x - gap) > 1:
                grid[y][x] = rng.choice("o*") if rng.random() < 0.6 else "#"
        tx = gap + (2 if side == 0 else -2)
        trainers.append({"id": trainer_ids[i], "x": tx, "y": y + 1, "facing": "left" if side == 0 else "right", "sight": 3})
        i += 1
        if i < n:
            trainers.append({"id": trainer_ids[i], "x": tx, "y": y - 1, "facing": "left" if side == 0 else "right", "sight": 3})
            i += 1
        side = 1 - side
        y -= 4
    # whoever is left stands beside the carpet, then against the side walls of each stretch between two walls
    extra = [(2, 3), (w - 3, 3), (2, 5), (w - 3, 5), (3, 2), (w - 4, 2)]
    for yy in range(h - 3, 5, -1):
        if (h - 4 - yy) % 4 in (1, 3):
            extra += [(1, yy), (w - 2, yy)]
    taken = {(t["x"], t["y"]) for t in trainers} | {leader, start}
    extra = [p for p in extra if p not in taken]
    while i < n and extra:
        x, yy = extra.pop(0)
        trainers.append({"id": trainer_ids[i], "x": x, "y": yy, "facing": "right" if x < w // 2 else "left", "sight": 2})
        i += 1
    for t in trainers:
        grid[t["y"]][t["x"]] = "."
    m = {"w": w, "h": h, "tiles": "".join("".join(r) for r in grid), "start": list(start),
         "leader": {"x": leader[0], "y": leader[1], "facing": "down"}, "trainers": trainers}
    return clean(m, trainer_ids)
