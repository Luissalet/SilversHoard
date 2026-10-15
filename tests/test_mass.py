"""Mass battles (mass.py): ready-made battles, building one from rosters and trainers' teams, the engine running it, keeping it on
disk, fighting it again with another seed, the screen's check, and the limits."""
from conftest import TEAM, needs_engine

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
