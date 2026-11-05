#!/usr/bin/env python3
"""Builds silvers_hoard/presets/hgss_rom.json.gz: what the HeartGold/SoulSilver cartridge says about its trainers, in the shape the app
needs (silvers_hoard/hgss_rom.py reads it).

    python scripts/build_hgss_rom.py <folder with the extracted JSON> [out]

Source: pret/pokeheartgold, the decompilation of HeartGold and SoulSilver (github.com/pret/pokeheartgold): the trainer data
(files/poketool/trainer, src/trainer_data.c, src/pokemon.c, src/math_util.c, wotbl.narc and personal data), the map event files
(files/fielddata/eventdata/zone_event) and the scripts (files/fielddata/script/scr_seq). A separate extraction step (not part of this
repository) turned them into the JSON files this script reads, all in <folder>:

  trainers_hgss.json  the 738 trainers of the ROM, in index order, each Pokémon with its exact nature, IVs, ability, gender, item and
                      moves (the game's own rules for the Pokémon it makes for a trainer: seed, personality value and default
                      moveset), the AI flags, the double-battle flag and the English messages
  match.json          "<character key>:<team id>" of Silver's characters -> ROM trainer index (matched by name, class and party)
  gyms_hgss.json      the gym maps: leader, gym trainers (position, facing, sight, entrance) and the doors between rooms
  lines_es.json       the messages in castellano (Spain) by ROM index, with the Spanish class and name where they are known

Besides those it reads Silver's own presets (characters.json.gz for the characters, trainer_sprites.json for the sprite names) and
checks every map it draws with silvers_hoard.gymmap.clean, so a map that is not valid is an error here, not in the app.

What goes into the preset:
  roms    the ROM trainers the app uses (the matched ones, the extra named ones and the gym trainers): name, class, AI flags, double
          flag, sets (Silver's set format, IVs as one number) and the lines in both languages (intro, after, lose, win, last, last_low)
  match   team of a Silver character -> ROM index
  extra   characters (or teams of characters) the ROM has and Silver did not: the Kimono Girls, a few more named trainers
  gyms    for each gym leader key: its trainers in the order of the room and a map drawn from the real positions
"""

from __future__ import annotations

import gzip
import json
import random
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from silvers_hoard import gymmap  # noqa: E402
from silvers_hoard.errors import SilverError  # noqa: E402

PRESETS = ROOT / "silvers_hoard" / "presets"
SOURCE = ("Cartridge data of HeartGold and SoulSilver from pret/pokeheartgold, the decompilation of the games "
          "(github.com/pret/pokeheartgold): trainer parties, AI flags, messages and gym maps.")

CODE_KEY = {"TRMSG_INTRO": "intro", "TRMSG_AFTER": "after", "TRMSG_LOSE": "lose", "TRMSG_WIN": "win", "TRMSG_LAST_POKE": "last",
            "TRMSG_LAST_POKE_HALF": "last_low", "TRMSG_DBL_INTRO_1": "intro", "TRMSG_DBL_LOSE_1": "lose", "TRMSG_DBL_AFTER_1": "after",
            "TRMSG_DBL_1POKE_1": "last", "TRMSG_DBL_INTRO_2": "intro2", "TRMSG_DBL_LOSE_2": "lose2", "TRMSG_DBL_AFTER_2": "after2",
            "TRMSG_DBL_1POKE_2": "last2"}
LINE_KEYS = ("intro", "after", "lose", "win", "last", "last_low")
MAX_LINE = 280

# Showdown trainer sprite of each trainer class the gyms use (the games' own overworld sprites are not in Showdown)
SPRITE = {"BIRD_KEEPER_GS": "birdkeeper", "TWINS": "twins", "BUG_CATCHER": "bugcatcher", "BEAUTY": "beauty", "LASS": "lass", "MEDIUM": "medium",
          "BLACK_BELT": "blackbelt", "SKIER": "skierf", "BOARDER": "boarder", "ACE_TRAINER_M": "acetrainer", "ACE_TRAINER_F": "acetrainerf",
          "HIKER": "hiker", "CAMPER": "camper", "SAILOR": "sailor", "SWIMMER_F": "swimmerf", "GUITARIST": "guitarist", "GENTLEMAN": "gentleman",
          "JUGGLER": "juggler", "PICNICKER": "picnicker", "PSYCHIC_M": "psychic", "SUPER_NERD": "supernerd", "SCIENTIST_GS": "scientist",
          "DOUBLE_TEAM": "doubleteam"}
# Spanish names where the official Spanish ones are not in the English ROM text (twins and the double team)
NAME_ES = {10: "Amy y May", 326: "Jo y Zoe", 684: "Elan e Ida"}

