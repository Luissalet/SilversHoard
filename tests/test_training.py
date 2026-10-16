import copy
import json

import pytest

from conftest import needs_engine
from test_practice import finished
from silvers_hoard.errors import SilverError

pytestmark = needs_engine


def test_export_import_restarts_an_independent_position_without_future_decisions(services):
    original = finished(services)
    row = copy.deepcopy(services.store.battle(original["id"]))
    e = services.training.create(original["id"], turn=1, title="Win with Psychic", goal="win", target_turns=0)
    package = services.training.export(e["id"])
    obj = json.loads(package["code"])
    choices = [line.split(" ", 1)[1] for line in obj["position"]["input"] if line.startswith((">p1 ", ">p2 "))]
    assert choices and all(choice.startswith("team ") for choice in choices)
    assert original["id"] not in package["code"]
    # Metadata cannot swap the actual starting format or teams away from the input record.
    obj["position"]["format"] = "gen1customgame"
    obj["position"]["seats"]["p1"]["sets"] = [{"species":"Magikarp","moves":["Splash"]}]
    imported = services.training.import_(json.dumps(obj))
    b = services.training.start(imported["id"], adaptive=False, ai_level="easy")
    assert b["format"] == "gen9customgame" and services.store.battle(b["id"])["p1"]["sets"][0]["species"] == "Mew"
    services.engine.stop()
    continued = services.battle_choose(b["id"], "p1", "move 2")
    if continued["status"] != "ended":
        services.battle_forfeit(b["id"], "p2")
    outcome = services.training.get(imported["id"])["attempts"][0]
    assert outcome["passed"]
    assert services.store.battle(original["id"]) == row
    assert not services.store.badges() and not services.store.hall()


def test_survive_goal_and_adaptation_are_explained_and_manual_level_stays_available(services):
    source = finished(services)
    e = services.training.create(source["id"], turn=1, goal="survive", target_turns=1)
    # Real practice attempts, not invented result rows: after one Splash turn the objective is met.
    for _ in range(3):
        b = services.training.start(e["id"], adaptive=False, ai_level="normal")
        services.battle_choose(b["id"], "p1", "move 1")
        services.battle_forfeit(b["id"], "p1")
    info = services.training.get(e["id"])
    assert all(a["passed"] for a in info["attempts"])
    assert info["recommendation"] == {"level":"hard","previous_level":"normal","samples":3,"passed":3,"step":1}
    adaptive = services.training.start(e["id"])
    assert adaptive["p2"]["ai"]["level"] == "hard" and adaptive["p2"]["ai"]["hidden"]
    manual = services.training.start(e["id"], adaptive=False, ai_level="easy")
    assert manual["p2"]["ai"]["level"] == "easy"


def test_losing_three_attempts_lowers_one_level_and_archive_is_reversible(services):
    source = finished(services)
    e = services.training.create(source["id"], turn=1)
    for _ in range(3):
        b = services.training.start(e["id"], adaptive=False, ai_level="normal")
        services.battle_forfeit(b["id"], "p1")
    assert services.training.get(e["id"])["recommendation"]["level"] == "easy"
    services.training.archive(e["id"])
    assert not services.training.list()["exercises"]
    assert services.training.list(archived=True)["exercises"][0]["id"] == e["id"]
    services.training.archive(e["id"], archived=False)
    assert services.training.list()["exercises"][0]["id"] == e["id"]


def test_invalid_or_old_records_never_create_an_exercise(services):
    source = finished(services)
    with pytest.raises(SilverError):
        services.training.create(source["id"], turn=99)
    with pytest.raises(SilverError):
        services.training.create(source["id"], turn=1, goal="survive", target_turns=0)
    with pytest.raises(SilverError):
        services.training.import_(json.dumps({"kind":"silvers-hoard/exercise","schema":2}))
    assert not services.training.list()["exercises"]


def test_native_tools_share_and_download_the_exercise(services, call, client):
    source = finished(services)
    e = call("exercise_create", {"battle_id":source["id"],"turn":1,"title":"Practice"})
    exported = call("exercise_export", {"id":e["id"]})
    response = client.get(exported["url"])
    assert response.status_code == 200 and json.loads(response.text)["kind"] == "silvers-hoard/exercise"
    imported = call("import", {"content":exported["code"]})
    assert imported["kind"] == "exercise" and imported["exercise"]["id"] != e["id"]
    b = call("exercise_start", {"id":imported["exercise"]["id"]})
    assert b["kind"] == "practice" and not b.get("run_id")
    assert call("exercise_get", {"id":e["id"]})["goal"] == "win"
    assert len(call("exercises_list", {})["exercises"]) == 2
    call("exercise_archive", {"id":e["id"]})
    assert call("exercises_list", {"archived":True})["exercises"][0]["id"] == e["id"]
    call("exercise_archive", {"id":e["id"],"archived":False})


