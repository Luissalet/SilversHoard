"""Small synthetic media and explicit inputs for historical art audits."""
import hashlib
import io
import json
import os
from pathlib import Path

import pytest
from PIL import Image

from scripts.build_pmd_reactions import compile_reactions
from silvers_hoard.pmd_library import PmdLibrary


def png_bytes(image):
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def audit_directory(variable, required, purpose):
    configured = os.environ.get(variable)
    if not configured:
        pytest.skip(
            f"{purpose}: unversioned media required. Set {variable} "
            f"to a directory containing {', '.join(required)}."
        )
    root = Path(configured)
    missing = [name for name in required if not (root / name).exists()]
    if missing:
        pytest.fail(f"{purpose}: {variable} is missing {', '.join(missing)}")
    return root


@pytest.fixture
def release_pmd_root():
    return audit_directory("SILVER_TEST_PMD_ROOT", ("manifest.json", "reactions.json"), "PMD release audit")


@pytest.fixture
def reaction_art_root():
    return audit_directory("SILVER_TEST_REACTION_ART_ROOT", ("sources", "compiled"), "Historical reaction art audit")


def write_reaction_library(root):
    root.mkdir(parents=True)
    idle = {"w": 2, "h": 2, "n": 1, "r": 1, "d": [8], "ax": 1, "ay": 2}
    pack = bytearray()
    files = {}
    metas = {}
    source = {"kind": "published-pmd", "sha": "fixture", "folder": "0001"}
    for key, color in (("normal-fixture", (10, 20, 30)), ("shiny-fixture", (110, 120, 130))):
        raw = png_bytes(Image.new("RGBA", (2, 2), (*color, 255)))
        files[key] = {"pmd": 0, "offset": len(pack), "size": len(raw),
                      "mime": "image/png", "sha256": hashlib.sha256(raw).hexdigest()}
        pack.extend(raw)
        metas[key] = {"key": key, "credit": ["Fixture artist"], "a": {"Idle": {**idle, "file": key}}}
    metas["normal-fixture"]["source"] = source
    manifest = {
        "version": 1, "source": {"sha": "fixture"}, "coverage": {},
        "entries": {"1||0": "normal-fixture", "1||1": "shiny-fixture"},
        "roster": [{"id": "fixture", "num": 1, "form": ""}],
        "files": files, "packs": ["sprites-fixture.pmd"], "metas": metas,
    }
    base_pack = root / "sprites-fixture.pmd"
    base_pack.write_bytes(pack)
    base_manifest = root / "manifest.json"
    base_manifest.write_text(json.dumps(manifest), encoding="utf8")

    authored = {}
    for action, color in (("Pain", (81, 91, 101)), ("HitGround", (82, 92, 102))):
        raw = png_bytes(Image.new("RGBA", (4, 2), (*color, 255)))
        geom = {**idle, "n": 2, "d": [3, 7],
                "source": {"kind": "published-pmd-reaction", "sha256": hashlib.sha256(raw).hexdigest()}}
        if action == "HitGround":
            geom["ground_frames"] = [1]
        authored[action] = (geom, raw)
    compile_reactions(PmdLibrary(root, with_reactions=False), {("fixture", "0001"): authored})
    assert base_pack.read_bytes() == pack
    assert json.loads(base_manifest.read_bytes()) == manifest
    return PmdLibrary(root)


@pytest.fixture
def synthetic_reaction_library(tmp_path):
    return write_reaction_library(tmp_path / "pmd")
