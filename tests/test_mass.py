"""Mass battles (mass.py): ready-made battles, building one from rosters and trainers' teams, the engine running it, keeping it on
disk, fighting it again with another seed, the screen's check, the limits, a person playing one Pokémon (here, by the tool and on a
friend's page with its code), the friend's page itself and the input log as it travels."""
import json
import re

from conftest import TEAM, needs_engine

from silvers_hoard import sharing

pytestmark = needs_engine


def test_presets_and_a_battle_royale(call, services):
    presets = call("mass_presets")["presets"]
    ids = [p["id"] for p in presets]
    assert {"kanto", "national", "starters", "top15", "gen1vs3", "johto_hoenn", "eternamax_kanto"} <= set(ids)
    assert all(p["mode"] in ("ffa", "teams", "boss") for p in presets)
    out = call("mass_start", {"preset": "starters", "seed": "royale"})
    assert out["id"].startswith("mass_") and out["units"] == 27 and out["mode"] == "ffa"
    assert out["title"] == "Los 27 iniciales en battle royale"
    s = out["summary"]
    assert s["ended"] and len(s["teams"]) == 27 and s["ranking"][0]["place"] == 1
    assert (services.config.data_dir / "mass" / f"{out['id']}.json").exists()
    got = call("mass_get", {"id": out["id"]})
    assert got["spec"]["mode"] == "ffa" and len(got["spec"]["teams"][0]["units"]) == 27 and got["hash"] == out["hash"]
    # the screen's own run ended the same way, or not
    assert call("mass_check", {"id": out["id"], "hash": out["hash"]})["same"] is True
    assert call("mass_check", {"id": out["id"], "hash": "nope"})["same"] is False
    # again: the same Pokémon with another seed
    again = call("mass_start", {"again": out["id"]})
    assert again["id"] != out["id"] and again["units"] == 27 and again["title"] == out["title"]
    assert again["spec"]["seed"] != got["spec"]["seed"]
    listed = call("mass_list")["battles"]
    assert [b["id"] for b in listed][:2] == [again["id"], out["id"]]
    call("mass_delete", {"id": again["id"]})
    call("mass_get", {"id": again["id"]}, status=404)


def test_teams_with_a_trainer_and_giants(call):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})
    out = call("mass_start", {"mode": "teams", "level": 50, "seed": "armies", "teams": [
        {"kind": "trainer", "trainer_id": me["id"]},
        {"kind": "top", "gens": [1], "count": 3, "name": "Kanto"},
    ]})
    names = [t["name"] for t in out["summary"]["teams"]]
    assert names == ["Luis", "Kanto"]
    assert out["spec"]["teams"][0]["units"][0]["set"]["species"] == "Garchomp"
    assert out["spec"]["level_rules"] == {"level": 50}
    boss = call("mass_start", {"mode": "boss", "seed": "giant", "teams": [
        {"kind": "species", "species": ["Mewtwo"]}, {"kind": "starters"}]})
    giant = boss["spec"]["teams"][0]["units"][0]["boss"]
    assert giant["hp"] > 1 and giant["size"] >= 2 and giant["power"] >= 1.5
    fixed = call("mass_start", {"mode": "boss", "seed": "giant2", "teams": [
        {"kind": "species", "species": ["Mewtwo"], "boss": {"hp": 7, "size": 3, "power": 2}}, {"kind": "starters"}]})
    assert fixed["spec"]["teams"][0]["units"][0]["boss"] == {"hp": 7, "size": 3, "power": 2}


def test_limits(call):
    every = {"kind": "dex", "gens": list(range(1, 10))}
    call("mass_start", {"mode": "teams", "teams": [every, every]}, status=400)                            # 2050 Pokémon
    call("mass_start", {"mode": "teams", "teams": [{"kind": "starters"}]}, status=400)                    # one team
    call("mass_start", {"mode": "boss", "teams": [{"kind": "starters"}]}, status=400)                     # no crowd
    call("mass_start", {"mode": "ffa", "teams": [{"kind": "species", "species": ["Missingno.x"]}]}, status=400)
    call("mass_start", {"preset": "nope"}, status=404)
    call("mass_get", {"id": "mass_../../etc"}, status=404)


def test_every_preset_fits_and_battles_are_never_dropped(call, services):
    # every ready-made battle composes within the limits (the biggest is the whole National Dex)
    for p in call("mass_presets")["presets"]:
        spec = services.mass.compose(preset=p["id"], seed="fit")
        assert sum(len(t["units"]) for t in spec["teams"]) <= 1100, p["id"]
    # nothing is deleted behind your back: battles stay until you delete them
    first = call("mass_start", {"preset": "starters", "seed": "keep"})
    for k in range(3):
        call("mass_start", {"preset": "starters", "seed": f"keep{k}"})
    assert call("mass_get", {"id": first["id"]})["id"] == first["id"]


