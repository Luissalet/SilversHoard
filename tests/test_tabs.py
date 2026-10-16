from conftest import TEAM, needs_engine

pytestmark = needs_engine


def test_own_trainers_include_the_random_ones_you_rolled(call):
    own = call("trainer_create", {"name": "Mío", "paste": TEAM})
    rnd = call("trainer_random", {"seed": "own-tab"})
    assert rnd["origin"] == "random"
    ids = {t["id"] for t in call("trainers_list", {"origin": "own"})["trainers"]}
    assert {own["id"], rnd["id"]} <= ids
    only_random = {t["id"] for t in call("trainers_list", {"origin": "random"})["trainers"]}
    assert rnd["id"] in only_random and own["id"] not in only_random
    # renaming, re-teaming or re-drawing a random trainer makes it yours; a star does not
    fav = call("trainer_random", {"seed": "fav"})
    assert call("trainer_update", {"id": fav["id"], "favorite": True})["origin"] == "random"
    up = call("trainer_update", {"id": rnd["id"], "name": "Luis"})
    assert up["origin"] == "own"
    assert rnd["id"] not in {t["id"] for t in call("trainers_list", {"origin": "random"})["trainers"]}
    assert rnd["id"] in {t["id"] for t in call("trainers_list", {"origin": "own"})["trainers"]}


def test_every_game_league_is_listed_before_it_is_installed(call, services):
    from silvers_hoard import game_leagues
    cat = call("leagues_catalog", {})["leagues"]
    keys = [lg["key"] for lg in cat]
    total = len(game_leagues.LEAGUES) + len(services.canon()["leagues"])
    assert len(keys) == len(set(keys)) == total and total >= 15 and keys[0] == "kanto-rgb"
    assert [lg["gen"] for lg in cat] == sorted(lg["gen"] for lg in cat)
    pt = next(lg for lg in cat if lg["key"] == "sinnoh-pt")
    assert pt["id"] == "" and not pt["installed"] and len(pt["gym_list"]) == 8 and len(pt["elite_list"]) == 4
    assert pt["champion"]["name"] and pt["champion"]["avatar_url"].startswith("/api/sprites/trainers/")
    assert all(g["badge"] and g["badge_color"].startswith("#") for g in pt["gym_list"])
    em = next(lg for lg in cat if lg["key"] == "hoenn-emerald")
    assert len(em["gym_list"]) == 8 and len(em["elite_list"]) == 4 and em["champion"]["avatar_url"]
    lg = call("canon_install", {"league_key": "sinnoh-pt"})["league"]
    pt2 = next(x for x in call("leagues_catalog", {})["leagues"] if x["key"] == "sinnoh-pt")
    assert pt2["installed"] and pt2["id"] == lg["id"] and pt2["elite_list"][0]["id"].startswith("tr_")
    assert len(call("leagues_catalog", {})["leagues"]) == total
    assert [x["id"] for x in call("leagues_list", {"origin": "canon"})["leagues"]] == [lg["id"]]
    assert call("leagues_list", {"origin": "own"})["leagues"] == [] and call("leagues_list", {"origin": "friend"})["leagues"] == []
