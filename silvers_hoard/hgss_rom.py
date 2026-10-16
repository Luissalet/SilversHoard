"""Pokémon HeartGold and SoulSilver cartridge data: the trainers as the game builds them (presets/hgss_rom.json.gz, made by
scripts/build_hgss_rom.py from the pret/pokeheartgold decompilation).

What the app takes from it:
  * the exact sets of the 78 HGSS teams the characters already had (nature, IVs, ability, gender, item, moves, in the game's own
    order): ``merge`` puts them over the Bulbapedia sets when the characters load, marks those teams as cartridge data, and adds the
    cartridge trainers that had no character yet (the Kimono Girls, Eusine, Elder Li);
  * the cartridge's AI flags as a Silver AI level and style (``ai_for``);
  * what the trainers say, in castellano and English, under the dialogue keys (``lines``);
  * the 16 gyms with their gym trainers, and each gym's room or rooms drawn as a gym map (``gym_map``) that ``gymmap.clean`` accepts.

Nothing here touches the database: services.py asks for rows and maps and stores them."""

from __future__ import annotations

import copy
import gzip
import json
import random
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from . import gymmap
from .errors import SilverError

PRESET = Path(__file__).resolve().parent / "presets" / "hgss_rom.json.gz"
CANON_PREFIX = "rom:hgss:"   # canon_key of a gym trainer made from the cartridge: rom:hgss:<trainer index>

# ---------------------------------------------------------------------------------------------------------------- the AI
# A cartridge trainer carries a bit mask: each set bit runs one of the battle AI's scripts (trainer_ai.c: bit 0 is the basic script
# and bit 7 the doubles strategy, which the game sets by itself in double battles; the order of the others is the one every
# Generation IV game shares). The decompilation names only bits 0 and 7, so the rest of the names come from that shared table.
AI_BITS = ("basic", "evaluate attack", "expert", "setup first turn", "risky", "prioritize damage", "baton pass", "tag strategy",
           "check HP", "weather", "harassment")
_BASIC, _EVALUATE, _EXPERT, _SETUP, _RISKY, _PRIORITIZE, _BATON, _TAG, _HP, _WEATHER, _HARASS = (1 << i for i in range(11))
# The level follows the scripts that decide how well a move is chosen:
#   no script ........................ random   (the game picks any move)
#   basic only ....................... easy     (avoids moves that do nothing, no more)
#   evaluate attack or prioritize damage normal  (looks at damage)
#   expert (with or without the rest)  hard     (weighs the whole turn)
# The extra scripts change how it plays, so they pick the style:
#   setup first turn / baton pass .... setup       risky / prioritize damage ... aggressive
#   check HP ......................... defensive   harassment ................. stall
#   weather, tag strategy ............ balanced (what the script does is already in the moves it has)
# A trainer with several extras takes the first in that order. Silver's expert, master and neural stay the player's to choose.


def ai_for(flags: int) -> dict[str, Any]:
    """{"level", "style", "scripts"} for a cartridge AI bit mask: the Silver AI that plays like those scripts."""
    flags = int(flags or 0)
    scripts = [name for i, name in enumerate(AI_BITS) if flags & (1 << i)]
    if flags & _EXPERT:
        level = "hard"
    elif flags & (_EVALUATE | _PRIORITIZE):
        level = "normal"
    elif flags & _BASIC:
        level = "easy"
    else:
        level = "random"
    if flags & (_SETUP | _BATON):
        style = "setup"
    elif flags & (_RISKY | _PRIORITIZE):
        style = "aggressive"
    elif flags & _HP:
        style = "defensive"
    elif flags & _HARASS:
        style = "stall"
    else:
        style = "balanced"
    return {"level": level, "style": style, "scripts": scripts}


# ----------------------------------------------------------------------------------------------------------------- the data
@lru_cache(maxsize=1)
def data() -> dict[str, Any]:
    if not PRESET.exists():
        return {"schema": 1, "source": "", "variants": {}, "characters": [], "trainers": {}, "gyms": [], "lines": {}, "ai_bits": list(AI_BITS)}
    return json.loads(gzip.decompress(PRESET.read_bytes()).decode("utf-8"))


def _mark(v: dict[str, Any]) -> dict[str, Any]:
    """A cartridge team of a character that had none: with the AI its flags mean."""
    v.update(ai=ai_for(v["flags"]), ai_flags=v["flags"], cartridge=True)
    return v


