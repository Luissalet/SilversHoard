"""PNG provenance and request snapshots; native/browser QA separately exercises the real renderer."""
import copy
import hashlib
import io
import json

import pytest
from PIL import Image

from conftest import needs_engine
from silvers_hoard import trainer_poster as poster
from silvers_hoard.errors import SilverError

pytestmark = needs_engine


def picture(color=(24, 64, 192, 255), size=(40, 60)):
    stream = io.BytesIO()
    Image.new("RGBA", size, color).save(stream, "PNG")
    return stream.getvalue()


@pytest.fixture
def trainer(call, services):
    trainer = call("trainer_create", {"name": "María Ñúñez " + "W" * 42, "title": "Entrenadora del bosque",
                                      "format": "gen9customgame", "team": [{"species": "Pikachu", "name": "Chispa", "level": 42,
                                      "shiny": True, "moves": ["Thunderbolt"], "evs": {"spa": 252}}]})
    services.avatar_from_photo(picture(), trainer_id=trainer["id"], mode="upload", kind="art",
                               credit="Áurea López ©", source="https://example.test/obra/mañana.png", title="Retrato de María")
    services.avatar_style_set(add=[("blue-reference.png", picture())], selected=None)
    ref = services.avatar_style_get()["images"][0]["file"]
    services.avatar_style_set(selected=[ref])
    return services.store.trainer(trainer["id"])


def build(services, trainer, badges=()):
    return poster.snapshot(services, copy.deepcopy(trainer), copy.deepcopy(list(badges)),
                           copy.deepcopy(services.avatar_style_get()), copy.deepcopy(services._avatar_meta()), "es")


def test_snapshot_preserves_identity_public_team_and_recorded_provenance(services, trainer):
    before = copy.deepcopy(trainer), services.avatar_style_get(), services._avatar_meta()
    data = build(services, trainer)
    public = poster.metadata(data)
    assert public["trainer"]["name"] == trainer["name"]
    assert public["portrait_category"] == "art"
    assert public["team"] == [{"name": "Chispa", "species": "Pikachu", "level": 42, "shiny": True}]
    source = next(source for source in public["sources"] if source["role"] == "portrait")
    assert (source["category"], source["credit"], source["source"], source["title"]) == (
        "art", "Áurea López ©", "https://example.test/obra/mañana.png", "Retrato de María")
    assert any(source["role"] == "palette" and source["credit"] == "" for source in public["sources"])
    assert data["accent"] != "#e2404f"
    assert public["accent"] == data["accent"]
    assert set(public["team"][0]) == {"name", "species", "level", "shiny"}
    assert "data:image" not in json.dumps(public)
    assert "moves" not in public and "evs" not in public["team"][0]
    assert (services.store.trainer(trainer["id"]), services.avatar_style_get(), services._avatar_meta()) == before


def test_all_members_and_earned_badge_shapes_are_kept(services, trainer):
    trainer["team"] = [{"species": "Pikachu", "name": f"Pika {i}", "moves": ["Thunderbolt"]} for i in range(11)]
    badges = [{"gym_name": "Gimnasio" + str(i), "badge": "Medalla" + str(i), "badge_color": "#ddcc66", "badge_image": "shape:star"} for i in range(18)]
    data = build(services, trainer, badges)
    public = poster.metadata(data)
    assert len(public["team"]) == 11 and len(public["badges"]) == 18
    assert public["team"][-1]["name"] == "Pika 10"
    assert all(badge["image"] == "shape:star" for badge in data["badges"])
    assert all(badge["source"] == "shape:star" for badge in public["badges"])
    assert len([source for source in public["sources"] if source["role"] == "badge"]) == 1


def test_missing_art_and_empty_badges_do_not_replace_identity(services, trainer, monkeypatch):
    def missing(*args, **kwargs):
        raise SilverError("not_found", "Missing fixture")
    monkeypatch.setattr(services.sprites, "pokemon", missing)
    trainer["avatar"] = ""
    services.avatar_style_set(selected=[])
    data = build(services, trainer)
    assert data["portrait"] == {"src": "", "category": "none"}
    assert data["team"][0]["name"] == "Chispa" and data["team"][0]["src"] == ""
    assert not data["badges"] and data["accent"] == "#e2404f"
    assert data["warnings"] == [{"role": "team", "name": "Pikachu"}]


