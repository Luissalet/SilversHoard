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


# ---------------------------------------------------------------- popular sets for a team (17-10-2026)
from silvers_hoard.smogon import CHAMPIONS, remote_name, set_from_usage  # noqa: E402

CHAMP_SETS = {"Delphox": {"Wallbreaker": {"moves": [["Flamethrower", "Fire Blast"], "Psyshock", ["Dazzling Gleam", "Substitute"],
                                                    ["Nasty Plot", "Substitute"]],
                                          "item": "Delphoxite", "nature": "Timid", "evs": {"hp": 1, "def": 1, "spa": 32, "spe": 32}}}}
PU_SETS = {"Delphox": {"Nasty Plot": {"moves": ["Nasty Plot", "Fire Blast", "Psyshock", "Grass Knot"], "item": "Heavy-Duty Boots",
                                      "nature": "Timid", "evs": {"spa": 252, "spd": 4, "spe": 252}}}}
ZU_STATS = {"battles": 10, "pokemon": {"Glaceon": {"usage": {"weighted": 0.0046}, "items": {"Nothing": 0.2, "Leftovers": 0.6},
                                                   "abilities": {"Ice Body": 0.7}, "moves": {"Freeze-Dry": 0.9, "Wish": 0.8, "Protect": 0.7,
                                                                                            "Calm Mind": 0.6, "Ice Beam": 0.1},
                                                   "spreads": {"Bold:252/0/252/0/4/0": 0.3, "Calm:252/0/0/0/252/4": 0.2},
                                                   "teraTypes": {"Water": 0.4}}}}
NU_STATS = {"battles": 10, "pokemon": {"Glaceon": {"usage": {"weighted": 0.0009}, "moves": {"Tackle": 1}}}}
CHAMP_STATS = {"battles": 10, "pokemon": {"Delphox": {"usage": {"weighted": 0.02}, "abilities": {"Blaze": 0.6, "Magician": 0.4}},
                                          # used more there, but Champions only counts when the generation has no usage at all
                                          "Glaceon": {"usage": {"weighted": 0.03}, "moves": {"Ice Beam": 1}, "items": {"Focus Sash": 1}}}}


class TeamSite(FakeSite):
    FILES = {"sets/championsou.json": CHAMP_SETS, "sets/gen9pu.json": PU_SETS, "stats/gen9zu.json": ZU_STATS,
             "stats/gen9nu.json": NU_STATS, "stats/gen9championsou.json": CHAMP_STATS}

    def __call__(self, url):
        self.calls.append(url)
        tail = url.split("data.pkmn.cc/")[1]
        if tail in self.FILES:
            return 200, json.dumps(self.FILES[tail]).encode(), "application/json"
        return super().__call__(url) if tail in ("sets/gen9ou.json", "stats/gen9ou.json") else (404, b"", "text/plain")


def test_champions_files_and_points():
    assert remote_name("stats", "championsou") == "gen9championsou" and remote_name("sets", "championsou") == "championsou"
    assert remote_name("stats", "gen9ou") == "gen9ou"
    assert "championsou" in CHAMPIONS
    s = norm_set("x", {"moves": ["Tackle"], "evs": {"spa": 32, "spe": 2, "hp": 1}}, points=True)
    assert s["evs"] == {"spa": 252, "spe": 12, "hp": 4}


def test_a_mega_gets_the_set_that_holds_its_stone(tmp_path):
    sm = Smogon(tmp_path / "s", TeamSite())
    found = sm.popular_set("Delphox-Mega", "gen9nationaldexag", base="Delphox", item="Delphoxite")
    assert found["format"] == "championsou" and found["source"] == "smogon"   # the PU set holds Heavy-Duty Boots: skipped
    s = found["set"]
    assert s["item"] == "Delphoxite" and s["moves"] == ["Flamethrower", "Psyshock", "Dazzling Gleam", "Nasty Plot"]
    assert s["evs"] == {"hp": 4, "def": 4, "spa": 252, "spe": 252} and s["ability"] == "Blaze"
    plain = sm.popular_set("Delphox", "gen9nationaldexag")
    assert plain["format"] == "gen9pu" and plain["set"]["item"] == "Heavy-Duty Boots"


