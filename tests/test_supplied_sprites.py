import base64
import io
import hashlib

from PIL import Image

from silvers_hoard.leisure import SPRITES, SUPPLIED_ART


def test_manifest_images_and_http_catalog_match(call, client):
    catalog = call("leisure_catalog", {"limit": 0})
    assert len(catalog["sprites"]) == len(SPRITES) >= 190
    assert len(catalog["accessories"]) > 90
    assert len(catalog["decorations"]) > 40
    assert len(SUPPLIED_ART["inventory"]) >= 174
    for item in catalog["sprites"]:
        sprite = SPRITES[item["id"]]
        response = client.get(item["url"])
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content == base64.b64decode(sprite["image"].split(",")[1])
        image = Image.open(io.BytesIO(response.content))
        assert image.size == (sprite["width"], sprite["height"])
        assert image.getbbox()
        assert sprite["source"] in SUPPLIED_ART["sources"]
    assert client.get("/api/sprites/supplied/unknown").status_code == 404


def test_large_furniture_roundtrip_and_all_cells_are_reserved(call):
    placements = [{"kind": "emerald-blue-desk", "x": 0, "y": 2}, {"kind": "doll-magnezone", "x": 5, "y": 4}]
    base = call("secret_base_save", {"name": "Furniture", "decorations": placements})
    exported = call("secret_base_export", {"id": base["id"]})
    imported = call("secret_base_import", {"payload": exported})
    assert imported["decorations"] == placements
    # The far corner of a 3x3 desk belongs to it, even though the anchor differs.
    call("secret_base_save", {"id": base["id"], "name": "Bad", "decorations": placements + [{"kind": "plant", "x": 2, "y": 4}]}, status=400)
    assert call("secret_base_get", {"id": base["id"]}) == base
    for x, y in [(7, 0), (2, 6), (2, 0)]:
        call("secret_base_save", {"name": "Bad", "decorations": [{"kind": "emerald-blue-desk", "x": x, "y": y}]}, status=400)
    # All cells of a multi-tile object block walking; a gap at x=3 still permits passage.
    call("secret_base_save", {"name": "Wall", "decorations": [
        {"kind": "emerald-blue-desk", "x": 0, "y": 3}, {"kind": "emerald-blue-desk", "x": 3, "y": 3},
        {"kind": "doll-magnezone", "x": 6, "y": 3}]}, status=400)


def test_new_accessories_preserve_original_scoring_and_persist(call):
    trainer = call("trainer_create", {"name": "Sprite host", "format": "gen9customgame", "team": [{"species": "Pikachu", "moves": ["Thunderbolt"]}]})
    state = call("contest_start", {"trainer_id": trainer["id"], "seed": "sprite-accessories"})
    selected = [a for a in call("leisure_catalog", {"limit": 0})["accessories"] if a["id"].startswith("bw-")][:3]
    args = {"id": state["id"], "revision": 0, "accessories": [a["id"] for a in selected]}
    chosen = call("contest_choose", args)
    assert chosen["accessories"] == args["accessories"]
    expected = 8 + sum(3 * (a["category"] == state["category"]) + 4 * (a["theme"] == state["theme"]) for a in selected)
    assert chosen["entrants"][0]["scores"][0] == expected
    assert call("contest_get", {"id": state["id"]}) == chosen
    call("contest_choose", args, status=400)


def test_catalog_pages_reach_every_sprite_and_filter_both_languages(call):
    seen = []
    offset = 0
    while offset is not None:
        page = call("leisure_catalog", {"section": "sprites", "offset": offset})
        seen.extend(a["id"] for a in page["sprites"])
        offset = page["pages"]["sprites"]["next_offset"]
    assert len(seen) == len(set(seen)) == len(SPRITES)
    assert set(seen) == set(SPRITES)
    page = call("leisure_catalog", {"section": "decorations", "query": "nevera"})
    assert {d["id"] for d in page["decorations"]} == {"rotom-fridge", "gen4-026"}
    assert "sprites" not in call("leisure_catalog")


def test_generation_four_complete_goods_keep_original_png_bytes_and_footprints(call):
    goods = [s for s in SPRITES.values() if s.get("generation") == 4 and s["group"] == "decoration"]
    assert sorted(s["goods_number"] for s in goods) == list(range(1,139))
    for sprite in goods:
        raw = base64.b64decode(sprite["image"].split(",")[1])
        assert hashlib.sha256(raw).hexdigest() == SUPPLIED_ART["sources"][sprite["source"]]["sha256"]
    assert SPRITES["gen4-028"]["footprint"] == [2,3]
    base=call("secret_base_save",{"name":"Generation IV","decorations":[{"kind":"gen4-028","x":0,"y":2},{"kind":"gen4-138","x":4,"y":4}]})
    imported=call("secret_base_import",{"payload":call("secret_base_export",{"id":base["id"]})})
    assert imported["decorations"]==base["decorations"]
    call("secret_base_save",{"name":"Outside","decorations":[{"kind":"gen4-028","x":7,"y":6}]},status=400)


def test_attack_atlases_have_every_frame_and_no_ranger_registration_markers():
    atlases=[s for s in SPRITES.values() if s["group"]=="effect-atlas"]
    assert len(atlases)==19
    assert sum(s["frames"] for s in atlases)>=200
    for s in atlases:
        im=Image.open(io.BytesIO(base64.b64decode(s["image"].split(",")[1])))
        assert im.width==s["frame_width"]*s["columns"]
        for n in range(s["frames"]):
            x,y=(n%s["columns"])*s["frame_width"],(n//s["columns"])*s["frame_height"]
            assert im.crop((x,y,x+s["frame_width"],y+s["frame_height"])).getbbox()
        if s is SPRITES["fx-ranger-impact"]:
            assert not any((r,g,b)==(255,0,255) and a for r,g,b,a in im.getdata())
