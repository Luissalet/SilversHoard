"""Battle music from PokeRogue's assets: only its known battle themes, cached once, alongside Showdown's tracks."""

import pytest


def test_pokerogue_tracks_are_fetched_once_and_only_known_ones(tmp_path):
    from silvers_hoard.errors import SilverError
    from silvers_hoard.sounds import PR_TRACKS, Sounds

    mp3 = b"ID3" + b"\x00" * 64
    seen = []

    def http(url):
        seen.append(url)
        return (200, mp3, "audio/mpeg") if url.endswith("/volcano.mp3") else (404, b"", "text/plain")

    s = Sounds(tmp_path / "audio", {"sound_downloads": True, "audio_server": "https://play.example/audio",
                                     "pokerogue_audio": "https://raw.example/pokerogue/audio/bgm"}, http)
    assert PR_TRACKS["volcano"] == "Firel" and "battle_kanto_gym" not in PR_TRACKS, "only its original, CC BY-NC-SA tracks"
    path = s.music("pr-volcano")
    assert path.name == "volcano.mp3" and seen == ["https://raw.example/pokerogue/audio/bgm/volcano.mp3"]
    assert s.music("pr-volcano.mp3") == path and len(seen) == 1, "cached"
    with pytest.raises(SilverError):
        s.music("pr-../../secret")
    with pytest.raises(SilverError):
        s.music("pr-battle_kanto_gym")   # a game rip it also hosts: never served
    with pytest.raises(SilverError):
        s.music("pr-sea")              # known, but the server has none here
    assert {"track": "pr-volcano", "by": "Firel", "licence": "CC BY-NC-SA 4.0"} in s.stats()["pokerogue_tracks"]


def test_music_source_setting(call):
    assert call("settings_get", {})["music_source"] == "showdown"
    call("settings_set", {"music_source": "pokerogue"})
    assert call("settings_get", {})["music_source"] == "pokerogue"
    call("settings_set", {"music_source": "radio"}, status=400)
