"""Private trainer pictures stay separate from versionable gym assets without breaking file URLs."""
import base64
import io
import subprocess
from pathlib import Path

from PIL import Image

from conftest import PNG_1PX
from silvers_hoard.sprites import Sprites


def test_legacy_images_move_without_changing_names_or_bytes(tmp_path):
    avatars = tmp_path / "data" / "avatars"
    avatars.mkdir(parents=True)
    names = ("trainer-ai-123.png", "drawn-ref1-123.png", "badge-gym-123.png", "backdrop-gym-123.png")
    for name in names:
        (avatars / name).write_bytes(PNG_1PX)
    sprites = Sprites(tmp_path / "cache", avatars, {})
    for name, folder in zip(names, (avatars, sprites.references_dir, sprites.assets_dir, sprites.assets_dir)):
        assert sprites.avatar_path(name) == folder / name
        assert sprites.avatar_path(name).read_bytes() == PNG_1PX
    sprites.separate_legacy_images()
    assert {item["file"] for item in sprites.avatars()} == set(names)


def test_migration_does_not_overwrite_an_existing_destination(tmp_path):
    avatars = tmp_path / "data" / "avatars"
    refs = avatars.parent / "avatar_refs"
    avatars.mkdir(parents=True)
    refs.mkdir()
    name = "drawn-ref1-123.png"
    (avatars / name).write_bytes(b"original")
    (refs / name).write_bytes(b"other")
    sprites = Sprites(tmp_path / "cache", avatars, {})
    assert sprites.avatar_path(name).read_bytes() == b"original"
    assert (refs / name).read_bytes() == b"other"


def test_trainer_reference_badge_and_backdrop_storage(services, client, monkeypatch):
    avatar = services.avatar_from_photo(PNG_1PX, mode="upload")
    assert services.sprites.avatar_path(avatar["file"]).parent == services.config.avatars_dir
    monkeypatch.setattr(services, "_job", lambda *args: {"queued": True})
    photo = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(photo, "PNG")
    services.avatar_draw([photo.getvalue()], style=False)
    refs = list(services.sprites.references_dir.glob("*.png"))
    assert len(refs) == 1
    badge = services.badge_upload(PNG_1PX)
    backdrop = services.backdrop_upload(PNG_1PX)
    imported = services._import_badge({"kind": "image", "data": base64.b64encode(PNG_1PX).decode()}, "imported-badge")
    for name in (badge["badge_image"][5:], backdrop["backdrop"][5:], imported[5:]):
        assert services.sprites.avatar_path(name).parent == services.sprites.assets_dir
        assert client.get(f"/api/avatars/{name}").status_code == 200
    assert client.get(avatar["url"]).status_code == 200
    assert client.get(f"/api/avatars/{refs[0].name}").status_code == 200
    assert any(item["file"] == refs[0].name for item in services.avatar_images()["images"])


def test_git_ignores_only_private_image_folders(tmp_path):
    root = Path(__file__).resolve().parents[1]
    # Test the shared rules independently of this checkout's local media policy.
    (tmp_path / ".gitignore").write_bytes((root / ".gitignore").read_bytes())
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True, capture_output=True)
    private = ["data/avatars/trainer.png", "data/avatar_refs/photo.png", "data/style_refs/style.png",
               "data/cache/style_prepared/sheet.png", "data/cache/pose_refs/back.png"]
    shared = ["data/assets/badge.png", "data/cache/sprites/trainers/red.png", "data/overworld/custom.png",
              "silvers_hoard/static/icon.png", "silvers_hoard/presets/pmd/source.png", "art/portraits/source.png"]
    result = subprocess.run(["git", "check-ignore", "--no-index", "-z", "--stdin"], input="\0".join(private + shared).encode() + b"\0",
                            cwd=tmp_path, capture_output=True, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stdout.decode().rstrip("\0").split("\0") == private
