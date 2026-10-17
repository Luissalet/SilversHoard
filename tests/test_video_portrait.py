"""Check the frame reaches the native recorder, UI/agent handlers and both battle kinds."""
import base64
from types import SimpleNamespace

import pytest

from silvers_hoard.errors import SilverError
from silvers_hoard.hoard_link.media.ffmpeg import FFmpeg
from test_prospero_sprite import run_job
from test_video import ended


@pytest.mark.parametrize("size,aspect,expected", [
    ("720p", "landscape", (1280, 720)), ("1080p", "landscape", (1920, 1080)),
    ("720p", "portrait", (720, 1280)), ("1080p", "portrait", (1080, 1920)),
])
def test_capture_uses_real_dimensions_and_matching_stage(services, monkeypatch, size, aspect, expected):
    import playwright.sync_api
    import psutil
    seen, callbacks = {}, {}

    def evaluate(expression):
        if expression == "window.videoRecord()":
            callbacks["__videoChunk"](base64.b64encode(b"recorded frames").decode())
            callbacks["__videoDone"]({"seconds": 3, "sound": True})

    def send(method, args=None):
        if method == "Browser.setContentsSize":
            seen["contents"] = args
        return {"windowId": 1}

    page = SimpleNamespace(context=SimpleNamespace(new_cdp_session=lambda _: SimpleNamespace(send=send)),
        expose_function=lambda name, fn: callbacks.update({name: fn}),
        goto=lambda url, **kw: seen.update(url=url), evaluate=evaluate, wait_for_function=lambda *a, **kw: None)

    def new_page(**kwargs):
        seen.update(kwargs)
        return page

    runtime = SimpleNamespace(chromium=SimpleNamespace(launch=lambda **kw: SimpleNamespace(new_page=new_page)), stop=lambda: None)
    monkeypatch.setattr(playwright.sync_api, "sync_playwright", lambda: SimpleNamespace(start=lambda: runtime))
    monkeypatch.setattr(psutil, "Process", lambda: SimpleNamespace(children=lambda: []))
    monkeypatch.setattr(services, "_end_tree", lambda roots: None)
    monkeypatch.setattr(FFmpeg, "duration", lambda self, path: 3.0)
    result = services._record_video({"id": "test-battle", "p1": {"name": "A"}, "p2": {"name": "B"}},
        "normal", size, "en", False, {"browser": "fixture", "ffmpeg": ""}, lambda _: None, lambda: False, aspect=aspect)
    width, height = expected
    assert seen["viewport"] == {"width": width, "height": height}
    assert seen["contents"] == {"windowId": 1, "width": width, "height": height}
    assert f"&aspect={aspect}" in seen["url"]
    assert (result["width"], result["height"]) == expected
    assert result["aspect"] == aspect and result["sound"]


def test_api_passes_portrait_and_preserves_battle(call, services, monkeypatch):
    seen = {}
    monkeypatch.setattr(services, "video_status", lambda: {"playwright": True, "browser": "fixture", "ffmpeg": "", "hint": ""})
    monkeypatch.setattr(services, "_record_video", lambda b, *args, **kw: seen.update(battle=b["id"], **kw) or {"file": "vertical.mp4"})
    bid = ended(services)
    before = services.store.battle(bid)
    job = call("battle_video", {"id": bid, "aspect": "portrait", "size": "1080p"})
    assert run_job(services, job)["status"] == "done"
    assert seen == {"battle": bid, "aspect": "portrait"}
    assert services.store.battle(bid) == before
    call("battle_video", {"id": bid, "aspect": "square"}, status=400)
    with pytest.raises(SilverError):
        services.battle_video(bid, aspect="square")


def test_mass_api_passes_format_and_run_to_shared_recorder(call, services, monkeypatch):
    seen = {}
    doc = {"id": "mass_portrait", "title": "Vertical arena", "summary": {"seconds": 20}}
    monkeypatch.setattr(services.mass, "_load", lambda _: doc)
    monkeypatch.setattr(services.mass, "play_get", lambda *args: {"seconds": 10, "challenger": "Challenger"})
    monkeypatch.setattr(services, "video_status", lambda: {"playwright": True, "browser": "fixture", "ffmpeg": "", "hint": ""})
    monkeypatch.setattr(services, "_record_video", lambda b, *args, **kw: seen.update(kw) or {"file": "mass.mp4"})
    job = call("mass_video", {"id": doc["id"], "play_id": "run_one", "aspect": "portrait", "size": "1080p"})
    assert run_job(services, job)["status"] == "done"
    assert seen["aspect"] == "portrait"
    assert "&play=run_one" in seen["url_path"] and seen["seconds"] == 5
