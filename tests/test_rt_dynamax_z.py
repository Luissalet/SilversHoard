"""Real-time mechanics use native API data and survive both portable input encodings."""
import pytest
from conftest import needs_engine
from silvers_hoard import sharing


def test_special_rows_roundtrip_and_reject_non_boolean_flags():
    rows = [[1, 0, .5, -.25, -1, 0, -1, 1, 0, 0, 0, 0, 1, 0],
            [100, 0, 0, 0, 0, 0, -1, 1, 0, 0, 0, 0, 0, 1]]
    assert sharing.decode_rt_inputs(sharing.encode_rt_inputs(rows)) == rows
    rows[0][-2] = 2
    with pytest.raises(Exception, match="damaged"):
        sharing.decode_rt_inputs(sharing.encode_rt_inputs(rows))


@needs_engine
def test_api_exposes_dynamax_and_z_and_replays_a_transformation(call):
    rules = call("rt_rules")
    assert {"dynamax", "zmove"} <= rules["controls"].keys()
    assert not any("Dynamax" in item or "Z-Moves" in item for item in rules["not_covered"])
    team = [{"species": "Pikachu", "gigantamax": True, "moves": ["Thunderbolt", "Protect"]}]
    seat = {"team": team, "human": True}
    battle = call("battle_start", {"p1": seat, "p2": seat, "format": "gen9customgame", "mode": "realtime", "time_limit": 30})
    assert battle["rt"]["spec"]["version"] == 13
    assert battle["rt"]["spec"]["p1"]["sets"][0]["gigantamax"] is True
    inputs = [[1, 0, 0, 0, -1, 0, -1, 1, 0, 0, 0, 0, 1, 0]]
    done = call("battle_rt_finish", {"id": battle["id"], "inputs": inputs, "tick": 60, "forfeit": "p1"})
    assert any("Dynamaxed" in line for line in done["lines"])
    frame = call("battle_rt_inspect", {"id": battle["id"], "tick": 30})
    mon = frame["view"]["sides"][0]["mons"][0]
    assert mon["is_dynamax"] and mon["species"] == "Pikachu-Gmax" and mon["display_scale"] == 2.2
    assert mon["moves"][0]["id"] == "gmaxvoltcrash"
    cds = call("rt_cooldowns", {"team": [{"species": "Pikachu", "item": "Electrium Z", "moves": ["Thunderbolt"]}]})
    assert cds["pokemon"][0]["z_moves"][0]["power"] == 175
