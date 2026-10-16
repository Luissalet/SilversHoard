#!/usr/bin/env python3
"""Builds silvers_hoard/presets/hgss_rom.json.gz: the HeartGold/SoulSilver cartridge data Silver's Hoard uses.

Source: pret/pokeheartgold, the decompilation of Pokémon HeartGold and SoulSilver (zone_event JSON, scr_seq scripts, trainers.json,
personal.json, wotbl.narc, src/trainer_data.c, src/pokemon.c). The decompilation was read by a set of extraction scripts that wrote
five JSON files; this script turns them into the preset the app loads:

  trainers_hgss.json   738 trainers of the cartridge, in index order, with the exact party the game builds (nature, IVs, ability,
                       gender, item, moves) and their AI flags
  match.json           {"<character>:<team id>": cartridge trainer index} for the HGSS teams Silver already has
  match_gaps.json      the teams that have no cartridge trainer, and the named cartridge trainers Silver has no team for
  gyms_hgss.json       the gym maps: where the leader, the gym trainers and the entrance stand
  lines_es.json        what the trainers say, in castellano (Spain), by cartridge index

Usage:  python scripts/build_hgss_rom.py <folder with the five JSON files> [--presets <presets folder>] [--out <file>]

It reads presets/characters.json.gz (to check every matched team) and presets/trainer_sprites.json (every sprite it names must exist)
and writes presets/hgss_rom.json.gz. silvers_hoard/hgss_rom.py loads it."""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from pathlib import Path

SOURCE = ("pret/pokeheartgold (descompilación de Oro HeartGold y Plata SoulSilver / decompilation of Pokémon HeartGold and SoulSilver): "
          "trainers, parties, AI flags, gym maps and trainer lines read from the game's own data and scripts; "
          "Spanish lines translated from the English text, official Spanish names where known.")
ROOT = Path(__file__).resolve().parent.parent
LINE_MAX = 280
KEYS = ("intro", "after", "lose", "win", "last", "last_low")
STATS = ("hp", "atk", "def", "spa", "spd", "spe")

# the cartridge's trainer classes: English name, then the Showdown trainer sprites that look like it, best first
CLASSES = {
    "ACE_TRAINER_M": ("Ace Trainer", ["acetrainer-gen4", "acetrainer-gen4dp", "acetrainer-gen2", "acetrainer"]),
    "ACE_TRAINER_F": ("Ace Trainer", ["acetrainerf-gen4", "acetrainerf-gen4dp", "acetrainerf-gen2", "acetrainerf"]),
    "BEAUTY": ("Beauty", ["beauty-gen4dp", "beauty-gen2", "beauty"]),
    "BIRD_KEEPER_GS": ("Bird Keeper", ["birdkeeper-gen4dp", "birdkeeper-gen2", "birdkeeper"]),
    "BLACK_BELT": ("Black Belt", ["blackbelt-gen4", "blackbelt-gen4dp", "blackbelt-gen2", "blackbelt"]),
    "BOARDER": ("Boarder", ["boarder-gen2", "boarder"]),
    "BUG_CATCHER": ("Bug Catcher", ["bugcatcher-gen4dp", "bugcatcher-gen2", "bugcatcher"]),
    "CAMPER": ("Camper", ["camper-gen2", "camper"]),
    "DOUBLE_TEAM": ("Double Team", ["doubleteam"]),
    "GENTLEMAN": ("Gentleman", ["gentleman-gen4", "gentleman-gen4dp", "gentleman-gen2", "gentleman"]),
    "GUITARIST": ("Guitarist", ["guitarist-gen4", "guitarist-gen2", "guitarist"]),
    "HIKER": ("Hiker", ["hiker-gen4", "hiker-gen2", "hiker"]),
    "JUGGLER": ("Juggler", ["juggler-gen2", "juggler"]),
    "LASS": ("Lass", ["lass-gen4", "lass-gen4dp", "lass-gen2", "lass"]),
    "MEDIUM": ("Medium", ["medium"]),
    "PICNICKER": ("Picnicker", ["picnicker-gen2", "picnicker"]),
    "PSYCHIC_M": ("Psychic", ["psychic-gen4", "psychic-gen2", "psychic"]),
    "SAILOR": ("Sailor", ["sailor-gen2", "sailor"]),
    "SCIENTIST_GS": ("Scientist", ["scientist-gen4", "scientist-gen4dp", "scientist-gen2", "scientist"]),
    "SKIER": ("Skier", ["skierf-gen4dp", "skierf", "skier-gen2", "skier"]),
    "SUPER_NERD": ("Super Nerd", ["supernerd-gen2", "supernerd"]),
    "SWIMMER_F": ("Swimmer", ["swimmerf-gen4", "swimmerf-gen4dp", "swimmerf-gen2", "swimmerf"]),
    "TWINS": ("Twins", ["twins-gen4", "twins-gen4dp", "twins-gen2", "twins"]),
}

