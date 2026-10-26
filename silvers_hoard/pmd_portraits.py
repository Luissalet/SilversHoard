"""Installed expression portraits, independent of the optional download cache."""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

from .hoard_link.atomic import write_bytes_atomic

LIBRARY_ROOT = Path(__file__).parent / "presets" / "portraits"


class PmdPortraits:
    def __init__(self, root: Path | None = None):
        self.root = Path(root if root is not None else LIBRARY_ROOT)
        path = self.root / "manifest.json"
        self.manifest = json.loads(path.read_text("utf8")) if path.is_file() else {}

    def resolve(self, species: str, emotions: list[str], shiny: bool = False) -> str | None:
        species = re.sub(r"[^a-z0-9]", "", species.lower())
        entry = self.manifest.get("entries", {}).get(f"{species}|{int(shiny)}", {})
        return next((entry[e] for e in emotions if entry.get(e)), None)

    def image_bytes(self, file: str) -> bytes:
        asset = self.manifest["files"][file]
        with (self.root / self.manifest["packs"][asset["pmd"]]).open("rb") as stream:
            stream.seek(asset["offset"])
            raw = stream.read(asset["size"])
        if len(raw) != asset["size"] or hashlib.sha256(raw).hexdigest() != asset["sha256"]:
            raise ValueError(f"Damaged portrait asset: {file}")
        return raw

    def extract(self, file: str, cache: Path) -> Path:
        asset = self.manifest["files"][file]
        path = cache / "library-portraits" / (asset["sha256"] + ".png")
        if not path.is_file():
            write_bytes_atomic(path, self.image_bytes(file), fsync=False)
        return path

    def portable(self, offset: int = 0) -> dict:
        return {"entries": self.manifest.get("entries", {}),
                "files": {key: {**asset, "pmd": asset["pmd"] + offset}
                          for key, asset in self.manifest.get("files", {}).items()},
                "sources": self.manifest.get("sources", {}),
                "coverage": self.manifest.get("coverage", {}),
                "fallbacks": self.manifest.get("fallbacks", {}),
                "chunks": [base64.b64encode((self.root / name).read_bytes()).decode("ascii")
                           for name in self.manifest.get("packs", [])]}

    def status(self) -> dict:
        return {"version": self.manifest.get("version"), "source": self.manifest.get("source", {}),
                "coverage": self.manifest.get("coverage", {}), "images": len(self.manifest.get("files", {})),
                "bytes": sum(f["size"] for f in self.manifest.get("files", {}).values())}
