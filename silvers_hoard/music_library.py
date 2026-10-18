"""Personal MP3s, ordered playlists and the listening queue, separate from battle data."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import threading
import uuid
from pathlib import Path

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic, write_json_atomic
from .sounds import PR_TRACKS, TRACKS

LOCAL_ID = re.compile(r"^local-[a-f0-9]{64}$")
BUILTIN_IDS = set(TRACKS) | {f"pr-{name}" for name in PR_TRACKS}


def validate_mp3(body: bytes) -> None:
    """Require consecutive complete MPEG Layer III frames, allowing an ID3v2 prefix."""
    start = 0
    if body[:3] == b"ID3":
        if len(body) < 10 or any(x & 128 for x in body[6:10]):
            raise SilverError("invalid", "Invalid MP3 ID3 tag.")
        start = 10 + sum(x << shift for x, shift in zip(body[6:10], (21, 14, 7, 0)))
        if body[5] & 16:
            start += 10

    def frame_end(pos):
        if pos + 4 > len(body):
            return None
        a, b, c, _ = body[pos:pos + 4]
        version, layer, rate, sample = (b >> 3) & 3, (b >> 1) & 3, c >> 4, (c >> 2) & 3
        if a != 255 or b & 224 != 224 or version == 1 or layer != 1 or rate in (0, 15) or sample == 3:
            return None
        rates = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320) if version == 3 else (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
        hz = (44100, 48000, 32000)[sample] // (1 if version == 3 else 2 if version == 2 else 4)
        end = pos + (144000 if version == 3 else 72000) * rates[rate] // hz + ((c >> 1) & 1)
        return end if end <= len(body) else None

    for pos in range(start, min(start + 65536, len(body) - 3)):
        end = frame_end(pos)
        if end is not None and frame_end(end) is not None:
            return
    raise SilverError("invalid", "This file does not contain playable MP3 frames.")


class MusicLibrary:
    def __init__(self, root: Path):
        self.root = Path(root)
        self._lock = threading.RLock()

    def _read(self):
        path = self.root / "library.json"
        try:
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            return {"tracks": {}, "playlists": {}, "queue": {"tracks": [], "index": 0, "repeat": "off", "shuffle": False}}
        except (ValueError, OSError) as exc:
            raise SilverError("failed", "Could not read the music library; the existing file has been preserved.") from exc

    def _write(self, data):
        self.root.mkdir(parents=True, exist_ok=True)
        write_json_atomic(self.root / "library.json", data)

    def snapshot(self):
        with self._lock:
            data = self._read()
            return {"tracks": list(data["tracks"].values()), "playlists": list(data["playlists"].values()), "queue": copy.deepcopy(data["queue"])}

    def import_file(self, path: str, title: str = ""):
        source = Path(path).expanduser()
        if not source.is_file():
            raise SilverError("not_found", "MP3 file not found.")
        return self.import_bytes(source.name, source.read_bytes(), title)

    def import_bytes(self, filename: str, body: bytes, title: str = ""):
        filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
        if Path(filename).suffix.lower() != ".mp3":
            raise SilverError("invalid", "Choose an .mp3 file.")
        validate_mp3(body)
        track_id = "local-" + hashlib.sha256(body).hexdigest()
        with self._lock:
            data = self._read()
            existing = data["tracks"].get(track_id)
            track = {"id": track_id, "title": (title.strip() or (existing or {}).get("title") or Path(filename).stem)[:300],
                     "filename": filename, "bytes": len(body), "source": "local", "archived": False}
            self.root.mkdir(parents=True, exist_ok=True)
            target = self.root / f"{track_id}.mp3"
            if not target.exists():
                write_bytes_atomic(target, body)
            data["tracks"][track_id] = track
            self._write(data)
            return {"track": track, "duplicate": bool(existing)}

    def path(self, track_id):
        with self._lock:
            data = self._read()
            track = data["tracks"].get(track_id) if LOCAL_ID.fullmatch(track_id) else None
            path = self.root / f"{track_id}.mp3"
            if not track or track.get("archived") or not path.is_file():
                raise SilverError("not_found", "Personal music track not found.")
            return path

    def _check_tracks(self, data, tracks):
        for tid in tracks:
            own = data["tracks"].get(tid)
            if tid not in BUILTIN_IDS and (not own or own.get("archived")):
                raise SilverError("not_found", f"Unknown music track: {tid}")

    def update_track(self, track_id, title=None, archived=None):
        with self._lock:
            data = self._read()
            track = data["tracks"].get(track_id)
            if not track:
                raise SilverError("not_found", "Personal music track not found.")
            if title is not None:
                if not title.strip():
                    raise SilverError("invalid", "The song needs a title.")
                track["title"] = title.strip()
            if archived is not None:
                track["archived"] = archived
            if archived:
                for playlist in data["playlists"].values():
                    playlist["tracks"] = [tid for tid in playlist["tracks"] if tid != track_id]
                queue = data["queue"]
                old = queue["tracks"]
                index = queue["index"]
                queue["tracks"] = [tid for tid in old if tid != track_id]
                queue["index"] = min(sum(tid != track_id for tid in old[:index]), max(0, len(queue["tracks"]) - 1))
            self._write(data)
            return self.snapshot()

    def save_playlist(self, name, tracks, playlist_id=""):
        name = name.strip()
        if not name:
            raise SilverError("invalid", "The playlist needs a name.")
        with self._lock:
            data = self._read()
            if playlist_id and playlist_id not in data["playlists"]:
                raise SilverError("not_found", "Playlist not found.")
            self._check_tracks(data, tracks)
            playlist_id = playlist_id or "playlist-" + uuid.uuid4().hex
            playlist = {"id": playlist_id, "name": name, "tracks": tracks}
            data["playlists"][playlist_id] = playlist
            self._write(data)
            return {"playlist": playlist}

    def delete_playlist(self, playlist_id):
        with self._lock:
            data = self._read()
            if playlist_id not in data["playlists"]:
                raise SilverError("not_found", "Playlist not found.")
            del data["playlists"][playlist_id]
            self._write(data)
            return {"deleted": playlist_id}

    def set_queue(self, tracks, index=0, repeat="off", shuffle=False):
        with self._lock:
            data = self._read()
            self._check_tracks(data, tracks)
            if index < 0 or index >= max(1, len(tracks)):
                raise SilverError("invalid", "Queue position is outside the track list.")
            data["queue"] = {"tracks": tracks, "index": index, "repeat": repeat, "shuffle": shuffle}
            self._write(data)
            return {"queue": copy.deepcopy(data["queue"])}