def merge(chars: dict[str, Any]) -> None:
    """Over the loaded characters (``chars`` holds ``characters`` and ``by_key``): the cartridge's sets for every HGSS team that has
    them, each marked ``cartridge`` with its ``rom`` index, ``ai_flags``, ``ai`` (level and style) and ``double``; and the cartridge
    trainers that had no character, as new characters."""
    rom = data()
    for vkey, e in rom["variants"].items():
        ck, vid = vkey.split(":", 1)
        c = chars["by_key"].get(ck)
        v = next((x for x in c["variants"] if x["id"] == vid), None) if c else None
        if not v:
            continue
        v["sets"] = copy.deepcopy(e["sets"])
        v.update(rom=e["rom"], ai_flags=e["flags"], ai=ai_for(e["flags"]), cartridge=True)
        if e.get("double"):
            v["double"] = True
    for c in rom["characters"]:
        known = chars["by_key"].get(c["key"])
        if known:   # the character exists (another source, or this was merged already): its cartridge team joins it once
            have = {v["id"] for v in known["variants"]}
            known["variants"] = [*known["variants"], *[_mark(copy.deepcopy(v)) for v in c["variants"] if v["id"] not in have]]
            continue
        new = copy.deepcopy(c)
        new["variants"] = [_mark(v) for v in new["variants"]]
        chars["characters"].append(new)
        chars["by_key"][new["key"]] = new
    if rom.get("source") and rom["source"] not in chars.get("source", ""):
        chars["source"] = f"{chars.get('source', '')} {rom['source']}".strip()


def lines(index: int, lang: str = "es") -> dict[str, str]:
    """What the cartridge trainer says, under Silver's dialogue keys (intro, after, lose, win, last, last_low): castellano, or English
    when lang is en. Empty when the game gives that trainer no lines."""
    l = data()["lines"].get(str(index)) or {}
    return dict(l.get("en" if lang == "en" else "es") or {})


CREDIT = "Equipo del cartucho (descompilación pret/pokeheartgold); sprite de Pokémon Showdown."   # also marks a trainer as made from the cartridge


def note(v: dict[str, Any]) -> str:
    """The line of a trainer's notes that says its team is the cartridge's: the trainer's number and the AI scripts it runs."""
    scripts = ", ".join((v.get("ai") or {}).get("scripts") or []) or "ninguno"
    return f"Datos del cartucho: equipo exacto, IA y frases como los construye el juego (entrenador {v.get('rom')}; scripts de IA: {scripts})."


def gym_note(index: int, row: dict[str, Any]) -> str:
    """The notes of a gym trainer made from the cartridge."""
    scripts = ", ".join(row.get("ai_scripts") or []) or "ninguno"
    return f"Entrenador de gimnasio de Oro HeartGold y Plata SoulSilver (cartucho, n.º {index}); scripts de IA: {scripts}.\n{CREDIT}"


# ------------------------------------------------------------------------------------------------------------------ gyms
def gym(leader_key: str) -> Optional[dict[str, Any]]:
    """The cartridge gym of this leader (a character key like falkner), or None."""
    return next((g for g in data()["gyms"] if g["leader"] == (leader_key or "").lower()), None)


def gym_trainer_indexes(g: dict[str, Any]) -> list[int]:
    """The gym's trainers in the order you meet them: room by room from the entrance, the nearest to each door first."""
    return [p["rom"] for room in g["rooms"] for p in room["trainers"]]


def gym_of(index: int) -> Optional[str]:
    """The leader's key (falkner, janine...) of the cartridge gym this trainer stands in, or None."""
    return next((g["leader"] for g in data()["gyms"] if index in gym_trainer_indexes(g)), None)


def trainer_row(index: int, lang: str = "es") -> dict[str, Any]:
    """The pieces of a gym trainer made from the cartridge: Spanish (or English) class and name, sprite, exact team, the AI its flags
    mean, and its lines. services.py adds the gym it stands in and stores it."""
    t = data()["trainers"].get(str(index))
    if not t:
        raise SilverError("not_found", f"No cartridge gym trainer {index}", hint="hgss_rom_get lists them by gym.")
    es = lang != "en"
    cls = (t["class_es"] if es else t["class"]).strip()
    name = (t.get("name_es") or t["name"]) if es else t["name"]
    ai = ai_for(t["flags"])
    return {"name": f"{cls} {name}"[:60], "class": cls, "sprite": t["sprite"], "team": copy.deepcopy(t["sets"]), "ai_level": ai["level"], "ai_style": ai["style"],
            "ai_scripts": ai["scripts"], "dialogue": lines(index, lang), "double": bool(t.get("double")), "flags": t["flags"]}


# --- the gym map -----------------------------------------------------------------------------------------------------------
MAX_GAP = 8                                  # a stretch of empty floor longer than this is drawn this long
FACING = ("up", "down", "left", "right")     # the cartridge's 0 north, 1 south, 2 west, 3 east


def _squash(values: list[int], cap: int) -> dict[int, int]:
    """The distinct coordinates in order, as 0, 1, 2... with every gap between two of them between 1 and ``cap`` tiles."""
    out: dict[int, int] = {}
    pos, prev = 0, None
    for v in sorted(set(values)):
        if prev is not None:
            pos += max(1, min(v - prev, cap))
        out[v] = pos
        prev = v
    return out