def test_without_a_written_set_the_most_used_build_of_the_format_where_it_is_used_most(tmp_path):
    sm = Smogon(tmp_path / "s", TeamSite())
    found = sm.popular_set("Glaceon", "gen9nationaldexag")
    assert found["source"] == "usage" and found["format"] == "gen9zu"      # 0.46 % in ZU beats 0.09 % in NU
    s = found["set"]
    assert s["moves"] == ["Freeze-Dry", "Wish", "Protect", "Calm Mind"] and s["item"] == "Leftovers" and s["ability"] == "Ice Body"
    assert s["nature"] == "Bold" and s["evs"] == {"hp": 252, "def": 252, "spd": 4} and s["teraType"] == "Water"
    assert sm.popular_set("Missingno", "gen9ou") is None


def test_set_from_usage_handles_thin_data():
    s = set_from_usage({"usage": 0.1, "moves": [["Nothing", 1]], "spreads": [["Serious:x/0", 1]]}, points=True, item="Gracidea")
    assert s["moves"] == [] and s["item"] == "Gracidea" and s["nature"] == "Serious" and s["evs"] == {}


from conftest import needs_engine  # noqa: E402


@needs_engine
def test_a_trainer_gets_a_team_of_popular_sets_from_names_as_written(services):
    services.smogon.fetch = TeamSite()
    t = services.trainer_create(name="Pablo", paste="Pikachu\n- Thunderbolt\n")
    r = services.team_popular_sets(["Mega delphox ", "Glaceon"], trainer_id=t["id"])
    assert r["saved"] and not r["unresolved"]
    assert [m["species"] for m in r["members"]] == ["Delphox-Mega", "Glaceon"]
    assert [m["source"] for m in r["members"]] == ["smogon", "usage"]
    team = services.trainer_get(t["id"])["team"]
    assert [x["species"] for x in team] == ["Delphox", "Glaceon"]           # a Mega is its base species holding the stone
    assert team[0]["item"] == "Delphoxite" and team[0]["evs"]["spa"] == 252 and "Freeze-Dry" in team[1]["moves"]
    assert "Delphoxite" in r["paste"]
    # appending keeps what was there
    more = services.team_popular_sets(["Glaceon"], trainer_id=t["id"], append=True)
    assert more["saved"] and len(services.trainer_get(t["id"])["team"]) == 3


@needs_engine
def test_a_name_that_is_not_a_pokemon_saves_nothing(services):
    services.smogon.fetch = TeamSite()
    t = services.trainer_create(name="Rival", paste="Pikachu\n- Thunderbolt\n")
    r = services.team_popular_sets(["Glaceon", "Glaceonn"], trainer_id=t["id"])
    assert not r["saved"] and r["unresolved"][0]["asked"] == "Glaceonn" and "Glaceon" in r["unresolved"][0]["hint"]
    assert [x["species"] for x in services.trainer_get(t["id"])["team"]] == ["Pikachu"]
    with pytest.raises(SilverError):
        services.team_popular_sets([], trainer_id=t["id"])


@needs_engine
def test_names_resolve_through_the_engine_and_sets_popular_takes_them(services):
    assert services.resolve_species("Shaymin Forma Cielo")["name"] == "Shaymin-Sky"
    assert services.resolve_species("Raichu alola")["name"] == "Raichu-Alola"
    mega = services.resolve_species("Mega Delphox")
    assert mega["name"] == "Delphox-Mega" and mega["base_species"] == "Delphox" and mega["required_item"] == "Delphoxite"
    assert services.resolve_species("Charizard Mega X")["required_item"] == "Charizardite X"
    with pytest.raises(SilverError):
        services.resolve_species("Not a pokemon at all")
    services.smogon.fetch = TeamSite()
    r = services.sets_popular("Mega Delphox")
    assert r["species"] == "Delphox-Mega" and r["team_species"] == "Delphox" and r["sets"][0]["item"] == "Delphoxite"
