from conftest import TEAM, needs_engine, wait_for

pytestmark = needs_engine


def first_choice(req):
    if req.get("teamPreview"):
        return "team " + "".join(str(i + 1) for i in range(len(req["side"]["pokemon"])))
    if req.get("forceSwitch"):
        n = next(i + 1 for i, p in enumerate(req["side"]["pokemon"]) if not p["active"] and not p["condition"].endswith(" fnt"))
        return f"switch {n}"
    moves = [j + 1 for j, m in enumerate(req["active"][0]["moves"]) if not m.get("disabled")]
    return f"move {moves[0]}"


def test_play_against_ai_to_the_end(call, services):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})
    foe = call("trainer_random", {"ai_level": "hard", "seed": "foe"})
    b = call("battle_start", {"p1": {"trainer_id": me["id"], "human": True}, "p2": {"trainer_id": foe["id"]}, "seed": "1"})
    assert b["status"] == "live" and "p1" in b["requests"] and b["requests"]["p1"]["teamPreview"]
    since = b["log_length"]
    seen = list(b["lines"])
    with_move_info = False
    for _ in range(400):
        req = b["requests"].get("p1")
        if not req:
            break
        if req.get("active"):
            with_move_info = with_move_info or "type" in req["active"][0]["moves"][0]
        b = call("battle_choose", {"id": b["id"], "side": "p1", "choice": first_choice(req), "since": since})
        seen += b["lines"]
        since = b["log_length"]
        if b["status"] != "live":
            break
    assert b["status"] == "ended" and b["winner_side"] in ("p1", "p2")
    assert with_move_info
    assert any(l.startswith("|win|") for l in seen)
    stored = call("battle_get", {"id": b["id"]})
    assert stored["status"] == "ended" and stored["log_length"] > 20 and stored["summary"]["turns"] == stored["turns"]
    rec = call("trainer_get", {"id": me["id"]})["record"]
    assert rec["wins"] + rec["losses"] == 1
    call("battle_choose", {"id": b["id"], "side": "p1", "choice": "move 1"}, status=409)


def test_invalid_choice_and_resume_after_engine_restart(call, services):
    me = call("trainer_create", {"name": "A", "paste": TEAM})
    foe = call("trainer_create", {"name": "B", "paste": TEAM})
    b = call("battle_start", {"p1": {"trainer_id": me["id"], "human": True}, "p2": {"trainer_id": foe["id"]}})
    call("battle_choose", {"id": b["id"], "side": "p1", "choice": "move 9"}, status=400)
    b = call("battle_choose", {"id": b["id"], "side": "p1", "choice": "team 12", "since": b["log_length"]})
    turn = b["turn"]
    services.engine.stop()                      # the engine forgets the battle; the snapshot brings it back
    again = call("battle_get", {"id": b["id"]})
    assert again["status"] == "live" and again["turn"] == turn and "p1" in again["requests"]
    after = call("battle_choose", {"id": b["id"], "side": "p1", "choice": "move 1", "since": again["log_length"]})
    assert after["turn"] >= turn
    out = call("battle_forfeit", {"id": b["id"], "side": "p1", "since": after["log_length"]})
    assert out["status"] == "ended" and out["winner_side"] == "p2"


def test_two_people_on_one_computer(call):
    a = call("trainer_create", {"name": "A", "paste": TEAM})
    c = call("trainer_create", {"name": "C", "paste": TEAM})
    b = call("battle_start", {"p1": {"trainer_id": a["id"], "human": True}, "p2": {"trainer_id": c["id"], "human": True}})
    assert set(b["requests"]) == {"p1", "p2"}
    b = call("battle_choose", {"id": b["id"], "side": "p1", "choice": "team 12"})
    assert b["requests"]["p1"].get("done") and not b["requests"]["p2"].get("done")
    b = call("battle_choose", {"id": b["id"], "side": "p2", "choice": "team 21"})
    assert b["turn"] == 1


