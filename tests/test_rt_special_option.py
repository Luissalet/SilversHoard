"""The extra attack is opt-in; a saved match/page never reads today's preference."""
import copy

import pytest

from conftest import TEAM, needs_engine, wait_for
from silvers_hoard import sharing

pytestmark = needs_engine


def seats(call):
    a = call("trainer_create", {"name": "A", "paste": TEAM})
    b = call("trainer_create", {"name": "B", "paste": "Magikarp\nLevel: 5\n- Splash"})
    return a, b


def test_new_choice_is_captured_and_legacy_replays_keep_their_rules(call, services):
    a, b = seats(call)
    args = {"p1": {"trainer_id": a["id"], "human": True}, "p2": {"trainer_id": b["id"]}, "mode": "realtime"}
    assert call("settings_get")["rt_silver_special"] is False
    off = call("battle_start", args)
    assert off["rt"]["spec"]["version"] == 12 and off["rt"]["spec"]["silver_special"] is False
    call("settings_set", {"rt_silver_special": True})
    on = call("battle_start", args)
    call("settings_set", {"rt_silver_special": False})
    assert call("battle_get", {"id": on["id"]})["rt"]["spec"]["silver_special"] is True
    assert call("battle_get", {"id": off["id"]})["rt"]["spec"]["silver_special"] is False
    legacy = copy.deepcopy(services.store.battle(on["id"])["replay"])
    legacy["version"] = 10
    legacy.pop("silver_special")
    services.store.update_battle(on["id"], {"replay": legacy})
    old_spec = call("battle_get", {"id": on["id"]})["rt"]["spec"]
    assert old_spec["version"] == 10 and "silver_special" not in old_spec
    for match in (on, off):
        call("battle_forfeit", {"id": match["id"], "side": "p1"})


@pytest.mark.parametrize("enabled", [False, True])
def test_batches_replay_with_the_captured_option(call, services, monkeypatch, enabled):
    a, b = seats(call)
    call("settings_set", {"rt_silver_special": enabled})
    original = services.engine.run_job
    seen = []

    def run(op, args, **kwargs):
        if op in ("simulate", "tournament", "benchmark"):
            seen.append(copy.deepcopy(args))
            services.settings.update({"rt_silver_special": not enabled})
        return original(op, args, **kwargs)

    monkeypatch.setattr(services.engine, "run_job", run)
    series = call("series_start", {"p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}, "count": 1, "mode": "realtime", "time_limit": 30})
    done = wait_for(lambda: (j := call("job_get", {"id": series["id"]}))["status"] == "done" and j)
    assert seen[0]["spec"]["silver_special"] is enabled
    assert done["battles"]
    for battle in done["battles"]:
        assert call("battle_get", {"id": battle["id"]})["rt"]["spec"]["silver_special"] is enabled

    call("settings_set", {"rt_silver_special": enabled})
    benchmark = call("benchmark_start", {"variant_ids": [a["id"], b["id"]], "rival_ids": [b["id"]], "games": 1,
                                         "mode": "realtime", "time_limit": 30, "seed": "special-benchmark"})
    done = wait_for(lambda: (j := call("job_get", {"id": benchmark["id"]}))["status"] == "done" and j)
    assert seen[-1]["silver_special"] is enabled
    assert done["result"]["silver_special"] is enabled and done["result"]["version"] == 12
    call("settings_set", {"rt_silver_special": enabled})
    tour = call("tournament_start", {"trainer_ids": [a["id"], b["id"]], "mode": "realtime", "time_limit": 30})
    done = wait_for(lambda: (j := call("job_get", {"id": tour["id"]}))["status"] == "done" and j)
    assert len(seen) == 3 and seen[-1]["silver_special"] is enabled
    assert done["battles"]
    for battle in done["battles"]:
        assert call("battle_get", {"id": battle["id"]})["rt"]["spec"]["silver_special"] is enabled


@pytest.mark.parametrize("enabled", [False, True])
def test_exported_result_keeps_choice_after_setting_changes(call, services, enabled):
    a, b = seats(call)
    call("settings_set", {"rt_silver_special": enabled})
    obj = services.store.trainer(b["id"])
    info = services._rt_page_info("trainer", obj)
    assert info["silver_special"] is enabled
    spec = {"id": "friend-option", "seed": "friend-option", "format": info["format"], "version": 11, "arena": "open", "time_limit": 30,
            "silver_special": enabled, "p1": {"name": "Friend", "sets": a["team"], "ai": None},
            "p2": {"name": b["name"], "sets": b["team"], "ai": {"level": obj["ai_level"], "style": obj["ai_style"]}}}
    replay = services.engine.run_job("rt_replay", {"spec": spec, "inputs": [], "tick": 5, "forfeit": "p1"})
    assert replay["ended"] and replay["summary"]["winner_side"] == "p2"
    rt = {"trainer": b["id"], "key": info["keys"][b["id"]], "v": 11, "arena": "open", "seed": spec["seed"], "limit": 30,
          "silver_special": enabled, "inputs": sharing.encode_rt_inputs([]), "tick": 5, "forfeit": "p1"}
    result = {"kind": "trainer", "trainer_id": b["id"], "trainer_name": b["name"], "challenger": "Friend", "won": False, "v": 2,
              "team": a["team"], "stages": [{"name": b["name"], "won": False, "turns": 0, "mode": "realtime", "rt": rt}]}
    call("settings_set", {"rt_silver_special": not enabled})
    out = call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX_RT, result)})
    saved = call("battle_get", {"id": out["battle_id"]})
    assert out["verified_real_time"] == 1 and saved["rt"]["spec"]["silver_special"] is enabled
    for bad in (None, "false", 1):
        damaged = copy.deepcopy(result)
        damaged["stages"][0]["rt"]["silver_special"] = bad
        call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX_RT, damaged)}, status=400)


@pytest.mark.parametrize("enabled", [False, True])
def test_cup_captures_choice_for_human_and_background_matches(call, services, monkeypatch, enabled):
    a, b = seats(call)
    call("settings_set", {"rt_silver_special": enabled})
    human = services.cups.create(trainer_ids=[a["id"], b["id"]], human_id=a["id"], mode="realtime", time_limit=30, autoplay=False)
    ai = services.cups.create(trainer_ids=[a["id"], b["id"]], mode="realtime", time_limit=30, autoplay=False)
    assert human["spec"]["silver_special"] is enabled and ai["spec"]["silver_special"] is enabled
    call("settings_set", {"rt_silver_special": not enabled})
    played = call("cup_play", {"id": human["id"]})
    assert call("battle_get", {"id": played["battle_id"]})["rt"]["spec"]["silver_special"] is enabled
    original = services.engine.run_job
    captured = []

    def run(op, args, **kwargs):
        if op == "tournament":
            captured.append(args["silver_special"])
        return original(op, args, **kwargs)

    monkeypatch.setattr(services.engine, "run_job", run)
    services.cups.advance(ai["id"])
    done = wait_for(lambda: (c := call("cup_get", {"id": ai["id"]}))["status"] == "done" and c)
    assert captured and all(x is enabled for x in captured)
    for game in done["rounds"][0][0]["games"]:
        assert call("battle_get", {"id": game["battle_id"]})["rt"]["spec"]["silver_special"] is enabled
    call("cup_abandon", {"id": human["id"]})
