"""Reading the party out of a Pokémon Unbound 2.1.1.1 save file (.sav / .srm, 128 KB of flash, optionally with a 16-byte clock).

The layout follows PUSE by Zannael (MIT, github.com/Zannael/PUSE), which mapped it against the game: the flash holds two copies of the
game, each 14 sections of 4 KB with a footer (id, checksum, signature, save counter); the newest complete copy is the current one.
Section 1 holds the party: a count at 52 and six 100-byte records from 56. Unbound runs on Complete Fire Red Upgrade, which stores the
party unencrypted, its 48 bytes of data in the fixed order growth, attacks, EVs, misc; the level sits at 84. The id tables (species,
moves, items, abilities and each species' three abilities) are in presets/unbound_save.json.gz, built by scripts/build_unbound_save.mjs
from PUSE's tables with every name matched to Showdown's.
"""
from __future__ import annotations

import gzip
import json
import struct
from functools import lru_cache
from pathlib import Path
from typing import Any

SECTION = 4096
SECTIONS = 14
SLOTS = 2
FOOTER_ID, FOOTER_SUM, FOOTER_SIG, FOOTER_COUNTER = 4084, 4086, 4088, 4092
SIGNATURES = {0x01121999, 0x01121998}
SUM_LENGTH = {0: 3876, 4: 3480, 13: 1104}
NO_SUM = {4}
PARTY_SECTION, PARTY_COUNT, PARTY_START, RECORD = 1, 52, 56, 100
SIZES = (131072, 131088)

NATURES = ["Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax", "Timid", "Hasty", "Serious",
           "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash", "Calm", "Gentle", "Sassy", "Careful", "Quirky"]
STATS = ["HP", "Atk", "Def", "Spe", "SpA", "SpD"]
CHARS = {0x00: " ", 0xAB: "!", 0xAC: "?", 0xAD: ".", 0xAE: "-", 0xB0: "…", 0xB1: "“", 0xB2: "”", 0xB3: "‘", 0xB4: "'", 0xB5: "♂", 0xB6: "♀",
         0xB8: ",", 0xBA: "/"}
