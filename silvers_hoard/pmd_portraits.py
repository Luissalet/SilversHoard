"""Installed expression portraits, independent of the optional download cache."""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path
from threading import Lock

from .hoard_link.atomic import write_bytes_atomic

LIBRARY_ROOT = Path(__file__).parent / "presets" / "portraits"


class PmdPortraits:
    def __init__(self, root: Path | None = None):
        self.root = Path(root if root is not None else LIBRARY_ROOT)
        self.manifest = {}
        self._manifest_signature = object()
        self._manifest_lock = Lock()
        self._snapshot()

    def _snapshot(self) -> dict:
        # Installers publish packs first and replace the manifest atomically.
        # Keep a request/export on one dictionary even if another thread reloads.
        with self._manifest_lock:
            path = self.root / "manifest.json"
            try:
                stat = path.stat()
                signature = (stat.st_mtime_ns, stat.st_size)
            except FileNotFoundError:
                signature = None
            if signature != self._manifest_signature:
                manifest = json.loads(path.read_text("utf8")) if signature is not None else {}
                self.manifest = manifest
                self._manifest_signature = signature
            return self.manifest

    def resolve(self, species: str, emotions: list[str], shiny: bool = False) -> str | None:
        species = re.sub(r"[^a-z0-9]", "", species.lower())
        entry = self._snapshot().get("entries", {}).get(f"{species}|{int(shiny)}", {})
        return next((entry[e] for e in emotions if entry.get(e)), None)

    def image_bytes(self, file: str) -> bytes:
        return self._image_bytes(file, self._snapshot())

    def _image_bytes(self, file: str, manifest: dict) -> bytes:
        asset = manifest["files"][file]
        with (self.root / manifest["packs"][asset["pmd"]]).open("rb") as stream:
            stream.seek(asset["offset"])
            raw = stream.read(asset["size"])
        if len(raw) != asset["size"] or hashlib.sha256(raw).hexdigest() != asset["sha256"]:
            raise ValueError(f"Damaged portrait asset: {file}")
        return raw

    def extract(self, file: str, cache: Path) -> Path:
        manifest = self._snapshot()
        asset = manifest["files"][file]
        path = cache / "library-portraits" / (asset["sha256"] + ".png")
        if not path.is_file():
            write_bytes_atomic(path, self._image_bytes(file, manifest), fsync=False)
        return path

    def portable(self, offset: int = 0) -> dict:
        manifest = self._snapshot()
        return {"entries": manifest.get("entries", {}),
                "files": {key: {**asset, "pmd": asset["pmd"] + offset}
                          for key, asset in manifest.get("files", {}).items()},
                "sources": manifest.get("sources", {}),
                "coverage": manifest.get("coverage", {}),
                "fallbacks": manifest.get("fallbacks", {}),
                "chunks": [base64.b64encode((self.root / name).read_bytes()).decode("ascii")
                           for name in manifest.get("packs", [])]}

    def status(self) -> dict:
        manifest = self._snapshot()
        return {"version": manifest.get("version"), "source": manifest.get("source", {}),
                "coverage": manifest.get("coverage", {}), "images": len(manifest.get("files", {})),
                "bytes": sum(f["size"] for f in manifest.get("files", {}).values())}
