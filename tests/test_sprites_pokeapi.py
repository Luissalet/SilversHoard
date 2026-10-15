"""The 3D sprite sets of the latest games (PokeAPI's collection): Showdown sprite ids mapped to PokeAPI ids, cached, and the gen 5
pixel art standing in when a forme has no picture there."""

import json


def test_pokeapi_sets_map_formes_and_fall_back(tmp_path):
    from silvers_hoard.sprites import Sprites

    webp = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 24
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
    listing = {"results": [{"name": "charizard", "url": "https://pokeapi.co/api/v2/pokemon/6/"},
                           {"name": "charizard-mega-x", "url": "https://pokeapi.co/api/v2/pokemon/10034/"},
                           {"name": "deoxys-normal", "url": "https://pokeapi.co/api/v2/pokemon/386/"},
                           {"name": "deoxys-attack", "url": "https://pokeapi.co/api/v2/pokemon/10001/"}]}
    seen = []

    def http(url):
        seen.append(url)
        if url.startswith("https://pokeapi.co/"):
            return 200, json.dumps(listing).encode(), "application/json"
        if url.endswith("/champions/6.webp") or url.endswith("/legends-za/back/386.webp"):
            return 200, webp, "image/webp"
        if url.endswith("/gen5/charizard-megax.png"):
            return 200, png, "image/png"
        return 404, b"", "text/plain"

    s = Sprites(tmp_path / "sprites", tmp_path / "avatars", {"sprite_downloads": True, "sprite_server": "https://play.example/sprites"}, http)
    assert s.pokeapi_id("charizard") == 6 and s.pokeapi_id("charizard-megax") == 10034 and s.pokeapi_id("deoxys") == 386
    assert s.pokeapi_id("deoxys-attack") == 10001 and s.pokeapi_id("missingno-x") == 0
    assert s.pokemon("charizard", set_="champions").name == "6.webp"
    assert s.pokemon("deoxys", set_="za", back=True).name == "386.webp"
    # no Champions picture for the Mega: the gen 5 pixel art
    assert s.pokemon("charizard-megax", set_="champions").name == "charizard-megax.png"
    n = len(seen)
    assert s.pokemon("charizard", set_="champions").name == "6.webp" and len(seen) == n, "cached after the first time"
    assert s.stats()["cached"] >= 2
