"""Cups: a knockout bracket that fills in match by match, with the AI's matches played in the background and yours waiting for you."""

from conftest import TEAM, needs_engine, wait_for

from silvers_hoard.cups import BYE, build_rounds, seed_order


def test_seeding_puts_the_best_seeds_apart_and_gives_them_the_byes():
    assert seed_order(8) == [1, 8, 4, 5, 2, 7, 3, 6]
    rounds = build_rounds(["s1", "s2", "s3", "s4", "s5"])
    assert [len(r) for r in rounds] == [4, 2, 1]
    first = rounds[0]
    assert [(m["a"], m["b"]) for m in first] == [("s1", BYE), ("s4", "s5"), ("s2", BYE), ("s3", BYE)]
    assert [m["state"] for m in first] == ["done", "ready", "done", "done"] and first[0]["bye"]
    # the byes already took their places in the next round; the match that is played still has its place open
    assert (rounds[1][0]["a"], rounds[1][0]["b"], rounds[1][0]["state"]) == ("s1", "", "wait")
    assert (rounds[1][1]["a"], rounds[1][1]["b"], rounds[1][1]["state"]) == ("s2", "s3", "ready")
    assert build_rounds(["x", "y"])[0][0]["state"] == "ready"


def _trainers(call, n):
    call("settings_set", {"max_turns": 40})   # a stalled game ends in a tie soon (ties do not count; a cup still finishes)
    return [call("trainer_random", {"seed": f"cup{i}", "ai_level": "easy"})["id"] for i in range(n)]


@needs_engine
def test_ai_cup_fills_in_to_a_champion(call):
    ids = _trainers(call, 5)
    c = call("cup_start", {"trainer_ids": ids, "seeding": "chosen", "ai_level": "easy", "pace": 0, "title": "Copa IA"})
    assert c["status"] == "active" and len(c["rounds"]) == 3 and c["total"] == 4 and c["human_id"] == ""
    assert c["rounds"][0][0]["a"] == ids[0] and c["rounds"][0][0]["bye"]
    done = wait_for(lambda: (x := call("cup_get", {"id": c["id"]}))["status"] == "done" and x, timeout=300)
    assert done["champion"] in ids and done["played"] == 4 and not done["simulating"]
    final = done["rounds"][-1][0]
    assert final["winner"] == done["champion"] and final["games"] and final["games"][0]["battle_id"]
    b = call("battle_get", {"id": final["games"][0]["battle_id"]})
    assert b["kind"] == "cup" and b["status"] == "ended" and b["cup"]["id"] == c["id"] and b["cup"]["champion"] == done["champion"]
    listed = call("cups_list", {})["cups"]
    assert listed[0]["id"] == c["id"] and listed[0]["champion_name"]
    assert call("cups_delete", {"ids": [c["id"]]})["deleted"] == 1
    assert not call("battles_list", {"kind": "cup"})["battles"]


@needs_engine
def test_your_matches_wait_for_you_and_the_rest_goes_on(call):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})["id"]
    rivals = _trainers(call, 3)
    c = call("cup_start", {"trainer_ids": rivals, "human_id": me, "seeding": "chosen", "ai_level": "easy", "pace": 0})
    assert c["entrants"][0]["id"] == me and c["entrants"][0]["human"]
    # the other semi-final is played by the AI; yours waits
    c = wait_for(lambda: (x := call("cup_get", {"id": c["id"]}))["played"] == 1 and not x["simulating"] and x)
    mine = c["my_match"]
    assert mine and mine["round"] == 0 and mine["opponent"] == rivals[-1] and c["rounds"][0][0]["state"] == "ready"
    assert c["rounds"][1][0]["state"] == "wait" and c["pending_ai"] == 0
    p = call("cup_play", {"id": c["id"]})
    b = call("battle_get", {"id": p["battle_id"]})
    assert b["status"] == "live" and b["kind"] == "cup" and b["p1"]["trainer_id"] == me and b["cup"]["my_match"]["battle_id"] == b["id"]
    assert call("cup_play", {"id": c["id"]}) == {"battle_id": b["id"], "resumed": True}
    call("battle_forfeit", {"id": b["id"], "side": "p1"})
    done = wait_for(lambda: (x := call("cup_get", {"id": c["id"]}))["status"] == "done" and x, timeout=300)
    assert done["rounds"][0][0]["winner"] == rivals[-1] and not done["human_alive"] and done["champion"] != me
    assert call("cup_play", {"id": c["id"]}, status=409)


@needs_engine
def test_simulate_your_match_and_random_draw(call):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM, "ai_level": "easy"})["id"]
    _trainers(call, 4)
    c = call("cup_start", {"human_id": me, "random_count": 4, "ai_level": "easy", "pace": 0, "best_of": 3})
    assert len(c["entrants"]) == 4 and me in [e["id"] for e in c["entrants"]] and c["spec"]["best_of"] == 3
    c = wait_for(lambda: (x := call("cup_get", {"id": c["id"]}))["my_match"] and not x["simulating"] and x)
    r = call("cup_simulate", {"id": c["id"]})
    assert r["simulating"]

    def drive():
        # if the AI wins your first match for you, the final is yours too: send it to the simulator as well
        x = call("cup_get", {"id": c["id"]})
        if x["status"] == "done":
            return x
        if x["my_match"] and not x["simulating"] and not x["my_match"]["battle_id"]:
            call("cup_simulate", {"id": c["id"]})
        return None

    done = wait_for(drive, timeout=400)
    first = [m for m in done["rounds"][0] if me in (m["a"], m["b"])][0]
    assert max(first["wins"]) == 2 and all(g["simulated"] for g in first["games"])
    assert call("cup_start", {"random_count": 4, "random_from": "zzz-nadie"}, status=404)


@needs_engine
def test_watch_an_ai_match_and_recover_after_a_restart(call, services):
    ids = _trainers(call, 2)
    c = services.cups.create(trainer_ids=ids, ai_level="easy", pace=0, autoplay=False)
    assert c["pending_ai"] == 1 and not c["simulating"]
    w = call("cup_watch", {"id": c["id"], "round": 0, "match": 0})
    done = wait_for(lambda: (x := call("cup_get", {"id": c["id"]}))["status"] == "done" and x)
    assert done["rounds"][0][0]["games"][0]["battle_id"] == w["battle_id"] and done["champion"] in ids
    # a match the AI was playing when the app stopped is ready again
    c2 = services.cups.create(trainer_ids=ids, pace=0, autoplay=False)
    cup = services.store.cup(c2["id"])
    cup["rounds"][0][0]["state"] = "sim"
    services.store.update_cup(cup["id"], {"rounds": cup["rounds"]})
    services.cups.recover()
    assert services.store.cup(c2["id"])["rounds"][0][0]["state"] == "ready"
    assert call("cup_abandon", {"id": c2["id"]})["status"] == "abandoned"
    assert call("cup_continue", {"id": c2["id"]})["simulating"] is False


@needs_engine
def test_real_time_cup(call):
    ids = _trainers(call, 3)
    c = call("cup_start", {"trainer_ids": ids, "mode": "realtime", "time_limit": 30, "pace": 0})
    assert c["spec"]["mode"] == "realtime" and c["spec"]["version"] >= 4
    done = wait_for(lambda: (x := call("cup_get", {"id": c["id"]}))["status"] == "done" and x, timeout=300)
    g = [m for m in done["rounds"][0] if not m["bye"]][0]["games"][0]
    b = call("battle_get", {"id": g["battle_id"]})
    assert b["mode"] == "realtime" and b["rt"]["spec"]["version"] == c["spec"]["version"]
