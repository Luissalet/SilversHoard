"""Sound: Pokémon cries and battle music from the Showdown audio server, kept in ``data/cache/audio`` after the first download
(nothing of that audio ships with the app). Same idea as the sprite cache: download once, remember the 404s, serve from disk."""

from __future__ import annotations

import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic

log = logging.getLogger("silver.sounds")

CRY_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
# the only tracks the music route serves
TRACKS = (
    "bw-trainer", "bw-rival", "bw-subway-trainer", "bw2-kanto-gym-leader", "bw2-rival", "bw2-homika-dogars",
    "dpp-trainer", "dpp-rival", "hgss-johto-trainer", "hgss-kanto-trainer", "xy-trainer", "xy-rival",
    "oras-trainer", "oras-rival", "sm-trainer", "sm-rival", "xd-miror-b", "colosseum-miror-b",
)
# PokeRogue's original music (the music source "pokerogue" in Settings): only the tracks its community composed, under CC BY-NC-SA
# 4.0 (its REUSE.toml; the game rips it also hosts are left out), served as ``pr-<name>`` and credited per track
PR_TRACKS = {
    **dict.fromkeys(("abyss", "desert", "end", "graveyard", "ice_cave", "laboratory", "metropolis", "plains", "power_plant", "seabed", "space",
                     "volcano"), "Firel"),
    **dict.fromkeys(("jungle", "lake", "ruins", "rocky_coast"), "Lmz"),
    **dict.fromkeys(("battle_rival_3_afd", "battle_trainer_afd", "forest", "fairy_cave", "sea", "slum"), "Andr06"),
    "wasteland": "Leavannite",
    **dict.fromkeys(("cave", "snowy_forest", "tall_grass"), "Bird_Obsession"),
    **dict.fromkeys(("construction_site", "island"), "MattCello"),
    "underground_well": "Veilure",
    "swamp": "Faces in the Clouds",
}
NEGATIVE_TTL_S = 7 * 24 * 3600
MAX_AUDIO_BYTES = 12 * 1024 * 1024


def looks_like_mp3(body: bytes, ctype: str) -> bool:
    return ctype.lower().startswith("audio/") or body[:3] == b"ID3" or (len(body) > 2 and body[0] == 0xFF and (body[1] & 0xE0) == 0xE0)


class Sounds:
    def __init__(self, cache_dir: Path, settings: Any, http_get: Optional[Callable[[str], tuple[int, bytes, str]]] = None):
        from .sprites import _http_get

        self.cache_dir = Path(cache_dir)
        self.settings = settings
        self._http_get = http_get or _http_get
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self.downloads = 0
        self.misses = 0
        from .music_library import MusicLibrary
        self.library = MusicLibrary(self.cache_dir.parent.parent / "music")

    def _lock(self, key: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())

    def _fetch(self, rel: str, url: str = "") -> Optional[Path]:
        """The cached file ``rel`` (e.g. ``cries/pikachu.mp3``), downloading it once; None when the server has no such file
        (remembered for a week), the network is down, or downloads are off and it is not cached."""
        path = self.cache_dir / rel
        if path.exists() and path.stat().st_size > 0:
            return path
        miss = path.with_suffix(path.suffix + ".404")
        if miss.exists() and time.time() - miss.stat().st_mtime < NEGATIVE_TTL_S:
            return None
        if not self.settings.get("sound_downloads", True):
            return None
        with self._lock(rel):
            if path.exists() and path.stat().st_size > 0:
                return path
            sub = rel.removeprefix("music/")
            url = url or f"{str(self.settings.get('audio_server')).rstrip('/')}/{sub}"
            try:
                status, body, ctype = self._http_get(url)
            except Exception as exc:  # noqa: BLE001 - offline: no sound, the UI carries on silent
                log.info("audio %s: %s", rel, exc)
                return None
            if status == 200 and body and len(body) < MAX_AUDIO_BYTES and looks_like_mp3(body, ctype):
                path.parent.mkdir(parents=True, exist_ok=True)
                write_bytes_atomic(path, body, fsync=False)
                self.downloads += 1
                return path
            if status in (404, 403, 410):
                miss.parent.mkdir(parents=True, exist_ok=True)
                miss.write_text(str(status))
            self.misses += 1
            return None

    def cry(self, cry_id: str) -> Path:
        """The cry of a species or form (``charizard-megax``); a form without its own cry falls back to the base species."""
        cid = cry_id.lower()
        if cid.endswith(".mp3"):
            cid = cid[:-4]
        if not CRY_ID.match(cid):
            raise SilverError("invalid", f"Not a cry id: {cry_id}")
        base = cid.split("-")[0]
        for c in dict.fromkeys([cid, base]):
            path = self._fetch(f"cries/{c}.mp3")
            if path:
                return path
        raise SilverError("not_found", f"No cry for {cry_id}")

    def music(self, track: str) -> Path:
        t = track.lower()
        if t.endswith(".mp3"):
            t = t[:-4]
        if t.startswith("local-"):
            return self.library.path(t)
        if t.startswith("pr-"):
            name = t[3:]
            if name not in PR_TRACKS:
                raise SilverError("invalid", f"Not a battle track: {track}")
            base = str(self.settings.get("pokerogue_audio") or "").rstrip("/")
            path = self._fetch(f"music/pokerogue/{name}.mp3", f"{base}/{name}.mp3")
            if not path:
                raise SilverError("not_found", f"No music {track}")
            return path
        if t not in TRACKS:
            raise SilverError("invalid", f"Not a battle track: {track}")
        path = self._fetch(f"music/{t}.mp3")
        if not path:
            raise SilverError("not_found", f"No music {track}")
        return path

    def stats(self) -> dict[str, Any]:
        files = [p for p in self.cache_dir.rglob("*.mp3") if p.is_file()] if self.cache_dir.exists() else []
        return {"cached": len(files), "bytes": sum(p.stat().st_size for p in files), "downloads": self.downloads, "misses": self.misses,
                "downloads_on": bool(self.settings.get("sound_downloads", True)), "tracks": list(TRACKS),
                "pokerogue_tracks": [{"track": f"pr-{x}", "by": who, "licence": "CC BY-NC-SA 4.0"} for x, who in PR_TRACKS.items()]}
