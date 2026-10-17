"""User-imported four-direction sheets; original PNGs remain intact in persistent data."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import threading
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from PIL import Image

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic

ZA_FILES = {"CLEFABLE_1": "clefable-mega", "VICTREEBEL_1": "victreebel-mega", "HAWLUCHA_1": "hawlucha-mega",
            "MALAMAR_1": "malamar-mega", "STARMIE_1": "starmie-mega", "DRAGONITE_1": "dragonite-mega",
            "RAICHU_3": "raichu-megax", "RAICHU_4": "raichu-megay", "LUCARIO_2": "lucario-megaz"}


class OverworldSprites:
    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self._lock = threading.RLock()

    def _index(self):
        path = self.directory / "index.json"
        return json.loads(path.read_text("utf-8")) if path.exists() else {}

    def list(self):
        with self._lock:
            return {"sprites": list(self._index().values())}

    def meta(self, sprite_id: str, shiny: bool = False):
        with self._lock:
            index = self._index()
            return index.get(f"{sprite_id}|{int(shiny)}") or index.get(f"{sprite_id}|0")

    def sheet(self, key: str):
        if not re.fullmatch(r"[0-9a-f]{64}", key):
            raise SilverError("invalid", "Not an overworld sheet key.")
        path = self.directory / f"{key}.png"
        if not path.exists():
            raise SilverError("not_found", "Overworld sheet not found.")
        return path

    def import_(self, path: str, *, source: str, credit: str):
        p = Path(path)
        if not p.is_file():
            raise SilverError("not_found", "Sprite file not found.")
        pending, images = [], {}

        def add(raw, sid, shiny, frames, background=None):
            key = hashlib.sha256(raw).hexdigest()
            images[key] = raw
            pending.append({"sprite_id": sid, "shiny": shiny, "key": key, "frames": frames, "background": background,
                            "url": f"/api/sprites/overworld-sheet/{key}.png", "source": source, "credit": [credit]})

        try:
            if p.suffix.lower() == ".zip":
                with ZipFile(p) as archive:
                    for entry in archive.infolist():
                        name = Path(entry.filename)
                        sid = ZA_FILES.get(name.stem.upper())
                        if name.suffix.lower() != ".png" or not sid:
                            continue
                        raw = archive.read(entry)
                        im = Image.open(io.BytesIO(raw))
                        if im.format != "PNG" or im.width % 4 or im.height % 4:
                            raise SilverError("invalid", f"Not a 4 by 4 PNG sheet: {entry.filename}")
                        im.load()
                        w, h = im.width // 4, im.height // 4
                        frames = [[[c * w, r * h, w, h] for c in range(4)] for r in range(4)]
                        add(raw, sid, any(part.lower() == "shiny" for part in name.parts), frames)
            else:
                raw = p.read_bytes()
                im = Image.open(io.BytesIO(raw))
                if im.format != "PNG" or im.size != (265, 258):
                    raise SilverError("invalid", "Expected the 265 by 258 Delphox-line sheet, or a Z-A overworld ZIP.")
                im = im.convert("RGBA")
                for col, sid in enumerate(["fennekin", "braixen", "delphox", "delphox-mega"] * 2):
                    x = 1 + col * 33
                    # Two vertical frames per direction: down, up, left, right. White column separators are outside the cells.
                    frames = [[[x, 1 + (r + c % 2) * 32, 32, 32] for c in range(4)] for r in [0, 4, 6, 2]]
                    add(raw, sid, col >= 4, frames, list(im.getpixel((x, 1))))
        except SilverError:
            raise
        except (OSError, ValueError, KeyError, BadZipFile) as exc:
            raise SilverError("invalid", f"Cannot read sprite sheets: {exc}") from None
        if not pending:
            raise SilverError("invalid", "No supported Z-A overworld sheets in this file.")
        with self._lock:
            index = self._index()
            self.directory.mkdir(parents=True, exist_ok=True)
            for key, raw in images.items():
                write_bytes_atomic(self.directory / f"{key}.png", raw)
            for meta in pending:
                index[f"{meta['sprite_id']}|{int(meta['shiny'])}"] = meta
            write_bytes_atomic(self.directory / "index.json", json.dumps(index, ensure_ascii=False).encode("utf-8"))
        return {"imported": len(pending), "sprites": pending}

    def export(self):
        """Imported art travels with a playable page, like other user-provided pictures."""
        with self._lock:
            return {name: {**meta, "url": "data:image/png;base64," + base64.b64encode(self.sheet(meta["key"]).read_bytes()).decode()}
                    for name, meta in self._index().items()}
