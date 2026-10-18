import base64
import hashlib
import json
import re

from conftest import PNG_1PX, needs_engine
from silvers_hoard import portable_assets


def seed_cache(services):
    path = services.sprites.cache_dir / "gen5/mew.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG_1PX)
    (path.parent / "missing.png.404").write_text("404")
    return path


def embedded(services, page):
    html = (services.config.exports_dir / page["file"]).read_text(encoding="utf8")
    data = json.loads(re.search(r'<script id="silver-data" type="application/json">(.*?)</script>', html, re.S).group(1))
    assert page["embedded_assets"] == len(data["portable_assets"]["files"]) >= 1
    image = data["portable_assets"]["files"]["sprites/gen5/mew.png"]
    assert base64.b64decode(image.split(",", 1)[1]) == PNG_1PX
    return data


def test_bundle_reads_existing_files_without_downloads_or_cache_changes(services):
    path = seed_cache(services)
    fx = services.fx.cache_dir / "fx/wisp.png"
    fx.parent.mkdir(parents=True, exist_ok=True)
    fx.write_bytes(PNG_1PX)
    def deny(*args, **kwargs):
        raise AssertionError("Portable assets must never fetch")
    for cache in [services.sprites, services.fx, services.reborn]:
        cache._http_get = deny
    before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in path.parent.rglob("*") if p.is_file()}
    assets = portable_assets.bundle(services)
    assert assets["version"] == 1 and len(assets["files"]) == 2
    assert assets["urls"][services.settings["sprite_server"] + "/gen5/mew.png"] == "sprites/gen5/mew.png"
    assert assets["urls"]["https://play.pokemonshowdown.com/fx/wisp.png"] == "fx/fx/wisp.png"
    assert assets["urls"]["/api/fx/wisp.png"] == "fx/fx/wisp.png"
    assert not any("404" in name for name in assets["files"])
    assert before == {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in path.parent.rglob("*") if p.is_file()}
    assert all(cache.downloads == 0 for cache in [services.sprites, services.fx, services.reborn])


@needs_engine
def test_native_trainer_export_carries_cached_art_for_both_battle_modes(services, call):
    seed_cache(services)
    trainer = call("trainer_create", {"name": "Offline assets QA", "team": [{"species": "Mew", "moves": ["Splash"]}]})
    before = call("trainer_get", {"id": trainer["id"]})
    for mode in ["turns", "realtime"]:
        data = embedded(services, call("export", {"kind": "trainer", "id": trainer["id"], "fmt": "page", "friend_mode": mode}))
        assert data["mode"] == mode
    assert call("trainer_get", {"id": trainer["id"]}) == before


@needs_engine
def test_daily_and_mass_exports_use_the_same_local_bundle(services, call):
    seed_cache(services)
    daily = embedded(services, call("daily_challenge_export", {"day": "2026-10-18"}))
    assert daily["daily"]["day"] == "2026-10-18"
    mass = call("mass_start", {"preset": "starters", "seed": "offline-assets"})
    data = embedded(services, call("mass_export", {"id": mass["id"]}))
    assert data["mass"]["hash"] == mass["hash"]
