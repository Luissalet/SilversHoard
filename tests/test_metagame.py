"""Corpus provenance, actual team-builder normalization and cancellation before simulation."""

from types import SimpleNamespace

import pytest

from silvers_hoard.errors import SilverError
from silvers_hoard.metagame import collect_corpus


def test_corpus_freezes_team_builder_sets_and_source_formats():
    calls = []
    popular = {"name": "Offensive Mega", "moves": ["Flamethrower"], "item": "Charizardite Y", "level": 50}
    def sets(species, fmt):
        calls.append((species, fmt))
        return {"species": species, "team_species": "Charizard", "format": "gen9nationaldex",
                "usage_format": "gen9ou", "sets": [popular] if species != "Missing" else []}
    top = {"format": "gen9ou", "battles": 123, "species": [
        {"species": "Charizard-Mega-Y", "usage": 0.4}, {"species": "Missing", "usage": 0.2}]}
    svc = SimpleNamespace(smogon=SimpleNamespace(top=lambda fmt, limit: top), sets_popular=sets)
    progress = []
    corpus = collect_corpus(svc, "gen9customgame", progress.append, lambda: False)
    assert calls == [("Charizard-Mega-Y", "gen9customgame"), ("Missing", "gen9customgame")]
    assert corpus["entries"][0]["sets"] == [{"species": "Charizard", "name": "", "moves": ["Flamethrower"],
                                            "item": "Charizardite Y", "level": 50}]
    assert corpus["entries"][0]["source_formats"] == ["gen9nationaldex", "gen9ou"]
    assert corpus["missing_sets"] == ["Missing"] and corpus["battles"] == 123
    assert corpus["format_requested"] == "gen9customgame" and corpus["usage_format"] == "gen9ou"
    assert progress == [0.5, 1]
    assert popular["name"] == "Offensive Mega"
    same = collect_corpus(svc, "gen9customgame", lambda p: None, lambda: False)
    assert same["sha256"] == corpus["sha256"] and len(corpus["sha256"]) == 64
    popular["moves"] = ["Fire Blast"]
    assert corpus["entries"][0]["sets"][0]["moves"] == ["Flamethrower"]
    assert collect_corpus(svc, "gen9customgame", lambda p: None, lambda: False)["sha256"] != corpus["sha256"]


def test_corpus_cancelled_before_fetch():
    with pytest.raises(SilverError) as error:
        collect_corpus(None, "gen9ou", lambda p: None, lambda: True)
    assert error.value.code == "cancelled"


def test_corpus_cancelled_between_species():
    seen = []
    def sets(species, fmt):
        seen.append(species)
        return {"sets": []}
    top = {"format": "gen1ou", "battles": 1, "species": [{"species": s, "usage": 1} for s in ["Pikachu", "Raichu"]]}
    svc = SimpleNamespace(smogon=SimpleNamespace(top=lambda fmt, limit: top), sets_popular=sets)
    with pytest.raises(SilverError) as error:
        collect_corpus(svc, "gen1ou", lambda p: None, lambda: bool(seen))
    assert error.value.code == "cancelled" and seen == ["Pikachu"]
