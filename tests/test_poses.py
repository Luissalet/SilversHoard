"""Poses of a trainer's own sprite (back view, victory) drawn by Prospero's Hoard, against the same contract fake as the sprite."""
import io
import json

import pytest
from PIL import Image

from silvers_hoard.errors import SilverError

from test_prospero_sprite import WRITES, picture, prospero, run_job  # noqa: F401 - the fixture is used by name


def sprite_png(size=(96, 96)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", size, (30, 90, 200, 255)).save(buf, "PNG")
    return buf.getvalue()


def size_of(services, name):
    with Image.open(services.sprites.avatar_path(name)) as im:
        return im.size


@pytest.fixture
def own(services):
    t = services.trainer_create(name="Luz", paste="Pikachu\n- Thunderbolt\n")
    name = services.sprites.save_avatar(sprite_png(), stem=f"{t['id']}-ai", pixelate=True)
    services.store.update_trainer(t["id"], {"avatar": f"file:{name}"})
    return services.store.trainer(t["id"])


def test_poses_are_drawn_from_the_sprite_and_follow_it(services, prospero, own):
    j = run_job(services, services.avatar_poses_draw(trainer_id=own["id"], count=2, style=False))
    assert j["status"] == "done", j
    res = j["result"]
    assert set(res["candidates"]) == {"back", "win"} and all(len(v) == 2 for v in res["candidates"].values())
    gens = [a for t, a in prospero.calls if t == "studio_generate_image"]
    assert len(gens) == 2
    assert gens[0]["reference_asset_ids"] == ["as_photo1"] and gens[0]["aspect"] == "2:3"
    assert "seen from behind" in gens[0]["prompt"] and "victory pose" in gens[1]["prompt"]
    assert "facing the viewer, cel" not in gens[0]["prompt"]       # the default style line drops its facing for the back view
    assert all("reason" in a for t, a in prospero.calls if t in WRITES)
    # the first of each pose is used, for every view of the trainer and for the seats of its battles
    view = services.trainer_get(own["id"])
    assert view["avatar_poses"]["back"] == res["candidates"]["back"][0]["url"]
    assert view["avatar_poses"]["win"] == res["candidates"]["win"][0]["url"]
    seat = services._public_seat({"avatar": own["avatar"], "sets": []})
    assert seat["avatar_poses"] == view["avatar_poses"] and "sets" not in seat
    # a sprite of 96 px gives sprites of 96 px
    assert size_of(services, res["candidates"]["back"][0]["file"]) == size_of(services, services.sprites.save_avatar(picture(), stem="x", pixelate=True))
    # another candidate, then dropping one pose
    other = res["candidates"]["win"][1]["avatar"]
    got = services.avatar_pose_set(avatar=own["avatar"], pose="win", file=other)
    assert got["poses"]["win"].endswith(other[5:])
    got = services.avatar_pose_set(avatar=own["avatar"], pose="back", file="")
    assert "back" not in got["poses"] and "win" in got["poses"]
    stored = json.loads((services.config.data_dir / "avatar_poses.json").read_text(encoding="utf-8"))
    assert list(stored[own["avatar"]]) == ["win"]
    # a new sprite has no poses
    services.store.update_trainer(own["id"], {"avatar": "sd:lucas"})
    assert services.trainer_get(own["id"])["avatar_poses"] == {}


def test_one_pose_only(services, prospero, own):
    j = run_job(services, services.avatar_poses_draw(avatar=own["avatar"], poses=["back"], style=False))
    assert j["status"] == "done", j
    assert list(j["result"]["candidates"]) == ["back"]
    assert len([1 for t, _ in prospero.calls if t == "studio_generate_image"]) == 1
    assert "win" not in services.avatar_poses_get(avatar=own["avatar"])["poses"]


def test_a_drawing_gives_drawings_and_its_style_goes_along(services, prospero):
    t = services.trainer_create(name="Sol", paste="Eevee\n- Tackle\n")
    name = services.sprites.save_avatar(sprite_png((300, 450)), stem=f"{t['id']}-ai-drawing", max_side=512)
    services.store.update_trainer(t["id"], {"avatar": f"file:{name}"})
    j = run_job(services, services.avatar_poses_draw(trainer_id=t["id"], poses=["win"]))
    assert j["status"] == "done", j
    gen = next(a for tl, a in prospero.calls if tl == "studio_generate_image")
    assert len(gen["reference_asset_ids"]) == 2 and "Image 2 is only a style reference" in gen["prompt"]
    assert size_of(services, j["result"]["candidates"]["win"][0]["file"]) == size_of(services, services.sprites.save_avatar(picture(), stem="y", max_side=512))


def test_games_sprites_and_bad_input_are_refused(services, prospero, own):
    t = services.trainer_create(name="Cyn", paste="Garchomp\n- Earthquake\n")
    services.store.update_trainer(t["id"], {"avatar": "sd:cynthia"})
    with pytest.raises(SilverError) as e:
        services.avatar_poses_draw(trainer_id=t["id"])
    assert e.value.code == "invalid"
    with pytest.raises(SilverError):
        services.avatar_poses_draw(avatar=own["avatar"], poses=["dance"])
    with pytest.raises(SilverError):
        services.avatar_pose_set(avatar=own["avatar"], pose="win", file="file:nope-1.png")
    assert services.avatar_poses_get(trainer_id=t["id"])["can_draw"] is False
    assert not [1 for tl, _ in prospero.calls if tl == "studio_generate_image"]
