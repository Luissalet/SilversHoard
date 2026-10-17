"""Behaviour regressions for generated mass-battle labels and native export language."""
import json
import re

from conftest import needs_engine

from silvers_hoard import sharing

pytestmark = needs_engine


def battle(call):
    return call("mass_start", {"mode": "ffa", "time_limit": 15, "seed": "locale640", "title": "Own title Tú",
                               "teams": [{"kind": "species", "species": ["Pikachu", "Bulbasaur", "Squirtle"]}]})


def test_default_player_translates_but_a_personal_tu_does_not(call):
    doc = battle(call)
    default = call("mass_play", {"id": doc["id"], "unit": 0, "inputs": []})
    assert default["challenger"] == "You"
    assert default["i18n"]["es"]["challenger"] == "Tú"
    assert default["i18n"]["en"]["challenger"] == "You"
    custom = call("mass_play", {"id": doc["id"], "unit": 1, "inputs": [], "challenger": "Tú"})
    assert custom["challenger"] == "Tú" and not custom.get("i18n")
    stored = call("mass_play_get", {"id": doc["id"], "play_id": default["id"]})
    assert stored["i18n"] == default["i18n"] and stored["inputs"] == []


def test_profile_name_is_kept_even_if_it_is_a_translatable_word(call, services):
    services.settings.update({"player_name": "Amigo"})
    doc = battle(call)
    play = call("mass_play", {"id": doc["id"], "unit": 0, "inputs": []})
    assert play["challenger"] == "Amigo" and not play.get("i18n")


def test_unnamed_friend_gets_a_label_without_using_owners_name(call, services):
    services.settings.update({"player_name": "Owner"})
    doc = battle(call)
    recorded = call("mass_play", {"id": doc["id"], "unit": 0, "inputs": [], "challenger": "Reference"})
    payload = {"kind": "mass", "v": 1, "mass_id": doc["id"], "unit": 0, "inputs": "", "hash": recorded["hash"]}
    result = call("import", {"content": sharing.pack_code(sharing.MASS_RESULT_PREFIX, payload)})
    friend = result["play"]
    assert friend["challenger"] == "Friend"
    assert friend["i18n"]["es"]["challenger"] == "Amigo"
    assert friend["i18n"]["en"]["challenger"] == "Friend"
    payload["challenger"] = "Amigo"
    custom = call("import", {"content": sharing.pack_code(sharing.MASS_RESULT_PREFIX, payload)})["play"]
    assert custom["challenger"] == "Amigo" and not custom.get("i18n")


def test_export_keeps_both_generated_labels_and_personal_names(call, services):
    doc = battle(call)
    call("mass_play", {"id": doc["id"], "unit": 0, "inputs": []})
    call("mass_play", {"id": doc["id"], "unit": 1, "inputs": [], "challenger": "Tú"})
    page = call("mass_export", {"id": doc["id"]})
    html = (services.config.exports_dir / page["file"]).read_text(encoding="utf-8")
    data = json.loads(re.search(r'<script id="silver-data" type="application/json">(.*?)</script>', html, re.S).group(1))
    assert data["mass"]["title"] == "Own title Tú" and not data["mass"].get("i18n")
    by_name = {p["challenger"]: p for p in data["mass"]["plays"]}
    assert by_name["You"]["i18n"]["es"]["challenger"] == "Tú"
    assert not by_name["Tú"].get("i18n")


def test_preset_title_is_translated_in_the_standalone_export(call, services):
    doc = call("mass_start", {"preset": "starters", "seed": "locale640"})
    page = call("mass_export", {"id": doc["id"]})
    html = (services.config.exports_dir / page["file"]).read_text(encoding="utf-8")
    data = json.loads(re.search(r'<script id="silver-data" type="application/json">(.*?)</script>', html, re.S).group(1))
    assert data["mass"]["i18n"]["en"]["title"] == "The 27 starters in a battle royale"
    assert data["mass"]["i18n"]["es"]["title"] == doc["title"]


def test_native_mass_video_defaults_to_english_and_retains_explicit_spanish(call, services, monkeypatch):
    doc = battle(call)
    monkeypatch.setattr(services, "video_status", lambda: {"playwright": True, "browser": True})
    monkeypatch.setattr(services, "_record_video", lambda *args, **kwargs: {"lang": args[3]})
    monkeypatch.setattr(services, "_job", lambda kind, title, args, run: run("qa", lambda value: None, lambda: False))
    assert call("mass_video", {"id": doc["id"]})["lang"] == "en"
    assert call("mass_video", {"id": doc["id"], "lang": "es"})["lang"] == "es"
