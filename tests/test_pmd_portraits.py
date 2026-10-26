import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path

import pytest
from PIL import Image

from silvers_hoard.pmd import EMOTIONS
from silvers_hoard.pmd_portraits import PmdPortraits
from silvers_hoard import portable_assets

spec = importlib.util.spec_from_file_location("portrait_builder", Path(__file__).parents[1] / "scripts/build_pmd_portraits.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def png(colour, size=(40, 40)):
    data = io.BytesIO()
    Image.new("RGBA", size, colour).save(data, format="PNG")
    return data.getvalue()


def collection(tmp_path, atlas_size=(168, 168)):
    stage, output = tmp_path / "stage", tmp_path / "installed"
    face = stage / "published/0006/0002/Normal.png"
    face.parent.mkdir(parents=True)
    original = png((240, 30, 20, 255))
    face.write_bytes(original)
    row = {"id": "charizardmegay", "name": "Charizard-Mega-Y", "folder": "0006/0002", "shiny_folder": None}
    plan = {"source": "https://example.invalid/pinned", "entries": [row],
            "folders": {"0006/0002": {"emotions": ["Normal"], "credit": {"primary": "Artist"}, "artists": ["Artist"]}}}
    image = Image.new("RGBA", atlas_size)
    for i in range(16):
        x, y = i % 4, i // 4
        bounds = (round(x * image.width / 4), round(y * image.height / 4),
                  round((x + 1) * image.width / 4), round((y + 1) * image.height / 4))
        image.paste((i * 13, 180, 200, 255), bounds)
    atlas = tmp_path / "atlas.png"; image.save(atlas)
    record = {"file": "atlas.png", "sha256": hashlib.sha256(atlas.read_bytes()).hexdigest(), "grid": [4, 4], "trim": 2,
              "reviewed": True, "cells": {emotion: [i % 4, i // 4] for i, emotion in enumerate(EMOTIONS)}}
    registry = tmp_path / "registry.json"
    registry.write_text(json.dumps({"charizardmegay|0": record, "charizardmegay|1": record}))
    builder.compile_library(plan, stage, output, registry)
    return plan, stage, output, registry, original


@pytest.mark.parametrize("atlas_size", [(168, 168), (184, 165)])
def test_reviewed_expressions_fill_gaps_without_replacing_published_face(tmp_path, atlas_size):
    _, _, output, _, original = collection(tmp_path, atlas_size)
    library = PmdPortraits(output)
    assert library.status()["coverage"] == {"complete": 2}
    assert library.image_bytes(library.resolve("Charizard-Mega-Y", ["Normal"])) == original
    for shiny in (False, True):
        assert len(library.manifest["entries"][f"charizardmegay|{int(shiny)}"]) == 16
        angry = library.resolve("Charizard-Mega-Y", ["Angry"], shiny)
        image = Image.open(io.BytesIO(library.image_bytes(angry)))
        assert image.size == (40, 40) and image.getpixel((20, 20)) == (39, 180, 200, 255)
        for i, emotion in enumerate(EMOTIONS):
            if emotion == "Normal" and not shiny:
                continue
            tile = Image.open(io.BytesIO(library.image_bytes(library.resolve("Charizard-Mega-Y", [emotion], shiny))))
            assert tile.getextrema() == tuple((v, v) for v in (i * 13, 180, 200, 255))
    assert library.resolve("Charizard", ["Normal"]) is None
    assert library.manifest["sources"]["0006/0002"]["artists"] == ["Artist"]


def test_emotion_template_preserves_outlined_cream_face_tears_and_contour():
    from PIL import ImageDraw
    image = Image.new('RGBA',(160,160),(252,244,204,255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((8,8,31,39),fill=(30,30,40,255))
    draw.rectangle((9,9,30,39),fill=(250,240,200,255))
    draw.line((20,20,20,30),fill=(120,210,255,255),width=1)
    record = {'grid':[4,4],'trim':0,'background_key':[252,244,204],'background_tolerance':20}
    template = Image.new('RGBA',(40,40),(240,100,160,255))
    result = builder.atlas_tile(image,record,[0,0],template)
    assert result.getpixel((0,0)) == (240,100,160,255)
    for point in ((10,10),(20,25),(8,8)):
        assert result.getpixel(point) == image.getpixel(point)


def test_background_segmentation_precedes_downsampling_for_thin_source_outlines():
    from PIL import ImageDraw
    image = Image.new('RGBA',(640,640),(252,244,204,255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((21,21,137,159),fill=(30,30,40,255))
    draw.rectangle((22,22,136,159),fill=(250,240,200,255))
    draw.line((80,80,80,120),fill=(120,210,255,255),width=4)
    record = {'grid':[4,4],'trim':0,'background_key':[252,244,204],
              'background_tolerance':20,'background_mask_source':True}
    template = Image.new('RGBA',(40,40),(240,100,160,255))
    original = builder.atlas_tile(image,record,[0,0])
    composed = builder.atlas_tile(image,record,[0,0],template)
    assert composed.getpixel((0,0)) == (240,100,160,255)
    for point in ((10,10),(20,25),(6,38)):
        assert composed.getpixel(point) == original.getpixel(point)
    # A cheek cropped at the side must not become a backdrop seed either.
    draw.rectangle((22,22,159,159),fill=(250,240,200,255))
    draw.line((21,21,159,21),fill=(30,30,40,255))
    record['background_seed_sides'] = False
    composed = builder.atlas_tile(image,record,[0,0],template)
    assert composed.getpixel((39,20)) == (250,240,200,255)
    assert composed.getpixel((0,0)) == (240,100,160,255)


def test_alpha_portrait_composes_background_without_keying_identical_pale_fur():
    from PIL import ImageDraw
    image = Image.new('RGBA',(40,40),(0,0,0,0))
    cream = (252,244,204,255)
    draw = ImageDraw.Draw(image)
    draw.rectangle((8,10,31,39),fill=cream)
    draw.point((9,9),fill=(80,40,20,128))
    record = {'grid':[1,1],'trim':0,'background_mode':'alpha'}
    for colour in ((210,110,170,255),(150,210,240,255)):
        template = Image.new('RGBA',(40,40),colour)
        composed = builder.atlas_tile(image,record,[0,0],template)
        assert composed.getpixel((0,0)) == colour
        assert composed.getpixel((20,39)) == cream
        assert composed.getpixel((9,9)) == Image.alpha_composite(template,image).getpixel((9,9))
        assert composed.getextrema()[3] == (255,255)
    assert builder.atlas_tile(image,record,[0,0]).tobytes() == image.tobytes()


def test_foreground_guard_preserves_a_pale_chest_connected_to_an_internal_source_gutter():
    # The chest and the gutter genuinely share a colour: lowering the tolerance
    # cannot distinguish them. A guard must preserve body pixels, not recolour it.
    from PIL import Image, ImageDraw
    cream = (252,244,204,255)
    image = Image.new('RGBA',(160,160),cream)
    draw = ImageDraw.Draw(image)
    draw.rectangle((24,60,136,151),fill=(240,150,35,255))
    draw.rectangle((48,112,112,151),fill=cream)
    record = {'grid':[1,1],'trim':0,'background_key':cream[:3],
              'background_tolerance':20,'background_mask_source':True,
              'background_protect':[[10,28,30,40]]}
    template = Image.new('RGBA',(40,40),(220,110,170,255))
    original = builder.atlas_tile(image,record,[0,0])
    composed = builder.atlas_tile(image,record,[0,0],template)
    assert composed.getpixel((0,0)) == template.getpixel((0,0))
    assert composed.getpixel((2,37)) == template.getpixel((2,37))
    assert composed.getpixel((20,35)) == original.getpixel((20,35)) == cream
    assert composed.getpixel((8,30)) == original.getpixel((8,30))
    with pytest.raises(ValueError,match='foreground guard'):
        builder.atlas_tile(image,{**record,'background_protect':[[10,28,41,40]]},[0,0],template)


def test_incomplete_or_unreviewed_compile_preserves_installed_manifest_and_packs(tmp_path):
    plan, stage, output, registry, _ = collection(tmp_path)
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    records = json.loads(registry.read_text())
    records["charizardmegay|1"]["reviewed"] = False
    registry.write_text(json.dumps(records))
    with pytest.raises(ValueError, match="incomplete"):
        builder.compile_library(plan, stage, output, registry)
    assert before == {p.name: p.read_bytes() for p in output.iterdir()}
    builder.compile_library(plan, stage, tmp_path / "partial", registry, allow_missing=True)
    partial = PmdPortraits(tmp_path / "partial")
    assert partial.status()["coverage"]["missing"] == 1
    assert partial.resolve("Charizard-Mega-Y", ["Normal"], True) is None
    records["charizardmegay|1"].update(reviewed=True, background_key=[252,244,204], background_reviewed=False)
    registry.write_text(json.dumps(records))
    with pytest.raises(ValueError, match="background review pending"):
        builder.compile_library(plan, stage, output, registry)
    assert before == {p.name: p.read_bytes() for p in output.iterdir()}
    records["charizardmegay|1"]["background_reviewed"] = True
    registry.write_text(json.dumps(records))
    with pytest.raises(ValueError, match="background templates missing"):
        builder.compile_library(plan, stage, output, registry)
    assert before == {p.name: p.read_bytes() for p in output.iterdir()}


def test_native_portrait_route_status_and_export_keep_exact_forms_colours_and_bytes(tmp_path, services, client, call):
    _, _, output, _, original = collection(tmp_path)
    services.pmd.portrait_library = library = PmdPortraits(output)
    def deny(*args, **kwargs):
        raise AssertionError("Installed portraits must not fetch")
    services.pmd._http_get = deny
    assert services.pmd.portrait("Charizard-Mega-Y").read_bytes() == original
    response = client.get("/api/sprites/portrait", params={"species": "Charizard-Mega-Y", "emotion": "Angry", "shiny": 1})
    assert response.status_code == 200 and response.headers["content-type"].startswith("image/png")
    assert response.content == library.image_bytes(library.resolve("Charizard-Mega-Y", ["Angry"], True))
    assert call("pmd_library_status")["portraits"]["coverage"] == {"complete": 2}
    assets = portable_assets.bundle(services)
    file = assets["portraits"]["entries"]["charizardmegay|1"]["Angry"]
    asset = assets["files"][file]
    pack = base64.b64decode(assets["pmd_chunks"][asset["pmd"]])
    assert pack[asset["offset"]:asset["offset"] + asset["size"]] == response.content
    assert services.pmd.portrait_library.status()["coverage"] == {"complete": 2}


def test_missing_shiny_never_fetches_or_returns_a_normal_colour_portrait(services):
    calls = []
    services.pmd._http_get = lambda url: calls.append(url)
    from silvers_hoard.errors import SilverError
    with pytest.raises(SilverError, match="shiny portrait"):
        services.pmd.portrait("Mew", "Normal", shiny=True)
    assert calls == []


def test_portrait_pack_corruption_is_detected_before_extraction(tmp_path):
    _, _, output, _, _ = collection(tmp_path)
    library = PmdPortraits(output)
    file = library.resolve("Charizard-Mega-Y", ["Angry"])
    pack = output / library.manifest["packs"][0]
    pack.write_bytes(b"invalid")
    with pytest.raises(ValueError, match="Damaged"):
        library.extract(file, tmp_path / "cache")
    assert not (tmp_path / "cache").exists()
