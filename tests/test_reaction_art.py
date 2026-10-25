"""Check raster extraction without manufacturing or approving character poses."""
import hashlib
import io
import json
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from scripts.import_reaction_art import grid_cuts, extract, native_palette
from silvers_hoard.pmd_library import PmdLibrary
from scripts.build_pmd_reactions import compile_reactions, load_generated

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


def test_complete_raster_build_cannot_report_runtime_acting_as_drawn(tmp_path):
    from types import SimpleNamespace
    fixture = Image.new("RGBA", (8, 8), (10, 20, 30, 255))
    buffer = io.BytesIO()
    fixture.save(buffer, "PNG")
    raw = buffer.getvalue()
    idle = {"file": "fixture", "w": 8, "h": 8, "n": 1, "r": 1, "d": [8]}
    library = SimpleNamespace(root=tmp_path, image_bytes=lambda key: raw, manifest={
        "entries": {"1||0": "normal"}, "metas": {"normal": {"a": {"Idle": idle}}}, "files": {}})
    with pytest.raises(ValueError, match="Incomplete raster reactions"):
        compile_reactions(library, {}, require_raster=True)
    assert not list(tmp_path.glob("reactions*"))
    drawn = {name: ({**idle, "source": {"kind": "generated-pmd-reaction"}}, raw)
             for name in ("Pain", "HitGround")}
    result = compile_reactions(library, {}, {"normal": drawn}, require_raster=True)
    assert result["coverage"] == {"Pain:generated": 1, "HitGround:generated": 1}
    assert all("reaction" not in action for action in result["metas"]["normal"].values())


def test_mega_venusaur_start_uses_exact_native_back_pixels_then_drawn_prone_frames():
    record = json.loads((ART / "sources" / "venusaurmega-v2.json").read_text("utf8"))
    library = PmdLibrary(ART.parents[1] / "silvers_hoard" / "presets" / "pmd", with_reactions=False)
    geometry, images = extract(record, library)
    g = geometry["HitGround"]
    sheet = Image.open(io.BytesIO(images["HitGround"])).convert("RGBA")
    first = sheet.crop((0, 2*g["h"], g["w"], 3*g["h"]))
    last = sheet.crop((3*g["w"], 2*g["h"], 4*g["w"], 3*g["h"]))
    native = library.resolve(3, "Mega")["a"]["Idle"]
    original = Image.open(io.BytesIO(library.image_bytes(native["file"]))).convert("RGBA")
    original = original.crop((0, 2*native["h"], native["w"], 3*native["h"]))
    assert first.crop(first.getbbox()).tobytes() == original.crop(original.getbbox()).tobytes()
    assert last.getbbox()[3] - last.getbbox()[1] < first.getbbox()[3] - first.getbbox()[1]
    assert g["source"]["generated_frames"] == 15


def test_compact_atlas_keeps_two_drawn_frames_and_last_ground_pose():
    record = json.loads((ART / "sources" / "metagross-compact.json").read_text("utf8"))
    library = PmdLibrary(ART.parents[1] / "silvers_hoard" / "presets" / "pmd", with_reactions=False)
    geometry, images = extract(record, library)
    for action, g in geometry.items():
        assert g["n"] == 2 and g["r"] == 4 and len(g["d"]) == 2
        assert g["row_map"] == [0, 1, 1, 2, 2, 3, 3, 0]
        sheet = Image.open(io.BytesIO(images[action])).convert("RGBA")
        for row in range(4):
            frames = [sheet.crop((frame*g["w"], row*g["h"],
                                   (frame+1)*g["w"], (row+1)*g["h"])) for frame in range(2)]
            assert frames[0].tobytes() != frames[1].tobytes()
        if action == "HitGround":
            assert g["ground_frames"] == [1] * 4
            first, last = [sheet.crop((frame*g["w"], 0, (frame+1)*g["w"], g["h"]))
                           for frame in range(2)]
            assert last.getbbox()[3] - last.getbbox()[1] < first.getbbox()[3] - first.getbbox()[1]


def test_pending_shiny_does_not_publish_normal_pixels_as_shiny(tmp_path):
    from types import SimpleNamespace
    normal = ART / "compiled" / "magnemite"
    target = tmp_path / "compiled" / "magnemite"
    target.mkdir(parents=True)
    record = json.loads((normal / "meta.json").read_text("utf8"))
    record.update(reviewed=True, shiny_reviewed=False)
    for action in ("Pain", "HitGround"):
        (target / f"{action}.png").write_bytes((normal / f"{action}.png").read_bytes())
    (target / "meta.json").write_text(json.dumps(record), "utf8")
    lib = SimpleNamespace(resolve=lambda num, form, shiny=False: {"key": "shiny" if shiny else "normal"})
    loaded = load_generated(lib, tmp_path)
    assert set(loaded) == {"normal"}
    assert set(loaded["normal"]) == {"Pain", "HitGround"}
    # A later approval must read the actual shiny files, never use a normal fallback.
    record["shiny_reviewed"] = True
    (target / "meta.json").write_text(json.dumps(record), "utf8")
    with pytest.raises(FileNotFoundError):
        load_generated(lib, tmp_path)


def test_shiny_delta_transfer_cannot_introduce_unregistered_colours(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from scripts import import_reaction_art as importer

    def pixels(colors):
        im = Image.new("RGBA", (len(colors), 1))
        im.putdata([(*color, 255) for color in colors])
        return importer.png(im)

    normal_colors = [(10, 20, 30), (30, 40, 50)]
    shiny_colors = [(110, 120, 130), (130, 140, 150)]
    extra_shade = (20, 30, 40)
    files = {"normal": pixels(normal_colors), "shiny": pixels(shiny_colors), "extra": pixels([extra_shade])}
    idle = {"w": 2, "h": 1, "n": 1, "r": 1, "d": [8]}
    original = {"key": "normal", "a": {"Idle": {**idle, "file": "normal"},
                                       "Attack": {**idle, "file": "extra"}}}
    shiny_meta = {"key": "shiny", "a": {"Idle": {**idle, "file": "shiny"}}}
    library = SimpleNamespace(resolve=lambda num, form, shiny=False: shiny_meta if shiny else original,
                              image_bytes=lambda key: files[key])
    generated = pixels([extra_shade])
    geom = {"w": 1, "h": 1, "n": 1, "r": 1, "d": [8], "source": {"source_sha256": "fixture"}}
    monkeypatch.setattr(importer, "extract", lambda *args: (
        {action: geom for action in ("Pain", "HitGround")},
        {action: generated for action in ("Pain", "HitGround")}))
    importer.compile_one({"id": "fixture", "num": 1}, library, tmp_path)
    for action in ("Pain", "HitGround"):
        normal = Image.open(tmp_path / "compiled" / "fixture" / f"{action}.png").convert("RGBA")
        exported = Image.open(tmp_path / "compiled" / "fixture" / f"{action}-shiny.png").convert("RGBA")
        assert normal.getpixel((0, 0))[:3] == extra_shade
        assert exported.getpixel((0, 0))[:3] in shiny_colors
