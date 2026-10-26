import hashlib
import importlib.util
import io
import json
from pathlib import Path

import pytest
from PIL import Image

from silvers_hoard.pmd_portraits import PmdPortraits

spec = importlib.util.spec_from_file_location("portrait_flip_builder", Path(__file__).parents[1] / "scripts/build_pmd_portraits.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def fixture(tmp_path, reviewed=True):
    stage, output = tmp_path / "stage", tmp_path / "installed"
    published = stage / "published/0003/0002/Normal.png"
    published.parent.mkdir(parents=True)
    image = Image.new("RGBA", (40, 40), (70, 160, 180, 255))
    image.putpixel((2, 18), (255, 20, 30, 255))
    image.putpixel((37, 7), (40, 250, 50, 180))
    data = io.BytesIO(); image.save(data, format="PNG"); raw = data.getvalue()
    published.write_bytes(raw)
    sha = hashlib.sha256(raw).hexdigest()
    (stage / "published-receipts.json").write_text(json.dumps({"0003/0002/Normal.png": {"sha256": sha}}))
    plan = {"source": "https://example.invalid/pinned", "entries": [
        {"id": "venusaurgmax", "folder": "0003/0002"},
        {"id": "anotherform", "folder": "0003/0002"}],
        "folders": {"0003/0002": {"emotions": ["Normal"], "credit": {"primary": "Artist"}, "artists": ["Artist"]}}}
    atlas = tmp_path / "atlas.png"; atlas.write_bytes(raw)
    registry = tmp_path / "registry.json"
    registry.write_text(json.dumps({"venusaurgmax|0": {
        "file": atlas.name, "sha256": sha, "reviewed": reviewed,
        "grid": [1, 1], "trim": 0, "cells": {}, "published_flips": {"Normal": sha}}}))
    return plan, stage, output, registry, published, image, raw


@pytest.mark.parametrize("reviewed", [True, False])
def test_only_explicit_reviewed_cell_is_flipped_and_original_remains_available(tmp_path, reviewed):
    plan, stage, output, registry, published, image, raw = fixture(tmp_path, reviewed)
    builder.compile_library(plan, stage, output, registry, allow_missing=True)
    library = PmdPortraits(output)
    actual = Image.open(io.BytesIO(library.image_bytes(library.resolve("venusaurgmax", ["Normal"]))))
    expected = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if reviewed else image
    assert actual.convert("RGBA").tobytes() == expected.tobytes()
    assert library.image_bytes(library.resolve("anotherform", ["Normal"])) == raw
    assert published.read_bytes() == raw
    sha = hashlib.sha256(raw).hexdigest()
    assert library.image_bytes(f"portraits/{sha}.png") == raw
    if reviewed:
        provenance = library.manifest["sources"]["venusaurgmax|0:Normal"]
        assert provenance["operation"] == "flip_x" and provenance["source_sha256"] == sha
        assert provenance["credit"] == {"primary": "Artist"} and provenance["artists"] == ["Artist"]
    # A rebuild must read the retained original rather than flip the derivative again.
    published.unlink()
    before = library.image_bytes(library.resolve("venusaurgmax", ["Normal"]))
    builder.compile_library(plan, stage, output, registry, allow_missing=True)
    rebuilt = PmdPortraits(output)
    assert rebuilt.image_bytes(rebuilt.resolve("venusaurgmax", ["Normal"])) == before


def test_source_change_does_not_publish_a_flip_of_an_unreviewed_original(tmp_path):
    plan, stage, output, registry, _, _, _ = fixture(tmp_path)
    builder.compile_library(plan, stage, output, registry, allow_missing=True)
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    records = json.loads(registry.read_text())
    records["venusaurgmax|0"]["published_flips"]["Normal"] = "0" * 64
    registry.write_text(json.dumps(records))
    with pytest.raises(ValueError, match="mirror source changed"):
        builder.compile_library(plan, stage, output, registry, allow_missing=True)
    assert {p.name: p.read_bytes() for p in output.iterdir()} == before
