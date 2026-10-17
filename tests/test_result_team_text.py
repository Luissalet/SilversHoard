"""Optional Showdown text never changes replay verification or counts a result twice."""
import copy

import pytest

from conftest import needs_engine
from silvers_hoard import sharing
from test_verified_results import play, result
from test_friend_realtime import result as rt_result, stage_for

pytestmark = needs_engine


@pytest.fixture
def played(call, services):
    rival = call("trainer_create", {"name": "Pez", "paste": "Magikarp\nLevel: 1\n- Splash",
                                     "format": "gen9customgame", "ai_level": "easy"})
    gym = call("gym_save", {"name": "Team text gym", "leader_id": rival["id"], "format": "gen9customgame"})
    team = services.import_team("Pikachu\nLevel: 100\n- Thunderbolt")["sets"]
    world = {"weak": rival, "gym": gym, "team": team}
    payload = result(services, world, play(services, rival, team))
    assert payload["won"]
    payload.pop("team_paste")
    return payload


def import_result(call, payload, status=200):
    return call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX, payload)}, status=status)


def test_without_text_still_verifies_without_exposing_extra_text(call, played):
    out = import_result(call, played)
    assert out["verified"] is True and out["won"] is True
    assert "team_paste" not in out


def test_included_text_comes_from_the_verified_team_and_can_be_saved(call, services, played):
    payload = {**played, "team_paste": "Pikachu\n- Splash"}
    expected = services.export_team(played["team"])
    before = len(call("trainers_list", {})["trainers"])
    out = import_result(call, payload)
    assert out["verified"] is True and out["team_paste"] == expected
    assert out["team_format"] == "gen9customgame"
    assert len(call("trainers_list", {})["trainers"]) == before, "importing the result does not save a trainer"
    saved = call("trainer_create", {"name": out["challenger"], "format": out["team_format"], "paste": out["team_paste"]})
    assert services.export_team(saved["team"]) == expected


@pytest.mark.parametrize("first_includes_text", [False, True])
def test_both_presentations_of_one_result_count_once(call, services, played, first_includes_text):
    with_text = {**played, "team_paste": services.export_team(played["team"])}
    first, second = (with_text, played) if first_includes_text else (played, with_text)
    imported = import_result(call, first)
    assert imported["verified"] is True
    before = len(call("battles_list", {})["battles"])
    import_result(call, second, status=409)
    assert len(call("battles_list", {})["battles"]) == before
    assert len(call("badges_list", {})["badges"]) == 1


@pytest.mark.parametrize("legacy_has_text", [False, True])
def test_existing_legacy_fingerprint_still_blocks_an_import_without_text(call, services, played, legacy_has_text):
    legacy = copy.deepcopy(played)
    legacy["team_paste"] = services.export_team(legacy["team"]) if legacy_has_text else ""
    old_fingerprint = sharing.fingerprint({k: v for k, v in legacy.items() if k != "log"})
    services.store.add_friend_result({"kind": "gym", "target_id": legacy["gym_id"], "target_name": legacy["gym_name"],
        "challenger": legacy["challenger"], "won": 1, "battles": 1, "battles_won": 1, "turns": legacy["turns"],
        "hp_left": 100, "verified": 1, "week": "", "mode": "classic", "battle_id": "", "badge_id": "",
        "fingerprint": old_fingerprint, "played_at": legacy["date"]})
    import_result(call, played, status=409)
    assert call("battles_list", {})["battles"] == []


def test_older_unverified_codes_with_text_keep_importing(call, services, played):
    legacy = {k: v for k, v in played.items() if k not in ("v", "ai_version", "stages")}
    legacy["team_paste"] = services.export_team(legacy["team"])
    out = import_result(call, legacy)
    assert out["kind"] == "result" and out["team_paste"] == legacy["team_paste"]
    assert out.get("verified") is not True


def test_real_time_text_round_trip_keeps_verification_and_one_result(call, services, played):
    call("settings_set", {"rt_time_limit": 60})
    gym = services.store.gym(played["gym_id"])
    world = {"gym": gym, "team": played["team"]}
    stage, _ = stage_for(services, world, {"id": gym["leader_id"]}, seed="optional-team-text")
    payload = rt_result(world, [stage], won=stage["won"])
    payload["team_paste"] = services.export_team(played["team"])
    out = call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX_RT, payload)})
    assert out["verified"] is True and out["verified_real_time"] == 1
    assert out["team_paste"] == payload["team_paste"]
    payload.pop("team_paste")
    call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX_RT, payload)}, status=409)
