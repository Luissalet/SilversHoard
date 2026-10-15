"""The neural AI level: settings, its server's state, and battles where the engine asks a (stand-in) server for every decision."""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from conftest import TEAM, needs_engine, wait_for


def test_off_until_its_python_is_set(call):
    st = call("neural_ai", {})
    assert st["enabled"] is False and st["running"] is False and st["hint"] and st["gens"] == [1, 2, 3, 4, 9]
    assert call("neural_ai", {"action": "start"}, status=400)
    levels = call("ai_levels", {})
    assert "neural" in [lv["level"] for lv in levels["levels"]] and levels["neural"]["enabled"] is False
    t = call("trainer_create", {"name": "Red neuronal", "paste": TEAM, "ai_level": "neural"})
    assert t["ai_level"] == "neural"


def test_settings_are_checked_and_give_the_engine_the_address(call, services, monkeypatch):
    monkeypatch.delenv("SILVER_NEURAL_URL", raising=False)
    assert call("settings_set", {"neural_ai_gpu": "x"}, status=400)
    assert call("settings_set", {"neural_ai_model": "no spaces allowed"}, status=400)
    call("settings_set", {"neural_ai_python": "C:/nowhere/python.exe", "neural_ai_port": 8899})
    assert os.environ["SILVER_NEURAL_URL"] == "http://127.0.0.1:8899"
    st = call("neural_ai", {})
    assert st["enabled"] and not st["python_found"] and st["hint"]
    assert call("neural_ai", {"action": "start"}, status=404)
    call("settings_set", {"neural_ai_python": ""})
    assert "SILVER_NEURAL_URL" not in os.environ


def test_the_weights_folder_can_live_elsewhere(call, tmp_path):
    assert call("neural_ai", {})["cache"].replace("\\", "/").endswith("cache/neural")
    assert call("settings_set", {"neural_ai_cache": "relative/folder"}, status=400)
    call("settings_set", {"neural_ai_cache": str(tmp_path / "weights")})
    assert call("neural_ai", {})["cache"] == str(tmp_path / "weights")
    call("settings_set", {"neural_ai_cache": ""})
    assert call("neural_ai", {})["cache"].replace("\\", "/").endswith("cache/neural")


class _Fake(BaseHTTPRequestHandler):
    calls: list = []

    def log_message(self, *a):
        pass

    def _send(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        self._send({"ok": True, "model": "fake", "device": "cpu", "battles": 0})

    def do_POST(self):  # noqa: N802
        a = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _Fake.calls.append(a)
        r = a.get("request") or {}
        mons = (r.get("side") or {}).get("pokemon") or []
        if r.get("forceSwitch"):
            i = next((j for j, p in enumerate(mons) if not p.get("active") and not str(p.get("condition")).endswith(" fnt")), None)
            choice = f"switch {i + 1}" if i is not None else "pass"
        else:
            moves = ((r.get("active") or [{}])[0]).get("moves") or []
            choice = f"move {next(j for j, m in enumerate(moves) if not m.get('disabled')) + 1}"
        self._send({"ok": True, "choice": choice, "action": 0, "ms": 2})


@needs_engine
def test_a_neural_trainer_asks_the_server_every_decision(call, services, monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _Fake.calls = []
    try:
        call("settings_set", {"neural_ai_python": sys.executable, "neural_ai_port": srv.server_address[1]})
        assert call("neural_ai", {})["running"] is True
        a = call("trainer_create", {"name": "Red", "paste": TEAM, "ai_level": "neural"})
        b = call("trainer_random", {"seed": "rival", "ai_level": "easy"})
        bt = call("battle_start", {"p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}, "format": "gen9customgame"})
        done = wait_for(lambda: (x := call("battle_get", {"id": bt["id"]}))["status"] == "ended" and x)
        assert done["turns"] >= 1 and _Fake.calls
        assert all(c["side"] == "p1" and c["gen"] == 9 and c["name"] == "Red" for c in _Fake.calls)
        assert sum(1 for c in _Fake.calls for line in c["lines"] if line.startswith("|start")) == 1
        notes = call("battle_explain", {"id": bt["id"], "side": "p1", "from_turn": 1, "limit": 800})["notes"]
        assert notes and all(n["level"] == "neural" and n.get("neural") for n in notes)
        assert any("neural network chose it" in n.get("text", "") for n in notes) or notes[0]["neural"]["ms"] >= 0
    finally:
        srv.shutdown()
        call("settings_set", {"neural_ai_python": ""})
        monkeypatch.delenv("SILVER_NEURAL_URL", raising=False)