CHARS.update({0xA1 + i: c for i, c in enumerate("0123456789")})
CHARS.update({0xBB + i: c for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")})
CHARS.update({0xD5 + i: c for i, c in enumerate("abcdefghijklmnopqrstuvwxyz")})

TABLES = Path(__file__).resolve().parent / "presets" / "unbound_save.json.gz"


class NotASave(ValueError):
    """The bytes are not a Pokémon Unbound save this reader understands."""


@lru_cache(maxsize=1)
def tables() -> dict[str, Any]:
    return json.loads(gzip.decompress(TABLES.read_bytes()).decode("utf-8"))


def _u16(b: bytes, o: int) -> int:
    return struct.unpack_from("<H", b, o)[0]


def _u32(b: bytes, o: int) -> int:
    return struct.unpack_from("<I", b, o)[0]


def _checksum(payload: bytes) -> int:
    total = sum(struct.unpack("<" + "I" * (len(payload) // 4), payload)) & 0xFFFFFFFF
    return ((total & 0xFFFF) + (total >> 16)) & 0xFFFF


def text(raw: bytes) -> str:
    out = ""
    for b in raw:
        if b == 0xFF:
            break
        out += CHARS.get(b, "")
    return out.strip()


def looks_like_save(data: bytes) -> bool:
    """Cheap check before reading: the size of a GBA flash save and a valid section footer at the start."""
    if len(data) not in SIZES:
        return False
    return any(_u32(data, s * SECTION + FOOTER_SIG) in SIGNATURES for s in range(SECTIONS * SLOTS))


def sections(data: bytes) -> dict[int, bytes]:
    """The sections of the current copy of the game, by id (the copy with the higher save counter among the complete, valid ones)."""
    copies = []
    for slot in range(SLOTS):
        base = slot * SECTIONS * SECTION
        found: dict[int, tuple[int, bytes]] = {}
        for k in range(SECTIONS):
            off = base + k * SECTION
            if off + SECTION > len(data):
                break
            sec = data[off:off + SECTION]
            sid = _u16(sec, FOOTER_ID)
            if sid >= SECTIONS or sid in found or _u32(sec, FOOTER_SIG) not in SIGNATURES:
                break
            if sid not in NO_SUM and _checksum(sec[:SUM_LENGTH.get(sid, 4080)]) != _u16(sec, FOOTER_SUM):
                break
            found[sid] = (_u32(sec, FOOTER_COUNTER), sec)
        if len(found) == SECTIONS and len({c for c, _ in found.values()}) == 1:
            copies.append((found[0][0], {sid: sec for sid, (_, sec) in found.items()}))
    if not copies:
        raise NotASave("No complete game in this save (it may be from another game, or damaged).")
    if len(copies) == 2:
        delta = (copies[1][0] - copies[0][0]) & 0xFFFFFFFF
        return copies[1][1] if 0 < delta < 0x80000000 else copies[0][1]
    return copies[0][1]


def _mon(rec: bytes, t: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    """One party record as a Showdown set (None for an empty slot or an egg) and what could not be carried over."""
    pid, otid = _u32(rec, 0), _u32(rec, 4)
    growth, attacks, evs, misc = rec[32:44], rec[44:56], rec[56:68], rec[68:80]
    sid = _u16(growth, 0)
    if not sid:
        return None, []
    iv_word = _u32(misc, 4)
    if iv_word >> 30 & 1:
        return None, ["egg"]
    skipped: list[str] = []
    species = t["species"].get(str(sid))
    if not species:
        return None, [f"species #{sid}"]
    item_id = _u16(growth, 2)
    item = t["items"].get(str(item_id), "") if item_id else ""
    if item_id and not item:
        skipped.append(f"item #{item_id}")
    abilities = t["species_abilities"].get(str(sid)) or [0, 0, 0]
    slot = 2 if iv_word >> 31 & 1 else pid & 1
    ability_id = abilities[slot] or abilities[0]
    ability = t["abilities"].get(str(ability_id), "") if ability_id else ""
    if ability_id and not ability:
        skipped.append(f"ability #{ability_id}")
    moves = []
    for i in range(4):
        mid = _u16(attacks, i * 2)
        if not mid:
            continue
        name = t["moves"].get(str(mid))
        if name:
            moves.append(name)
        else:
            skipped.append(f"move #{mid}")
    shiny = ((otid >> 16) ^ (otid & 0xFFFF) ^ (pid >> 16) ^ (pid & 0xFFFF)) < 16
    s: dict[str, Any] = {
        "species": species, "nickname": text(rec[8:18]), "item": item, "ability": ability, "moves": moves,
        "nature": NATURES[pid % 25], "level": max(1, min(100, rec[84] or 1)), "shiny": shiny,
        "evs": {STATS[i]: evs[i] for i in range(6)}, "ivs": {STATS[i]: iv_word >> (5 * i) & 0x1F for i in range(6)},
    }
    return s, skipped


def read_party(data: bytes) -> dict[str, Any]:
    """{player, sets, skipped}: the player's name and the party as Showdown sets, plus what had no Showdown equivalent."""
    data = bytes(data)
    if len(data) not in SIZES:
        raise NotASave("A Pokémon Unbound save is 128 KB (a .sav or .srm file).")
    secs = sections(data)
    t = tables()
    party = secs[PARTY_SECTION]
    count = min(6, _u32(party, PARTY_COUNT))
    sets, skipped = [], []
    for i in range(count):
        rec = party[PARTY_START + i * RECORD: PARTY_START + (i + 1) * RECORD]
        s, missed = _mon(rec, t)
        if s:
            sets.append(s)
        skipped += [f"{i + 1}: {m}" for m in missed]
    return {"player": text(secs[0][0:7]), "sets": sets, "skipped": skipped}


def showdown(sets: list[dict[str, Any]]) -> str:
    """The sets as Showdown export text."""
    out = []
    for s in sets:
        nick = s.get("nickname") or ""
        base = s["species"].split("-")[0].replace("’", "'")
        head = f"{nick} ({s['species']})" if nick and nick.lower() != base.lower() and nick.lower() != s["species"].lower() else s["species"]
        lines = [head + (f" @ {s['item']}" if s.get("item") else "")]
        if s.get("ability"):
            lines.append(f"Ability: {s['ability']}")
        if s.get("level", 100) != 100:
            lines.append(f"Level: {s['level']}")
        if s.get("shiny"):
            lines.append("Shiny: Yes")
        evs = " / ".join(f"{v} {k}" for k, v in s["evs"].items() if v)
        if evs:
            lines.append(f"EVs: {evs}")
        lines.append(f"{s['nature']} Nature")
        ivs = " / ".join(f"{v} {k}" for k, v in s["ivs"].items() if v != 31)
        if ivs:
            lines.append(f"IVs: {ivs}")
        lines += [f"- {m}" for m in s["moves"]]
        out.append("\n".join(lines))
    return "\n\n".join(out) + "\n"