# The named ROM trainers that Silver had no team for (match_gaps.json lists them all) and are worth having as characters:
# (ROM index, character key, Showdown sprite, class, where, labels (en, es) or None)
EXTRA = [
    (160, "naoko", "kimonogirl", "Kimono Girl", "Ecruteak Dance Theater", None), (161, "sayo", "kimonogirl", "Kimono Girl", "Ecruteak Dance Theater", None),
    (162, "zuki", "kimonogirl", "Kimono Girl", "Ecruteak Dance Theater", None), (163, "kuni", "kimonogirl", "Kimono Girl", "Ecruteak Dance Theater", None),
    (164, "miki", "kimonogirl", "Kimono Girl", "Ecruteak Dance Theater", None),
    (6, "keith", "policeman", "Policeman", "Johto Route 34", None), (80, "dirk", "policeman", "Policeman", "Johto Route 35", None),
    (41, "clyde", "guitarist", "Guitarist", "Goldenrod Radio Tower", None),
    (290, "li", "sage", "Elder", "Sprout Tower", None), (498, "eusine", "eusine", "Mystery Man", "Cianwood City", None),
    # five trainers whose teams are in the data but who no map or script uses
    (667, "cheryl", "cheryl", "Pokémon Trainer", "Not fought in the game", ("Left in the data", "Sin usar en el juego")),
    (668, "marley", "marley", "Pokémon Trainer", "Not fought in the game", ("Left in the data", "Sin usar en el juego")),
    (669, "mira", "mira", "Pokémon Trainer", "Not fought in the game", ("Left in the data", "Sin usar en el juego")),
    (670, "riley", "riley", "Pokémon Trainer", "Not fought in the game", ("Left in the data", "Sin usar en el juego")),
    (671, "buck", "buck", "Pokémon Trainer", "Not fought in the game", ("Left in the data", "Sin usar en el juego")),
]

# How each gym is drawn: floor tile, what is scattered on it (and where), and a puzzle of the games where the map can have one
STYLE = {
    "falkner": dict(base=".", decor="*", p=0.12, zone="sides"),
    "bugsy": dict(base=",", decor="*", p=0.14, zone="all"),
    "whitney": dict(base="=", decor="*", p=0.08, zone="sides"),
    "morty": dict(base=".", decor="o", p=0.1, zone="sides"),
    "chuck": dict(base=".", decor="~", p=0.9, zone="edge"),
    "jasmine": dict(base=".", decor="o", p=0.1, zone="sides"),
    "pryce": dict(base=".", decor="o", p=0.05, zone="sides", puzzle="ice"),
    "clair": dict(base=".", decor="o", p=0.14, zone="sides"),
    "brock": dict(base=".", decor="o", p=0.22, zone="sides"),
    "misty": dict(base=".", decor="~", p=0.9, zone="edge"),
    "ltsurge": dict(base=".", decor="o", p=0.06, zone="sides", puzzle="switch"),
    "erika": dict(base=",", decor="*", p=0.2, zone="all"),
    "janine": dict(base=".", decor="*", p=0.1, zone="sides"),
    "sabrina": dict(base="=", decor="", p=0, zone="sides"),
    "blaine": dict(base=".", decor="~", p=0.6, zone="edge"),
    "blue": dict(base=".", decor="o", p=0.1, zone="sides"),
}
FACING = {0: "up", 1: "down", 2: "left", 3: "right"}
PADX, PADTOP, INT_W, INT_H = 2, 1, 30, 22      # floor left/right of the people, a row above the leader, the most floor that fits a map


