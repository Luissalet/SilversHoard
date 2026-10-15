"""Mass battles (mass.py): ready-made battles, building one from rosters and trainers' teams, the engine running it, keeping it on
disk, fighting it again with another seed, the screen's check, and the limits."""
from conftest import TEAM, needs_engine

pytestmark = needs_engine


def test_presets_and_a_battle_royale(call, services):
    presets = call("mass_presets")["presets"]
    ids = [p["id"] for p in presets]
    assert {"kanto", "starters", "top15", "gen1vs3", "eternamax_kanto"} <= set(ids)
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
    call("mass_start", {"mode": "ffa", "teams": [{"kind": "dex", "gens": [1, 2, 3]}]}, status=400)       # 386 Pokémon
    call("mass_start", {"mode": "teams", "teams": [{"kind": "starters"}]}, status=400)                    # one team
    call("mass_start", {"mode": "boss", "teams": [{"kind": "starters"}]}, status=400)                     # no crowd
    call("mass_start", {"mode": "ffa", "teams": [{"kind": "species", "species": ["Missingno.x"]}]}, status=400)
    call("mass_start", {"preset": "nope"}, status=404)
    call("mass_get", {"id": "mass_../../etc"}, status=404)
