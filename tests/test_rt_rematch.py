"""Rematches can use the exact custom field already present in a saved RT view."""
import pytest

from conftest import needs_engine
from silvers_hoard.agent_tools import BattleStartArgs


def test_battle_start_schema_accepts_a_saved_custom_field():
    field = {"name": "Pasillo Ñ", "floor": "ice", "rocks": [{"x": 14, "y": 8, "r": 1}]}
    args = BattleStartArgs.model_validate({"p1": {}, "p2": {}, "mode": "realtime", "rt_arena": field})
    assert args.rt_arena == field


@needs_engine
def test_rematch_uses_saved_custom_field_after_the_original_arena_changes(call):
    arena = call("arena_save", {"name": "Pasillo Ñ", "floor": "ice", "rocks": [{"x": 14, "y": 8, "r": 1}]})
    args = {"p1": {"name": "A", "paste": "Pikachu\n- Splash", "human": True},
            "p2": {"name": "B", "paste": "Snorlax\n- Splash", "human": True},
            "mode": "realtime", "format": "gen9customgame", "rt_arena": arena["value"], "time_limit": 30}
    first = call("battle_start", args)
    ended = call("battle_rt_finish", {"id": first["id"], "tick": 0, "inputs": [], "forfeit": "p1"})
    field = ended["rt"]["arena"]
    call("arena_save", {"id": arena["id"], "name": "Edited", "floor": "sand", "rocks": []})
    call("arenas_delete", {"ids": [arena["id"]]})
    again = call("battle_start", {**args, "rt_arena": field})
    assert again["id"] != ended["id"]
    assert again["rt"]["arena"] == {key: field[key] for key in ("name", "floor", "rocks")}
    assert call("arenas_list", {})["arenas"] == []
    assert again["rt"]["tick"] == 0 and again["rt"]["forfeit"] == ""
    assert call("battle_get", {"id": first["id"]}) == ended
    call("battle_rt_finish", {"id": again["id"], "tick": 1, "inputs": [], "forfeit": "p2"})


@pytest.mark.parametrize("rocks", [[{"x": 5, "y": 8.5, "r": 1}], [{"x": 14, "y": 8, "r": 99}]])
def test_saved_fields_keep_the_existing_rock_validation(call, rocks):
    result = call("battle_start", {"p1": {}, "p2": {}, "mode": "realtime", "rt_arena": {"name": "Bad", "floor": "ice", "rocks": rocks}}, status=400)
    assert "spot" in result["error"] or "radius" in result["error"]
