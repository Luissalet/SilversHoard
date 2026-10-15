"""Pokémon Champions formats through the app: listed, validated with Champions' rules and played to the end."""
from conftest import TEAM, needs_engine, wait_for

pytestmark = needs_engine


def test_champions_formats_and_battle(call):
    formats = {f["id"]: f for f in call("formats_list", {"query": "champions"})["formats"]}
    assert "gen9championsbssregmb" in formats and formats["gen9championsvgc2026regmb"]["game_type"] == "doubles"
    a = call("trainer_create", {"name": "Ana", "paste": TEAM, "format": "gen9championscustomgame"})
    b = call("trainer_create", {"name": "Bea", "paste": TEAM, "format": "gen9championscustomgame"})
    bt = call("battle_start", {"p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}, "seed": "champ"})
    done = wait_for(lambda: (x := call("battle_get", {"id": bt["id"]}))["status"] in ("ended", "failed") and x)
    assert done["status"] == "ended" and done["format"] == "gen9championscustomgame"
    # Garchomp with 32 stat points in HP would have 108 + 32 + 75; the team has none in HP: 108 + 75 = 183 HP at the start
    assert any("|switch|p1a: Garchomp|" in l and "|183/183" in l for l in done["lines"])