def test_custom_badge_art_keeps_its_category_credit_and_origin(services, trainer):
    data = build(services, trainer, [{"gym_name": "Luz", "badge": "Ámbar", "badge_image": trainer["avatar"]}])
    assert data["badges"][0]["image"]["kind"] == "image"
    source = next(row for row in data["sources"] if row["role"] == "badge")
    assert source["category"] == "art" and source["credit"] == "Áurea López ©"
    assert source["source"] == "https://example.test/obra/mañana.png"


@pytest.mark.parametrize("kind", ["drawing", "sprite"])
def test_generated_art_titles_do_not_share_the_generation_description(services, trainer, kind, monkeypatch):
    private_description = "QA generation description: blue coat and an unshared phrase"
    services._avatar_meta_set(trainer["avatar"][5:], kind=kind, title=private_description)
    before = copy.deepcopy(services._avatar_meta())
    badges = [{"gym_name": "Prueba", "badge": "Nombre público de medalla", "badge_image": trainer["avatar"]}]
    data = build(services, trainer, badges)
    assert private_description not in json.dumps(data, ensure_ascii=False)
    for role, name in (("portrait", trainer["name"]), ("badge", badges[0]["badge"])):
        source = next(row for row in data["sources"] if row["role"] == role)
        assert source["title"] == name and source["category"] == kind
        assert source["credit"] == "Áurea López ©" and source["source"] == "https://example.test/obra/mañana.png"
    assert services._avatar_meta() == before  # Keep the private drawing metadata for the original workflow.
    pending = fake_renderer(monkeypatch, services)
    rendered = []
    def render(s, data, browser, cancelled):
        rendered.append(copy.deepcopy(data))
        return picture()
    monkeypatch.setattr(poster, "render", render)
    job = poster.create(services, trainer["id"])
    pending.pop()()
    result = services.job_get(job["id"])["result"]
    with Image.open(services.config.exports_dir / result["file"]) as image:
        assert private_description not in image.info["SilverPoster"]
    assert private_description not in json.dumps(rendered, ensure_ascii=False)


@pytest.mark.parametrize("kind", ["art", "photo", "image"])
def test_public_picture_titles_and_credits_are_kept(services, trainer, kind):
    services._avatar_meta_set(trainer["avatar"][5:], kind=kind)
    data = build(services, trainer)
    source = next(row for row in data["sources"] if row["role"] == "portrait")
    assert (source["title"], source["category"], source["credit"], source["source"]) == (
        "Retrato de María", kind, "Áurea López ©", "https://example.test/obra/mañana.png")


@pytest.mark.parametrize("broken", [False, True])
def test_style_reference_filenames_are_not_shared(services, trainer, broken):
    # The existing picker names references from avatar titles, which may be generation descriptions.
    private_word = "privatephrase731"
    services.avatar_style_set(add=[(private_word + ".png", picture())])
    ref = next(row["file"] for row in services.avatar_style_get()["images"] if row["file"].startswith(private_word))
    services.avatar_style_set(selected=[ref])
    styles = copy.deepcopy(services.avatar_style_get())
    path = services.config.style_refs_dir / ref
    if broken:
        path.write_bytes(b"invalid synthetic reference")
    before = path.read_bytes()
    selection = (services.config.style_refs_dir / "selection.json").read_bytes()
    data = poster.snapshot(services, trainer, [], styles, services._avatar_meta(), "es")
    assert private_word not in json.dumps(data, ensure_ascii=False)
    assert private_word not in json.dumps(poster.metadata(data), ensure_ascii=False)
    if broken:
        assert {"role": "palette", "name": "#1"} in data["warnings"]
    else:
        source = next(row for row in data["sources"] if row["role"] == "palette")
        assert source["title"] == "#1" and source["category"] == "style_reference" and source["credit"] == ""
        assert source["source"] == "style-library:sha256:" + hashlib.sha256(before).hexdigest()
    assert path.read_bytes() == before
    assert (services.config.style_refs_dir / "selection.json").read_bytes() == selection


