"""Exercise the shipped collection, its additive pack and normal product transport."""
import hashlib
import io
import json
from pathlib import Path

from PIL import Image

from silvers_hoard.pmd_library import PmdLibrary

ROOT = Path(__file__).resolve().parents[1] / "silvers_hoard/presets/pmd"


def test_all_identities_and_palettes_have_explicit_reactions_without_changing_originals():
    base = PmdLibrary(ROOT, with_reactions=False)
    extended = PmdLibrary(ROOT)
    assert extended.manifest["entries"] == base.manifest["entries"]
    assert len(extended.manifest["entries"]) == 2938
    assert extended.manifest["roster"] == base.manifest["roster"]
    for key, original in base.manifest["metas"].items():
        result = extended.metas[key]
        assert {k: v for k, v in result.items() if k != "a"} == {k: v for k, v in original.items() if k != "a"}
        assert {a: result["a"][a] for a in original["a"]} == original["a"]
        for name in ("Pain", "HitGround"):
            g = result["a"][name]
            assert g["n"] > 0 and len(g["d"]) == g["n"] and all(d > 0 for d in g["d"])
            if g.get("reaction"):
                assert g["source"]["identity"] == key
                assert g["file"] == original["a"][g["source"]["animation"]]["file"]
                if name == "HitGround":
                    assert len(g["pose_bounds"]) == g["r"]
            else:
                raw = extended.image_bytes(g["file"])
                image = Image.open(io.BytesIO(raw))
                assert image.size == (g["n"] * g["w"], g["r"] * g["h"])
                assert hashlib.sha256(raw).hexdigest() == g["source"]["sha256"]
                if name == "HitGround":
                    assert len(g["ground_frames"]) == g["r"]
                    assert all(0 <= frame < g["n"] for frame in g["ground_frames"])
    assert extended.status()["coverage"]["reactions"]["Pain:authored"] > 500


def test_every_reaction_resolves_through_sheet_routes_and_portable_pack_indices(services, client, call, tmp_path):
    library = PmdLibrary(ROOT)
    services.pmd.library = library
    services.pmd._http_get = lambda *a: (_ for _ in ()).throw(AssertionError("installed reactions must be offline"))
    for num, form, shiny in [(152, "", False), (152, "", True), (1025, "", False), (6, "Mega-X", True)]:
        meta = client.get(f"/api/sprites/pmd/{num}", params={"form": form, "shiny": str(shiny).lower()}).json()
        for action in ("Pain", "HitGround"):
            g = meta["a"][action]
            response = client.get(f'/api/sprites/pmd-sheet/{meta["key"]}/{action}.png')
            assert response.status_code == 200
            assert response.content == library.image_bytes(g["file"])
    status = call("pmd_library_status")
    assert status["coverage"]["reactions"] == library.status()["coverage"]["reactions"]
    portable = library.portable()
    for meta in library.manifest["metas"].values():
        for name in ("Pain", "HitGround"):
            file = portable["urls"][f'/api/sprites/pmd-sheet/{meta["key"]}/{name}.png']
            assert file in portable["files"]
            assert 0 <= portable["files"][file]["pmd"] < len(portable["chunks"])
    # The on-disk base manifest is unchanged by either reader.
    assert json.loads((ROOT / "manifest.json").read_text("utf8"))["packs"] == library.manifest["packs"][:-1]
