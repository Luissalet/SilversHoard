"""Exercise additive reaction packs, agent transport and optional release media."""
import base64
import hashlib
import io
import json

from PIL import Image

from silvers_hoard.pmd_library import PmdLibrary

from portrait_fixtures import release_pmd_root, synthetic_reaction_library  # noqa: F401


def test_all_identities_and_palettes_have_explicit_reactions_without_changing_originals(release_pmd_root):
    extended = PmdLibrary(release_pmd_root)
    check_additive_reactions(extended)
    assert len(extended.manifest["entries"]) == 2938
    assert extended.status()["coverage"]["reactions"]["Pain:authored"] > 500


def test_synthetic_pack_preserves_base_entries_and_exposes_authored_and_fallback_reactions(synthetic_reaction_library):
    check_additive_reactions(synthetic_reaction_library)
    assert synthetic_reaction_library.status()["coverage"]["reactions"] == {
        "Pain:authored": 1, "HitGround:authored": 1, "Pain:acting": 1, "HitGround:acting": 1,
    }


def check_additive_reactions(extended):
    base = PmdLibrary(extended.root, with_reactions=False)
    assert extended.manifest["entries"] == base.manifest["entries"]
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


def test_every_reaction_resolves_through_sheet_routes_and_portable_pack_indices(
    services, client, call, synthetic_reaction_library,
):
    library = synthetic_reaction_library
    services.pmd.library = library
    services.pmd._http_get = lambda *a: (_ for _ in ()).throw(AssertionError("installed reactions must be offline"))
    for shiny, key in ((False, "normal-fixture"), (True, "shiny-fixture")):
        meta = client.get("/api/sprites/pmd/1", params={"shiny": str(shiny).lower()}).json()
        assert meta["key"] == key
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
            asset = portable["files"][file]
            assert asset["pmd"] == (0 if meta["key"] == "shiny-fixture" else 1)
            chunk = base64.b64decode(portable["chunks"][asset["pmd"]])
            assert chunk[asset["offset"]:asset["offset"] + asset["size"]] == library.image_bytes(file)
    # The on-disk base manifest is unchanged by either reader.
    assert json.loads((library.root / "manifest.json").read_text("utf8"))["packs"] == library.manifest["packs"][:-1]
