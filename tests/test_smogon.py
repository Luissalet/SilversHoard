"""Popular sets and usage statistics from data.pkmn.cc, against a fake site: format fallbacks, set options, trimmed usage, the
cache (one download per file a week), a format the site lacks, offline use, the setting that turns it off and the sample team."""
import json
import time

import pytest

from silvers_hoard.errors import SilverError
from silvers_hoard.smogon import Smogon, candidates, norm_set

SETS = {
    "Great Tusk": {"Offensive Utility": {"moves": ["Headlong Rush", "Ice Spinner", "Rapid Spin", ["Close Combat", "Knock Off"]],
                                         "item": ["Heavy-Duty Boots", "Booster Energy"], "nature": "Jolly",
                                         "evs": {"atk": 252, "def": 4, "spe": 252}, "teratypes": ["Steel", "Ice"]}},
    "Kingambit": {"Swords Dance": {"moves": ["Swords Dance", "Kowtow Cleave", "Sucker Punch", "Iron Head"], "item": "Leftovers",
                                   "ability": "Supreme Overlord", "nature": "Adamant", "evs": {"hp": 252, "atk": 252, "spd": 4}}},
}
STATS = {"battles": 1000, "pokemon": {
    "Great Tusk": {"usage": {"weighted": 0.33}, "items": {"Rocky Helmet": 0.26, "Heavy-Duty Boots": 0.25}, "abilities": {"Protosynthesis": 1},
                   "moves": {"Headlong Rush": 0.9, "Rapid Spin": 0.8}, "teammates": {"Kingambit": 0.3}, "spreads": {}, "teraTypes": {"Steel": 0.29},
                   "counters": {"x": [1, 2, 3]}},
    "Kingambit": {"usage": {"weighted": 0.4}, "items": {"Leftovers": 0.5}, "abilities": {"Supreme Overlord": 1}, "moves": {}, "teammates": {}},
    "Pikachu": {"usage": {"weighted": 0.01}},
}}


class FakeSite:
    def __init__(self):
        self.calls = []
        self.down = False

    def __call__(self, url):
        self.calls.append(url)
        if self.down:
            raise OSError("offline")
        tail = url.split("data.pkmn.cc/")[1]
        if tail == "sets/gen9ou.json":
            return 200, json.dumps(SETS).encode(), "application/json"
        if tail == "stats/gen9ou.json":
            return 200, json.dumps(STATS).encode(), "application/json"
        return 404, b"", "text/plain"


@pytest.fixture
def site(tmp_path):
    fake = FakeSite()
    return fake, Smogon(tmp_path / "smogon", fake)


def test_candidates():
    assert candidates("gen9nationaldexag")[:3] == ["gen9nationaldexag", "gen9nationaldex", "gen9ou"]
    assert "gen9nationaldexubers" in candidates("gen9nationaldexag") and "gen9pu" in candidates("gen9nationaldexag")
    assert candidates("gen9customgame")[:2] == ["gen9ou", "gen9ubers"]
    assert candidates("gen9doublescustomgame")[:2] == ["gen9doublesou", "gen9ou"]
    # only letters and digits reach the URL and the cache file name
    assert all(c.isalnum() for c in candidates("gen9ou/../../x")) and candidates("gen9ou/../../x")[0] == "gen9oux"
    assert candidates("")[0] == "gen9ou"
    assert candidates("gen4ou")[0] == "gen4ou" and "gen4uu" in candidates("gen4ou")


def test_sets_with_options_and_trimmed_usage(site):
    fake, sm = site
    r = sm.sets("great tusk", "gen9customgame")
    assert r["format"] == "gen9ou" and r["usage_format"] == "gen9ou"
    s = r["sets"][0]
    assert s["moves"] == ["Headlong Rush", "Ice Spinner", "Rapid Spin", "Close Combat"]
    assert s["move_options"][3] == ["Close Combat", "Knock Off"]
    assert s["ability"] == "Protosynthesis"      # not named by the set: the most used one
    assert s["item"] == "Heavy-Duty Boots" and s["teraType"] == "Steel" and s["evs"] == {"atk": 252, "def": 4, "spe": 252}
    assert r["usage"]["usage"] == 0.33 and r["usage"]["items"][0] == ["Rocky Helmet", 0.26] and "counters" not in r["usage"]
    assert norm_set("x", {"moves": ["Tackle"]})["ability"] == ""


def test_cache_missing_formats_and_offline(site, tmp_path):
    fake, sm = site
    sm.sets("Kingambit", "gen9nationaldexag")       # natdexag and natdex are missing, ou has it
    first = len(fake.calls)
    assert any("gen9nationaldexag" in c for c in fake.calls) and any("gen9nationaldex.json" in c for c in fake.calls)
    fresh = Smogon(tmp_path / "smogon", fake)        # a new process reads the cache, missing formats included
    fresh.sets("Kingambit", "gen9nationaldexag")
    assert len(fake.calls) == first
    # a week later the site is down: the old copy is used
    for f in (tmp_path / "smogon").glob("*.json"):
        old = time.time() - 8 * 24 * 3600
        import os
        os.utime(f, (old, old))
    fake.down = True
    later = Smogon(tmp_path / "smogon", fake)
    assert later.sets("Kingambit", "gen9ou")["sets"][0]["ability"] == "Supreme Overlord"


def test_switched_off_and_unknown(tmp_path):
    fake = FakeSite()
    off = Smogon(tmp_path / "s2", fake, enabled=lambda: False)
    r = off.sets("Kingambit", "gen9ou")
    assert r["sets"] == [] and r["usage"] is None and fake.calls == []
    with pytest.raises(SilverError):
        off.sets(" ", "gen9ou")


def test_top_and_sample_team(site):
    fake, sm = site
    top = sm.top("gen9ou", 2)
    assert [x["species"] for x in top["species"]] == ["Kingambit", "Great Tusk"]
    team = sm.sample_team("gen9ou")["team"]
    assert [m["species"] for m in team] == ["Kingambit", "Great Tusk"]      # Pikachu has no set
    assert team[0]["moves"][0] == "Swords Dance" and team[0]["set_name"] == "Swords Dance"


def test_through_the_app(services, monkeypatch):
    fake = FakeSite()
    services.smogon.fetch = fake
    r = services.sets_popular("Great Tusk", "gen9customgame")
    assert r["sets"] and r["format"] == "gen9ou"
    assert services.sample_team("gen9ou")["team"]
    services.settings_set({"smogon_data": False})
    services.smogon._mem.clear()
    assert services.smogon.enabled() is False
