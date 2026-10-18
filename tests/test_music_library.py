import base64
import concurrent.futures
import json

import pytest

from silvers_hoard.agent_tools import TOOLS_BY_NAME, call_tool
from silvers_hoard.errors import SilverError
from silvers_hoard.music_library import MusicLibrary, validate_mp3

# Complete, consecutive MPEG1 Layer III frames (128 kbps, 44.1 kHz).
MP3 = (bytes.fromhex("fffb9000") + bytes(413)) * 4
MP3_B = (bytes.fromhex("fffb9000") + bytes(412) + b"\x01") * 4


def test_upload_persists_originals_deduplicates_and_serves_range(client, call, services, tmp_path):
    for name, body in [("Canción uno.MP3", MP3), ("Canción dos.mp3", MP3_B)]:
        r = client.post("/api/music/upload", files={"file": (name, body, "audio/mpeg")})
        assert r.status_code == 200, r.text
        tid = r.json()["track"]["id"]
        assert client.get(f"/api/music/{tid}").content == body
        partial = client.get(f"/api/music/{tid}", headers={"Range": "bytes=10-19"})
        assert partial.status_code == 206 and partial.content == body[10:20]
    tracks = call("music_library")["tracks"]
    assert len(tracks) == 2 and tracks[0]["title"] == "Canción uno"
    again = call("music_import", {"filename": "copy.mp3", "base64": base64.b64encode(MP3).decode()})
    assert again["duplicate"] and again["track"]["title"] == "Canción uno"
    fresh = MusicLibrary(services.config.data_dir / "music")
    assert len(fresh.snapshot()["tracks"]) == 2
    source = tmp_path / "original.mp3"
    source.write_bytes(MP3_B)
    imported = call("music_import", {"path": str(source), "title": "Mi título"})
    assert imported["duplicate"] and source.read_bytes() == MP3_B
    assert imported["track"]["title"] == "Mi título"


@pytest.mark.parametrize("name,body", [("bad.mp3", b"ID3"), ("bad.mp3", b"<html>"), ("bad.mp3", bytes.fromhex("fffb9000")), ("bad.wav", MP3), ("bad.mp3", b"ID3" + bytes(7)), ("bad.mp3", b"")])
def test_rejects_invalid_upload_without_touching_library(client, call, name, body):
    before = call("music_library")
    assert client.post("/api/music/upload", files={"file": (name, body, "audio/mpeg")}).status_code == 400
    assert call("music_library") == before


def test_id3_and_mpeg_versions():
    validate_mp3(b"ID3\x04\x00\x00\x00\x00\x00\x04test" + MP3)
    # MPEG2, 64 kbps at 22.05kHz: 208-byte frames.
    validate_mp3((bytes.fromhex("fff38000") + bytes(204)) * 3)


def test_playlists_queue_duplicates_archive_restore_and_unknowns(call, client):
    tid = call("music_import", {"filename": "a.mp3", "base64": base64.b64encode(MP3).decode()})["track"]["id"]
    ids = [tid, "bw-trainer", tid]
    pl = call("music_playlist_save", {"name": "  Favoritas  ", "tracks": ids})["playlist"]
    assert pl["name"] == "Favoritas" and pl["tracks"] == ids
    queue = {"tracks": ids, "index": 2, "repeat": "all", "shuffle": True}
    assert call("music_queue_set", queue)["queue"] == queue
    assert call("music_playlist_save", {"id": pl["id"], "name": "Otra", "tracks": list(reversed(ids))})["playlist"]["name"] == "Otra"
    before = call("music_library")
    call("music_queue_set", {"tracks": ids, "index": 3}, status=400)
    call("music_queue_set", {"tracks": [], "index": 1}, status=400)
    call("music_queue_set", {"tracks": ["unknown"]}, status=404)
    call("music_playlist_save", {"name": "Bad", "tracks": ["unknown"]}, status=404)
    call("music_playlist_save", {"id": "no", "name": "Bad"}, status=404)
    call("music_playlist_save", {"name": " "}, status=400)
    assert call("music_library") == before
    updated = call("music_track_update", {"id": tid, "archived": True})
    assert updated["queue"] == {**queue, "tracks": ["bw-trainer"], "index": 0}
    assert updated["playlists"][0]["tracks"] == ["bw-trainer"]
    assert client.get(f"/api/music/{tid}").status_code == 404
    call("music_track_update", {"id": tid, "archived": False, "title": "Restaurada"})
    assert client.get(f"/api/music/{tid}").content == MP3
    call("music_playlist_delete", {"id": pl["id"]})
    assert call("music_library")["playlists"] == []
    assert len(call("music_library")["tracks"]) == 1


def test_import_errors_and_path_containment(call, client):
    call("music_import", {"filename": "a.mp3", "base64": "not base64"}, status=400)
    call("music_import", {"path": "does-not-exist.mp3"}, status=404)
    call("music_track_update", {"id": "../outside", "title": "bad"}, status=404)
    assert client.get("/api/music/local-" + "f" * 64).status_code == 404
    result = call("music_import", {"filename": "../../song.mp3", "base64": base64.b64encode(MP3).decode()})
    assert result["track"]["filename"] == "song.mp3"


def test_concurrent_writes_keep_every_playlist(tmp_path):
    lib = MusicLibrary(tmp_path / "music")
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda i: lib.save_playlist(str(i), ["bw-trainer"]), range(20)))
    assert len(MusicLibrary(lib.root).snapshot()["playlists"]) == 20


def test_corrupt_library_is_preserved(tmp_path):
    lib = MusicLibrary(tmp_path)
    (tmp_path / "library.json").write_text("broken", encoding="utf-8")
    with pytest.raises(SilverError):
        lib.save_playlist("new", [])
    assert (tmp_path / "library.json").read_text() == "broken"


def test_music_tools_use_shared_handlers_and_catalog(services):
    names = {name for name in TOOLS_BY_NAME if name.startswith("music_")}
    assert len(names) == 6
    for name in names:
        assert len(TOOLS_BY_NAME[name].description.splitlines()[0]) <= 110
    assert TOOLS_BY_NAME["music_library"].annotations["readOnlyHint"]
    result = call_tool(services, "music_playlist_save", {"name": "MCP", "tracks": ["pr-volcano"]})
    assert call_tool(services, "music_library")["playlists"][0] == result["playlist"]
