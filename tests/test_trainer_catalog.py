from conftest import needs_engine
from threading import Event, current_thread
from concurrent.futures import ThreadPoolExecutor

import pytest
from silvers_hoard.errors import SilverError


@needs_engine
def test_saved_trainers_filter_by_actual_game_and_bilingual_name(call):
    c = call("character_get", {"key": "leon"})
    assert len(c["variants"]) == 12
    v = next(v for v in c["variants"] if "swsh" in v["games"])
    tr = call("character_install", {"key": "leon", "variant": v["id"]})["trainer"]
    for query in ("Leon", "Lionel"):
        rows = call("trainers_list", {"query": query, "game": "swsh", "region": "Galar"})["trainers"]
        assert [r["id"] for r in rows] == [tr["id"]]
    assert not call("trainers_list", {"query": "Leon", "region": "Kanto"})["trainers"]
    assert not call("trainers_list", {"query": "Leon", "game": "sv"})["trainers"]


@needs_engine
def test_original_canon_trainers_keep_game_region_filters(call):
    call("canon_install", {"trainer_key": "frlg-brock"})
    rows = call("trainers_list", {"game": "frlg", "region": "Kanto"})["trainers"]
    assert rows


@needs_engine
def test_cancel_live_battle_does_not_change_records(call, services):
    a = call("trainer_create", {"name": "A", "paste": "Snorlax\n- Rest"})
    b = call("trainer_create", {"name": "B", "paste": "Blissey\n- Soft-Boiled"})
    battle = call("battle_start", {"p1": {"trainer_id": a["id"], "human": True}, "p2": {"trainer_id": b["id"], "human": True}})
    ended = call("battle_cancel", {"id": battle["id"]})
    assert ended["status"] == "cancelled"
    assert not ended["winner_name"]
    assert not services.engine.call("match_loaded", {"id": battle["id"]})["loaded"]
    assert call("battle_cancel", {"id": battle["id"]})["status"] == "cancelled"
    assert call("trainer_get", {"id": a["id"]})["record"] == {"wins": 0, "losses": 0, "ties": 0}


@needs_engine
@pytest.mark.parametrize("operation", ["get", "choose", "forfeit", "advice"])
def test_pending_live_request_cannot_reload_a_cancelled_match(services, monkeypatch, operation):
    battle = services.battle_start(p1={"name": "A", "paste": "Pikachu\n- Thunderbolt", "human": True},
                                  p2={"name": "B", "paste": "Magikarp\n- Splash", "human": True})
    bid = battle["id"]
    captured, release = Event(), Event()
    original = services.store.battle
    held = False

    def stale_read(id_):
        nonlocal held
        row = original(id_)
        if id_ == bid and current_thread().name.startswith("stale-reader") and not held:
            held = True
            captured.set()
            assert release.wait(10)
        return row

    monkeypatch.setattr(services.store, "battle", stale_read)
    actions = {"get": lambda: services.battle_get(bid), "choose": lambda: services.battle_choose(bid, "p1", "team 1"),
               "forfeit": lambda: services.battle_forfeit(bid, "p1"), "advice": lambda: services.battle_explain(bid, advice=True)}
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="stale-reader") as pool:
        future = pool.submit(actions[operation])
        try:
            assert captured.wait(5)
            assert services.battle_cancel(bid)["status"] == "cancelled"
        finally:
            release.set()
        if operation in ("choose", "forfeit"):
            with pytest.raises(SilverError) as error:
                future.result(timeout=10)
            assert error.value.code == "ended"
        else:
            assert future.result(timeout=10)["status"] == "cancelled"
    assert original(bid)["status"] == "cancelled"
    assert not services.engine.call("match_loaded", {"id": bid})["loaded"]
    assert not original(bid)["winner_name"]


@needs_engine
def test_named_characters_have_playable_teams(call):
    for key in ("rose", "volo", "adaman", "irida", "sada", "turo", "zinnia", "benga", "clavell", "jacq", "miriam"):
        character = call("character_get", {"key": key})
        assert character["variants"], key
        assert all(v["species"] for v in character["variants"]), key


@needs_engine
@pytest.mark.parametrize("mode", ["classic", "realtime"])
@pytest.mark.parametrize("fails", [False, True])
def test_cancel_background_battle_cannot_be_overwritten(call, services, monkeypatch, mode, fails):
    started, release = Event(), Event()
    original_job, original_submit = services.engine.run_job, services.pool.submit
    futures = []

    def blocked_job(method, args, **kwargs):
        if method not in ("play_out", "rt_play_out"):
            return original_job(method, args, **kwargs)
        started.set()
        assert release.wait(10)
        if fails:
            raise RuntimeError("worker stopped after cancellation")
        return {"summary": {"winner_side": "p1", "winner": "A"}, "lines": ["|win|A"], "ended": True}

    def submit(*args, **kwargs):
        future = original_submit(*args, **kwargs)
        futures.append(future)
        return future

    monkeypatch.setattr(services.engine, "run_job", blocked_job)
    monkeypatch.setattr(services.pool, "submit", submit)
    a = call("trainer_create", {"name": "A", "paste": "Snorlax\n- Rest"})
    b = call("trainer_create", {"name": "B", "paste": "Blissey\n- Soft-Boiled"})
    try:
        battle = call("battle_start", {"mode": mode, "p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}})
        assert started.wait(5)
        assert call("battle_cancel", {"id": battle["id"]})["status"] == "cancelled"
    finally:
        release.set()
    for future in futures:
        future.result(timeout=10)
    saved = call("battle_get", {"id": battle["id"]})
    assert saved["status"] == "cancelled"
    assert not saved["winner_name"]
    assert call("trainer_get", {"id": a["id"]})["record"] == {"wins": 0, "losses": 0, "ties": 0}
