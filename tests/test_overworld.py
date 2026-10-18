import base64
import io
import hashlib
import json
from zipfile import ZipFile

import pytest
from PIL import Image

from silvers_hoard.errors import SilverError
from silvers_hoard.overworld import OverworldSprites


def png(size=(64, 64), color=(20, 40, 60, 255)):
    out = io.BytesIO()
    Image.new("RGBA", size, color).save(out, "PNG")
    return out.getvalue()


def test_native_import_preserves_original_pngs_variants_and_export(call, client, services, tmp_path):
    normal, shiny = png(), png(color=(80, 60, 40, 255))
    source = tmp_path / "ZA Megas.zip"
    with ZipFile(source, "w") as z:
        z.writestr("ZA Megas/RAICHU_3.png", normal)
        z.writestr("ZA Megas/Shiny/RAICHU_3.png", shiny)
    result = call("overworld_import", {"path": str(source), "source": "https://example.org/source", "credit": "Artist"})
    assert result["imported"] == 2
    assert len(call("overworld_list")["sprites"]) == 2
    for variant, original in [(False, normal), (True, shiny)]:
        r = client.get(f"/api/sprites/overworld/raichu-megax?shiny={str(variant).lower()}")
        assert r.status_code == 200
        meta = r.json()
        assert meta["shiny"] == variant and meta["source"] == "https://example.org/source"
        assert meta["frames"][2][3] == [48, 32, 16, 16]
        assert client.get(meta["url"]).content == original
        exported = services.overworld.export()[f"raichu-megax|{int(variant)}"]
        assert base64.b64decode(exported["url"].split(",", 1)[1]) == original
    restarted = OverworldSprites(services.overworld.directory)
    assert restarted.meta("raichu-megax", True)["key"] != restarted.meta("raichu-megax")["key"]
    assert source.is_file()


def test_delphox_sheet_has_exact_cells_and_separate_shiny_without_rewriting_pixels(tmp_path):
    raw = png((265, 258), (111, 232, 183, 255))
    source = tmp_path / "delphox.png"
    source.write_bytes(raw)
    sprites = OverworldSprites(tmp_path / "data")
    assert sprites.import_(str(source), source="https://example.org/cami", credit="CamiLovesO")["imported"] == 8
    normal, shiny = sprites.meta("delphox-mega"), sprites.meta("delphox-mega", True)
    assert normal["frames"][0][0] == [100, 1, 32, 32]
    assert normal["frames"][1][1] == [100, 161, 32, 32]
    assert shiny["frames"][3][0] == [232, 65, 32, 32]
    assert normal["background"] == [111, 232, 183, 255]
    assert sprites.sheet(normal["key"]).read_bytes() == raw == source.read_bytes()
    assert sprites.meta("unknown-mega") is None


def test_invalid_pack_does_not_publish_partial_import(tmp_path):
    source = tmp_path / "bad.zip"
    with ZipFile(source, "w") as z:
        z.writestr("ZA Megas/RAICHU_3.png", png())
        z.writestr("ZA Megas/CLEFABLE_1.png", b"not a PNG")
    sprites = OverworldSprites(tmp_path / "data")
    with pytest.raises(SilverError):
        sprites.import_(str(source), source="source", credit="Artist")
    assert sprites.list() == {"sprites": []}


def swampert_sheet(path):
    sheet = Image.new("RGBA", (270, 437), (30, 30, 30, 255))
    for row in range(5):
        for col in range(3):
            sheet.putpixel((col * 50 + 8, 122 + row * 40 + 10), (24, 152, 224, 255))
            sheet.putpixel((col * 50 + 9, 122 + row * 40 + 10), (row + 60, col + 60, 80, 255))
    sheet.save(path)


def swampert_get(url):
    if "pokemon-species" in url:
        return 200, json.dumps({"name": "swampert", "varieties": [{"pokemon": {
            "name": "swampert-mega", "url": "https://pokeapi.co/api/v2/pokemon/10064/"}}]}).encode(), "application/json"
    return 200, png((2, 2), (240, 120, 224, 255) if "/shiny/" in url else (24, 152, 224, 255)), "image/png"


def test_swampert_native_import_has_eight_directions_shiny_original_and_portable_art(call, client, services, tmp_path):
    source = tmp_path / "mega_swampert_sprites_by_jhony_rex_d89a70c.png"
    swampert_sheet(source)
    raw = source.read_bytes()
    original = hashlib.sha256(raw).hexdigest()
    services.overworld._http_get = swampert_get
    result = call("overworld_import", {"path": str(source), "source": source.name, "credit": "Jhony-Rex"})
    assert result["imported"] == 2
    assert services.overworld.sheet(original).read_bytes() == source.read_bytes() == raw
    images = []
    for variant in (False, True):
        meta = client.get(f"/api/sprites/overworld/swampert-mega?shiny={int(variant)}").json()
        assert meta["original_key"] == original and meta["directions"] == 8
        assert meta["credit"] == ["Jhony-Rex"] and meta["shiny"] == variant
        assert meta["derivation"]["palette"]["form_exact"]
        assert len(meta["frames"]) == 8 and all(len(row) == 4 for row in meta["frames"])
        data = client.get(meta["url"]).content
        image = Image.open(io.BytesIO(data)).convert("RGBA")
        images.append(image)
        assert image.size == (150, 320)
        assert image.getpixel((0, 0))[3] == 0
        for row in range(8):
            assert image.crop((0, row * 40, 150, row * 40 + 40)).getbbox()
        assert meta["frames"][3][3] == [50, 120, 50, 40]
        portable = services.overworld.export()[f"swampert-mega|{int(variant)}"]
        assert base64.b64decode(portable["url"].split(",")[1]) == data
    assert images[0].getchannel("A").tobytes() == images[1].getchannel("A").tobytes()
    assert images[0].getpixel((8, 10)) == (24, 152, 224, 255)
    assert images[1].getpixel((8, 10)) == (240, 120, 224, 255)
    for left, right in ((7, 1), (6, 2), (5, 3)):
        assert images[0].crop((0, left * 40, 50, left * 40 + 40)).transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes() == images[0].crop((0, right * 40, 50, right * 40 + 40)).tobytes()
    restarted = OverworldSprites(services.overworld.directory, http_get=lambda _: pytest.fail("cached palette must work offline"))
    assert restarted.import_(str(source), source=source.name, credit="Jhony-Rex")["imported"] == 2
    assert restarted.meta("swampert-mega", True)["key"] == result["sprites"][1]["key"]


def test_swampert_missing_reference_keeps_existing_imports(tmp_path):
    source = tmp_path / "mega_swampert_sprites_by_jhony_rex.png"
    swampert_sheet(source)
    sprites = OverworldSprites(tmp_path / "data", http_get=lambda _: (404, b"", ""))
    old = tmp_path / "delphox.png"
    old.write_bytes(png((265, 258)))
    sprites.import_(str(old), source="old", credit="Artist")
    before = {p.name: p.read_bytes() for p in sprites.directory.iterdir()}
    with pytest.raises(SilverError, match="shiny palette"):
        sprites.import_(str(source), source=source.name, credit="Jhony-Rex")
    assert {p.name: p.read_bytes() for p in sprites.directory.iterdir()} == before
