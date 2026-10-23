"""Versioned presentation art shipped with Silver, independently of its download cache."""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .hoard_link.atomic import write_bytes_atomic

LIBRARY_ROOT = Path(__file__).parent / "presets" / "pmd"


class PmdLibrary:
    def __init__(self, root: Path | None = None):
        self.root = Path(root if root is not None else LIBRARY_ROOT)
        manifest = self.root / "manifest.json"
        self.manifest = json.loads(manifest.read_text("utf-8")) if manifest.is_file() else {}
        self.metas = dict(self.manifest.get("metas", {}))
        self.metas.update((m["crowd"]["key"], m["crowd"]) for m in self.manifest.get("metas", {}).values() if m.get("crowd"))
        self.species = {m["id"]: m for m in self.manifest.get("roster", [])}
        self._extracted: set[Path] = set()

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

    def sheet(self, key: str, animation: str, cache: Path) -> Path | None:
        geom = self.metas.get(key, {}).get("a", {}).get(animation)
        file = geom["file"] if geom else self.metas.get(key, {}).get("previews", {}).get(animation)
        if not file:
            return None
        asset = self.manifest["files"][file]
        extension = ".webp" if asset["mime"] == "image/webp" else ".png"
        dest = cache / "library" / (asset["sha256"] + extension)
        if dest not in self._extracted or not dest.is_file():
            raw = self.image_bytes(file)
            write_bytes_atomic(dest, raw, fsync=False)
            self._extracted.add(dest)
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
