from conftest import needs_engine, wait_for

pytestmark = needs_engine


def test_facilities_list_has_bosses(call):
    r = call("facilities_list", {})
    ids = [f["id"] for f in r["facilities"]]
    assert {"tower4", "subway_single", "subway_double", "maison_single", "tree_double", "tower8"} <= set(ids)
    tower = next(f for f in r["facilities"] if f["id"] == "tower4")
    assert [b["at"] for b in tower["bosses"]] == [21, 49] and tower["bosses"][0]["key"] == "palmer"
    assert tower["size"] == 3 and tower["record"] == 0
    assert next(f for f in r["facilities"] if f["id"] == "subway_double")["size"] == 4


def test_boss_and_generated_rivals(services):
    boss = services._facility_stage({"id": "run_x", "target_id": "tower4", "step": 20})
    assert boss["boss"] and boss["character"] == "palmer" and len(boss["seat"]["team"]) == 3 and boss["seat"]["ai_level"] == "expert"
    red = services._facility_stage({"id": "run_x", "target_id": "tree_single", "step": 49})
    assert red["character"] == "red" and len(red["seat"]["team"]) == 3   # three of his pool of ten
    first = services._facility_stage({"id": "run_x", "target_id": "subway_double", "step": 0})
    again = services._facility_stage({"id": "run_x", "target_id": "subway_double", "step": 0})
    assert not first["boss"] and len(first["seat"]["team"]) == 4 and first["seat"]["ai_level"] == "normal"
    assert first == again   # seeded by run and battle number
    assert first["avatar"].startswith("sd:") and first["name"]
    late = services._facility_stage({"id": "run_x", "target_id": "subway_single", "step": 30})
    assert late["seat"]["ai_level"] == "expert"


def test_streak_runs_by_itself_and_sets_the_record(call):
    tr = call("trainer_random", {"name": "Racha", "format": "gen9customgame", "seed": "streak"})
    tid = (tr.get("trainer") or tr)["id"]
    run = call("challenge_start", {"kind": "facility", "target_id": "maison_single", "challenger_id": tid, "auto": True, "stop_at": 2})
    assert run["kind"] == "facility" and run["status"] == "active" and run["stages"][0]["battle_id"]
    call("challenge_start", {"kind": "facility", "target_id": "maison_single", "challenger_id": tid}, status=409)   # one open streak per facility

    def settled():
        r = next(x for x in call("challenges_list", {"kind": "facility"})["challenges"] if x["id"] == run["id"])
        done = r["status"] == "lost" or (r["step"] >= 2 and all(s.get("result") for s in r["stages"]))
        return r if done else None

    r = wait_for(settled, timeout=600)
    b = call("battle_get", {"id": r["stages"][0]["battle_id"]})
    assert b["kind"] == "facility" and b["level_rules"] == {"level": 50} and "Picked Team Size = 3" in b["rules"]
    assert r["streak"] == sum(1 for s in r["stages"] if s["result"] == "won")
    listed = next(f for f in call("facilities_list", {"trainer_id": tid})["facilities"] if f["id"] == "maison_single")
    assert listed["record"] == r["streak"] and listed["streaks"] == 1
    if r["status"] == "active":   # stopped after two wins: challenge_next adds the third rival
        nxt = call("challenge_next", {"id": run["id"]})
        assert len(nxt["stages"]) == 3 and nxt["stages"][2]["number"] == 3
        third = nxt["stages"][2]["battle_id"]
        wait_for(lambda: call("battle_get", {"id": third})["status"] not in ("running", "live"), timeout=600)


def test_facility_needs_enough_pokemon(call):
    tr = call("trainer_create", {"name": "Corto", "paste": "Pikachu\n- Thunderbolt\n"})
    tid = (tr.get("trainer") or tr)["id"]
    call("challenge_start", {"kind": "facility", "target_id": "tower4", "challenger_id": tid}, status=400)


def test_realtime_streak_brings_as_many_as_the_rival(services):
    tr = services.trainer_random(name="Tiempo", format_="gen9customgame", seed="rt-streak")
    tid = (tr.get("trainer") or tr)["id"]
    run = services.run_start(kind="facility", target_id="tower4", challenger_id=tid, mode="realtime")
    b = services.store.battle(run["stages"][0]["battle_id"])
    assert b["mode"] == "realtime" and len(b["p1"]["sets"]) == 3 and len(b["p2"]["sets"]) == 3
    services.run_abandon(run["id"])
