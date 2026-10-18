"""An arena's optional weather travels with it, independently of combat rules."""

import json

import pytest

from conftest import TEAM, needs_engine, wait_for


def test_version9_database_migrates_without_changing_existing_columns(tmp_path):
    from silvers_hoard import store as module
    from silvers_hoard.hoard_link.sqlkit import Database

    path = tmp_path / "legacy.sqlite3"
    old = Database(path, migrations=[getattr(module, f"SCHEMA_V{i}") for i in range(1, 10)])
    old.execute("INSERT INTO arenas(id,name,floor,rocks_json,owner,origin,created_at,updated_at,deleted_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)", ("old", "Niebla antigua", "pyre", "[]", "Owner", "own", 1.25, 2.5, None))
    old.execute("INSERT INTO arenas(id,name,floor,rocks_json,created_at,updated_at,deleted_at) "
                "VALUES (?,?,?,?,?,?,?)", ("deleted", "Deleted", "summit", "[]", 3, 4, 5))
    tables = [r["name"] for r in old.query("SELECT name FROM sqlite_master WHERE type='table'")
              if r["name"] != "schema_version"]
    columns = {t: [r["name"] for r in old.query(f'PRAGMA table_info("{t}")')] for t in tables}
    before = {t: [tuple(r) for r in old.query(f'SELECT * FROM "{t}"')] for t in tables}
    old.close()
    current = module.Store(path)
    try:
        assert current.db.schema_version == 10
        for table, names in columns.items():
            projection = ",".join(f'"{c}"' for c in names)
            assert [tuple(r) for r in current.db.query(f'SELECT {projection} FROM "{table}"')] == before[table]
        assert all(r["weather"] == "" and r["weather_rules"] == 0 for r in current.db.query("SELECT * FROM arenas"))
        assert current.arena("old")["floor"] == "pyre"
        assert current.db.migrate() == 10
    finally:
        current.close()


@pytest.mark.parametrize("weather", ["sunnyday", "raindance", "snow", "fog"])
def test_weather_survives_save_partial_edit_and_gym_sharing(call, client, weather):
    a = call("arena_save", {"name": "Clima", "weather": weather, "weather_rules": True})
    assert (a["weather"], a["weather_rules"]) == (weather, True)
    edited = call("arena_save", {"id": a["id"], "name": "Clima nuevo"})
    assert (edited["weather"], edited["weather_rules"]) == (weather, True)
    leader = call("trainer_create", {"name": "Clima", "paste": TEAM})
    gym = call("gym_save", {"name": "Clima", "leader_id": leader["id"], "rt_arena": a["value"]})
    exported = call("export", {"kind": "gym", "id": gym["id"], "fmt": "file"})
    raw = client.get(exported["url"]).content
    snapshot = json.loads(raw)["gym"]["rt_arena"]
    assert (snapshot["weather"], snapshot["weather_rules"]) == (weather, True)
    call("arena_save", {"id": a["id"], "weather_rules": False})
    # Identical floor and rocks with different rules must not be deduplicated.
    imported = client.post("/api/import/upload", files={"file": (exported["file"], raw, "application/json")}).json()["gym"]
    assert imported["rt_arena"] != a["value"]
    brought = call("arena_get", {"id": imported["rt_arena"].split(":")[1]})
    assert (brought["weather"], brought["weather_rules"]) == (weather, True)
    again = client.post("/api/import/upload", files={"file": (exported["file"], raw, "application/json")}).json()["gym"]
    assert again["rt_arena"] == imported["rt_arena"]


def test_original_arena_defaults_and_invalid_weather(call):
    a = call("arena_save", {"name": "Original"})
    assert a["weather"] == "" and not a["weather_rules"]
    assert call("arena_save", {"name": "Bad", "weather": "storm"}, status=400)


