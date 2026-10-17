"""A finished cup is no longer busy while its worker finishes publishing the result."""
import threading
from types import SimpleNamespace

from conftest import needs_engine
from silvers_hoard.cups import Cups


def _cup(status="done", state="done", human=""):
    return {"id": "cup-race", "status": status, "champion": "a" if status == "done" else "",
            "human_id": human, "entrants": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
            "rounds": [[{"a": "a", "b": "b", "state": state, "winner": "a" if state == "done" else "",
                         "wins": [1, 0], "games": [], "bye": False}]]}


def test_finished_cup_is_not_busy_during_worker_cleanup():
    cups = Cups(SimpleNamespace(avatar_url=lambda _: ""))
    cups._running.add("cup-race")
    result = cups.view(_cup())
    assert result["status"] == "done" and result["champion"] == "a"
    assert result["played"] == result["total"] == 1
    assert result["simulating"] is False


def test_active_matches_still_report_busy_and_human_waiting_does_not():
    cups = Cups(SimpleNamespace(avatar_url=lambda _: ""))
    assert cups.view(_cup("active", "sim"))["simulating"] is True
    cups._running.add("cup-race")
    assert cups.view(_cup("active", "ready"))["simulating"] is True
    assert cups.view(_cup("abandoned", "sim"))["simulating"] is False
    cups._running.clear()
    waiting = cups.view(_cup("active", "ready", "a"))
    assert waiting["my_match"] and waiting["pending_ai"] == 0
    assert waiting["simulating"] is False


def test_continue_checks_finished_status_before_the_worker_marker():
    cup = _cup()
    cups = Cups(SimpleNamespace(store=SimpleNamespace(cup=lambda _: cup)))
    cups._running.add(cup["id"])
    assert cups.advance(cup["id"])["simulating"] is False
    cup["status"] = "active"
    cup["rounds"][0][0]["state"] = "sim"
    assert cups.advance(cup["id"])["simulating"] is True
    cup["status"] = "abandoned"
    assert cups.advance(cup["id"])["simulating"] is False


@needs_engine
def test_api_reports_final_result_before_the_worker_releases_its_running_marker(call, services, monkeypatch):
    a = call("trainer_create", {"name": "QA winner", "format": "gen9customgame", "paste": "Mewtwo\n- Psystrike"})
    b = call("trainer_create", {"name": "QA rival", "format": "gen9customgame", "paste": "Magikarp\n- Splash"})
    result_written = threading.Event()
    release_worker = threading.Event()
    original_emit = services.emit

    def emit(event, data):
        original_emit(event, data)
        if event == "cup.won":
            result_written.set()
            release_worker.wait(timeout=20)

    def tournament(*args, **kwargs):
        return {"matches": [{"games": [{"winner": a["id"], "seed": [1, 2, 3, 4],
                    "summary": {"winner_side": "p1", "winner": a["name"], "turns": 1}, "lines": ["|win|QA winner"]}]}]}

    monkeypatch.setattr(services, "emit", emit)
    monkeypatch.setattr(services.engine, "run_job", tournament)
    try:
        cup = call("cup_start", {"trainer_ids": [a["id"], b["id"]], "format": "gen9customgame", "pace": 0})
        assert result_written.wait(timeout=20)
        assert cup["id"] in services.cups._running, "hold the actual worker in the result-publishing window"
        final = call("cup_get", {"id": cup["id"]})
        assert final["status"] == "done" and final["champion"] == a["id"]
        assert final["simulating"] is False
        assert call("cup_continue", {"id": cup["id"]})["simulating"] is False
    finally:
        release_worker.set()
