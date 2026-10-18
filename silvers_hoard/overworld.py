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
from .pmd_shiny import palette_pair, recolor, reference_pair
from .sprites import _http_get

ZA_FILES = {"CLEFABLE_1": "clefable-mega", "VICTREEBEL_1": "victreebel-mega", "HAWLUCHA_1": "hawlucha-mega",
            "MALAMAR_1": "malamar-mega", "STARMIE_1": "starmie-mega", "DRAGONITE_1": "dragonite-mega",
            "RAICHU_3": "raichu-megax", "RAICHU_4": "raichu-megay", "LUCARIO_2": "lucario-megaz"}


class OverworldSprites:
    def __init__(self, directory: Path, http_get=None):
        self.directory = Path(directory)
        self._http_get = http_get or _http_get
        self._lock = threading.RLock()

    def _swampert(self, im):
        """Jhony-Rex's five walking rows; reflect the three left-facing rows."""
        atlas = Image.new("RGBA", (150, 320))
        for row, (original, mirror) in enumerate([(0, False), (1, True), (2, True), (3, True),
                                                  (4, False), (3, False), (2, False), (1, False)]):
            for col in range(3):
                # The back row has a 47px stride: its first silhouette crosses x=50.
                x = [4, 51, 98][col] if original == 4 else col * 50
                tile = im.crop((x, 122 + original * 40, x + 50, 162 + original * 40))
                tile.putdata([(*p[:3], 0) if p == (30, 30, 30, 255) else p for p in tile.getdata()])
                if mirror:
                    tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                atlas.paste(tile, (col * 50, row * 40))
        out = io.BytesIO()
        atlas.save(out, "PNG")

        def get(url):
            import httpx
            try:
                status, raw, _ = self._http_get(url)
                return raw if status == 200 and len(raw) <= 64 * 1024 * 1024 else None
            except httpx.HTTPError:
                return None

        pair = reference_pair(self.directory / "palette", 260, "Mega", get, True)
        if not pair:
            raise SilverError("invalid", "Cannot obtain Mega Swampert's shiny palette. Retry with an internet connection.")
        normal = out.getvalue()
        shiny = recolor(normal, palette_pair(*pair[:2]))
        frames = [[[c * 50, r * 40, 50, 40] for c in [0, 1, 2, 1]] for r in range(8)]
        return normal, shiny, frames, pair[2]

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
                if im.format != "PNG":
                    raise SilverError("invalid", "Expected a PNG sprite sheet.")
                if im.size == (270, 437) and p.stem.lower().startswith("mega_swampert_sprites_by_jhony_rex"):
                    normal, shiny, frames, palette = self._swampert(im.convert("RGBA"))
                    original = hashlib.sha256(raw).hexdigest()
                    images[original] = raw
                    for variant, sheet in [(False, normal), (True, shiny)]:
                        add(sheet, "swampert-mega", variant, frames)
                        pending[-1].update(original_key=original, directions=8,
                                           derivation={"kind": "shiny-recolor" if variant else "walking-atlas", "palette": palette})
                elif im.size == (265, 258):
                    im = im.convert("RGBA")
                    for col, sid in enumerate(["fennekin", "braixen", "delphox", "delphox-mega"] * 2):
                        x = 1 + col * 33
                        # Two vertical frames per direction: down, up, left, right. White column separators are outside the cells.
                        frames = [[[x, 1 + (r + c % 2) * 32, 32, 32] for c in range(4)] for r in [0, 4, 6, 2]]
                        add(raw, sid, col >= 4, frames, list(im.getpixel((x, 1))))
                else:
                    raise SilverError("invalid", "Expected a Delphox-line PNG, Jhony-Rex Mega Swampert PNG, or Z-A overworld ZIP.")
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
