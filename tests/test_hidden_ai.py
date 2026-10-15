"""An AI that does not see the opponent's team: the seat option and the setting, its guesses from the usage statistics, a battle
played that way with the notes saying so, and the expert's advice for a person not seeing the AI's team either."""
from conftest import needs_engine

from test_smogon import FakeSite

MINE = "Garchomp\nAbility: Rough Skin\n- Earthquake\n- Dragon Claw\n- Swords Dance\n\nLucario\n- Aura Sphere\n- Flash Cannon\n"
THEIRS = "Great Tusk\n- Headlong Rush\n- Ice Spinner\n\nKingambit\n- Kowtow Cleave\n- Sucker Punch\n"


def test_beliefs_from_usage(services):
    services.smogon.fetch = FakeSite()
    b = services._beliefs([{"species": "Great Tusk"}, {"species": "Kingambit"}, {"species": "Pikachu"}], "gen9ou")
    assert b["Great Tusk"]["moves"][:2] == ["Headlong Rush", "Rapid Spin"] and b["Great Tusk"]["item"] == "Rocky Helmet"
    assert b["Great Tusk"]["ability"] == "Protosynthesis" and b["Great Tusk"]["tera"] == "Steel"
    assert b["Kingambit"]["moves"][0] == "Swords Dance"           # no usage moves: the first popular set's
    assert "Pikachu" not in b
    services.settings_set({"smogon_data": False})
    assert services._beliefs([{"species": "Great Tusk"}], "gen9ou") == {}


def test_seat_option_and_setting(services):
    services.smogon.fetch = FakeSite()
    seat = services._seat({"paste": MINE, "name": "A", "ai_hidden": True}, "x")
    assert seat["ai"]["hidden"] is True
    assert "hidden" not in services._seat({"paste": MINE, "name": "A"}, "x")["ai"]
    services.settings_set({"ai_hidden_info": True})
    assert services._seat({"paste": MINE, "name": "A"}, "x")["ai"]["hidden"] is True
    assert "hidden" not in services._seat({"paste": MINE, "name": "A", "ai_hidden": False}, "x")["ai"]


@needs_engine
def test_a_battle_without_seeing_and_fair_advice(call, services):
    services.smogon.fetch = FakeSite()
    b = call("battle_start", {"p1": {"paste": MINE, "name": "Yo", "human": True}, "p2": {"paste": THEIRS, "name": "Ciega", "ai_level": "expert", "ai_hidden": True},
                              "format": "gen9customgame"})
    stored = services.store.battle(b["id"])
    assert stored["p2"]["ai"]["hidden"] is True and isinstance(stored["p2"]["ai"]["beliefs"], dict)
    call("battle_choose", {"id": b["id"], "side": "p1", "choice": "default"})
    call("battle_choose", {"id": b["id"], "side": "p1", "choice": "move 1"})
    r = call("battle_explain", {"id": b["id"], "side": "p2", "limit": 20})
    turns = [n for n in r["notes"] if n["kind"] == "turn"]
    assert turns and all(n.get("hidden") for n in turns)
    assert any("not seeing the other team" in t for t in r["text"])
    adv = call("battle_explain", {"id": b["id"], "side": "p1", "limit": 1})["advice"]["p1"]
    # the random seed sometimes knocks out the first Pokémon, and then the advice is which one to send in
    assert adv["kind"] in ("turn", "switch_in") and adv.get("hidden") is True
