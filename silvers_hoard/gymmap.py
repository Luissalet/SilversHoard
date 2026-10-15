"""A gym's map: the room you walk through to its leader, as in the games. A grid of tiles (floor, walls, water, boulders, plants, carpet,
grass), the entrance, the leader and the gym's trainers standing where the designer put them, each looking one way with a line of sight.

Puzzles of the games can be painted in: ice you slide over until something stops you, arrow tiles that carry you the way they point,
and switches that open every door of the map once stepped on. Trainers may also turn on the spot, looking each way in turn. Outside the
gym itself, buildings (a Pokémon Center, a shop, houses, gym buildings) can stand on the map as solid props.

Walking in front of a trainer starts their battle; talking to the leader only works once every trainer of the gym is beaten, so a
challenge on a map still fights every stage, in the order you meet them (the leader always last). Saved in ``gyms.map_json``; ``{}``
means the gym has no map and its battles come one after another. The client (battle/overworld/Overworld.jsx) moves by the same rules
as ``_move`` here, which the save check uses to prove everybody can be reached."""

from __future__ import annotations

import random
from collections import deque
from typing import Any, Optional

from .errors import SilverError

TILES = {".": "floor", "#": "wall", "~": "water", "o": "boulder", "*": "plant", "=": "carpet", ",": "grass",
         "_": "ice", "^": "arrow up", "v": "arrow down", "<": "arrow left", ">": "arrow right", "s": "switch", "d": "door"}
WALKABLE = set(".=,")                          # where people (and the entrance) can stand
PASSABLE = WALKABLE | set("_^v<>s")            # where you can walk; doors too once a switch was stepped on
ARROWS = {"^": "up", "v": "down", "<": "left", ">": "right"}
FACING = ("up", "down", "left", "right")
STEP = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
MIN_W, MIN_H, MAX_W, MAX_H = 7, 7, 32, 24
LOOKS = ("colors", "pixel")   # how the map is drawn: shapes in the gym's type colours, or pixel-art tiles
# buildings that can stand on a map (solid), by kind: size in tiles (width, height)
PROPS = {"center": (6, 6), "shop": (5, 5), "gym": (7, 7), "gym_fire": (7, 7), "gym_water": (7, 7), "house": (5, 5), "house_purple": (5, 5),
         "bighouse": (7, 7), "bighouse_green": (7, 7)}
PUZZLES = ("", "ice", "arrows", "switches")
MAX_PROPS = 12


def _pos(v: Any, what: str, w: int, h: int) -> tuple[int, int]:
    try:
        x, y = int(v[0]), int(v[1])
    except (TypeError, ValueError, IndexError, KeyError):
        raise SilverError("invalid", f"map: {what} needs a position [x, y].") from None
    if not (0 <= x < w and 0 <= y < h):
        raise SilverError("invalid", f"map: {what} is outside the map.")
    return x, y


def _move(grid: list[list[str]], w: int, h: int, blocked: set[tuple[int, int]], x: int, y: int, d: str, opened: bool) -> Optional[tuple[int, int, bool]]:
    """One step from (x, y) towards d with the puzzles' rules: ice slides on until the next tile is not passable, an arrow tile carries
    you the way it points, a switch opens the doors. Returns where you stop and whether the doors are open, or None if you cannot move."""
    def passable(px: int, py: int, op: bool) -> bool:
        if not (0 <= px < w and 0 <= py < h) or (px, py) in blocked:
            return False
        c = grid[py][px]
        return c in PASSABLE or (c == "d" and op)

    dx, dy = STEP[d]
    nx, ny = x + dx, y + dy
    if not passable(nx, ny, opened):
        return None
    seen = set()
    while True:
        c = grid[ny][nx]
        if c == "s":
            opened = True
        if c in ARROWS:
            d = ARROWS[c]
        elif c != "_":
            return nx, ny, opened
        if (nx, ny, d) in seen:   # arrows that go round in a circle: you stop where the loop closes
            return nx, ny, opened
        seen.add((nx, ny, d))
        dx, dy = STEP[d]
        if not passable(nx + dx, ny + dy, opened):
            return nx, ny, opened
        nx, ny = nx + dx, ny + dy


def stops(m: dict[str, Any]) -> set[tuple[int, int]]:
    """Every tile where you can stand still, walking from the entrance (people and buildings block the way)."""
    w, h = m["w"], m["h"]
    grid = [list(m["tiles"][y * w:(y + 1) * w]) for y in range(h)]
    blocked = _blocked(m)
    start = (m["start"][0], m["start"][1], False)
    seen = {start}
    todo = deque([start])
    while todo:
        x, y, op = todo.popleft()
        for d in STEP:
            r = _move(grid, w, h, blocked, x, y, d, op)
            if r and r not in seen:
                seen.add(r)
                todo.append(r)
    return {(x, y) for x, y, _ in seen}


def _prop_cells(p: dict[str, Any]) -> list[tuple[int, int]]:
    pw, ph = PROPS[p["kind"]]
    return [(p["x"] + i, p["y"] + j) for i in range(pw) for j in range(ph)]


def _blocked(m: dict[str, Any]) -> set[tuple[int, int]]:
    out = {(m["leader"]["x"], m["leader"]["y"])} | {(t["x"], t["y"]) for t in m.get("trainers") or []}
    for p in m.get("props") or []:
        out |= set(_prop_cells(p))
    return out