def _room_points(room: dict[str, Any]) -> list[tuple[int, int]]:
    pts = [tuple(room["entrance"])]
    if room.get("up"):
        pts.append(tuple(room["up"]))
    if room.get("leader"):
        pts.append((room["leader"]["x"], room["leader"]["z"]))
    pts += [(p["x"], p["z"]) for p in room["trainers"]]
    pts += [(d["x"], d["z"]) for d in room.get("decor", [])]
    return pts


def _layout(rooms: list[dict[str, Any]]) -> tuple[list[dict[int, int]], list[dict[int, int]], int]:
    """How each room's columns and rows are squashed so the gym fits gymmap's size limit: the largest gap cap that fits, for width
    (the widest room) and for height (the rooms stacked, entrance room at the bottom)."""
    pts = [_room_points(r) for r in rooms]
    cap_x = next((k for k in range(MAX_GAP, 0, -1)
                  if max(max(_squash([x for x, _ in p], k).values()) for p in pts) + 1 + 2 + 2 <= gymmap.MAX_W), 1)
    rows = lambda k: sum(max(_squash([z for _, z in p], k).values()) + 1 for p in pts) + (len(rooms) - 1) + 1 + 2   # + top margin + borders
    cap_z = next((k for k in range(MAX_GAP, 0, -1) if rows(k) <= gymmap.MAX_H), 1)
    return [_squash([x for x, _ in p], cap_x) for p in pts], [_squash([z for _, z in p], cap_z) for p in pts], cap_z


def _draw(g: dict[str, Any], ids: dict[int, str], *, decor: bool, ice: float) -> dict[str, Any]:
    rooms = g["rooms"]
    xs, zs, _ = _layout(rooms)
    span_x = [max(m.values()) + 1 for m in xs]
    span_z = [max(m.values()) + 1 for m in zs]
    inner_w = max(span_x) + 2
    w = max(gymmap.MIN_W, inner_w + 2)
    lx = 1 + (w - 2 - inner_w) // 2   # first floor column of every room: the rooms stand side by side on the left of the common width
    n = len(rooms)
    h = 1 + 1 + sum(span_z) + (n - 1) + 1   # border, a row behind the leader, the rooms and the walls between them, border
    top_margin = 1 + max(0, gymmap.MIN_H - h)
    h += top_margin - 1
    grid = [["#"] * w for _ in range(h)]
    y_of = [0] * n   # the first row of each room's tiles; the last room (the leader's) is on top, the entrance room at the bottom
    y = 1 + top_margin
    for i in range(n - 1, -1, -1):
        y_of[i] = y
        for yy in range(1 if i == n - 1 else y, y + span_z[i]):
            for xx in range(lx, lx + span_x[i] + 2):
                grid[yy][xx] = "."
        y += span_z[i] + 1   # one wall row between two rooms
    pos = lambda i, x, z: (lx + 1 + xs[i][x], y_of[i] + zs[i][z])
    # doors between rooms
    doors = []
    for i in range(len(rooms) - 1):
        ex, _ = pos(i + 1, *rooms[i + 1]["entrance"])
        col = min(max(ex, lx + 1), lx + min(span_x[i], span_x[i + 1]))
        sep = y_of[i + 1] + span_z[i + 1]
        grid[sep][col] = "."
        doors.append((col, sep))
    start = pos(0, *rooms[0]["entrance"])
    grid[h - 1][start[0]] = "."
    leader_i = next(i for i, r in enumerate(rooms) if r.get("leader"))
    lead = rooms[leader_i]["leader"]
    lp = pos(leader_i, lead["x"], lead["z"])
    people = {start, lp}
    trainers = []
    for i, r in enumerate(rooms):
        for p in r["trainers"]:
            tx, ty = pos(i, p["x"], p["z"])
            people.add((tx, ty))
            t = {"id": ids[p["rom"]], "x": tx, "y": ty, "facing": FACING[p["facing"]], "sight": 1 if p.get("talk") else max(1, min(int(p["sight"]), 8))}
            if p.get("turns"):
                t["turns"] = True
            trainers.append(t)
    # the leader stands on a carpet three tiles wide and two deep
    for dx in (-1, 0, 1):
        for dy in (0, 1):
            cx, cy = lp[0] + dx, lp[1] + dy
            if 0 < cx < w - 1 and 0 < cy < h - 1 and grid[cy][cx] == "." and (cx, cy) not in people:
                grid[cy][cx] = "="
    if decor:
        for i, r in enumerate(rooms):
            for d in r.get("decor", []):
                cx, cy = pos(i, d["x"], d["z"])
                if grid[cy][cx] == "." and (cx, cy) not in people:
                    grid[cy][cx] = "*" if d["kind"] == "tree" else "o"
    if ice:
        rng = random.Random(g["leader"])
        near = {(px + dx, py + dy) for px, py in [*people, *doors] for dx in (-1, 0, 1) for dy in (-1, 0, 1)}   # you must be able to stop by everybody and every door
        for yy in range(1, h - 1):
            for xx in range(1, w - 1):
                if grid[yy][xx] == "." and (xx, yy) not in near and rng.random() < ice:
                    grid[yy][xx] = "_"
    return {"w": w, "h": h, "tiles": "".join("".join(r) for r in grid), "start": list(start),
            "leader": {"x": lp[0], "y": lp[1], "facing": FACING[lead["facing"]]}, "trainers": trainers}


