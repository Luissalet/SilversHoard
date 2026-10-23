"""Ultra Burst is exposed by the ordinary rules/cooldowns/battle handlers."""
from conftest import needs_engine


@needs_engine
def test_ultra_burst_native_handlers_preserve_fusion_and_separate_z(call):
    rules = call("rt_rules")
    assert "ultra_burst" in rules["controls"]
    assert any("Rules version 14" in r for r in rules["rules"])
    team = [{"species": "Necrozma-Dawn-Wings", "item": "Ultranecrozium Z", "shiny": True,
             "moves": ["Photon Geyser", "Protect"]}]
    cds = call("rt_cooldowns", {"team": team})["pokemon"][0]
    assert cds["species"] == "Necrozma-Dawn-Wings" and cds["ultra"]["species"] == "Necrozma-Ultra"
    assert cds["z_moves"][0] is None
    seat = {"team": team, "human": True}
    battle = call("battle_start", {"p1": seat, "p2": seat, "format": "gen9customgame", "mode": "realtime", "time_limit": 30})
    assert battle["rt"]["spec"]["version"] == 14
    rows = [[1, 0, 0, 0, -1, 0, -1, 1, 0, 1, 0, 0, 0, 0],
            [35, 0, 0, 0, 0, 0, -1, 1, 0, 0, 0, 0, 0, 1]]
    done = call("battle_rt_finish", {"id": battle["id"], "inputs": rows, "tick": 100, "forfeit": "p2"})
    assert any("Ultra Burst" in line for line in done["lines"])
    assert any("unleashed Light That Burns the Sky" in line for line in done["lines"])
    frame = call("battle_rt_inspect", {"id": battle["id"], "tick": 32})["view"]["sides"][0]
    mon = frame["mons"][0]
    assert mon["is_ultra"] and not mon["is_mega"] and mon["shiny"]
    assert mon["species"] == "Necrozma-Ultra" and mon["ability"] == "Neuroforce"
    assert frame["ultra_used"] and not frame["mega_used"] and not frame["z_used"]
    assert mon["moves"][0]["z_move"]["id"] == "lightthatburnsthesky"