def test_watch_series_tournament(call):
    ids = [call("trainer_random", {"seed": f"t{i}", "ai_level": "normal"})["id"] for i in range(4)]
    w = call("battle_start", {"p1": {"trainer_id": ids[0]}, "p2": {"trainer_id": ids[1], "ai_level": "expert"}, "format": "gen9customgame"})
    assert w["status"] == "running"
    done = wait_for(lambda: (x := call("battle_get", {"id": w["id"]}))["status"] == "ended" and x)
    assert done["log_length"] > 20 and done["winner_side"] in ("p1", "p2", "")
    dbl = call("battle_start", {"p1": {"trainer_id": ids[2]}, "p2": {"trainer_id": ids[3]}, "format": "gen9doublescustomgame"})
    assert wait_for(lambda: call("battle_get", {"id": dbl["id"]})["status"] == "ended")
    s = call("series_start", {"p1": {"trainer_id": ids[0]}, "p2": {"trainer_id": ids[1]}, "count": 4})
    js = wait_for(lambda: (j := call("job_get", {"id": s["id"]}))["status"] not in ("queued", "running") and j)
    assert js["status"] == "done", js
    assert sum(js["result"]["wins"].values()) == 4 and js["result"]["pokemon"] and js["battles"]
    t = call("tournament_start", {"trainer_ids": ids, "kind": "league", "ai_level": "easy"})
    jt = wait_for(lambda: (j := call("job_get", {"id": t["id"]}))["status"] not in ("queued", "running") and j)
    assert jt["status"] == "done", jt
    assert len(jt["result"]["standings"]) == 4 and len(jt["battles"]) == 6
    t2 = call("tournament_start", {"trainer_ids": ids[:3], "kind": "bracket", "best_of": 3, "ai_level": "easy"})
    j2 = wait_for(lambda: (j := call("job_get", {"id": t2["id"]}))["status"] not in ("queued", "running") and j)
    assert j2["result"]["champion"] in ids and j2["result"]["rounds"][0]["byes"]
    hist = call("battles_list", {"kind": "tournament"})["battles"]
    assert hist
    assert call("jobs_delete", {"ids": [t2["id"]]})["deleted"] == 1


def test_gym_challenge_and_league(call):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM, "ai_level": "hard"})
    leader = call("trainer_random", {"seed": "leader", "ai_level": "easy"})
    gt = call("trainer_random", {"seed": "gymtrainer", "ai_level": "easy"})
    gym = call("gym_save", {"name": "Gimnasio Prueba", "type": "Fire", "badge": "Medalla Prueba", "leader_id": leader["id"], "trainers": [gt["id"]],
                            "format": "gen9customgame", "level_rules": {"level": 50}})
    assert [x["id"] for x in gym["gym_trainers"]] == [gt["id"]]
    run = call("challenge_start", {"kind": "gym", "target_id": gym["id"], "challenger_id": me["id"]})
    assert run["status"] == "active" and run["stages"][0]["battle_id"]
    first = call("battle_get", {"id": run["stages"][0]["battle_id"]})
    assert first["status"] == "live" and first["kind"] == "gym" and first["run"]["id"] == run["id"]
    call("challenge_abandon", {"id": run["id"]})
    auto = call("challenge_start", {"kind": "gym", "target_id": gym["id"], "challenger_id": me["id"], "auto": True})
    final = wait_for(lambda: (r := next(x for x in call("challenges_list")["challenges"] if x["id"] == auto["id"]))["status"] != "active" and r, timeout=240)
    assert final["status"] in ("won", "lost")
    if final["status"] == "won":
        assert call("badges_list", {"trainer_id": me["id"]})["badges"][0]["gym_id"] == gym["id"]
    league = call("league_save", {"name": "Liga Prueba", "gyms": [gym["id"]], "elite_four": [gt["id"]], "champion_id": leader["id"]})
    other = call("trainer_random", {"seed": "nobadges"})
    call("challenge_start", {"kind": "league", "target_id": league["id"], "challenger_id": other["id"]}, status=409)
    ok = call("challenge_start", {"kind": "league", "target_id": league["id"], "challenger_id": other["id"], "ignore_badges": True, "auto": True,
                                  "format": "gen9customgame"})
    wait_for(lambda: next(x for x in call("challenges_list")["challenges"] if x["id"] == ok["id"])["status"] != "active", timeout=240)
