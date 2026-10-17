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
