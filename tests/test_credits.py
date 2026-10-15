"""Visible credits: the trainer sprite artists from Showdown's index, SpriteCollab's artists by sprite folder, the cache (no network
when fresh, a background download for screens, the old copy offline), the credits tool and the artists in trainer and character
views and on the walking sprites' geometry."""
import json
import time

from conftest import needs_engine
from silvers_hoard.credits import Credits, parse_credit_names, parse_trainer_index, pmd_credits

INDEX = """<main><figure id="aarune.png">\n\t<img src="aarune.png" />\n\t<figcaption><a href="aarune.png">aarune</a><br />by kyledove</figcaption>\n</figure>
<figure id="acerola.png"><img src="acerola.png" /><figcaption><a href="acerola.png">acerola</a><br />by Beliot419 &amp; co</figcaption></figure>
<figure id="acetrainer-gen1.png"><img src="acetrainer-gen1.png" /><figcaption><a href="acetrainer-gen1.png">acetrainer-gen1</a></figcaption></figure></main>"""
TRACKER = {
    "0006": {"name": "Charizard", "sprite_files": {"Walk": True}, "sprite_credit": {"primary": "CHUNSOFT", "secondary": ["<@!42>"]},
             "subgroups": {
                 "0000": {"name": "", "sprite_files": {}, "sprite_credit": {}, "subgroups": {
                     "0001": {"name": "Shiny", "sprite_files": {"Walk": True}, "sprite_credit": {"primary": "<@!42>", "secondary": []}, "subgroups": {}}}},
                 "0001": {"name": "Mega_X", "sprite_files": {"Walk": True}, "sprite_credit": {"primary": "<@!7>", "secondary": ["<@!99>"]}, "subgroups": {}},
                 "0002": {"name": "Mega_Y", "sprite_files": {}, "sprite_credit": {"primary": "<@!7>"}, "subgroups": {}}}},
}
NAMES = "Name\tDiscord\tContact\nCHUNSOFT\tCHUNSOFT\thttps://example\nEmboarger\t<@!42>\t\nKevin\t<@!7>\t\n"


class Site:
    def __init__(self):
        self.calls = []
        self.down = False

    def __call__(self, url):
        self.calls.append(url)
        if self.down:
            raise OSError("offline")
        if url.endswith("/sprites/trainers/"):
            return 200, INDEX.encode(), "text/html"
        if url.endswith("/tracker.json"):
            return 200, json.dumps(TRACKER).encode(), "application/json"
        if url.endswith("/credit_names.txt"):
            return 200, NAMES.encode(), "text/plain"
        return 404, b"", "text/plain"


def test_parsers():
    t = parse_trainer_index(INDEX)
    assert t == {"aarune": "kyledove", "acerola": "Beliot419 & co"}         # the games' own art has no author
    names = parse_credit_names(NAMES)
    c = pmd_credits(TRACKER, names)
    assert c["0006"] == ["CHUNSOFT", "Emboarger"]
    assert c["0006/0001"] == ["Kevin"]                                       # an unknown Discord id is left out, not shown raw
    assert c["0006/0000/0001"] == ["Emboarger"]
    assert "0006/0002" not in c                                              # no sprite files: nothing to credit


def test_cache_background_and_offline(tmp_path):
    site = Site()
    cr = Credits(tmp_path / "credits", {"sprite_downloads": True}, site, lambda: "https://raw.example/SpriteCollab")
    assert cr.trainer("acerola", wait=True) == "Beliot419 & co"
    assert cr.walking("0006-0001", wait=True) == ["Kevin"]
    assert cr.walking("0006/0003/0001", wait=True) == ["CHUNSOFT", "Emboarger"]   # unknown form: the plain one's artists
    n = len(site.calls)
    fresh = Credits(tmp_path / "credits", {"sprite_downloads": True}, site, lambda: "https://raw.example/SpriteCollab")
    assert fresh.trainer("aarune") == "kyledove" and len(site.calls) == n      # read from the cache, no network
    # a screen never waits: with nothing cached it gets {} and the list arrives in the background
    other = Credits(tmp_path / "c2", {"sprite_downloads": True}, site, lambda: "https://raw.example/SpriteCollab")
    assert other.trainers() == {}
    for _ in range(50):
        if other.trainers():
            break
        time.sleep(0.05)
    assert other.trainer("aarune") == "kyledove"
    # stale and offline: the old copy
    old = time.time() - 40 * 24 * 3600
    for f in (tmp_path / "credits").glob("*.json"):
        import os
        os.utime(f, (old, old))
    site.down = True
    stale = Credits(tmp_path / "credits", {"sprite_downloads": True}, site, lambda: "https://raw.example/SpriteCollab")
    assert stale.trainer("acerola", wait=True) == "Beliot419 & co"
    off = Credits(tmp_path / "c3", {"sprite_downloads": False}, site, lambda: "x")
    assert off.summary(wait=True)["trainer_sprites"]["credited"] == 0


@needs_engine
def test_tool_and_views(services, monkeypatch):
    site = Site()
    services.credits._http_get = site
    services.credits._pmd_base = lambda: "https://raw.example/SpriteCollab"
    r = services.credits_get()
    assert any(x["id"] == "spritecollab" for x in r["sources"]) and r["trainer_sprites"]["credited"] == 2
    assert r["walking_sprites"]["artists"][0]["artist"] in ("Emboarger", "CHUNSOFT", "Kevin")
    one = services.credits_get(sprite="sd:acerola")
    assert one["sprite"] == "acerola" and one["artist"] == "Beliot419 & co"
    assert services.credits_get(sprite="acetrainer-gen1")["artist"] == ""
    t = services.trainer_create(name="Ace", paste="Pikachu\n- Thunderbolt\n", avatar="sd:acerola")
    assert services.trainer_get(t["id"])["avatar_credit"] == "Beliot419 & co"


@needs_engine
def test_species_credit(services):
    site = Site()
    services.credits._http_get = site
    services.credits._pmd_base = lambda: "https://raw.example/SpriteCollab"
    services.pmd._forms = {"6": {"megax": "0001", "megay": "0002"}}
    r = services.credits_get(species="Charizard-Mega-X")
    assert r["num"] == 6 and r["folder"] == "0006/0001" and r["artists"] == ["Kevin"]
    assert services.credits_get(species="Charizard")["artists"] == ["CHUNSOFT", "Emboarger"]
