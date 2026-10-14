import shutil
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from silvers_hoard.config import Config  # noqa: E402
from silvers_hoard.main import create_app  # noqa: E402
from silvers_hoard.services import Services  # noqa: E402

HAS_ENGINE = bool(shutil.which("node")) and (ROOT / "node_modules" / "@pkmn" / "sim").exists()
needs_engine = pytest.mark.skipif(not HAS_ENGINE, reason="Node.js and npm install are needed for the battle engine")

PNG_1PX = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                        "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2a1d2b40000000049454e44ae426082")


def fake_http(url):
    if "missing" in url:
        return 404, b"", "text/html"
    return 200, PNG_1PX, "image/png"


@pytest.fixture(autouse=True)
def hermetic(monkeypatch, tmp_path):
    for key in ("SILVER_DATA_DIR", "SILVER_PORT", "SILVER_NODE"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("HOARD_HUB_URL", "http://127.0.0.1:9")   # no hub in tests
    monkeypatch.setenv("HOME", str(tmp_path / "home"))


@pytest.fixture
def services(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", background=False)
    s = Services(cfg, http_get=fake_http)
    s.start()
    yield s
    s.stop()


@pytest.fixture
def client(services):
    app = create_app(services.config, services=services)
    with TestClient(app, base_url="http://127.0.0.1:5206") as c:
        yield c


@pytest.fixture
def call(client):
    def _call(_tool, args=None, status=200):
        r = client.post("/api/ui/call", json={"name": _tool, "arguments": args or {}})
        assert r.status_code == status, r.text
        return r.json()
    return _call


def wait_for(fn, timeout=120, every=0.2):
    end = time.time() + timeout
    while time.time() < end:
        value = fn()
        if value:
            return value
        time.sleep(every)
    raise AssertionError("timed out")


TEAM = """Garchomp @ Choice Scarf
Ability: Rough Skin
Tera Type: Ground
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Earthquake
- Outrage
- Stone Edge
- Fire Fang

Rotom-Wash @ Leftovers
Ability: Levitate
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Pain Split
"""
