"""Export metadata describes the final media file, including capture setup time."""
import base64
from pathlib import Path
from types import SimpleNamespace

import pytest

from silvers_hoard.hoard_link.errors import Unavailable
from silvers_hoard.hoard_link.media.ffmpeg import FFmpeg, FFmpegError


@pytest.fixture
def record(services, monkeypatch):
    """Exercise the real export finalizer with a completed browser recording."""
    import playwright.sync_api
    import psutil
    import subprocess

    callbacks = {}
    def evaluate(expression):
        if expression == "window.videoRecord()":
            callbacks["__videoChunk"](base64.b64encode(b"recorded webm").decode())
            callbacks["__videoDone"]({"seconds": 22.8, "sound": True})

    window = SimpleNamespace(send=lambda *args: {"windowId": 1})
    page = SimpleNamespace(context=SimpleNamespace(new_cdp_session=lambda _: window),
                           expose_function=lambda name, fn: callbacks.update({name: fn}),
                           goto=lambda *args, **kwargs: None, evaluate=evaluate,
                           wait_for_function=lambda *args, **kwargs: None)
    runtime = SimpleNamespace(chromium=SimpleNamespace(launch=lambda **kwargs: SimpleNamespace(new_page=lambda **kw: page)),
                              stop=lambda: None)
    monkeypatch.setattr(playwright.sync_api, "sync_playwright", lambda: SimpleNamespace(start=lambda: runtime))
    monkeypatch.setattr(psutil, "Process", lambda: SimpleNamespace(children=lambda: []))
    monkeypatch.setattr(services, "_end_tree", lambda roots: None)
    def transcode(command, **kwargs):
        Path(command[-1]).write_bytes(b"final mp4")
        return SimpleNamespace(returncode=0, stderr="")
    monkeypatch.setattr(subprocess, "run", transcode)

    def run(mp4=False):
        return services._record_video({"id": "qa-duration", "p1": {"name": "Ana"}, "p2": {"name": "Bea"}},
                                      "normal", "720p", "en", False,
                                      {"browser": "fixture", "ffmpeg": "fixture" if mp4 else ""},
                                      lambda value: None, lambda: False)
    return run


@pytest.mark.parametrize("mp4", [False, True], ids=["webm", "mp4"])
def test_duration_comes_from_the_final_export(record, monkeypatch, mp4):
    seen = []
    def duration(self, path):
        seen.append(path)
        return 24.345333
    monkeypatch.setattr(FFmpeg, "duration", duration)
    result = record(mp4)
    assert result["seconds"] == 24.3
    assert [p.suffix for p in seen] == [".mp4" if mp4 else ".webm"]
    assert str(seen[0].resolve()) == result["path"]
    assert result["sound"] is True and result["width"] == 1280 and result["height"] == 720


@pytest.mark.parametrize("probe", [0.0, -1.0, OSError("unavailable"),
                                  Unavailable("ffprobe", ["not installed"]),
                                  FFmpegError("unreadable metadata")],
                         ids=["no-duration", "negative-duration", "os-error", "missing-tool", "probe-error"])
def test_unavailable_duration_keeps_the_recorders_estimate(record, monkeypatch, probe):
    def duration(self, path):
        if isinstance(probe, Exception):
            raise probe
        return probe
    monkeypatch.setattr(FFmpeg, "duration", duration)
    assert record()["seconds"] == 22.8
