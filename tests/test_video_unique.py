"""Repeated and simultaneous recordings must leave earlier downloads intact."""
import base64
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from silvers_hoard.hoard_link.media.ffmpeg import FFmpeg


@pytest.fixture
def recorder(services, monkeypatch):
    import playwright.sync_api
    import psutil
    import subprocess

    local = threading.local()

    def start():
        callbacks = {}
        def evaluate(expression):
            if expression == "window.videoRecord()":
                callbacks["__videoChunk"](base64.b64encode(local.payload).decode())
                callbacks["__videoDone"]({"seconds": 3, "sound": True})
        def ready(*args, **kwargs):
            if local.barrier:
                local.barrier.wait(timeout=10)
        window = SimpleNamespace(send=lambda *args: {"windowId": 1})
        page = SimpleNamespace(context=SimpleNamespace(new_cdp_session=lambda _: window),
                               expose_function=lambda name, fn: callbacks.update({name: fn}),
                               goto=lambda *args, **kwargs: None, evaluate=evaluate, wait_for_function=ready)
        return SimpleNamespace(chromium=SimpleNamespace(launch=lambda **kwargs: SimpleNamespace(new_page=lambda **kw: page)),
                               stop=lambda: None)

    monkeypatch.setattr(playwright.sync_api, "sync_playwright", lambda: SimpleNamespace(start=start))
    monkeypatch.setattr(psutil, "Process", lambda: SimpleNamespace(children=lambda: []))
    monkeypatch.setattr(services, "_end_tree", lambda roots: None)
    monkeypatch.setattr(FFmpeg, "duration", lambda self, path: 3.0)
    def transcode(command, **kwargs):
        source = Path(command[command.index("-i") + 1])
        Path(command[-1]).write_bytes(b"mp4:" + source.read_bytes())
        return SimpleNamespace(returncode=0, stderr="")
    monkeypatch.setattr(subprocess, "run", transcode)

    def record(payload, mp4, stem="", barrier=None):
        local.payload, local.barrier = payload, barrier
        return services._record_video({"id":"same-battle", "p1":{"name":"Ana"}, "p2":{"name":"Bea"}},
                                      "normal", "720p", "en", False,
                                      {"browser":"fixture", "ffmpeg":"fixture" if mp4 else ""},
                                      lambda value: None, lambda: False, stem=stem)
    return record


@pytest.mark.parametrize("mp4", [False, True], ids=["webm", "mp4"])
@pytest.mark.parametrize("stem", ["", "Campal same battle"], ids=["battle", "custom-page"])
def test_repeated_export_keeps_the_previous_download(recorder, mp4, stem):
    first = recorder(b"first recording", mp4, stem)
    original = Path(first["path"]).read_bytes()
    second = recorder(b"second recording", mp4, stem)
    assert first["path"] != second["path"]
    assert first["url"] != second["url"]
    assert Path(first["path"]).read_bytes() == original
    assert Path(second["path"]).read_bytes().endswith(b"second recording")
    assert first["bytes"] == len(original)
    assert first["battle_id"] == second["battle_id"] == "same-battle"


@pytest.mark.parametrize("mp4", [False, True], ids=["webm", "mp4"])
def test_simultaneous_exports_capture_separate_streams(recorder, mp4):
    barrier = threading.Barrier(2)
    payloads = [b"recording A", b"a different recording B"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(recorder, payload, mp4, "Campal same battle", barrier) for payload in payloads]
        results = [future.result(timeout=20) for future in futures]
    assert len({result["path"] for result in results}) == 2
    for result, payload in zip(results, payloads):
        content = Path(result["path"]).read_bytes()
        assert content == (b"mp4:" if mp4 else b"") + payload
        assert result["bytes"] == len(content)