def clean(m: Any, trainer_ids: list[str]) -> dict[str, Any]:
    """The map as stored, or SilverError saying what is wrong. ``{}`` (or None) removes the map. Every trainer of the gym must stand
    somewhere, and the leader and every trainer must be reachable from the entrance (trainers and buildings block the way, like walls;
    ice, arrows, switches and doors move you as in the games)."""
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
        one = {"id": t["id"], "x": x, "y": y, "facing": facing, "sight": sight}
        if t.get("turns"):
            one["turns"] = True
        placed.append(one)
    missing = [i for i in trainer_ids if i not in {p["id"] for p in placed}]
    if missing:
        raise SilverError("invalid", f"map: {len(missing)} of the gym's trainers are not on the map.", hint="Place every gym trainer, or remove them from the gym.")
    for (x, y), what in taken.items():
        if grid[y][x] not in WALKABLE:
            raise SilverError("invalid", f"map: {what} stands on a {TILES[grid[y][x]]} tile.")
    props: list[dict[str, Any]] = []
    raw_props = m.get("props") or []
    if not isinstance(raw_props, list) or len(raw_props) > MAX_PROPS:
        raise SilverError("invalid", f"map: props is a list of up to {MAX_PROPS} buildings {{kind, x, y}}.")
    cells: dict[tuple[int, int], str] = {}
    for p in raw_props:
        if not isinstance(p, dict) or p.get("kind") not in PROPS:
            raise SilverError("invalid", f"map: a building's kind is one of {', '.join(PROPS)}.")
        x, y = _pos([p.get("x"), p.get("y")], "a building", w, h)
        pw, ph = PROPS[p["kind"]]
        if x + pw > w or y + ph > h:
            raise SilverError("invalid", "map: a building does not fit inside the map.")
        one = {"kind": p["kind"], "x": x, "y": y}
        for c in _prop_cells(one):
            if c in taken:
                raise SilverError("invalid", f"map: a building stands on {taken[c]}.")
            if c in cells:
                raise SilverError("invalid", "map: two buildings overlap.")
            cells[c] = p["kind"]
        props.append(one)
    if sum(c == "d" for c in tiles) and not sum(c == "s" for c in tiles):
        raise SilverError("invalid", "map: a door needs a switch somewhere to open it.")
    out = {"w": w, "h": h, "tiles": tiles, "start": list(start), "leader": {"x": leader[0], "y": leader[1], "facing": leader_facing},
           "trainers": placed}
    if props:
        out["props"] = props
    # who can be reached: you stop on a tile next to them (moving by the puzzles' rules; people and buildings block the way)
    seen = stops(out)

    def reachable(p: tuple[int, int]) -> bool:
        return any((p[0] + dx, p[1] + dy) in seen for dx, dy in STEP.values())

    if not reachable(leader):
        raise SilverError("invalid", "map: there is no way from the entrance to the leader.")
    for p in placed:
        if not reachable((p["x"], p["y"])):
            raise SilverError("invalid", "map: a trainer cannot be reached from the entrance.")
    look = m.get("look") or "colors"
    if look not in LOOKS:
        raise SilverError("invalid", "map: look is colors (shapes in the gym's type colours) or pixel (pixel-art tiles).")
    if look != "colors":
        out["look"] = look
    return out


def generate(trainer_ids: list[str], seed: Optional[str] = None, puzzle: str = "") -> dict[str, Any]:
    """A classic gym room for these trainers: walls around, the entrance at the bottom, the leader at the top on a carpet, the trainers
    along a winding way between rows of boulders and plants, each looking across it. puzzle: "" (none), "ice" (the way is frozen, you
    slide), "arrows" (arrow tiles push you along) or "switches" (doors close the way until you step on their switch)."""
    if puzzle not in PUZZLES:
        raise SilverError("invalid", f"puzzle is one of: {', '.join(p or 'none' for p in PUZZLES)}.")
    base = _classic(trainer_ids, seed)
    if not puzzle:
        return base
    rng = random.Random(f"{seed or ','.join(trainer_ids)}:{puzzle}")
    for attempt in range(40):
        share = max(0.25, 0.75 - attempt * 0.02)
        m = _with_puzzle(base, puzzle, rng, share)
        try:
            return clean(m, trainer_ids)
        except SilverError:
            continue
    return base


def _classic(trainer_ids: list[str], seed: Optional[str]) -> dict[str, Any]:
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


def _with_puzzle(base: dict[str, Any], puzzle: str, rng: random.Random, share: float) -> dict[str, Any]:
    w, h = base["w"], base["h"]
    grid = [list(base["tiles"][y * w:(y + 1) * w]) for y in range(h)]
    people = {(base["start"][0], base["start"][1]), (base["leader"]["x"], base["leader"]["y"])} | {(t["x"], t["y"]) for t in base["trainers"]}
    near = {(x + dx, y + dy) for x, y in people for dx, dy in [(0, 0)] + list(STEP.values())}
    floor = [(x, y) for y in range(5, h - 1) for x in range(1, w - 1) if grid[y][x] == "." and (x, y) not in near]
    if puzzle == "ice":
        for x, y in floor:
            if rng.random() < share:
                grid[y][x] = "_"
    elif puzzle == "arrows":
        for x, y in floor:
            if rng.random() < share * 0.5:
                grid[y][x] = rng.choice("^<>")
    elif puzzle == "switches":
        # a door in the top wall's gap (just before the carpet) and a switch tucked away lower down
        rows = [y for y in range(5, h - 1) if sum(grid[y][x] in "#o*" for x in range(1, w - 1)) >= w - 5]
        if not rows:
            return base
        top = min(rows)
        gap = [x for x in range(1, w - 1) if grid[top][x] in WALKABLE]
        for x in gap:
            grid[top][x] = "d"
        lower = [(x, y) for x, y in floor if y > top + 1]
        if not lower:
            return base
        sx, sy = rng.choice(lower)
        grid[sy][sx] = "s"
    return {**base, "tiles": "".join("".join(r) for r in grid)}