def fake_renderer(monkeypatch, services):
    monkeypatch.setattr(type(services), "video_status", lambda self: {"playwright": True, "browser": "fixture-browser", "hint": ""})
    pending = []
    monkeypatch.setattr(services.pool, "submit", lambda work: pending.append(work))
    return pending


def test_job_freezes_request_metadata_png_pixels_and_unique_exports(services, trainer, monkeypatch):
    pending = fake_renderer(monkeypatch, services)
    rendered = []
    png = picture((20, 40, 60, 255), (1080, 1350))
    def render(s, data, browser, cancelled):
        rendered.append(copy.deepcopy(data))
        return png
    monkeypatch.setattr(poster, "render", render)
    first = poster.create(services, trainer["id"], lang="es")
    second = poster.create(services, trainer["id"], lang="es")
    services.store.update_trainer(trainer["id"], {"name": "Nombre cambiado después de pedir el PNG"})
    services.avatar_style_set(selected=[])
    for work in pending:
        work()
    jobs = [services.job_get(job["id"]) for job in (first, second)]
    assert all(job["status"] == "done" for job in jobs), jobs
    files = [services.config.exports_dir / job["result"]["file"] for job in jobs]
    assert files[0] != files[1] and all(path.is_file() for path in files)
    assert first["id"] in files[0].name and second["id"] in files[1].name
    for path, job in zip(files, jobs):
        with Image.open(path) as image, Image.open(io.BytesIO(png)) as original:
            stored = json.loads(image.info["SilverPoster"])
            assert image.size == (1080, 1350) and image.tobytes() == original.tobytes()
        assert stored == job["result"]["poster"]
        assert stored["trainer"]["name"] == trainer["name"]
        assert next(row for row in stored["sources"] if row["role"] == "portrait")["credit"] == "Áurea López ©"
        assert any(row["role"] == "palette" for row in stored["sources"])
    assert services.store.trainer(trainer["id"])["name"] == "Nombre cambiado después de pedir el PNG"


def test_missing_browser_does_not_queue_a_poster(services, trainer, monkeypatch):
    monkeypatch.setattr(type(services), "video_status", lambda self: {"playwright": False, "browser": "", "hint": "Existing video setup"})
    before = services.store.jobs()
    with pytest.raises(SilverError) as error:
        poster.create(services, trainer["id"])
    assert error.value.code == "unavailable" and error.value.hint == "Existing video setup"
    assert services.store.jobs() == before


def test_cancelled_job_does_not_write_the_rendered_png(services, trainer, monkeypatch):
    pending = fake_renderer(monkeypatch, services)
    def render(s, data, browser, cancelled):
        services.job_cancel(job["id"])
        return picture()
    monkeypatch.setattr(poster, "render", render)
    job = poster.create(services, trainer["id"])
    pending.pop()()
    assert services.job_get(job["id"])["status"] == "cancelled"
    assert not list(services.config.exports_dir.glob("*.png"))


def test_shared_handler_exports_downloadable_png_with_provenance(client, call, services, trainer, monkeypatch):
    pending = fake_renderer(monkeypatch, services)
    monkeypatch.setattr(poster, "render", lambda *args: picture(size=(1080, 1350)))
    job = call("trainer_poster", {"id": trainer["id"], "lang": "es"})
    assert job["kind"] == "poster"
    pending.pop()()
    result = call("job_get", {"id": job["id"]})["result"]
    response = client.get(result["url"])
    assert response.status_code == 200 and response.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (1080, 1350)
        assert json.loads(image.info["SilverPoster"])["trainer"]["name"] == trainer["name"]
    assert call("trainer_get", {"id": trainer["id"]})["name"] == trainer["name"]
