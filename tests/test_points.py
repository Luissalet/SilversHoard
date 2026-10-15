from conftest import TEAM, needs_engine

pytestmark = needs_engine


def test_stat_points_read_and_write(call):
    """Champions' stat points: read from EVs (HOME's rule), written back as EVs, 66 in all and 32 per stat."""
    tr = call("trainer_create", {"name": "Puntos", "paste": TEAM, "format": "gen9customgame"})
    r = call("stat_points", {"trainer_id": tr["id"]})
    chomp = r["pokemon"][0]
    assert chomp["points"] == {"hp": 0, "atk": 32, "def": 0, "spa": 0, "spd": 1, "spe": 32} and chomp["points_total"] == 65
    assert r["limits"] == {"total": 66, "per_stat": 32}
    # Level 100 Jolly Garchomp with 252 Speed EVs: 333
    assert chomp["stats"]["spe"] == 333
    new = call("stat_points", {"trainer_id": tr["id"], "points": {"0": {"hp": 32, "def": 32, "spe": 2}}, "save": True})
    assert new["saved"] and new["sets"][0]["evs"] == {"hp": 252, "atk": 0, "def": 252, "spa": 0, "spd": 0, "spe": 12}
    assert call("trainer_get", {"id": tr["id"]})["team"][0]["evs"]["def"] == 252
    call("stat_points", {"trainer_id": tr["id"], "points": {"0": {"atk": 33}}}, status=400)
    call("stat_points", {"trainer_id": tr["id"], "points": {"0": {"hp": 32, "atk": 32, "def": 3}}}, status=400)
    # the trainer page's summary shows them too
    assert call("trainer_get", {"id": tr["id"]})["summary"][0]["points"]["def"] == 32
