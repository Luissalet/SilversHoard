import io
import pytest
from PIL import Image
from conftest import needs_engine

pytestmark = needs_engine


def own_art(services):
    trainer = services.trainer_create(name="Art source", paste="Mew\n- Psychic", format_="gen9customgame")
    buf = io.BytesIO()
    Image.new("RGB", (600, 900), "blue").save(buf, "PNG")
    services.avatar_from_photo(buf.getvalue(), trainer_id=trainer["id"], mode="upload", kind="art",
        credit="QA artist", source="https://example.org/source", title="QA artwork")
    return services.trainer_get(trainer["id"])


@pytest.mark.parametrize("fmt", ["code", "file", "page"])
def test_trainer_art_keeps_its_metadata_in_every_share_format(services, fmt):
    trainer = own_art(services)
    out = services.export("trainer", trainer["id"], fmt=fmt)
    content = out["code"] if fmt == "code" else (services.config.exports_dir / out["file"]).read_text(encoding="utf-8")
    back = services.import_any(content)["trainer"]
    assert back["avatar_kind"] == "art" and back["avatar_credit"] == "QA artist"
    metadata = services._avatar_meta()[back["avatar"][5:]]
    assert metadata["source"] == "https://example.org/source" and metadata["title"] == "QA artwork"
    assert services.trainer_get(trainer["id"])["avatar"] == trainer["avatar"]


def test_nested_gym_and_league_art_and_old_payloads(services, call):
    trainer = own_art(services)
    gym = call("gym_save", {"name": "Art gym", "leader_id": trainer["id"], "trainers": [trainer["id"]]})
    payload = services._gym_payload(services.store.gym(gym["id"]))
    assert payload["leader"]["avatar"]["metadata"] == payload["trainers"][0]["avatar"]["metadata"]
    exported = services.export("gym", gym["id"], fmt="file")
    back = services.import_any((services.config.exports_dir / exported["file"]).read_text(encoding="utf-8"))["gym"]
    for id_ in [back["leader_id"], *back["trainers"]]:
        assert services.trainer_get(id_)["avatar_credit"] == "QA artist"
    league = call("league_save", {"name": "Art league", "gyms": [gym["id"]],
        "elite_four": [trainer["id"]], "champion_id": trainer["id"]})
    shared = services.export("league", league["id"], fmt="file")
    imported = services.import_any((services.config.exports_dir / shared["file"]).read_text(encoding="utf-8"))["league"]
    for id_ in [imported["champion_id"], *imported["elite_four"]]:
        assert services.trainer_get(id_)["avatar_credit"] == "QA artist"
    assert services.league_get(imported["id"])["gym_list"][0]["leader"]["avatar_credit"] == "QA artist"
    image = dict(payload["leader"]["avatar"])
    image.pop("metadata")
    assert services._import_avatar(image, "legacy").startswith("file:")
    image["metadata"] = {"kind": "future", "title": {"unknown": True}}
    assert services._import_avatar(image, "future").startswith("file:")
