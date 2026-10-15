"""Pokémon cries and battle music: downloaded once from the audio server, cached on disk, remembered when missing."""

import re
from pathlib import Path

import pytest

from silvers_hoard.errors import SilverError
from silvers_hoard.sounds import PR_TRACKS, TRACKS


def _audio(services) -> Path:
    return services.config.sprites_dir.parent / "audio"


def _count(services):
    calls = []
    inner = services.sounds._http_get

    def counting(url):
        calls.append(url)
        return inner(url)

    services.sounds._http_get = counting
    return calls


def test_cry_is_downloaded_once_and_cached(client, services):
    calls = _count(services)
    r = client.get("/api/cries/pikachu")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content.startswith(b"ID3")
    assert (_audio(services) / "cries" / "pikachu.mp3").exists()
    assert client.get("/api/cries/pikachu.mp3").status_code == 200       # the extension is optional
    assert client.get("/api/cries/Pikachu").status_code == 200           # ids are lowercased
    assert calls == ["https://play.pokemonshowdown.com/audio/cries/pikachu.mp3"]
    assert services.sounds.downloads == 1


def test_cry_of_a_form_falls_back_to_the_species(client, services):
    calls = _count(services)
    assert client.get("/api/cries/charizard-megax").status_code == 200
    assert (_audio(services) / "cries" / "charizard-megax.mp3").exists()
    assert client.get("/api/cries/charizard-nocry").status_code == 200
    cries = _audio(services) / "cries"
    assert (cries / "charizard.mp3").exists() and not (cries / "charizard-nocry.mp3").exists()
    assert (cries / "charizard-nocry.mp3.404").exists()                  # the missing form is remembered
    before = len(calls)
    assert client.get("/api/cries/charizard-nocry").status_code == 200
    assert len(calls) == before                                          # nothing new asked: the 404 and the base cry are on disk


def test_missing_cry_is_remembered(client, services):
    calls = _count(services)
    assert client.get("/api/cries/missingmon").status_code == 404
    first = len(calls)
    assert client.get("/api/cries/missingmon").status_code == 404
    assert len(calls) == first and (_audio(services) / "cries" / "missingmon.mp3.404").exists()


def test_cry_ids_are_validated(client):
    for bad in ["..%2F..%2Fetc%2Fpasswd", "a%20b", "-pikachu", "pikachu.png", "x" * 80, "pika%2Fchu", "pikachu%00"]:
        assert client.get(f"/api/cries/{bad}").status_code in (400, 404), bad
    assert client.get("/api/cries/pikachu.png").status_code == 400


def test_a_page_that_is_not_audio_is_not_stored(client, services):
    assert client.get("/api/cries/webpage").status_code == 404
    assert not (_audio(services) / "cries" / "webpage.mp3").exists()


def test_music_whitelist(client, services):
    assert len(TRACKS) == 18 and "bw-trainer" in TRACKS and "colosseum-miror-b" in TRACKS
    r = client.get("/api/music/bw-trainer")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert (_audio(services) / "music" / "bw-trainer.mp3").exists()
    assert client.get("/api/music/bw-trainer.mp3").status_code == 200
    for bad in ["not-a-track", "bw-trainer2", "..%2F..%2Fsecret", "cries", "xy-trainer%00"]:
        assert client.get(f"/api/music/{bad}").status_code in (400, 404), bad
    assert client.get("/api/music/not-a-track").status_code == 400
    calls = _count(services)
    assert client.get("/api/music/bw-trainer").status_code == 200
    assert calls == []                                                   # cached
    services.sounds.downloads = 0
    for track in TRACKS:
        assert client.get(f"/api/music/{track}").status_code == 200
    assert services.sounds.downloads == len(TRACKS) - 1                  # bw-trainer was already on disk


def test_music_is_fetched_from_the_audio_root(client, services):
    calls = _count(services)
    client.get("/api/music/xy-rival")
    assert calls == ["https://play.pokemonshowdown.com/audio/xy-rival.mp3"]


def test_downloads_off_serves_only_what_is_cached(client, services, call):
    assert client.get("/api/cries/eevee").status_code == 200
    call("settings_set", {"sound_downloads": False})
    assert client.get("/api/cries/eevee").status_code == 200
    assert client.get("/api/cries/snorlax").status_code == 404
    assert client.get("/api/music/sm-rival").status_code == 404
    stats = client.get("/api/sound/stats").json()
    assert stats["cached"] == 1 and stats["downloads_on"] is False and "bw-trainer" in stats["tracks"]


def test_audio_server_must_be_https(services):
    with pytest.raises(SilverError):
        services.settings.update({"audio_server": "http://example.test/audio"})
    assert services.settings.update({"audio_server": "https://example.test/audio"})["audio_server"] == "https://example.test/audio"


def test_the_tracks_the_client_picks_from_are_all_served():
    """client/src/audio.js picks by generation from its own list; every id in it must be on the server's whitelist."""
    text = (Path(__file__).resolve().parent.parent / "client" / "src" / "audio.js").read_text(encoding="utf-8")
    block = text[text.index("const TRACKS"):text.index("export function pickTrack")]
    ids = set(re.findall(r'"([a-z0-9-]+)"', block)) - {"pokerogue"}     # the music source's own name, not a track
    assert ids and ids <= set(TRACKS) | set(PR_TRACKS)          # the community source's tracks are served as pr-<name>