@pytest.mark.parametrize("bom", [b"", b"\xef\xbb\xbf"])
def test_an_exported_exercise_file_imports_and_starts_a_new_practice(services, call, client, bom):
    source = finished(services)
    original = copy.deepcopy(services.store.battle(source["id"]))
    exercise = call("exercise_create", {"battle_id":source["id"], "turn":2, "title":"Archivo de práctica"})
    exported = call("exercise_export", {"id":exercise["id"]})
    file = client.get(exported["url"])
    assert file.status_code == 200
    response = client.post("/api/import/upload", files={"file":(exported["file"], bom + file.content, "application/json")})
    assert response.status_code == 200, response.text
    imported = response.json()
    assert imported["kind"] == "exercise" and imported["exercise"]["id"] != exercise["id"]
    assert imported["exercise"]["title"] == "Archivo de práctica"
    practice = call("exercise_start", {"id":imported["exercise"]["id"], "adaptive":False, "ai_level":"easy"})
    assert practice["kind"] == "practice" and practice["turn"] == 2 and practice["requests"]["p1"]
    assert services.store.battle(source["id"]) == original
    assert len(call("exercises_list", {})["exercises"]) == 2
    assert not services.store.badges() and not services.store.hall()


def test_turn_limited_win_counts_completed_turns(services):
    source = services.battle_start(p1={"name":"A","paste":"Mew\n- Splash\n- Psychic","human":True},
        p2={"name":"B","paste":"Magikarp\nLevel: 1\n- Splash","human":True},format_="gen9customgame",seed="one-turn")
    for side in ("p1","p2"):
        services.battle_choose(source["id"],side,"team 1")
    for side in ("p1","p2"):
        services.battle_choose(source["id"],side,"move 1")
    services.battle_forfeit(source["id"],"p1")
    e = services.training.create(source["id"],turn=1,target_turns=1)
    fast = services.training.start(e["id"],adaptive=False,ai_level="easy")
    services.battle_choose(fast["id"],"p1","move 2")
    assert services.training.get(e["id"])["attempts"][0]["passed"]
    slow = services.training.start(e["id"],adaptive=False,ai_level="easy")
    services.battle_choose(slow["id"],"p1","move 1")
    services.battle_choose(slow["id"],"p1","move 2")
    outcome = services.training.get(e["id"])["attempts"][0]
    assert outcome["status"] == "ended" and outcome["elapsed_turns"] == 2 and not outcome["passed"]


def test_v7_migration_preserves_all_existing_rows(tmp_path):
    from silvers_hoard import store as module
    from silvers_hoard.hoard_link.sqlkit import Database
    path = tmp_path / "old.sqlite"
    db = Database(path, migrations=[getattr(module, f"SCHEMA_V{i}") for i in range(1, 7)])
    db.insert("arenas", {"id":"old-arena","name":"Existing arena","created_at":1,"updated_at":1})
    db.insert("trainers", {"id":"old-trainer","name":"Existing trainer","format":"gen9customgame","wins":7,"created_at":1,"updated_at":1})
    db.insert("gyms", {"id":"old-gym","name":"Existing gym","format":"gen9customgame","rt_arena":"custom:old-arena","map_json":'{"entry":[1,1]}',"created_at":1,"updated_at":1})
    tables = [r["name"] for r in db.query("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'schema_version'")]
    before = {t: db.query(f'SELECT * FROM "{t}"') for t in tables}
    db.close()
    store = module.Store(path)
    # The migration ledger is expected to grow; business rows must stay byte-for-byte equivalent.
    for table, rows in before.items():
        assert store.db.query(f'SELECT * FROM "{table}"') == rows
    assert store.exercises() == []
    store.close()


def test_shared_exercise_plays_in_a_fresh_library_without_its_source(services, tmp_path):
    from conftest import fake_http
    from silvers_hoard.config import Config
    from silvers_hoard.services import Services
    source = finished(services)
    exercise = services.training.create(source["id"], turn=2, title="Portable turn two")
    code = services.training.export(exercise["id"])["code"]
    receiver = Services(Config(data_dir=tmp_path / "receiver", background=False), http_get=fake_http)
    try:
        receiver.start()
        assert not receiver.store.battles()
        imported = receiver.training.import_(code)
        attempt = receiver.training.start(imported["id"], adaptive=False, ai_level="easy")
        assert attempt["turn"] == 2 and attempt["requests"]["p1"]
        continued = receiver.battle_choose(attempt["id"], "p1", "move 2")
        assert not continued.get("errors")
        assert all(b["id"] != source["id"] for b in receiver.store.battles())
        assert not receiver.store.trainers() and not receiver.store.badges() and not receiver.store.hall()
    finally:
        receiver.stop()
