"""Pokémon Reborn's move animations for the "reborn" style: only the listed files, downloaded once from the fixed commit, cached."""

import json
import re
from pathlib import Path

from silvers_hoard.config import REPO_ROOT

WAV = b"RIFF\x24\x00\x00\x00WAVEfmt "
ANIM = json.dumps([{"graphic": "PRAS- Grass", "frames": [[]], "frameTimedEvents": {}, "position": 1, "hue": 0}]).encode()


def _serve(services):
    calls = []

    def http(url):
        calls.append(url)
        if url.endswith(".json"):
            return 200, ANIM, "application/json"
        if url.endswith(".wav"):
            return 200, WAV, "audio/wav"
        if "missing" in url:
            return 404, b"", "text/html"
        return 200, b"\x89PNG\r\n\x1a\n" + b"0" * 32, "image/png"

    services.reborn._http_get = http
    return calls


def test_only_listed_files_are_served_and_each_is_downloaded_once(client, services):
    calls = _serve(services)
    ref = services.reborn.ref
    assert len(ref) == 40
    r = client.get("/api/reborn/anim/leaf-blade")
    assert r.status_code == 200 and r.json()[0]["graphic"] == "PRAS- Grass"
    assert client.get("/api/reborn/anim/leaf-blade").status_code == 200
    assert calls == [f"https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets/{ref}/battle-anims/leaf-blade.json"]
    assert client.get("/api/reborn/sheet/PRAS- Grass").status_code == 200
    assert calls[-1].endswith("/images/battle_anims/PRAS-%20Grass.png")
    assert client.get("/api/reborn/sound/PRSFX- Leaf Blade.wav").status_code == 200
    # nothing outside the list: other animations of that repository, other pictures, other sounds, paths
    for path in ("/api/reborn/anim/..%2Fpackage", "/api/reborn/sheet/003-Attack01", "/api/reborn/sound/Blow5.m4a", "/api/reborn/x/leaf-blade"):
        assert client.get(path).status_code in (400, 404), path
    assert len(calls) == 3
    stats = services.reborn.stats()
    assert stats["cached"] == 3 and stats["available"]["anim"] > 700 and stats["ref"] == ref


def test_the_index_and_the_list_agree():
    allow = json.loads((REPO_ROOT / "silvers_hoard" / "presets" / "reborn_anims.json").read_text(encoding="utf-8"))
    index = (REPO_ROOT / "client" / "src" / "battle" / "fx" / "reborn" / "index.gen.js").read_text(encoding="utf-8")
    assert f'REBORN_REF = "{allow["ref"]}"' in index
    moves = json.loads(re.search(r"REBORN_MOVES = (\{.*?\});", index).group(1))
    status = json.loads(re.search(r"REBORN_STATUS = (\{.*?\});", index).group(1))
    assert moves["leafblade"] == "leaf-blade" and status["brn"] == "common-burn" and len(moves) > 700
    assert set(moves.values()) | set(status.values()) <= set(allow["anims"])
    assert all(s.startswith("PRAS-") for s in allow["sheets"]) and all(s.startswith("PRSFX-") for s in allow["sounds"])


def test_reborn_tool(services):
    from silvers_hoard.agent_tools import call_tool

    r = call_tool(services, "reborn_cache", {})
    assert r["cached"] == 0 and r["server"].startswith("https://raw.githubusercontent.com/")
