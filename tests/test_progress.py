from conftest import needs_engine, wait_for

pytestmark = needs_engine


def test_progress_from_battles(call):
    a = call("trainer_random", {"name": "Progreso A", "format": "gen9customgame", "seed": "pa"})
    b = call("trainer_random", {"name": "Progreso B", "format": "gen9customgame", "seed": "pb"})
    aid, bid = (a.get("trainer") or a)["id"], (b.get("trainer") or b)["id"]
    empty = call("progress_get", {"trainer_id": aid})
    assert empty["record"]["battles"] == 0 and not any(x["unlocked"] for x in empty["achievements"]) and empty["pokedex"]["used"]
    battle = call("battle_start", {"p1": {"trainer_id": aid}, "p2": {"trainer_id": bid}, "format": "gen9customgame"})
    wait_for(lambda: call("battle_get", {"id": battle["id"]})["status"] == "ended", timeout=300)
    pa, pb = call("progress_get", {"trainer_id": aid}), call("progress_get", {"trainer_id": bid})
    assert pa["record"]["battles"] == pb["record"]["battles"] == 1
    assert pa["record"]["wins"] + pb["record"]["wins"] + pa["record"]["ties"] == 1
    winner = pa if pa["record"]["wins"] else pb
    assert winner["streaks"]["best"] == 1 and next(x for x in winner["achievements"] if x["id"] == "first_win")["unlocked"]
    assert winner["mvp"] and winner["pokedex"]["seen"] and winner["by_kind"]["watch"]["wins"] == 1
    ranking = call("progress_list", {})["trainers"]
    assert {aid, bid} <= {r["trainer_id"] for r in ranking} and ranking[0]["record"]["wins"] >= 1
    call("canon_install", {"league_key": "kalos-xy"})
    assert len(call("progress_list", {})["trainers"]) == len(ranking)   # in-game trainers are not ranked