# cartridge trainers Silver has no character for, made into characters: index -> (key, name_es, class, class_es, sprites, place, place_es)
EXTRAS = {
    160: ("naoko", "Naoko", "Kimono Girl", "Chica Kimono", ["kimonogirl", "kimonogirl-gen2"], "Ecruteak Dance Theater", "Teatro de Baile de Ciudad Iris"),
    161: ("sayo", "Sayo", "Kimono Girl", "Chica Kimono", ["kimonogirl", "kimonogirl-gen2"], "Ecruteak Dance Theater", "Teatro de Baile de Ciudad Iris"),
    162: ("zuki", "Zuki", "Kimono Girl", "Chica Kimono", ["kimonogirl", "kimonogirl-gen2"], "Ecruteak Dance Theater", "Teatro de Baile de Ciudad Iris"),
    163: ("kuni", "Kuni", "Kimono Girl", "Chica Kimono", ["kimonogirl", "kimonogirl-gen2"], "Ecruteak Dance Theater", "Teatro de Baile de Ciudad Iris"),
    164: ("miki", "Miki", "Kimono Girl", "Chica Kimono", ["kimonogirl", "kimonogirl-gen2"], "Ecruteak Dance Theater", "Teatro de Baile de Ciudad Iris"),
    498: ("eusine", "Eusine", "Mystery Man", "Místico", ["eusine", "eusine-gen2"], "Cianwood City", "Ciudad Orquídea"),
    290: ("elderli", "Anselmo", "Elder", "Anciano", ["li"], "Sprout Tower", "Torre Bellsprout"),
}
# Spanish names of the double teams (the Spanish text calls Bugsy's twins Amy and May)
TEAM_NAMES_ES = {10: "Amy y May", 326: "Jo y Zoe", 684: "Elan e Ida"}
SPRITE_LABELS = {"": ("Showdown (current)", "Showdown (actual)"), "gen2": ("Gold, Silver and Crystal", "Oro, Plata y Cristal")}
LINE_CODES = {"TRMSG_INTRO": "intro", "TRMSG_AFTER": "after", "TRMSG_LOSE": "lose", "TRMSG_WIN": "win", "TRMSG_LAST_POKE": "last",
              "TRMSG_LAST_POKE_HALF": "last_low"}
DOUBLE_CODES = {"TRMSG_DBL_INTRO_1": "intro", "TRMSG_DBL_INTRO_2": "intro2", "TRMSG_DBL_AFTER_1": "after", "TRMSG_DBL_AFTER_2": "after2",
                "TRMSG_DBL_LOSE_1": "lose", "TRMSG_DBL_LOSE_2": "lose2"}   # TRMSG_DBL_1POKE_* is said when the PLAYER has one Pokémon


def load(folder: Path, name: str):
    return json.loads((folder / name).read_text(encoding="utf-8"))


