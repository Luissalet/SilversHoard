from conftest import needs_engine

pytestmark = needs_engine


def test_every_game_league_installs_from_the_characters(call, services):
    listed = {lg["key"]: lg for lg in call("canon_list", {})["leagues"]}
    keys = ["kanto-rgb", "johto-hgss", "kanto-hgss", "hoenn-oras", "sinnoh-pt", "unova-bw", "unova-b2w2", "kalos-xy", "alola-sm", "alola-usum", "galar-sw", "paldea-sv"]
    assert set(keys) <= set(listed) and len(listed["sinnoh-pt"]["gyms"]) == 8 and not listed["alola-sm"]["gyms"]
    for key in keys:
        lg = call("canon_install", {"league_key": key})["league"]
        want = len(listed[key]["gyms"])
        assert len(lg["gyms"]) == want and lg["badges_required"] == want, key
        assert len(lg["elite_four"]) == len(listed[key]["elite_four"]) and lg["champion_id"], key
    again = call("canon_install", {"league_key": "kalos-xy"})["league"]   # installed once
    assert again["id"] == call("canon_list", {})["leagues"][[x["key"] for x in call("canon_list", {})["leagues"]].index("kalos-xy")]["installed_id"]
    pt = next(g for g in services.store.gyms() if g.get("canon_key") == "sinnoh-pt:fantina")
    assert pt["name"] == "Gimnasio de Ciudad Corazón" and pt["badge"] == "Medalla Reliquia" and pt["type"] == "Ghost"
    assert services.store.trainer(pt["leader_id"])["team"]
    galar = next(g for g in services.store.gyms() if g.get("canon_key") == "galar-sw:milo")
    assert galar["name"] == "Estadio de Hoyuelo"


def test_a_character_listed_twice_keeps_all_its_teams(call):
    kukui = call("character_get", {"key": "kukui"})
    ids = {v["id"] for v in kukui["variants"]}
    assert {"smchampionbattleincineroar", "usumbattletree"} <= ids
