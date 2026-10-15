"""Importing a team from a Pokémon Unbound save: a save built byte by byte the way the game writes it (two copies of the game, the newer
one current), read into Showdown sets and made a trainer."""
import base64
import struct

import pytest

from silvers_hoard import unbound_save as ub

SECTION, SECTIONS = 4096, 14
SIG = 0x01121999


def _record(species, item, moves, *, pid, otid=0x12345678, level=50, evs=(0,) * 6, ivs=(31,) * 6, hidden=False, egg=False, nick=""):
    rec = bytearray(100)
    struct.pack_into("<II", rec, 0, pid, otid)
    name = bytearray([0xFF] * 10)
    for i, ch in enumerate(nick[:10]):
        name[i] = {v: k for k, v in ub.CHARS.items()}[ch]
    rec[8:18] = name
    growth = bytearray(12)
    struct.pack_into("<HH", growth, 0, species, item)
    attacks = bytearray(12)
    for i, m in enumerate(moves):
        struct.pack_into("<H", attacks, i * 2, m)
    ev = bytearray(12)
    ev[0:6] = bytes(evs)
    misc = bytearray(12)
    word = sum(v << (5 * i) for i, v in enumerate(ivs)) | (1 << 31 if hidden else 0) | (1 << 30 if egg else 0)
    struct.pack_into("<I", misc, 4, word)
    rec[32:80] = growth + attacks + ev + misc
    rec[84] = level
    return bytes(rec)


def _section(sid, counter, payload=b""):
    sec = bytearray(SECTION)
    sec[:len(payload)] = payload
    struct.pack_into("<H", sec, 4084, sid)
    struct.pack_into("<I", sec, 4088, SIG)
    struct.pack_into("<I", sec, 4092, counter)
    if sid not in ub.NO_SUM:
        struct.pack_into("<H", sec, 4086, ub._checksum(bytes(sec[:ub.SUM_LENGTH.get(sid, 4080)])))
    return bytes(sec)


def make_save(party, *, player="LUIS", older=None, rtc=False):
    """Copy A holds ``older`` (an earlier party) with counter 7, copy B the current ``party`` with counter 8."""
    def copy(mons, counter):
        trainer = bytearray(SECTION)
        trainer[0:7] = bytes([{v: k for k, v in ub.CHARS.items()}[c] for c in player] + [0xFF] * (7 - len(player)))
        team = bytearray(SECTION)
        struct.pack_into("<I", team, 52, len(mons))
        for i, rec in enumerate(mons):
            team[56 + i * 100:56 + (i + 1) * 100] = rec
        out = b""
        for sid in range(SECTIONS):
            out += _section(sid, counter, bytes(trainer[:3876]) if sid == 0 else bytes(team[:4080]) if sid == 1 else b"")
        return out
    data = copy(older or party, 7) + copy(party, 8)
    data += b"\xff" * (131072 - len(data))
    return data + (b"\x00" * 16 if rtc else b"")


def _sid(name):
    return int(next(k for k, v in ub.tables()["species"].items() if v == name))


GARCHOMP = _sid("Garchomp")
CHARIZARD = _sid("Charizard")
RAICHU_ALOLA = _sid("Raichu-Alola")


def test_reads_the_newest_party():
    t = ub.tables()
    eq = next(k for k, v in t["moves"].items() if v == "Earthquake")
    dc = next(k for k, v in t["moves"].items() if v == "Draco Meteor")
    scarf = next(k for k, v in t["items"].items() if v == "Choice Scarf")
    party = [
        _record(GARCHOMP, int(scarf), [int(eq), int(dc)], pid=13, level=62, evs=(4, 252, 0, 252, 0, 0), ivs=(31, 31, 31, 31, 0, 31), nick="Chompy"),
        _record(CHARIZARD, 0, [int(eq)], pid=1, hidden=True),
        _record(RAICHU_ALOLA, 0, [int(eq)], pid=4),
        _record(CHARIZARD, 0, [int(eq)], pid=2, egg=True),
    ]
    old = [_record(RAICHU_ALOLA, 0, [int(eq)], pid=3)]
    out = ub.read_party(make_save(party, older=old, rtc=True))
    assert out["player"] == "LUIS"
    assert [s["species"] for s in out["sets"]] == ["Garchomp", "Charizard", "Raichu-Alola"]   # the newer copy; no egg
    g = out["sets"][0]
    assert g["item"] == "Choice Scarf" and g["moves"] == ["Earthquake", "Draco Meteor"] and g["level"] == 62 and g["nature"] == "Jolly"
    assert g["evs"]["Atk"] == 252 and g["evs"]["Spe"] == 252 and g["ivs"]["SpA"] == 0 and g["nickname"] == "Chompy"
    assert out["sets"][1]["ability"] == "Solar Power"                                  # the hidden-ability flag picks the third
    assert out["sets"][2]["ability"] == t["abilities"][str(t["species_abilities"][str(RAICHU_ALOLA)][0])]   # even PID: the first
    text = ub.showdown(out["sets"])
    assert "Chompy (Garchomp) @ Choice Scarf" in text and "Level: 62" in text and "IVs: 0 SpA" in text and "Jolly Nature" in text
    assert out["skipped"] == ["4: egg"]


def test_rejects_other_files():
    with pytest.raises(ub.NotASave):
        ub.read_party(b"\x00" * 1000)
    bad = bytearray(make_save([_record(GARCHOMP, 0, [89], pid=1)]))
    for k in range(2 * SECTIONS):          # every checksum broken: no complete copy
        bad[k * SECTION + 4086] ^= 0xFF
    with pytest.raises(ub.NotASave):
        ub.read_party(bytes(bad))
    assert not ub.looks_like_save(b"x" * 131072)


def test_import_makes_a_trainer(call):
    t = ub.tables()
    eq = next(k for k, v in t["moves"].items() if v == "Earthquake")
    data = make_save([_record(GARCHOMP, 0, [int(eq)], pid=13, level=70)], player="RED")
    out = call("unbound_save_import", {"data_base64": base64.b64encode(data).decode()})
    tr = out["trainer"]
    assert tr["name"] == "RED" and tr["format"] == "gen8customgame"
    assert tr["team"][0]["species"] == "Garchomp" and tr["team"][0]["level"] == 70


def test_import_route_takes_a_save_file(client):
    t = ub.tables()
    eq = next(k for k, v in t["moves"].items() if v == "Earthquake")
    data = make_save([_record(CHARIZARD, 0, [int(eq)], pid=0)], player="GOLD")
    r = client.post("/api/import/upload", files={"file": ("Unbound.sav", data)}, data={"name": "Mi partida"})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "trainer" and r.json()["trainer"]["name"] == "Mi partida"