def mon(p: dict) -> dict:
    """One party member as a Showdown set: the cartridge is authoritative (species, level, item, moves, ability, nature, gender, IVs)."""
    moves = [(p.get("hidden_power") or {}).get("move_name") if m == "Hidden Power" and p.get("hidden_power") else m for m in p["moves"]]
    s = {"species": p["species"], "level": p["level"]}
    if p.get("item"):
        s["item"] = p["item"]
    s["moves"] = moves
    s["ability"] = p["ability"]
    s["nature"] = p["nature"]
    if p.get("gender") in ("M", "F"):
        s["gender"] = p["gender"]
    s["ivs"] = {k: p["iv"] for k in STATS}
    if "happiness" in p:
        s["happiness"] = p["happiness"]
    return s


def sprite_for(cls: str, names: set[str]) -> str:
    if cls not in CLASSES:
        raise SystemExit(f"no sprite known for the class {cls}")
    for cand in CLASSES[cls][1]:
        if cand in names:
            return cand
    raise SystemExit(f"none of {CLASSES[cls][1]} is a trainer sprite")


def cut(text: str) -> str:
    """A line fits the dialogue's 280 characters: whole sentences, or a word boundary and an ellipsis."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= LINE_MAX:
        return text
    head = text[:LINE_MAX]
    stop = max(head.rfind(". "), head.rfind("! "), head.rfind("? "), head.rfind("… "))
    if stop > 60:
        return head[:stop + 1]
    return head[:LINE_MAX - 1].rsplit(" ", 1)[0] + "…"


def join(a: str, b: str) -> str:
    return cut(f"{a} {b}") if a and b and len(a) + len(b) + 1 <= LINE_MAX else cut(a or b)


def lines_for(rom: dict, es: dict) -> dict:
    """{"es": {...}, "en": {...}} with the keys intro, after, lose, win, last, last_low (the dialogue keys of Silver's Hoard).
    The two partners of a double team speak as one: their lines join when they fit. last_low is said when the last Pokémon is at half HP."""
    msgs = rom["messages"]
    en = {LINE_CODES[k]: v for k, v in msgs.items() if k in LINE_CODES}
    if rom["double"]:
        d = {DOUBLE_CODES[k]: v for k, v in msgs.items() if k in DOUBLE_CODES}
        en = {k: v for k, v in en.items() if k not in ("last",)}
        for k in ("intro", "after", "lose"):
            if d.get(k):
                en[k] = join(d[k], d.get(k + "2", ""))
    sp = {k: es[k] for k in KEYS if es.get(k)}
    if rom["double"]:
        sp.pop("last", None)
        for k in ("intro", "after", "lose"):
            if es.get(k):
                sp[k] = join(es[k], es.get(k + "2", ""))
    return {"es": {k: cut(v) for k, v in sp.items()}, "en": {k: cut(v) for k, v in en.items() if v}}


def trainer_entry(rom: dict, es: dict, sprite: str, cls_en: str) -> dict:
    out = {"name": rom["name"], "class": cls_en, "class_es": es.get("class_es") or "", "sprite": sprite, "flags": rom["ai_flags"],
           "sets": [mon(p) for p in rom["party"]]}
    name_es = TEAM_NAMES_ES.get(rom["index"]) or es.get("name_es")
    if name_es and name_es != rom["name"]:
        out["name_es"] = name_es
    if rom["double"]:
        out["double"] = True
    return out


def gym_rooms(maps: list[dict]) -> list[dict]:
    """The rooms of one gym from the entrance to the leader, with everybody's place. Trainers that are two objects (a double team)
    stand once, and each room lists them in the order you meet them (nearest the door first). Positions are the cartridge's tiles
    (x east, z south); facing 0 north, 1 south, 2 west, 3 east."""
    rooms = []
    for m in sorted(maps, key=lambda m: m["room_depth"]):
        room = {"map": m["map"], "depth": m["room_depth"], "entrance": [m["entrance"]["x"], m["entrance"]["z"]]}
        depth = {x["map"]: x["room_depth"] for x in maps}
        up = [w for w in m["warps"] if depth.get(w["to_zone"], -1) > m["room_depth"]]   # the door to the next room
        if up:
            room["up"] = [up[0]["x"], up[0]["z"]]
        if m.get("leader"):
            room["leader"] = {"x": m["leader"]["x"], "z": m["leader"]["z"], "facing": m["leader"]["facing"]}
        seen, people = set(), []
        for t in m["trainers"]:
            if t["index"] in seen:
                continue
            seen.add(t["index"])
            p = {"rom": t["index"], "x": t["x"], "z": t["z"], "facing": t["facing"], "sight": t["sight"]}
            if t["engage"] == "talk":
                p["talk"] = True
            if t.get("object_type") == 2:
                p["turns"] = True
            people.append(p)
        ex, ez = room["entrance"]
        people.sort(key=lambda p: abs(p["x"] - ex) + abs(p["z"] - ez))
        room["trainers"] = people
        decor = []
        for o in m["objects_all"]:
            kind = {"ICE": "ice", "TREE": "tree"}.get(o["sprite"])
            if kind:
                decor.append({"kind": kind, "x": o["x"], "z": o["z"]})
        if decor:
            room["decor"] = decor
        rooms.append(room)
    return rooms


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("data", type=Path, help="folder with trainers_hgss.json, match.json, match_gaps.json, gyms_hgss.json, lines_es.json")
    ap.add_argument("--presets", type=Path, default=ROOT / "silvers_hoard" / "presets")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    out_path = a.out or a.presets / "hgss_rom.json.gz"
    rom = load(a.data, "trainers_hgss.json")
    match = load(a.data, "match.json")
    gaps = load(a.data, "match_gaps.json")
    gyms = load(a.data, "gyms_hgss.json")["gyms"]
    lines_es = load(a.data, "lines_es.json")
    sprites = set(json.loads((a.presets / "trainer_sprites.json").read_text(encoding="utf-8")))
    chars = json.loads(gzip.decompress((a.presets / "characters.json.gz").read_bytes()).decode("utf-8"))["characters"]
    by_variant = {f"{c['key']}:{v['id']}": (c, v) for c in chars for v in c["variants"]}

    # 1. the teams Silver already has: exact sets, the cartridge index, AI flags
    variants = {}
    for key, idx in sorted(match.items()):
        r = rom[idx]
        c, v = by_variant[key]
        sets = [mon(p) for p in r["party"]]
        have = sorted((s["species"], s["level"]) for s in v["sets"])
        got = sorted((s["species"], s["level"]) for s in sets)
        if have != got:
            raise SystemExit(f"{key}: Silver has {have} but the cartridge trainer {idx} has {got}")
        entry = {"rom": idx, "flags": r["ai_flags"], "sets": sets}
        if r["double"]:
            entry["double"] = True
        variants[key] = entry

    # 2. cartridge trainers that become characters
    hg = next(v for _, v in by_variant.values() if v["games"] == ["hgss"] and v["category"] == "leaders")
    characters = []
    for idx, (key, name_es, cls_en, cls_es, spr, place, place_es) in EXTRAS.items():
        r = rom[idx]
        # a character Silver has by now (from Bulbapedia): the cartridge's sets go over its HeartGold/SoulSilver team, like any other
        have = next(((c, v) for c in chars if c["key"] == key for v in c["variants"] if v["games"] == ["hgss"]), None)
        if have:
            sets = [mon(p) for p in r["party"]]
            if sorted((s["species"], s["level"]) for s in have[1]["sets"]) != sorted((s["species"], s["level"]) for s in sets):
                raise SystemExit(f"{key}: Silver's HGSS team differs from the cartridge trainer {idx}")
            variants[f"{key}:{have[1]['id']}"] = {"rom": idx, "flags": r["ai_flags"], "sets": sets, **({"double": True} if r["double"] else {})}
            continue
        missing = [s for s in spr if s not in sprites]
        if missing:
            raise SystemExit(f"{key}: no trainer sprite {missing}")
        def suffixed(s: str) -> str:
            return s.split("-", 1)[1] if "-" in s else ""

        variant = {"games": ["hgss"], "category": "others", "id": "hgss", "game": hg["game"], "game_name": hg["game_name"], "game_name_es": hg["game_name_es"],
                   "gen": 4, "order": hg["order"], "format": "gen4customgame", "labels": [place], "labels_alt": [], "trainer_class": cls_en,
                   "trainer_class_es": cls_es, "location": place, "note": "", "sprite": spr[0],
                   "sets": [mon(p) for p in r["party"]], "side": False, "labels_es": [place_es], "labels_alt_es": [], "rom": idx, "flags": r["ai_flags"]}
        characters.append({"key": key, "name": r["name"], "name_es": name_es, "base_sprite": spr[0],
                           "sprites": [{"id": s, "suffix": suffixed(s), "label": SPRITE_LABELS[suffixed(s)][0], "label_es": SPRITE_LABELS[suffixed(s)][1]} for s in spr],
                           "variants": [variant]})

    # 3. gyms: every gym trainer (exact set, class, name, sprite) and the rooms with everybody's place
    leader_key = {}
    for key, idx in match.items():
        if key.endswith(":hgssgymbattle") or key in ("giovanni:hgss",):
            leader_key.setdefault(idx, key.split(":")[0])
    by_gym: dict[str, list] = {}
    for m in gyms:
        by_gym.setdefault(m["city_en"], []).append(m)
    gym_out, trainers = [], {}
    for city, rooms in by_gym.items():
        lead = next((m for m in rooms if m.get("leader_index")), None)
        if not lead:
            raise SystemExit(f"{city}: no room with a leader")
        key = leader_key.get(lead["leader_index"])
        if not key:
            raise SystemExit(f"{city}: leader {lead['leader_index']} is not a matched team")
        for m in rooms:
            for t in m["trainers"]:
                cls = t["class_const"].replace("TRAINERCLASS_", "")
                r = rom[t["index"]]
                es = lines_es.get(str(t["index"]), {})
                if not es.get("class_es") or es["class_es"] == "?":
                    raise SystemExit(f"trainer {t['index']}: no Spanish class")
                trainers[str(t["index"])] = trainer_entry(r, es, sprite_for(cls, sprites), CLASSES[cls][0])
        g = {"leader": key, "city": city, "gym": lead["gym_en"], "rooms": gym_rooms(rooms)}
        if any(t.get("note") for m in rooms for t in m["trainers"]):
            g["quiz"] = True   # Blaine's Seafoam gym: the trainers fight you after a wrong answer
        gym_out.append(g)

    # 4. lines, in both languages, for every cartridge trainer the app can make
    wanted = set(match.values()) | {int(i) for i in trainers} | set(EXTRAS)
    lines = {}
    for idx in sorted(wanted):
        l = lines_for(rom[idx], lines_es.get(str(idx), {}))
        if l["es"] or l["en"]:
            lines[str(idx)] = l

    data = {"schema": 1, "source": SOURCE, "variants": variants, "characters": characters, "trainers": trainers, "gyms": gym_out, "lines": lines,
            "ai_bits": ["basic", "evaluate attack", "expert", "setup first turn", "risky", "prioritize damage", "baton pass", "tag strategy",
                        "check HP", "weather", "harassment"]}
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    out_path.write_bytes(gzip.compress(raw, 9, mtime=0))
    print(f"{out_path}: {len(raw)} bytes -> {out_path.stat().st_size} gz; {len(variants)} teams, {len(characters)} new characters, "
          f"{len(trainers)} gym trainers in {len(gym_out)} gyms, lines for {len(lines)} trainers", file=sys.stderr)


if __name__ == "__main__":
    main()
