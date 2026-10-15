"""Pokémon Reborn's move animations for the turn-based screen's "reborn" animation style: the animation files, their sheets and
Reborn's own sounds, as pagefaultgames/pokerogue-assets keeps them, downloaded once from a fixed commit and kept in
``data/cache/reborn`` (nothing of that art ships with the app).

Only what ``presets/reborn_anims.json`` lists can be asked for: the files that repository marks LicenseRef-POKEMON-REBORN (The
Pokémon Reborn Team: «credit… borrow whatever you need»), drawn with Reborn's own sheets ("PRAS- …") and sounding Reborn's own
sounds ("PRSFX- …"). scripts/build_reborn.py writes that list and the client's index. Same idea as the effect cache (fxcache.py):
download once, remember the 404s for a week, serve from disk."""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any, Callable, Optional

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic

log = logging.getLogger("silver.reborn")

PRESET = Path(__file__).resolve().parent / "presets" / "reborn_anims.json"
DEFAULT_SERVER = "https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets"
NEGATIVE_TTL_S = 7 * 24 * 3600
MAX_BYTES = 6 * 1024 * 1024
# kind -> (list in the preset, folder in the repository, extension added to the name)
KINDS = {"anim": ("anims", "battle-anims", ".json"), "sheet": ("sheets", "images/battle_anims", ".png"),
         "sound": ("sounds", "audio/battle_anims", "")}


def _looks_right(kind: str, body: bytes) -> bool:
    if kind == "sheet":
        return body[:8] == b"\x89PNG\r\n\x1a\n"
    if kind == "sound":
        return body[:4] == b"RIFF" and body[8:12] == b"WAVE"
    try:
        return isinstance(json.loads(body.decode("utf-8")), (list, dict))
    except (UnicodeDecodeError, ValueError):
        return False


class RebornCache:
    def __init__(self, cache_dir: Path, settings: Any, http_get: Optional[Callable[[str], tuple[int, bytes, str]]] = None,
                 preset: Optional[Path] = None):
        from .sprites import _http_get

        self.cache_dir = Path(cache_dir)
        self.settings = settings
        self._http_get = http_get or _http_get
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        self.downloads = 0
        self.misses = 0
        try:
            data = json.loads((preset or PRESET).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        self.ref = str(data.get("ref") or "beta")
        self.allowed = {kind: set(data.get(key) or []) for kind, (key, _, _) in KINDS.items()}

    def _lock(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def _server(self) -> str:
        return str(self.settings.get("reborn_server") or DEFAULT_SERVER).rstrip("/")

    def url(self, kind: str, name: str) -> str:
        _, folder, ext = KINDS[kind]
        return f"{self._server()}/{self.ref}/{folder}/{urllib.parse.quote(name + ext)}"

    def get(self, kind: str, name: str) -> Path:
        """The cached file ``name`` of ``kind`` (anim: "leaf-blade", sheet: "PRAS- Grass", sound: "PRSFX- Leaf Blade.wav"),
        downloading it the first time. SilverError ``invalid`` for anything outside the list, ``not_found`` when it cannot be had."""
        if kind not in KINDS or name not in self.allowed[kind]:
            raise SilverError("invalid", f"Not one of Reborn's animation files: {name}")
        rel = f"{kind}/{name}{KINDS[kind][2]}"
        path = self.cache_dir / rel
        if path.exists() and path.stat().st_size > 0:
            return path
        miss = path.with_name(path.name + ".404")
        if miss.exists() and time.time() - miss.stat().st_mtime < NEGATIVE_TTL_S:
            raise SilverError("not_found", f"No Reborn file {name}")
        if not self.settings.get("sprite_downloads", True):
            raise SilverError("not_found", f"Reborn file {name} is not cached and downloads are off")
        with self._lock(rel):
            if path.exists() and path.stat().st_size > 0:
                return path
            try:
                status, body, _ctype = self._http_get(self.url(kind, name))
            except Exception as exc:  # noqa: BLE001 - offline: the move falls back to Silver's effects
                log.info("reborn %s: %s", rel, exc)
                raise SilverError("not_found", f"Could not download {name}") from None
            if status == 200 and body and len(body) < MAX_BYTES and _looks_right(kind, body):
                path.parent.mkdir(parents=True, exist_ok=True)
                write_bytes_atomic(path, body, fsync=False)
                self.downloads += 1
                return path
            if status in (404, 403, 410):
                miss.parent.mkdir(parents=True, exist_ok=True)
                miss.write_text(str(status))
            self.misses += 1
            raise SilverError("not_found", f"No Reborn file {name}")

    def prefetch(self, kinds: tuple[str, ...] = ("anim", "sheet", "sound")) -> dict[str, Any]:
        """Downloads every listed file (about 60 MB) for battles without internet afterwards; returns what failed and the stats."""
        failed = []
        for kind in kinds:
            for name in sorted(self.allowed.get(kind) or ()):
                try:
                    self.get(kind, name)
                except SilverError:
                    failed.append(f"{kind}/{name}")
        return {"failed": failed[:50], "failed_count": len(failed), **self.stats()}

    def stats(self) -> dict[str, Any]:
        files = [p for p in self.cache_dir.rglob("*") if p.is_file() and not p.name.endswith(".404")] if self.cache_dir.exists() else []
        return {"cached": len(files), "bytes": sum(p.stat().st_size for p in files), "downloads": self.downloads, "misses": self.misses,
                "server": self._server(), "ref": self.ref, "available": {k: len(v) for k, v in self.allowed.items()}}
