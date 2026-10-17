import copy

import pytest

from conftest import needs_engine
from silvers_hoard.errors import SilverError

pytestmark = needs_engine


def facility(services):
    for c in services.characters()["characters"]:
        for v in c["variants"]:
            if v.get("pool", 0) > 6 and len(v["sets"]) > 6:
                return c, v
    raise AssertionError("Missing facility pool")


def test_installed_pool_can_choose_any_six_without_editing_trainer(services, call):
    character, variant = facility(services)
    trainer = call("character_install", {"key": character["key"], "variant": variant["id"]})["trainer"]
    saved = copy.deepcopy(services.store.trainer(trainer["id"]))
    detail = call("trainer_get", {"id": trainer["id"]})
    assert len(detail["team_pool"]) == len(variant["sets"]) > 6
    assert detail["team_pool_indices"] == list(range(6))
    indices = list(range(len(variant["sets"]) - 1, len(variant["sets"]) - 7, -1))
    seat = services._seat({"trainer_id": trainer["id"], "team_indices": indices}, "A")
    assert seat["sets"] == [detail["team_pool"][i] for i in indices]
    assert services.store.trainer(trainer["id"]) == saved
    for invalid in ([0] * 6, [0, 1, 2], [-1, 0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 99999]):
        with pytest.raises(SilverError):
            services._seat({"trainer_id": trainer["id"], "team_indices": invalid}, "A")


def test_selected_install_is_idempotent_and_retains_full_pool(services, call):
    character, variant = facility(services)
    args = {"key": character["key"], "variant": variant["id"], "team_indices": [6, 5, 4, 3, 2, 1]}
    trainer = call("character_install", args)["trainer"]
    assert trainer["team"][0]["species"] == variant["sets"][6]["species"]
    assert call("character_install", args)["trainer"]["id"] == trainer["id"]
    detail = call("trainer_get", {"id": trainer["id"]})
    assert len(detail["team_pool"]) > 6
    assert detail["team_pool_indices"] == args["team_indices"]
    assert call("character_install", {"key": character["key"], "variant": variant["id"]})["trainer"]["id"] != trainer["id"]


@pytest.mark.parametrize("mode", ["classic", "realtime"])
def test_selected_six_reach_battle_engine(call, services, mode):
    team = [{"species": n, "moves": ["Tackle"]} for n in ["Pikachu", "Eevee", "Snorlax", "Bulbasaur", "Charmander", "Squirtle", "Pidgey"]]
    trainer = call("trainer_create", {"name": "Seven", "team": team, "format": "gen9customgame"})
    # trainer_create's normal API returns the trainer directly.
    indices = [6, 5, 4, 3, 2, 1]
    battle = call("battle_start", {"p1": {"trainer_id": trainer["id"], "human": True, "team_indices": indices},
                                  "p2": {"trainer_id": trainer["id"], "human": True}, "mode": mode})
    saved = services.store.battle(battle["id"])
    assert [s["species"] for s in saved["p1"]["sets"]] == [team[i]["species"] for i in indices]
    assert len(call("trainer_get", {"id": trainer["id"]})["team"]) == 7
    call("battle_forfeit", {"id": battle["id"], "side": "p1"})


@pytest.mark.parametrize("rename", [False, True])
def test_saving_facility_team_only_adds_actual_edits(call, rename):
    trainer = call("character_install", {"key": "giovanni", "variant": "usumbattleagency"})["trainer"]
    original = call("trainer_get", {"id": trainer["id"]})
    assert len(original["team_pool"]) == 11
    team = copy.deepcopy(original["team"])
    if rename:
        team[0]["name"] = "My Marowak"
    saved = call("trainer_update", {"id": trainer["id"], "team": team})
    assert len(saved["team_pool"]) == 11 + int(rename)
    assert saved["team_pool_indices"] == ([11, 1, 2, 3, 4, 5] if rename else list(range(6)))
    assert [saved["team_pool"][i] for i in saved["team_pool_indices"]] == saved["team"]
    # A second save must also remain stable after all defaults were normalized.
    again = call("trainer_update", {"id": trainer["id"], "team": saved["team"]})
    assert again["team_pool"] == saved["team_pool"]
    assert again["team_pool_indices"] == saved["team_pool_indices"]
