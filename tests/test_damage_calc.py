from conftest import TEAM, needs_engine

pytestmark = needs_engine

TRAN = "Heatran @ Leftovers\nAbility: Flash Fire\nEVs: 252 HP / 4 SpA / 252 SpD\nCalm Nature\n- Magma Storm\n"


def test_damage_calc_tool(call):
    chomp = TEAM.split("\n\n")[0]
    r = call("damage_calc", {"attacker": chomp, "defender": TRAN})
    eq = next(m for m in r["moves"] if m["id"] == "earthquake")
    assert len(eq["rolls"]) == 16 and eq["ohko_rolls"] == 16 and eq["ko"]["hits"] == 1
    assert r["defender"]["species"] == "Heatran" and r["defender_hp"] == r["defender"]["maxhp"]
    # a set as JSON, field conditions, boosts, Tera and HP left go through the tool
    rotom = call("team_import", {"text": TEAM})["sets"][1]
    w = call("damage_calc", {"attacker": rotom, "defender": TRAN, "moves": ["Hydro Pump"], "weather": "rain", "screens": ["lightscreen"],
                             "attacker_boosts": {"spa": 2}, "defender_hp": 40, "attacker_tera": "yes"})
    assert w["field"]["weather"] == "raindance" and w["field"]["screens"] == ["lightscreen"]
    assert w["attacker"]["boosts"]["spa"] == 2 and w["defender_hp"] < w["defender"]["maxhp"] / 2
    assert [m["id"] for m in w["moves"]] == ["hydropump"]
    call("damage_calc", {"attacker": chomp, "defender": TRAN, "weather": "fog"}, status=400)
