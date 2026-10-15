"""The master AI: the helper script (poke-engine's search on a state and its answer as slots of the team), the ai_levels tool and a
battle against the master with its searched futures in the notes. The parts that need poke-engine skip without it."""
import importlib.util
import json
import subprocess
import sys

import pytest

from conftest import needs_engine
from silvers_hoard.engine import MASTER_SCRIPT, master_env, master_status

HAS_PE = importlib.util.find_spec("poke_engine") is not None
needs_pe = pytest.mark.skipif(not HAS_PE, reason="poke-engine is not installed")

MINE = "Garchomp @ Life Orb\nAbility: Rough Skin\nTera Type: Fire\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Swords Dance\n- Fire Fang\n\nRotom-Wash\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n"
THEIRS = "Heatran @ Leftovers\nAbility: Flash Fire\nEVs: 252 SpA / 252 Spe\nTimid Nature\n- Magma Storm\n- Earth Power\n- Flash Cannon\n- Protect\n\nCorviknight\n- Brave Bird\n- Roost\n"


def mon(name, types, moves, hp=300, spe=200, tera="normal"):
    return {"id": name, "level": 100, "types": types, "base_types": types, "hp": hp, "maxhp": 300, "ability": "none", "base_ability": "none",
            "item": "none", "nature": "serious", "evs": [85] * 6, "attack": 250, "defense": 250, "special_attack": 250, "special_defense": 250,
            "speed": spe, "status": "none", "rest_turns": 0, "sleep_turns": 0, "weight_kg": 50.0, "terastallized": False, "tera_type": tera,
            "mega_evolved": False, "moves": [{"id": m, "pp": 16, "disabled": False} for m in moves]}


def run(state, ms=200):
    r = subprocess.run([sys.executable, str(MASTER_SCRIPT)], input=json.dumps({"state": state, "ms": ms}), capture_output=True, text=True, timeout=60)
    return json.loads(r.stdout.strip().splitlines()[-1])


def side(mons, can_tera=True, **kw):
    return {"pokemon": mons, "active_index": "0", "side_conditions": {}, "volatile_statuses": [], "volatile_status_durations": {},
            "boosts": {}, "substitute_health": 0, "last_used_move": "move:none", "wish": [0, 0], "can_tera": can_tera, **kw}


@needs_pe
def test_helper_searches_and_answers_in_slots():
    assert master_status(refresh=True)["available"] is True
    state = {"side_one": side([mon("garchomp", ["dragon", "ground"], ["earthquake", "splash"]), mon("rotomwash", ["electric", "water"], ["hydropump"])]),
             "side_two": side([mon("heatran", ["fire", "steel"], ["magmastorm"], spe=100)]), "weather": "none", "terrain": "none"}
    out = run(state)
    assert out["ok"] and out["iterations"] > 100
    kinds = {(o["kind"], o["index"], o.get("tera", False)) for o in out["options"]}
    assert ("move", 0, False) in kinds and ("move", 0, True) in kinds and ("switch", 1) in {(k, i) for k, i, _ in kinds}
    best = max(out["options"], key=lambda o: o["visits"])
    assert best["kind"] == "move" and best["index"] == 0        # Earthquake on Heatran, not Splash
    # a side that may not terastallize gets no Terastallization options
    state["side_one"]["can_tera"] = False
    assert not any(o.get("tera") for o in run(state)["options"])
    # a state poke-engine cannot read is an error, not a crash
    state["weather"] = "nonsense"
    bad = run(state)
    assert bad["ok"] is False and bad["error"]


def test_env_and_levels(services):
    env = master_env()
    assert ("SILVER_MASTER_PY" in env) == master_status()["available"]
    r = services.ai_levels()
    master = next(x for x in r["levels"] if x["level"] == "master")
    assert "poke-engine" in master["about"]
    assert set(r["master"]) >= {"available", "reason", "hint"}
    assert services.health()["master_ai"]["available"] == r["master"]["available"]


@needs_engine
@needs_pe
def test_a_battle_against_the_master(call):
    b = call("battle_start", {"p1": {"paste": MINE, "name": "Yo", "human": True}, "p2": {"paste": THEIRS, "name": "Maestra", "ai_level": "master"},
                              "format": "gen9customgame"})
    b = call("battle_choose", {"id": b["id"], "side": "p1", "choice": "default"})      # team preview
    for _ in range(2):
        b = call("battle_choose", {"id": b["id"], "side": "p1", "choice": "move 1"})
        if b["status"] != "live":
            break
    r = call("battle_explain", {"id": b["id"], "side": "p2", "advice": False, "limit": 50})
    turns = [n for n in r["notes"] if n["kind"] == "turn"]
    assert turns and all(n["level"] == "master" for n in turns)
    searched = [n for n in turns if n.get("search")]
    assert searched, r["notes"]
    s = searched[0]["search"]
    assert s["iterations"] > 100 and s["options"][0]["share"] > 0 and s["options"][0]["label"]
    assert any("possible futures" in t for t in r["text"])