def test_playable_gym_uses_weather_in_its_starting_spec(call, services):
    a = call("arena_save", {"name": "Portable rain", "weather": "raindance", "weather_rules": True})
    trainer = call("trainer_create", {"name": "Leader", "paste": TEAM})
    gym = call("gym_save", {"name": "Portable", "leader_id": trainer["id"], "rt_arena": a["value"]})
    info = services._rt_page_info("gym", services.store.gym(gym["id"]))
    assert info["arena"]["weather"] == "raindance"
    assert info["arena"]["weather_rules"] is True


@needs_engine
@pytest.mark.parametrize("weather,rules", [("raindance", True), ("fog", False)])
def test_portable_result_replays_the_captured_climate(call, services, weather, rules):
    from silvers_hoard import sharing

    arena = call("arena_save", {"name": "Portable", "weather": weather, "weather_rules": rules})
    leader = call("trainer_create", {"name": "Leader", "paste": TEAM})
    gym = call("gym_save", {"name": "Portable", "leader_id": leader["id"], "rt_arena": arena["value"]})
    obj = services.store.trainer(leader["id"])
    info = services._rt_page_info("gym", services.store.gym(gym["id"]))
    rt = {"trainer": leader["id"], "key": info["keys"][leader["id"]], "v": 12, "arena": info["arena"],
          "seed": "arena-portable", "limit": 30, "silver_special": False,
          "inputs": sharing.encode_rt_inputs([]), "tick": 5, "forfeit": "p1"}
    result = {"kind": "gym", "gym_id": gym["id"], "gym_name": gym["name"], "challenger": "Portable QA", "won": False,
              "turns": 0, "v": 2, "team": obj["team"], "stages": [{"name": obj["name"], "won": False, "turns": 0, "mode": "realtime", "rt": rt}]}
    out = call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX_RT, result)})
    assert out["verified_real_time"] == 1
    spec = call("battle_get", {"id": out["battle_id"]})["rt"]["spec"]
    assert spec["arena"]["weather"] == weather and spec["arena"]["weather_rules"] is rules
    call("arena_save", {"id": arena["id"], "weather": "snow"})
    call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX_RT, result)}, status=409)


@needs_engine
def test_finished_battle_retains_weather_after_arena_edit(call):
    a = call("arena_save", {"name": "Nieve", "weather": "snow", "weather_rules": True})
    trainer = call("trainer_create", {"name": "Weather", "paste": TEAM})
    bt = call("battle_start", {"p1": {"trainer_id": trainer["id"]}, "p2": {"trainer_id": trainer["id"]},
                              "mode": "realtime", "rt_arena": a["value"], "time_limit": 30})
    done = wait_for(lambda: (x := call("battle_get", {"id": bt["id"]}))["status"] == "ended" and x)
    spec = done["rt"]["spec"]
    assert spec["version"] == 12
    assert spec["arena"]["weather"] == "snow" and spec["arena"]["weather_rules"] is True
    call("arena_save", {"id": a["id"], "weather": "sunnyday", "weather_rules": False})
    assert call("battle_get", {"id": bt["id"]})["rt"]["spec"] == spec


@needs_engine
def test_saved_weather_and_forfeit_travel_together(call):
    arena = call("arena_save", {"name": "Fog replay", "weather": "fog", "weather_rules": True})
    seat = {"team": [{"species": "Glaceon", "moves": ["Splash"]}], "human": True}
    battle = call("battle_start", {"p1": seat, "p2": seat, "mode": "realtime", "rt_arena": arena["value"], "time_limit": 30})
    ended = call("battle_rt_finish", {"id": battle["id"], "inputs": [], "tick": 90, "forfeit": "p1"})
    assert ended["summary"]["reason"] == "forfeit" and ended["summary"]["seconds"] == 3
    assert ended["rt"]["forfeit"] == "p1" and ended["rt"]["tick"] == 90
    assert ended["rt"]["spec"]["version"] == 12
    original = ended["rt"]["spec"]
    call("arena_save", {"id": arena["id"], "weather": "snow"})
    again = call("battle_get", {"id": battle["id"]})
    assert again["rt"]["spec"] == original
    assert again["rt"]["spec"]["arena"]["weather"] == "fog"
    assert again["rt"]["forfeit"] == "p1" and again["rt"]["tick"] == 90
