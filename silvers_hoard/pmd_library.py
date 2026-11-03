"""Versioned presentation art shipped with Silver, independently of its download cache."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
from pathlib import Path
from typing import Any

from .hoard_link.atomic import write_bytes_atomic

LIBRARY_ROOT = Path(__file__).parent / "presets" / "pmd"


class PmdLibrary:
    def __init__(self, root: Path | None = None, *, with_reactions: bool = True):
        self.root = Path(root if root is not None else LIBRARY_ROOT)
        manifest = self.root / "manifest.json"
        self.manifest = json.loads(manifest.read_text("utf-8")) if manifest.is_file() else {}
        reactions = self.root / "reactions.json"
        if with_reactions and reactions.is_file():
            extra = json.loads(reactions.read_text("utf-8"))
            offset = len(self.manifest["packs"])
            self.manifest["packs"].extend(extra["packs"])
            for key, asset in extra["files"].items():
                self.manifest["files"][key] = {**asset, "pmd": asset["pmd"] + offset}
            for key, animations in extra["metas"].items():
                if key in self.manifest["metas"]:
                    self.manifest["metas"][key]["a"].update(animations)
            self.manifest["coverage"]["reactions"] = extra["coverage"]
        self.metas = dict(self.manifest.get("metas", {}))
        self.metas.update((m["crowd"]["key"], m["crowd"]) for m in self.manifest.get("metas", {}).values() if m.get("crowd"))
        self.species = {m["id"]: m for m in self.manifest.get("roster", [])}
        self._extracted: dict[Path, tuple[int, int]] = {}
        self._locks: dict[Path, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def resolve(self, num: int, form: str = "", shiny: bool = False) -> dict[str, Any] | None:
        form = re.sub(r"[^a-z0-9]", "", form.lower())
        key = self.manifest.get("entries", {}).get(f"{num}|{form}|{int(shiny)}")
        meta = self.manifest.get("metas", {}).get(key)
        return {**meta, "form_exact": True} if meta else None

    def image_bytes(self, file: str) -> bytes:
        asset = self.manifest["files"][file]
        with (self.root / self.manifest["packs"][asset["pmd"]]).open("rb") as stream:
            stream.seek(asset["offset"])
            raw = stream.read(asset["size"])
        if len(raw) != asset["size"] or hashlib.sha256(raw).hexdigest() != asset["sha256"]:
            raise ValueError(f"Damaged PMD library asset: {file}")
        return raw

    def by_species(self, name: str) -> dict[str, Any] | None:
        mon = self.species.get(re.sub(r"[^a-z0-9]", "", name.lower()))
        return self.resolve(mon["num"], mon["form"]) if mon else None

    def _cached(self, dest: Path, asset: dict[str, Any]) -> bool:
        """Whether ``dest`` already holds this asset's exact bytes; hashed once per file version (size and mtime)."""
        try:
            st = dest.stat()
        except OSError:
            return False
        if st.st_size != asset["size"]:
            return False
        signature = (st.st_size, st.st_mtime_ns)
        if self._extracted.get(dest) == signature:
            return True
        try:
            ok = hashlib.sha256(dest.read_bytes()).hexdigest() == asset["sha256"]
        except OSError:
            return False
        if ok:
            self._extracted[dest] = signature
        return ok

    def sheet(self, key: str, animation: str, cache: Path) -> Path | None:
        geom = self.metas.get(key, {}).get("a", {}).get(animation)
        file = geom["file"] if geom else self.metas.get(key, {}).get("previews", {}).get(animation)
        if not file:
            return None
        asset = self.manifest["files"][file]
        extension = ".webp" if asset["mime"] == "image/webp" else ".png"
        dest = cache / "library" / (asset["sha256"] + extension)
        # Animations that share one picture (Hurt and Faint, previews) share this content-addressed file. A file that already
        # holds the right bytes is never replaced: on Windows, replacing a file another request is reading (or opening it while
        # it is replaced) fails with PermissionError. Extraction runs once per file under its own lock; a missing or damaged
        # copy is still written again.
        with self._locks_guard:
            lock = self._locks.setdefault(dest, threading.Lock())
        with lock:
            if not self._cached(dest, asset):
                raw = self.image_bytes(file)
                try:
                    write_bytes_atomic(dest, raw, fsync=False)
                except PermissionError:
                    # another process wrote the same file first and is serving it: theirs has the same bytes
                    if not self._cached(dest, asset):
                        raise
                self._cached(dest, asset)
        return dest

    def portable(self) -> dict[str, Any]:
        """Read compressed image packs without decoding images or consulting the presentation cache."""
        urls = {}
        for key, meta in self.metas.items():
            for name, geom in meta["a"].items():
                urls[f"/api/sprites/pmd-sheet/{key}/{name}.png"] = geom["file"]
            for name,file in meta.get("previews",{}).items():
                urls[f"/api/sprites/pmd-sheet/{key}/{name}.png"] = file
        return {"entries": self.manifest.get("entries", {}), "metas": self.manifest.get("metas", {}),
                "notices":self.manifest.get("notices",{}),
                "species":{m["id"]:{"num":m["num"],"form":m["form"]} for m in self.manifest.get("roster",[])},
                "files": self.manifest.get("files", {}), "urls": urls,
                "chunks": [base64.b64encode((self.root / name).read_bytes()).decode("ascii")
                           for name in self.manifest.get("packs", [])]}

    def status(self) -> dict[str, Any]:
        return {"version": self.manifest.get("version"), "source": self.manifest.get("source", {}),
                "coverage": self.manifest.get("coverage", {}), "identities": len(self.manifest.get("roster", [])),
                "requests": len(self.manifest.get("entries", {})), "images": len(self.manifest.get("files", {})),
                "bytes": sum(f["size"] for f in self.manifest.get("files", {}).values())}
