"""Teams by pokepast.es link: import (as a trainer, with the title and the format of the notes) and export (the public paste)."""
import json

import pytest

from silvers_hoard.errors import SilverError

from conftest import needs_engine

PASTE = "Garchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang\n"


@needs_engine
def test_import_a_link(services, monkeypatch):
    seen = []

    def fake(url):
        seen.append(url)
        if url == "https://pokepast.es/774751c5dc2c4500/json":
            return 200, json.dumps({"title": "Chomp  ladder", "author": "ceree", "notes": "Format: gen9ou", "paste": PASTE}).encode(), "application/json"
        return 404, b"", "text/plain"
    monkeypatch.setattr(services, "_http_get", fake)
    r = services.import_any("https://pokepast.es/774751C5DC2C4500")
    assert r["kind"] == "trainer" and r["source"] == "https://pokepast.es/774751c5dc2c4500" and r["author"] == "ceree"
    t = r["trainer"]
    assert t["name"] == "Chomp ladder" and t["format"] == "gen9ou" and t["team"][0]["species"] == "Garchomp"
    r2 = services.import_any("pokepast.es/774751c5dc2c4500/json", name="Mío")
    assert r2["trainer"]["name"] == "Mío"
    with pytest.raises(SilverError) as e:
        services.import_pokepaste("https://pokepast.es/0000000000000000")
    assert e.value.code == "not_found"
    with pytest.raises(SilverError):
        services.import_pokepaste("https://example.com/774751c5dc2c4500")


@needs_engine
def test_export_publishes_the_team(services, monkeypatch):
    t = services.trainer_create(name="Luz", paste=PASTE)
    sent = {}

    def fake_post(fields):
        sent.update(fields)
        return "/9f8e7d6c5b4a3210"
    monkeypatch.setattr(services, "_pokepaste_post", fake_post)
    r = services.pokepaste_export(t["id"])
    assert r == {"url": "https://pokepast.es/9f8e7d6c5b4a3210", "name": "Luz"}
    assert sent["title"] == "Luz" and "Garchomp" in sent["paste"] and sent["notes"].startswith("Format: ")
