import base64
import io
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
