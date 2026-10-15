"""Pictures of your own as trainers' avatars: uploaded as they are, official art from the Pokémon Wiki, the list of your pictures,
drawings in the games' official artwork look, and big pictures travelling to friends."""
import base64
import io
import json

import pytest
from PIL import Image

from silvers_hoard.errors import SilverError
from silvers_hoard.official_art import OfficialArt, scaled

from test_prospero_sprite import picture, prospero, run_job  # noqa: F401 - the fixture is used by name


def png(size=(600, 1200), color=(40, 120, 200, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", size, color).save(buf, "PNG")
    return buf.getvalue()


def noisy_png(size) -> bytes:
    import os
    img = Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def size_of(services, avatar):
    with Image.open(services.sprites.avatar_path(avatar[5:])) as im:
        return im.size


def test_upload_keeps_the_picture_as_it_is(services):
    t = services.trainer_create(name="Luis", paste="Pikachu\n- Thunderbolt\n")
    out = services.avatar_from_photo(png((600, 1200)), trainer_id=t["id"], mode="upload", kind="photo")
    assert size_of(services, out["avatar"]) == (512, 1024)          # up to 1024 px, not a 256 px thumbnail
    assert services.store.trainer(t["id"])["avatar"] == out["avatar"]
    with Image.open(services.sprites.avatar_path(out["file"])) as im:
        assert im.getpixel((5, 5))[3] == 255                       # the background stays unless asked
    small = services.avatar_from_photo(png((90, 90)), mode="upload")
    assert size_of(services, small["avatar"]) == (90, 90)           # never enlarged


def test_official_art_credit_and_own_pictures(services):
    t = services.trainer_create(name="Lance", paste="Dragonite\n- Outrage\n")
    out = services.avatar_from_photo(png(), trainer_id=t["id"], mode="upload", kind="art", credit="Pokémon Wiki (Fandom)",
                                     title="Lance Masters.png", source="https://static.wikia.nocookie.net/x.png")
    view = services.trainer_get(t["id"])
    assert view["avatar_credit"] == "Pokémon Wiki (Fandom)"
    # the same bytes twice are one picture; badges and backdrops are not trainers' pictures
    services.avatar_from_photo(png(), mode="upload")
    services.sprites.save_avatar(png((50, 50), (1, 2, 3, 255)), stem="badge-gym1")
    imgs = services.avatar_images()["images"]
    assert len(imgs) == 1 and imgs[0]["kind"] in ("art", "image") and not any(i["file"].startswith("badge-") for i in imgs)
    services.avatar_from_photo(png((300, 300), (9, 9, 9, 255)), trainer_id=t["id"], mode="upload", kind="photo")
    found = services.avatar_images(query="lance")["images"]
    assert {i["kind"] for i in found} == {"art", "photo"} and all("Lance" in i["trainers"] for i in found)
    assert [i["kind"] for i in services.avatar_images(kind="art")["images"]] == ["art"]
    assert services.avatar_images(query="nadie")["images"] == []
    assert out["file"] in {i["file"] for i in services.avatar_images(query="masters")["images"]}


def test_avatar_from_url_says_when_the_server_wants_a_browser(services, monkeypatch):
    t = services.trainer_create(name="Red", paste="Pikachu\n- Thunderbolt\n")
    monkeypatch.setattr(services, "_http_get", lambda url: (403, b"<html>Just a moment...</html>", "text/html"))
    with pytest.raises(SilverError) as e:
        services.avatar_from_url("https://static.wikia.nocookie.net/pokemon/images/x.png", trainer_id=t["id"])
    assert e.value.code == "unavailable" and "browser" in e.value.message
    monkeypatch.setattr(services, "_http_get", lambda url: (200, png((400, 800)), "image/png"))
    out = services.avatar_from_url("https://example.org/red.png", trainer_id=t["id"], kind="art", credit="someone")
    assert services.store.trainer(t["id"])["avatar"] == out["avatar"] and services.trainer_get(t["id"])["avatar_credit"] == "someone"
    with pytest.raises(SilverError):
        services.avatar_from_url("not a url")


def test_big_pictures_travel_shrunk(services):
    t = services.trainer_create(name="Cynthia", paste="Garchomp\n- Earthquake\n")
    services.avatar_from_photo(noisy_png((700, 1000)), trainer_id=t["id"], mode="upload")
    code = services.export("trainer", t["id"], fmt="code")["code"]
    file = services.export("trainer", t["id"], fmt="file")
    payload = services._trainer_payload(services.store.trainer(t["id"]))
    data = base64.b64decode(payload["avatar"]["data"])
    assert len(data) <= services.FILE_PICTURE_BYTES
    assert len(base64.b64decode(services._trainer_payload(services.store.trainer(t["id"]), max_picture=services.CODE_PICTURE_BYTES)["avatar"]["data"])) <= services.CODE_PICTURE_BYTES
    assert code and file
    # a friend's import keeps a big picture big (not 256 px)
    imported = services._import_avatar({"kind": "image", "data": base64.b64encode(png((600, 1200))).decode()}, "friend")
    assert size_of(services, imported) == (512, 1024)


def test_character_with_its_official_art(services):
    art = services.avatar_from_photo(png(), mode="upload", kind="art", credit="Pokémon Wiki (Fandom)", title="Lance Masters.png")
    first = services.character_install("lance", avatar=art["avatar"], art="Lance Masters.png")
    assert first["avatar"] == art["avatar"] and not first.get("existing")
    assert services.trainer_get(first["id"])["avatar_credit"] == "Pokémon Wiki (Fandom)"
    again = services.character_install("lance", avatar=art["avatar"], art="Lance Masters.png")
    assert again["id"] == first["id"] and again.get("existing")
    plain = services.character_install("lance")
    assert plain["id"] != first["id"] and plain["avatar"].startswith("sd:")
    with pytest.raises(SilverError):
        services.character_install("lance", avatar="sd:lance")


def test_drawing_in_the_official_art_look(services, prospero):
    t = services.trainer_create(name="Luis", paste="Sceptile\n- Leaf Blade\n")
    j = run_job(services, services.avatar_draw([picture()], description="black jacket", trainer_id=t["id"], look="art"))
    assert j["status"] == "done", j
    res = j["result"]
    assert res["look"] == "art"
    assert "no pixel art" in prospero.generated["prompt"]
    assert prospero.generated["reference_asset_ids"] == ["as_photo1"]       # no pixel sprites as style references
    assert services.store.trainer(t["id"])["avatar"] == res["candidates"][0]["drawing"]["avatar"]
    kinds = {i["file"]: i["kind"] for i in services.avatar_images()["images"]}
    assert kinds[res["candidates"][0]["drawing"]["file"]] == "drawing"
    with pytest.raises(SilverError):
        services.avatar_draw([picture()], look="watercolour")


# ------------------------------------------------------------------ the wiki's pages and pictures, against a fake API
def fake_wiki(url, params):
    titles = params.get("titles", "")
    if params.get("list") == "search":
        pages = [{"title": "Lance (game)", "missing": True}, {"title": "Lance", "pageid": 1}]
        return {"query": {"pages": pages, "search": [{"title": "Lance"}, {"title": "Lance (anime)"}]}}
    if params.get("prop") == "images":
        if titles == "Lance (anime)":
            return {"query": {"pages": [{"title": titles, "images": [{"title": "File:Lance anime Journeys.png"}]}]}}
        return {"query": {"pages": [{"title": "Lance", "images": [{"title": f"File:{n}"} for n in (
            "Lance HeartGold and SoulSilver.png", "Lance HGSS.png", "Lance Masters.png", "Lance anime Journeys.png", "Lance VS PE.png",
            "0149Dragonite HGSS.png", "Lance Let's Go, Pikachu! and Let's Go, Eevee! concept art.png", "Lance Generations.png",
            "Type Dragon.gif", "Lance Ultra Prism 148.png")]}]}}
    if params.get("prop") == "imageinfo":
        sizes = {"Lance HeartGold and SoulSilver.png": (2064, 3243), "Lance HGSS.png": (80, 80), "Lance Masters.png": (441, 832),
                 "Lance Generations.png": (1920, 1080)}
        out = []
        for t in titles.split("|"):
            name = t.split(":", 1)[1]
            w, h = sizes.get(name, (500, 900))
            url = f"https://static.wikia.nocookie.net/pokemon/images/a/ab/{name.replace(' ', '_')}/revision/latest?cb=1"
            out.append({"title": t, "imageinfo": [{"width": w, "height": h, "mime": "image/png", "url": url, "thumburl": url + "&w=240"}]})
        return {"query": {"pages": out}}
    raise AssertionError(params)


def test_official_art_pages_and_pictures(tmp_path):
    art = OfficialArt(tmp_path, get_json=fake_wiki)
    r = art.search("lance")
    assert r["page"] == "Lance" and r["pages"][:2] == ["Lance", "Lance (anime)"]
    files = [i["file"] for i in r["images"]]
    assert files == ["Lance HeartGold and SoulSilver.png", "Lance Masters.png"]   # sprites, anime, scenes, cards and concept art out
    first = r["images"][0]
    assert first["label_es"] == "Oro HeartGold y Plata SoulSilver" and first["full"].endswith("/scale-to-height-down/1200?cb=1")
    assert r["images"][1]["label_es"] == "Pokémon Masters EX" and r["images"][1]["full"] == r["images"][1]["url"]
    # cached: no second question to the wiki
    art2 = OfficialArt(tmp_path, get_json=lambda u, p: (_ for _ in ()).throw(AssertionError("asked again")))
    assert art2.search("Lance")["images"][0]["file"] == files[0]
    assert OfficialArt(tmp_path, get_json=fake_wiki).search("x", page="Lance (anime)")["images"] == []
    assert scaled("https://h/x.png/revision/latest?cb=2", 500) == "https://h/x.png/revision/latest?cb=2"


def test_official_art_tools(call, monkeypatch, services):
    services.art._get_json = fake_wiki
    r = call("official_art_search", {"query": "Lance"})
    assert r["images"][0]["label"] == "HeartGold and SoulSilver"
    assert call("avatar_images", {})["images"] == []