def gym_map(leader_key: str, ids: dict[int, str]) -> dict[str, Any]:
    """The gym's rooms as one gym map (gymmap format) for the trainers ``ids`` (cartridge index -> trainer id): the rooms stacked from the
    entrance room up to the leader's, everybody on their tile (squashed to gymmap's size limit, empty stretches shortened), facing
    and sight as the game has them, a carpet at the leader, trees and ice blocks where the game puts them. A gym whose floor is ice
    (Mahogany) gets sliding ice when the result still passes ``gymmap.clean``; otherwise the plainest map that does."""
    g = gym(leader_key)
    if not g:
        raise SilverError("not_found", f"No cartridge gym for {leader_key}", hint="hgss_rom_get lists the gyms.")
    wanted = gym_trainer_indexes(g)
    ids = {int(k): v for k, v in ids.items()}
    if any(i not in ids for i in wanted):
        raise SilverError("invalid", "A trainer of the gym has no id.")
    has_ice = any(d["kind"] == "ice" for r in g["rooms"] for d in r.get("decor", []))
    tries = [dict(decor=True, ice=s) for s in ((1.0, 0.8, 0.6, 0.4) if has_ice else ())] + [dict(decor=True, ice=0), dict(decor=False, ice=0)]
    last: Optional[SilverError] = None
    for kw in tries:
        try:
            return gymmap.clean(_draw(g, ids, **kw), [ids[i] for i in wanted])
        except SilverError as e:
            last = e
    raise SilverError("invalid", f"The map of the {g['gym']} does not pass the checks: {last.message if last else ''}")


# ------------------------------------------------------------------------------------------------------------- for tools
def info(gym_key: str = "", index: int = 0) -> dict[str, Any]:
    """The cartridge data an agent can read: the source and counts, the AI bits, the gyms (rooms, trainers with class, team and
    AI) and, with ``index``, one cartridge trainer of those the app can make (its team, AI and lines)."""
    d = data()
    q = (gym_key or "").strip().lower()

    def trainer(i: int) -> dict[str, Any]:
        t = d["trainers"][str(i)]
        return {"index": i, "name": t["name"], "name_es": t.get("name_es", ""), "class": t["class"], "class_es": t["class_es"], "sprite": t["sprite"],
                "species": [f"{s['species']} L{s['level']}" for s in t["sets"]], "ai_flags": t["flags"], "ai": ai_for(t["flags"]), **({"double": True} if t.get("double") else {})}

    gyms = []
    for g in d["gyms"]:
        if q and q not in g["leader"] and q not in g["city"].lower() and q not in g["gym"].lower():
            continue
        gyms.append({"leader": g["leader"], "city": g["city"], "gym": g["gym"], "quiz": bool(g.get("quiz")),
                     "rooms": [{"map": r["map"], "has_leader": bool(r.get("leader")), "trainers": [trainer(p["rom"]) for p in r["trainers"]]} for r in g["rooms"]]})
    out: dict[str, Any] = {"source": d.get("source", ""), "teams": len(d["variants"]), "new_characters": [c["key"] for c in d["characters"]],
                           "gym_trainers": len(d["trainers"]), "ai_bits": [{"bit": i, "script": n} for i, n in enumerate(AI_BITS)],
                           "ai_rules": "no script: random; basic only: easy; evaluate attack or prioritize damage: normal; expert: hard. "
                                       "setup first turn or baton pass: style setup; risky or prioritize damage: aggressive; check HP: defensive; harassment: stall.",
                           "gyms": gyms}
    if index:
        t = next((v for v in d["variants"].values() if v["rom"] == index), None) or d["trainers"].get(str(index))
        if not t:
            raise SilverError("not_found", f"No cartridge trainer {index} in the app's data", hint="Gym trainers are listed under gyms; teams with character_get.")
        flags = t.get("flags", 0)
        out["trainer"] = {"index": index, "sets": t["sets"], "ai_flags": flags, "ai": ai_for(flags), "lines": {"es": lines(index, "es"), "en": lines(index, "en")}}
    return out
