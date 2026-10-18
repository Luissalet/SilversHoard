"""A replay cursor must never rewrite a verified result or a trainer's record."""
import copy

from conftest import needs_engine

pytestmark = needs_engine


def test_native_inspection_is_read_only_and_clamps_to_saved_forfeit(call, services):
    a = call("trainer_create", {"name": "Replay A", "paste": "Snorlax\n- Splash\n\nMew\n- Splash"})
    b = call("trainer_create", {"name": "Replay B", "paste": "Blissey\n- Splash"})
    battle = call("battle_start", {"p1": {"trainer_id": a["id"], "human": True},
                                   "p2": {"trainer_id": b["id"]}, "mode": "realtime", "seed": "inspect", "time_limit": 30})
    call("battle_rt_inspect", {"id": battle["id"]}, status=400)
    inputs = [[1, 0, 1, 0, -1, 0, -1], [75, 0, 0, 0, -1, 0, 1]]
    call("battle_rt_finish", {"id": battle["id"], "inputs": inputs, "tick": 212, "forfeit": "p1"})
    saved = copy.deepcopy(services.store.battle(battle["id"]))
    trainers = [call("trainer_get", {"id": id_}) for id_ in (a["id"], b["id"])]
    for tick in (0, 74, 75, 180, 212, 999999):
        frame = call("battle_rt_inspect", {"id": battle["id"], "tick": tick})
        assert frame["tick"] == min(tick, 212) and frame["end_tick"] == 212
        assert frame["view"]["t"] == frame["tick"]
        assert frame["view"]["ended"] is (tick >= 212)
        assert frame["ui_url"] == f"/#/combate/{battle['id']}?tick={min(tick, 212)}"
    assert services.store.battle(battle["id"]) == saved
    assert [call("trainer_get", {"id": id_}) for id_ in (a["id"], b["id"])] == trainers
    call("battle_rt_inspect", {"id": battle["id"], "tick": -1}, status=400)
    classic = call("battle_start", {"p1": {"trainer_id": a["id"], "human": True}, "p2": {"trainer_id": b["id"]}})
    call("battle_rt_inspect", {"id": classic["id"]}, status=400)


def test_tick_zero_forfeit_is_already_terminal(call):
    a = call("trainer_create", {"name": "Zero A", "paste": "Mew\n- Splash"})
    b = call("trainer_create", {"name": "Zero B", "paste": "Blissey\n- Splash"})
    battle = call("battle_start", {"p1": {"trainer_id": a["id"], "human": True},
                                   "p2": {"trainer_id": b["id"]}, "mode": "realtime"})
    call("battle_rt_finish", {"id": battle["id"], "tick": 0, "forfeit": "p2"})
    frame = call("battle_rt_inspect", {"id": battle["id"], "tick": 99})
    assert frame["tick"] == frame["end_tick"] == 0 and frame["view"]["ended"]
