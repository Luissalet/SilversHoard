"""The pixelfx_map tool: which pixel-art effect a move, a type or a status plays in the "pixelfx" animation style."""

import subprocess
from pathlib import Path

from silvers_hoard.agent_tools import call_tool

ROOT = Path(__file__).resolve().parents[1]
TYPES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying",
         "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"]


def test_catalog_lists_effects_types_and_statuses(services):
    r = call_tool(services, "pixelfx_map", {})
    assert r["effects"] >= 70 and r["types"] == sorted(TYPES)
    assert "fire/fireball" in r["effect_ids"] and r["moves"] > 800
    assert set(r["statuses"]) == {"brn", "par", "psn", "tox", "frz", "slp"}


def test_a_move_gets_its_effect_by_type_category_and_shape(services):
    flame = call_tool(services, "pixelfx_map", {"move": "Flamethrower"})
    assert flame["type"] == "Fire" and flame["category"] == "Special" and flame["shape"] == "beam"
    assert flame["role"] == "beam" and flame["effect"].startswith("fire/")
    water = call_tool(services, "pixelfx_map", {"move": "water-gun"})
    assert water["effect"].startswith("water/")
    swords = call_tool(services, "pixelfx_map", {"move": "swordsdance"})
    assert swords["category"] == "Status" and swords["role"] == "self"
    assert call_tool(services, "pixelfx_map", {"move": "nonsense"})["error"]


def test_every_type_has_an_effect_for_every_category_and_shape(services):
    for type_ in TYPES:
        r = call_tool(services, "pixelfx_map", {"type": type_})
        assert set(r["by_category"]) == {"Physical", "Special", "Status"}
        assert r["by_category"]["Physical"]["role"] == "impact"
        assert r["by_category"]["Special"]["role"] == "projectile"
        assert r["by_category"]["Status"]["role"] == "self"
        assert len(r["by_shape"]) == 10 and all(p["effect"] for p in r["by_shape"].values())
        assert call_tool(services, "pixelfx_map", {"type": type_.lower(), "category": "Special"})["plan"]["effect"] == r["by_category"]["Special"]["effect"]
    assert call_tool(services, "pixelfx_map", {"type": "Fire", "shape": "drop"})["plan"]["role"] == "drop"
    assert call_tool(services, "pixelfx_map", {"type": "Stellar"})["error"]


def test_status_effects(services):
    assert call_tool(services, "pixelfx_map", {"status": "brn"})["plan"]["effect"] == "fire/torch"
    assert call_tool(services, "pixelfx_map", {"status": "xyz"})["error"]


def test_the_preset_matches_the_client_table(services):
    """The JSON is written by scripts/gen_pixelfx_map.mjs from client/src/battle/pixelfx/mapping.js: it must not be stale."""
    done = subprocess.run(["node", "scripts/gen_pixelfx_map.mjs", "--check"], cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr
