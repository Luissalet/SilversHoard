"""Battle videos: what is refused (unfinished, real-time, unknown speed or size, no browser), the job and the export file name."""
import pytest

from silvers_hoard.errors import SilverError

from test_prospero_sprite import run_job


def ended(services, **extra):
    return services.store.add_battle({"kind": "watch", "status": "ended", "format": "gen9customgame", "p1": {"name": "Ana"}, "p2": {"name": "Bea"},
                                      "log_text": "|start\n|turn|1\n|win|Ana", **extra})


def test_what_is_refused(services, monkeypatch):
    monkeypatch.setattr(type(services), "video_status", lambda self: {"playwright": True, "browser": "chrome", "ffmpeg": "", "hint": "h"})
    live = services.store.add_battle({"kind": "play", "status": "live", "format": "gen9customgame", "p1": {}, "p2": {}})
    with pytest.raises(SilverError) as e:
        services.battle_video(live)
    assert e.value.code == "conflict"
    with pytest.raises(SilverError):
        services.battle_video(ended(services, mode="realtime"))
    bid = ended(services)
    with pytest.raises(SilverError):
        services.battle_video(bid, speed="ludicrous")
    with pytest.raises(SilverError):
        services.battle_video(bid, size="8k")
    monkeypatch.setattr(type(services), "video_status", lambda self: {"playwright": False, "browser": "", "ffmpeg": "", "hint": "install it"})
    with pytest.raises(SilverError) as e:
        services.battle_video(bid)
    assert e.value.code == "unavailable" and e.value.hint == "install it"


def test_the_job_and_its_file(services, monkeypatch):
    monkeypatch.setattr(type(services), "video_status", lambda self: {"playwright": True, "browser": "chrome", "ffmpeg": "", "hint": ""})
    seen = {}

    def fake(self, b, speed, size, lang, lumiere, status, progress, cancelled):
        seen.update(battle=b["id"], speed=speed, size=size, lang=lang, lumiere=lumiere)
        out = self.config.exports_dir / "Ana vs Bea 123456.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"\0" * 64)
        return {"file": out.name, "url": f"/api/exports/{out.name}"}
    monkeypatch.setattr(type(services), "_record_video", fake)
    bid = ended(services)
    j = run_job(services, services.battle_video(bid, speed="fast", size="1080p", lang="en", lumiere=True))
    assert j["status"] == "done" and j["kind"] == "video", j
    assert seen == {"battle": bid, "speed": "fast", "size": "1080p", "lang": "en", "lumiere": True}
    assert services.export_file("Ana vs Bea 123456.mp4").stat().st_size == 64
    with pytest.raises(SilverError):
        services.export_file("../silver.db")


def test_status_says_what_is_missing(services):
    st = services.video_status()
    assert set(st) == {"playwright", "browser", "ffmpeg", "hint"} and isinstance(st["playwright"], bool)
