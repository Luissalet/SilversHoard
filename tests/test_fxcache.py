"""Effect pictures of Showdown's move animations and the battle backdrops: downloaded once, cached on disk, remembered when missing."""

from pathlib import Path


def _fx(services) -> Path:
    return services.config.sprites_dir.parent / "fx"


def _count(services):
    calls = []
    inner = services.fx._http_get

    def counting(url):
        calls.append(url)
        return inner(url)

    services.fx._http_get = counting
    return calls


def test_effect_picture_is_downloaded_once_and_cached(client, services):
    calls = _count(services)
    r = client.get("/api/fx/wisp.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")
    assert (_fx(services) / "fx" / "wisp.png").exists()
    assert client.get("/api/fx/Wisp.png").status_code == 200          # names are lowercased
    assert calls == ["https://play.pokemonshowdown.com/fx/wisp.png"]
    assert services.fx.downloads == 1


def test_backdrop_comes_from_the_gen6_backdrops(client, services):
    calls = _count(services)
    assert client.get("/api/fx/bg/bg-icecave.jpg").status_code == 200
    assert calls == ["https://play.pokemonshowdown.com/sprites/gen6bgs/bg-icecave.jpg"]


def test_missing_picture_is_remembered(client, services):
    calls = _count(services)
    assert client.get("/api/fx/missing.png").status_code == 404
    assert client.get("/api/fx/missing.png").status_code == 404
    assert len(calls) == 1
    assert (_fx(services) / "fx" / "missing.png.404").exists()


def test_names_outside_the_pattern_are_refused(client, services):
    calls = _count(services)
    for bad in ("..%2Fsilver.db", "wisp.exe", "a" * 80 + ".png", ".hidden.png"):
        assert client.get(f"/api/fx/{bad}").status_code in (400, 404, 422)
    assert client.get("/api/fx/nope/wisp.png").status_code in (400, 404)
    assert calls == []


def test_no_download_when_downloads_are_off(client, services):
    services.settings.update({"sprite_downloads": False})
    calls = _count(services)
    assert client.get("/api/fx/fireball.png").status_code == 404
    assert calls == []


def test_stats(client, services):
    client.get("/api/fx/rock1.png")
    s = client.get("/api/fx/stats").json()
    assert s["cached"] == 1 and s["downloads"] == 1 and s["server"] == "https://play.pokemonshowdown.com"


def test_prefetch_downloads_every_picture_the_tables_name(client, services, tmp_path):
    js = tmp_path / "anims.gen.js"
    js.write_text('const BattleEffects = { wisp: { url: "wisp.png", w: 100, h: 100 }, iceball: { url: "iceball.png" } };\n'
                  'scene.backgroundEffect(`url(\'https://${Config.routes.client}/fx/bg-space.jpg\')`, 600, 0.6);\n'
                  'scene.backgroundEffect(`url(\'https://${Config.routes.client}/sprites/gen6bgs/bg-icecave.jpg\')`, 600);\n'
                  'scene.showEffect("missing", {});', encoding="utf-8")
    bd = tmp_path / "backdrop.js"
    bd.write_text('export const BACKDROPS = ["bg-beach.jpg"];\nconst W = { rain: "weather-raindance.jpg" };\n', encoding="utf-8")
    calls = _count(services)
    r = services.fx.prefetch(js, bd)
    assert r["pictures"] == 6 and r["failed"] == [] and r["cached"] == 6
    assert sorted(calls) == ["https://play.pokemonshowdown.com/fx/bg-space.jpg", "https://play.pokemonshowdown.com/fx/iceball.png",
                             "https://play.pokemonshowdown.com/fx/weather-raindance.jpg", "https://play.pokemonshowdown.com/fx/wisp.png",
                             "https://play.pokemonshowdown.com/sprites/gen6bgs/bg-beach.jpg",
                             "https://play.pokemonshowdown.com/sprites/gen6bgs/bg-icecave.jpg"]


def test_the_real_tables_name_the_effect_pictures(services):
    known = services.fx.known()
    kinds = [k for k, _ in known]
    assert kinds.count("fx") >= 90 and kinds.count("bg") >= 19
    assert ("bg", "bg-skypillar.jpg") in known and ("fx", "bg-gen4-snow.png") in known and ("fx", "weather-strongwind.png") in known
    assert ("fx", "bg-gen1.png") in known
    assert ("fx", "iceball.png") in services.fx.known() and ("fx", "bg-space.jpg") in services.fx.known()


def test_fx_tool(services):
    from silvers_hoard.agent_tools import call_tool

    r = call_tool(services, "fx_cache", {})
    assert r["cached"] == 0 and r["server"] == "https://play.pokemonshowdown.com"
