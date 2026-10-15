"""Pokémon Unbound's Battle Frontier: its 14 special trainers as characters (a game card of their own, merged with the characters
that already exist), each pool of sets with Unbound's abilities, a trainer installed from a pool, and a battle between two of them."""
from conftest import wait_for


def test_unbound_card_and_characters(call):
    lst = call("characters_list", {"game": "unbound"})
    keys = {c["key"] for c in lst["characters"]}
    assert keys == {"palmer", "pat", "pablo", "paula", "skeli", "golche", "gail", "lixdel", "cynthia", "red", "bigmo", "galavan", "candice", "giovanni"}
    card = next(g for g in lst["games"] if g["id"] == "unbound")
    assert card["gen"] == 8 and card["side"] and card["characters"] == 14 and card["categories"] == {"facilities": 14}
    assert "Unbound" in lst["source"] and "Bulbapedia" in lst["source"]
    skeli = call("character_get", {"key": "skeli"})
    assert [v["id"] for v in skeli["variants"]] == ["unbound-special", "unbound-legendary", "unbound-middlecup", "unbound-littlecup"]
    special = skeli["variants"][0]
    assert special["pool"] >= 6 and special["format"] == "gen8customgame" and special["trainer_class_es"] == "Desarrollador"
    assert len(set(special["species"][:6])) == 6                  # the first six are different species
    assert skeli["variants"][3]["max_level"] == 5                  # Little Cup
    assert not skeli["bulbapedia"]                                 # a character made for Unbound has no Bulbapedia page
    # Unbound's abilities, not the main games': its Pidgeot line and Talonflame
    talon = next(s for v in skeli["variants"] for s in v["sets"] if s["species"] == "Talonflame")
    assert talon["ability"] == "Gale Wings"
    # a character of the main games keeps its teams and gains Unbound's
    palmer = call("character_get", {"key": "palmer"})
    ids = [v["id"] for v in palmer["variants"]]
    assert any(i.startswith("unbound-") for i in ids) and any(not i.startswith("unbound-") for i in ids) and palmer["bulbapedia"]


def test_an_unbound_trainer_plays(call):
    a = call("character_install", {"key": "skeli", "variant": "unbound-special"})["trainer"]
    assert len(a["team"]) == 6 and a["format"] == "gen8customgame" and "Unbound" in a["notes"] and "Bulbapedia" not in a["notes"]
    b = call("character_install", {"key": "golche", "variant": "unbound-special"})["trainer"]
    battle = call("battle_start", {"p1": {"trainer_id": a["id"], "human": False}, "p2": {"trainer_id": b["id"], "human": False}, "format": a["format"]})
    done = wait_for(lambda: (lambda x: x if x["status"] == "ended" else None)(call("battle_get", {"id": battle["id"]})))
    assert done["status"] == "ended" and done["winner_side"] in ("p1", "p2", "")