# a short game: walk right for a second, fire the first move at the middle of the field, roll, then stand
ROWS = [[1, 1000, 0, -1, 0, 0, 0], [31, 0, 0, 0, 1500, 900, 0], [80, 0, -1000, -1, 0, 0, 1], [90, 0, 0, -1, 0, 0, 0]]


def test_the_input_log_travels_packed():
    assert sharing.decode_mass_inputs(sharing.encode_mass_inputs(ROWS)) == ROWS
    assert sharing.decode_mass_inputs("") == []
    for bad in ([[5, 0, 0, -1, 0, 0, 0], [4, 0, 0, -1, 0, 0, 0]],      # the ticks go back
                [[1, 2000, 0, -1, 0, 0, 0]],                           # off the stick
                [[1, 0, 0, 7, 0, 0, 0]],                               # no fifth move
                [[1, 0, 0, -1, 0, 0]]):                                 # a column short
        try:
            sharing.check_mass_rows(bad)
        except sharing.SilverError:
            continue
        raise AssertionError(bad)


def test_a_person_plays_one_pokemon(call):
    out = call("mass_start", {"mode": "boss", "seed": "played", "teams": [{"kind": "species", "species": ["Mewtwo"]}, {"kind": "starters"}]})
    first = call("mass_play", {"id": out["id"], "unit": 5, "inputs": ROWS})
    assert first["unit"] == 5 and first["name"] == "Cyndaquil" and first["of"] == 28 and first["source"] == "app"
    assert 1 <= first["place"] <= 28 and first["summary"]["player"]["inputs"] == 4
    # the same log replays to the same fingerprint; a screen that ended elsewhere is refused
    again = call("mass_play", {"id": out["id"], "unit": 5, "inputs": ROWS, "hash": first["hash"], "challenger": "Otra"})
    assert again["hash"] == first["hash"] and again["place"] == first["place"]
    call("mass_play", {"id": out["id"], "unit": 5, "inputs": ROWS, "hash": "nope"}, status=409)
    call("mass_play", {"id": out["id"], "unit": 99, "inputs": ROWS}, status=400)
    got = call("mass_get", {"id": out["id"]})
    assert len(got["plays"]) == 2 and "inputs" not in got["plays"][0]
    assert call("mass_list")["battles"][0]["played"] == 2
    run = call("mass_play_get", {"id": out["id"], "play_id": first["id"]})
    assert run["inputs"] == ROWS
    call("mass_play_delete", {"id": out["id"], "play_id": again["id"]})
    assert [p["id"] for p in call("mass_get", {"id": out["id"]})["plays"]] == [first["id"]]


def test_a_friends_page_and_its_code(call, services):
    out = call("mass_start", {"preset": "starters", "seed": "page"})
    call("mass_play", {"id": out["id"], "unit": 0, "inputs": ROWS})
    page = call("mass_export", {"id": out["id"]})
    assert call("mass_export", {"id": out["id"]})["file"] != page["file"]        # every export is a file of its own
    assert page["battle_id"] == out["id"] and page["hash"] == out["hash"]
    assert (services.config.exports_dir / page["file"]).stat().st_size == page["bytes"]
    call("mass_export", {"id": "mass_0000000000nope"}, status=404)
    html = (services.config.exports_dir / page["file"]).read_text(encoding="utf-8")
    data = json.loads(re.search(r'<script id="silver-data" type="application/json">(.*?)</script>', html, re.S).group(1))
    assert data["kind"] == "mass" and data["mass"]["id"] == out["id"] and len(data["mass"]["spec"]["teams"][0]["units"]) == 27
    assert data["mass"]["hash"] == out["hash"] and data["mass"]["plays"][0]["unit"] == 0
    # what the page gives back after the friend plays: replayed here and kept as the friend's run
    hash_ = services.engine.call("mass_run", {"spec": {**data["mass"]["spec"], "player": {"unit": 3}}, "inputs": ROWS})["hash"]
    code = sharing.pack_code(sharing.MASS_RESULT_PREFIX, {"kind": "mass", "v": 1, "mass_id": out["id"], "title": out["title"], "challenger": "Ana",
                                                           "unit": 3, "inputs": sharing.encode_mass_inputs(ROWS), "hash": hash_})
    got = call("import", {"content": "Mi partida: " + code})
    assert got["kind"] == "mass_result" and got["play"]["challenger"] == "Ana" and got["play"]["source"] == "friend"
    call("import", {"content": code}, status=409)                     # a code counts once
    tampered = sharing.pack_code(sharing.MASS_RESULT_PREFIX, {"kind": "mass", "mass_id": out["id"], "challenger": "Ana", "unit": 4,
                                                               "inputs": sharing.encode_mass_inputs(ROWS), "hash": hash_})
    call("import", {"content": tampered}, status=409)                 # another Pokémon: the replay does not end there
    # the page itself brings the battle into another app
    imported = call("import", {"content": html})
    assert imported["kind"] == "mass" and imported["mass"]["id"] != out["id"] and imported["mass"]["hash"] == out["hash"]
    assert call("mass_start", {"again": imported["mass"]["id"]})["units"] == 27
