"""A saved presentation mix follows the battle across clients and into the recorder."""
import base64
import json
from types import SimpleNamespace

import pytest

from silvers_hoard.store import Store
from silvers_hoard.hoard_link.media.ffmpeg import FFmpeg
from test_video import ended
from test_prospero_sprite import run_job


MIX = {"master": .8, "music": 1, "sfx": .15, "cries": .2, "mute": False, "music_track": "bw-trainer"}


def test_saved_mix_survives_another_reader_without_changing_replay(call, services):
    bid = ended(services, mode="realtime", replay={"tick": 90, "inputs": [], "spec": {"seed": 42}})
    before = services.store.battle(bid)
    result = call("battle_audio_set", {"id": bid, "audio": MIX})
    other = Store(services.config.db_path)
    try:
        after = other.battle(bid)
        assert after["audio"] == result["audio"] == MIX
        assert {k: v for k, v in after.items() if k not in ("audio", "updated_at")} == {
            k: v for k, v in before.items() if k not in ("audio", "updated_at")}
    finally:
        other.close()
    assert services.battle_get(bid)["audio"] == MIX


@pytest.mark.parametrize("patch", [{"music": -1}, {"sfx": 1.1}, {"master": "NaN"},
                                    {"music_track": "missing"}, {"music_track": "local-" + "a" * 64}])
def test_invalid_mix_preserves_saved_audio(call, services, patch):
    bid = ended(services)
    call("battle_audio_set", {"id": bid, "audio": MIX})
    call("battle_audio_set", {"id": bid, "audio": {**MIX, **patch}}, status=404 if "local-" in str(patch) else 400)
    assert services.store.battle(bid)["audio"] == MIX


def test_local_song_identity_is_saved_without_copying_audio_into_battle(call, services):
    # Two complete MP3 frames, as in the music-library tests.
    body = (b"\xff\xfb\x90\x00" + bytes(413)) * 3
    track = services.sounds.library.import_bytes("my.mp3", body)["track"]
    bid = ended(services)
    mix = {**MIX, "music_track": track["id"]}
    call("battle_audio_set", {"id": bid, "audio": mix})
    assert services.battle_get(bid)["audio"] == mix
    assert services.sounds.library.path(track["id"]).read_bytes() == body
    assert "base64" not in json.dumps(services.store.battle(bid)["audio"])


def test_video_uses_saved_mix_and_freezes_explicit_override(call, services, monkeypatch):
    seen = []
    monkeypatch.setattr(services, "video_status", lambda: {"playwright": True, "browser": "fixture", "ffmpeg": "", "hint": ""})
    monkeypatch.setattr(services, "_record_video", lambda *a, **kw: seen.append(kw["audio"]) or {"file": "mix.mp4"})
    bid = ended(services)
    call("battle_audio_set", {"id": bid, "audio": MIX})
    job = call("battle_video", {"id": bid})
    assert run_job(services, job)["status"] == "done"
    override = {**MIX, "music_track": "none", "sfx": 0, "mute": True}
    assert run_job(services, call("battle_video", {"id": bid, "audio": override}))["status"] == "done"
    assert seen == [MIX, override]
    assert services.store.battle(bid)["audio"] == MIX


def test_mix_is_installed_before_navigation_and_reported(services, monkeypatch):
    import playwright.sync_api
    import psutil

    seen, callbacks = [], {}
    def evaluate(expression):
        if expression == "window.videoRecord()":
            callbacks["__videoChunk"](base64.b64encode(b"frames").decode())
            callbacks["__videoDone"]({"seconds": 3, "sound": True})
    page = SimpleNamespace(
        add_init_script=lambda script: seen.append(("mix", script)),
        context=SimpleNamespace(new_cdp_session=lambda _: SimpleNamespace(send=lambda *a: {"windowId": 1})),
        expose_function=lambda name, fn: callbacks.update({name: fn}),
        goto=lambda url, **kw: seen.append(("goto", url)), evaluate=evaluate, wait_for_function=lambda *a, **kw: None)
    runtime = SimpleNamespace(chromium=SimpleNamespace(launch=lambda **kw: SimpleNamespace(new_page=lambda **kw: page)), stop=lambda: None)
    monkeypatch.setattr(playwright.sync_api, "sync_playwright", lambda: SimpleNamespace(start=lambda: runtime))
    monkeypatch.setattr(psutil, "Process", lambda: SimpleNamespace(children=lambda: []))
    monkeypatch.setattr(services, "_end_tree", lambda _: None)
    monkeypatch.setattr(FFmpeg, "duration", lambda *a: 3)
    result = services._record_video({"id": "battle-mix", "p1": {}, "p2": {}}, "normal", "1080p", "es", False,
        {"browser": "fixture", "ffmpeg": ""}, lambda _: None, lambda: False, audio=MIX, aspect="portrait")
    assert [x[0] for x in seen] == ["mix", "goto"]
    literal = seen[0][1].removeprefix("localStorage.setItem('silver-sound', ").removesuffix(");")
    assert json.loads(json.loads(literal)) == result["audio"] == MIX
    assert (result["width"], result["height"]) == (1080, 1920)