def jload(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def clip(text: str) -> str:
    """At most MAX_LINE characters, ending where a sentence ends when it can."""
    text = text.strip()
    if len(text) <= MAX_LINE:
        return text
    cut = text[:MAX_LINE]
    ends = [m.end() for m in re.finditer(r"[.!?…]['”’\"]?\s", cut + " ")]
    if ends and ends[-1] > MAX_LINE * 0.5:
        return cut[:ends[-1]].strip()
    return cut[:MAX_LINE - 1].rsplit(" ", 1)[0] + "…"


def silver_set(p: dict[str, Any]) -> dict[str, Any]:
    s: dict[str, Any] = {"species": p["species"], "level": p["level"]}
    if p["item"]:
        s["item"] = p["item"]
    s["ability"] = p["ability"]
    s["moves"] = list(p["moves"])
    s["nature"] = p["nature"]
    if p["gender"]:
        s["gender"] = p["gender"]
    s["iv"] = p["iv"]                      # one number: the game gives all six stats the same IV
    if "happiness" in p:
        s["happiness"] = p["happiness"]
    if p.get("hidden_power"):
        s["hpType"] = p["hidden_power"]["type"]
    return s


def join_partners(a: str, b: str) -> str:
    parts = [x for x in (a, b) if x]
    if len(parts) == 2 and parts[0] == parts[1]:
        parts = parts[:1]
    return clip(" ".join(parts))


def lines_of(rec: dict[str, str]) -> dict[str, str]:
    """The six lines of one language, the second partner of a double team folded into the first one's."""
    out = {}
    for k in LINE_KEYS:
        v = join_partners(rec.get(k, ""), rec.get(f"{k}2", "")) if k != "last_low" and k != "win" else rec.get(k, "")
        if v:
            out[k] = clip(v)
    return out


def english_lines(t: dict[str, Any]) -> dict[str, str]:
    rec = {CODE_KEY[k]: v for k, v in t["messages"].items() if k in CODE_KEY}
    return lines_of(rec)


def main() -> None:
    src = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else PRESETS / "hgss_rom.json.gz"
    trainers = jload(src / "trainers_hgss.json")
    match = jload(src / "match.json")
    gyms_raw = jload(src / "gyms_hgss.json")["gyms"]
    lines_es = jload(src / "lines_es.json")
    characters = json.loads(gzip.decompress((PRESETS / "characters.json.gz").read_bytes()).decode("utf-8"))["characters"]
    sprite_names = set(jload(PRESETS / "trainer_sprites.json"))
    by_key = {c["key"]: c for c in characters}

    needed: set[int] = set(match.values()) | {x[0] for x in EXTRA}

    # ---------------------------------------------------------------- the gyms: trainers in the order of the room, and the map
    gyms: dict[str, Any] = {}
    leader_of = {v: k.split(":")[0] for k, v in match.items() if k.endswith(":hgssgymbattle")}
    by_group: dict[str, list[dict[str, Any]]] = {}
    for room in gyms_raw:
        by_group.setdefault(room["group"], []).append(room)
    for group, rooms in by_group.items():
        rooms = sorted((r for r in rooms if r["trainers"] or r["leader"]), key=lambda r: r["room_depth"])
        leader_room = next(r for r in rooms if r["leader"])
        key = leader_of[leader_room["leader_index"]]
        g = draw_gym(key, rooms, trainers, lines_es, sprite_names)
        gyms[key] = g
        needed |= {t["rom"] for t in g["trainers"]}

    # ---------------------------------------------------------------- the ROM trainers
    roms: dict[str, Any] = {}
    for idx in sorted(needed):
        t = trainers[idx]
        es = lines_es.get(str(idx), {})
        entry: dict[str, Any] = {"name": t["name"], "class": t["class_const"].replace("TRAINERCLASS_", ""), "ai": t["ai_flags"],
                                 "sets": [silver_set(p) for p in t["party"]]}
        name_es = NAME_ES.get(idx) or es.get("name_es")
        if name_es and name_es != t["name"]:
            entry["name_es"] = name_es
        if es.get("class_es") and es["class_es"] != "?":
            entry["class_es"] = es["class_es"]
        if t["double"]:
            entry["double"] = 1
        lines = {"es": lines_of({k: v for k, v in es.items() if k not in ("name", "name_es", "class_es")}), "en": english_lines(t)}
        lines = {lang: v for lang, v in lines.items() if v}
        if lines:
            entry["lines"] = lines
        roms[str(idx)] = entry

    # ---------------------------------------------------------------- characters the ROM adds
    extra: list[dict[str, Any]] = []
    for idx, key, sprite, cls, where, labels in EXTRA:
        assert sprite in sprite_names, sprite
        t = trainers[idx]
        known = by_key.get(key)
        assert not known or "hgss" not in {v["id"] for v in known["variants"]}
        variant = {"games": ["hgss"], "category": "others", "id": "hgss", "game": "HGSS", "game_name": "HeartGold and SoulSilver",
                   "game_name_es": "Oro HeartGold y Plata SoulSilver", "gen": 4, "order": 42, "format": "gen4customgame",
                   "labels": [labels[0]] if labels else [], "labels_alt": [], "labels_es": [labels[1]] if labels else [], "labels_alt_es": [],
                   "trainer_class": cls, "location": where, "note": "", "sprite": known["base_sprite"] if known else sprite,
                   "sets": [silver_set(p) for p in t["party"]], "side": False, "rom": idx}
        if known:
            extra.append({"key": key, "variants": [variant]})
        else:
            name_es = roms[str(idx)].get("name_es") or t["name"]
            extra.append({"key": key, "name": t["name"], "name_es": name_es, "base_sprite": sprite, "games": ["HGSS"],
                          "sprites": [{"id": sprite, "suffix": "", "label": "Showdown", "label_es": "Showdown"}], "variants": [variant]})

    out = {"schema": 1, "source": SOURCE, "roms": roms, "match": match, "extra": extra, "gyms": gyms}
    out_path.write_bytes(gzip.compress(json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9, mtime=0))
    print(json.dumps({"roms": len(roms), "matched": len(match), "extra": len(extra), "gyms": len(gyms),
                      "gym_trainers": sum(len(g["trainers"]) for g in gyms.values()), "bytes": out_path.stat().st_size,
                      "sizes": {k: f"{g['w']}x{g['h']}" for k, g in gyms.items()}}, ensure_ascii=False, indent=1))


# ------------------------------------------------------------------------------------------------------------------- the maps
def draw_gym(key: str, rooms: list[dict[str, Any]], trainers: list[dict[str, Any]], lines_es: dict[str, Any], sprite_names: set[str]) -> dict[str, Any]:
    """The rooms of one gym stacked into one map (each room's exit on the next room's entrance), the people squeezed to fit the
    biggest map the app draws, the floor round them with walls, the gym's look and its puzzle where it has one."""
    offs: dict[str, tuple[int, int]] = {rooms[-1]["map"]: (0, 0)}
    for i in range(len(rooms) - 2, -1, -1):
        room, nxt = rooms[i], rooms[i + 1]
        door = next((w for w in room["warps"] if w["to_zone"] == nxt["map"]), None)
        ox, oz = offs[nxt["map"]]
        if door:
            offs[room["map"]] = (nxt["entrance"]["x"] + ox - door["x"], nxt["entrance"]["z"] + oz - door["z"])
        else:   # no door between them in the data: the room goes below the next one
            low = max(t["z"] for t in nxt["trainers"]) if nxt["trainers"] else nxt["entrance"]["z"]
            offs[room["map"]] = (ox, low + oz + 2 - min(t["z"] for t in room["trainers"]))
    first = rooms[0]
    ex, ez = first["entrance"]["x"] + offs[first["map"]][0], first["entrance"]["z"] + offs[first["map"]][1]
    leader_room = rooms[-1]
    lx, lz = leader_room["leader"]["x"] + offs[leader_room["map"]][0], leader_room["leader"]["z"] + offs[leader_room["map"]][1]
    people: list[dict[str, Any]] = []
    seen: set[int] = set()
    for room in rooms:
        ox, oz = offs[room["map"]]
        for t in room["trainers"]:
            if t["index"] in seen or t.get("double_partner_object"):
                continue
            seen.add(t["index"])
            cls = t["class_const"].replace("TRAINERCLASS_", "")
            people.append({"rom": t["index"], "gx": t["x"] + ox, "gz": t["z"] + oz, "facing": FACING[t["facing"]], "sight": max(1, t["sight"]),
                           "turns": t["object_type"] == 2, "sprite": SPRITE[cls]})
            assert SPRITE[cls] in sprite_names, SPRITE[cls]
    people.sort(key=lambda p: (abs(p["gz"] - ez) + abs(p["gx"] - ex) * 0.01, p["gx"]))   # the order you meet them walking from the entrance
    xs = [ex, lx, *[p["gx"] for p in people]]
    zs = [ez, lz, *[p["gz"] for p in people]]
    minx, maxx, minz, maxz = min(xs), max(xs), min(zs), max(zs)
    sx = min(1.0, (INT_W - 2 * PADX - 1) / max(maxx - minx, 1))
    sy = min(1.0, (INT_H - PADTOP - 1) / max(maxz - minz, 1))

    def col(x: int) -> int:
        return round((x - minx) * sx) + 1 + PADX

    def row(z: int) -> int:
        return round((z - minz) * sy) + 1 + PADTOP

    W, H = col(maxx) + PADX + 2, row(maxz) + 2
    dx = dy = 0
    if W < 9:
        dx, W = (9 - W) // 2, 9
    if H < 9:
        dy, H = 9 - H, 9
    start = (col(ex) + dx, row(ez) + dy)
    leader = (col(lx) + dx, row(lz) + dy)
    taken = {start, leader}
    placed = []
    for p in people:
        want = (col(p["gx"]) + dx, row(p["gz"]) + dy)
        spot = free_tile(want, taken, W, H)
        taken.add(spot)
        axis = sy if p["facing"] in ("up", "down") else sx
        one = {"rom": p["rom"], "x": spot[0], "y": spot[1], "facing": p["facing"], "sight": max(1, min(8, round(p["sight"] * axis))),
               "sprite": p["sprite"]}
        if p["turns"]:
            one["turns"] = True
        placed.append(one)
    lead = {"x": leader[0], "y": leader[1], "facing": FACING[leader_room["leader"]["facing"]]}
    ids = [f"t{i}" for i in range(len(placed))]
    last_error = None
    for attempt in range(60):
        tiles = tiles_of(key, W, H, start, leader, [(p["x"], p["y"]) for p in placed], attempt)
        m = {"w": W, "h": H, "tiles": tiles, "start": list(start), "leader": lead, "look": "pixel",
             "trainers": [{"id": i, "x": p["x"], "y": p["y"], "facing": p["facing"], "sight": p["sight"], **({"turns": True} if p.get("turns") else {})}
                          for i, p in zip(ids, placed)]}
        try:
            gymmap.clean(m, ids)
            break
        except SilverError as exc:
            last_error = exc   # from attempt 20 the puzzle goes, from 40 the scenery too: a plain room
    else:
        raise SystemExit(f"{key}: no valid map ({last_error})")
    return {"name": rooms[-1].get("gym_en") or f"{rooms[-1]['city_en']} Gym", "city": rooms[-1]["city_en"], "map": [r["map"] for r in rooms],
            "w": W, "h": H, "tiles": tiles, "start": list(start), "leader": lead, "look": "pixel",
            "trainers": [{k: v for k, v in p.items()} for p in placed]}


def free_tile(want: tuple[int, int], taken: set[tuple[int, int]], W: int, H: int) -> tuple[int, int]:
    """The nearest tile inside the walls that nobody stands on."""
    for r in range(0, 8):
        ring = sorted(((a, b) for a in range(-r, r + 1) for b in range(-r, r + 1) if max(abs(a), abs(b)) == r), key=lambda ab: (abs(ab[0]) + abs(ab[1]), abs(ab[1])))
        for a, b in ring:
            x, y = want[0] + a, want[1] + b
            if 1 <= x <= W - 2 and 1 <= y <= H - 2 and (x, y) not in taken:
                return x, y
    raise SystemExit("no free tile")


def tiles_of(key: str, W: int, H: int, start: tuple[int, int], leader: tuple[int, int], people: list[tuple[int, int]], attempt: int) -> str:
    st = STYLE[key]
    rng = random.Random(f"hgss:{key}:{attempt}")
    grid = [["#"] * W for _ in range(H)]
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            grid[y][x] = st["base"]
    lx, ly = leader
    for y in range(ly, min(ly + 3, H - 1)):                  # the leader's carpet
        for x in range(max(1, lx - 2), min(W - 2, lx + 2) + 1):
            grid[y][x] = "="
    everyone = [start, leader, *people]

    def near(x: int, y: int, r: int = 2) -> bool:
        return any(max(abs(x - a), abs(y - b)) <= r for a, b in everyone)

    puzzle = st.get("puzzle", "") if attempt < 20 else ""
    if puzzle == "ice":                                       # Mahogany: the floor is ice with a row to stand on every four rows
        for y in range(ly + 3, H - 1):
            if (H - 2 - y) % 4 != 0:
                for x in range(1, W - 1):
                    grid[y][x] = "_"
    if st["decor"] and attempt < 40:
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                if grid[y][x] in "_=" or near(x, y):
                    continue
                zone = st["zone"]
                if zone == "sides" and not (x <= 2 or x >= W - 3):
                    continue
                if zone == "edge" and not (x <= 2 or x >= W - 3):
                    continue
                if rng.random() < st["p"]:
                    grid[y][x] = st["decor"]
    if puzzle == "switch":                                     # Vermilion: a gate before the leader that a switch opens
        gate = next((y for y in range(ly + 3, H - 3) if not any(py == y for _, py in people) and not any(py < y for _, py in people)), None)
        spots = [(x, y) for y in range(H - 3, ly + 3, -1) for x in range(W - 2, 0, -1) if gate and y > gate and not near(x, y, 1)]
        if gate and spots:
            for x in range(1, W - 1):
                grid[gate][x] = "d"
            sx, sy = spots[rng.randrange(min(len(spots), 8))]
            grid[sy][sx] = "s"
    for x, y in people:                                        # people stand on plain floor, never on scenery or ice
        if grid[y][x] not in ".=,":
            grid[y][x] = st["base"]
    for x, y in (start, leader):
        if grid[y][x] not in ".=,":
            grid[y][x] = st["base"]
    return "".join("".join(r) for r in grid)


if __name__ == "__main__":
    main()
