"""Composition: commentary language and real-time rule choices remain independent."""
import pytest

from conftest import needs_engine

pytestmark = needs_engine


@pytest.mark.parametrize("special", [False, True])
def test_cup_keeps_language_and_special_choice_after_settings_change(call, services, special):
    seats = [call("trainer_create", {"name": name, "format": "gen9customgame",
                                    "paste": "Magikarp\n- Splash"})["id"] for name in ("Snapshot A", "Snapshot B")]
    call("settings_set", {"rt_silver_special": special})
    cup = call("cup_start", {"trainer_ids": seats, "human_id": seats[0], "format": "gen9customgame",
                             "mode": "realtime", "lang": "es", "time_limit": 30})
    assert cup["spec"]["lang"] == "es" and cup["spec"]["silver_special"] is special
    call("settings_set", {"rt_silver_special": not special})
    game = call("cup_play", {"id": cup["id"]})
    saved = services.store.battle(game["battle_id"])
    assert saved["replay"]["version"] == 11 and saved["replay"]["silver_special"] is special
    assert call("cup_get", {"id": cup["id"]})["spec"]["lang"] == "es"
    call("battle_forfeit", {"id": game["battle_id"], "side": "p1"})
