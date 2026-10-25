"""Check raster extraction without manufacturing or approving character poses."""
import hashlib
import io
import json
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from scripts.import_reaction_art import grid_cuts, extract, native_palette
from silvers_hoard.pmd_library import PmdLibrary

ART = Path(__file__).resolve().parents[1] / "art" / "reactions"


def test_gutters_follow_content_even_with_asymmetric_margins():
    sheet = Image.new("RGBA", (220, 50))
    draw = ImageDraw.Draw(sheet)
    for left, right in [(34, 51), (72, 91), (110, 133), (164, 186)]:
        draw.rectangle((left, 7, right, 42), fill=(10, 30, 20, 255))
    cuts = grid_cuts(sheet, 0, 4)
    assert cuts[1] > 51 and cuts[1] < 72
    assert cuts[2] > 91 and cuts[2] < 110
    assert cuts[3] > 133 and cuts[3] < 164
    for left, right in zip(cuts, cuts[1:]):
        bbox = sheet.crop((left, 0, right, 50)).getbbox()
        assert bbox and 0 < bbox[0] < bbox[2] < right - left
    with pytest.raises(ValueError, match="Expected 5"):
        grid_cuts(sheet, 0, 5)


@pytest.mark.parametrize("identity", ["baxcalibur", "charizardmegax"])
def test_drawn_pilot_frames_keep_registered_dimensions_palette_and_ground_hold(identity):
    record = json.loads((ART / "sources" / f"{identity}-v2.json").read_text("utf8"))
    library = PmdLibrary(ART.parents[1] / "silvers_hoard" / "presets" / "pmd", with_reactions=False)
    before = hashlib.sha256(library.root.joinpath("manifest.json").read_bytes()).hexdigest()
    original = library.resolve(record["num"], record.get("form", ""))
    palette = set(native_palette(library, original))
    geometry, images = extract(record, library)
    for name, geom in geometry.items():
        assert "reaction" not in geom
        assert geom["r"] == 8 and geom["n"] == 4
        sheet = Image.open(io.BytesIO(images[name])).convert("RGBA")
        assert sheet.size == (geom["w"] * 4, geom["h"] * 8)
        assert set(sheet.getchannel("A").getdata()) == {0, 255}
        assert {p[:3] for p in sheet.getdata() if p[3]} <= palette
        assert hashlib.sha256(images[name]).hexdigest() == geom["source"]["sha256"]
        for row in range(8):
            for frame in range(4):
                bbox = sheet.crop((frame*geom["w"], row*geom["h"],
                                   (frame+1)*geom["w"], (row+1)*geom["h"])).getbbox()
                assert bbox and bbox[0] >= 3 and bbox[2] <= geom["w"] - 3
                assert bbox[1] > 0 and bbox[3] < geom["h"]
        if name == "HitGround":
            assert geom["ground_frames"] == [3] * 8
    assert hashlib.sha256(library.root.joinpath("manifest.json").read_bytes()).hexdigest() == before


@pytest.mark.parametrize("identity", ["baxcalibur", "charizardmegax", "magnemite"])
def test_reviewed_shiny_exports_keep_pose_pixels_and_exact_installed_colors(identity):
    root = ART / "compiled" / identity
    meta = json.loads((root / "meta.json").read_text("utf8"))
    assert meta["reviewed"]
    reference = meta["provenance"]
    library = PmdLibrary(ART.parents[1] / "silvers_hoard" / "presets" / "pmd", with_reactions=False)
    palette = set(native_palette(library, library.resolve(reference["num"], reference["form"], shiny=True)))
    for name in ("Pain", "HitGround"):
        normal = Image.open(root / f"{name}.png").convert("RGBA")
        raw = (root / f"{name}-shiny.png").read_bytes()
        shiny = Image.open(io.BytesIO(raw)).convert("RGBA")
        assert normal.size == shiny.size
        assert normal.getchannel("A").tobytes() == shiny.getchannel("A").tobytes()
        assert {p[:3] for p in shiny.getdata() if p[3]} <= palette
        assert hashlib.sha256(raw).hexdigest() == meta["shiny"]["a"][name]["source"]["sha256"]
