"""HeartGold and SoulSilver cartridge data: the exact sets over the characters' teams, the AI the flags mean, the trainers' lines, and
the gyms with their trainers and maps (silvers_hoard/hgss_rom.py, presets/hgss_rom.json.gz)."""

import gzip
import json
from pathlib import Path

import pytest
from conftest import TEAM, needs_engine

from silvers_hoard import gymmap, hgss_rom, names_i18n
from silvers_hoard.errors import SilverError

ROOT = Path(__file__).resolve().parent.parent
LINE_KEYS = {"intro", "after", "lose", "win", "last", "last_low"}


def _characters():
    """The characters as Services loads them, before the cartridge data goes over them."""
    data = json.loads(gzip.decompress((ROOT / "silvers_hoard" / "presets" / "characters.json.gz").read_bytes()).decode("utf-8"))
    data["by_key"] = {c["key"]: c for c in data["characters"]}
    return data


def _variant(chars, key, vid):
    return next(v for v in chars["by_key"][key]["variants"] if v["id"] == vid)


# ------------------------------------------------------------------------------------------------------------------ the AI
def test_the_ai_flags_become_a_level_and_a_style():
    want = {0: ("random", "balanced"), 1: ("easy", "balanced"), 3: ("normal", "balanced"), 5: ("hard", "balanced"), 7: ("hard", "balanced"),
            15: ("hard", "setup"), 33: ("normal", "aggressive"), 35: ("normal", "aggressive"), 69: ("hard", "setup"), 257: ("easy", "defensive"),
            513: ("easy", "balanced"), 519: ("hard", "balanced"), 1025: ("easy", "stall"), 8: ("random", "setup")}
    for flags, (level, style) in want.items():
        got = hgss_rom.ai_for(flags)
        assert (got["level"], got["style"]) == (level, style), flags
    assert hgss_rom.ai_for(7)["scripts"] == ["basic", "evaluate attack", "expert"]
    assert hgss_rom.ai_for(0)["scripts"] == [] and hgss_rom.ai_for(None)["level"] == "random"
    # the app never gives the expert, master or neural AI by itself: those stay the player's choice
    assert {hgss_rom.ai_for(f)["level"] for f in range(0, 2048)} <= {"random", "easy", "normal", "hard"}


# --------------------------------------------------------------------------------------------------------------- the data
def test_the_preset_is_small_and_names_its_source():
    assert (hgss_rom.PRESET.stat().st_size) < 80_000
    d = hgss_rom.data()
    assert "pret/pokeheartgold" in d["source"] and d["schema"] == 1
    assert len(d["variants"]) == 79 and len(d["gyms"]) == 16 and len(d["trainers"]) == 60
    assert [c["key"] for c in d["characters"]] == ["naoko", "sayo", "zuki", "kuni", "miki", "elderli"]


def test_the_cartridge_sets_go_over_bulbapedia_s():
    chars = _characters()
    before = _variant(chars, "whitney", "hgssgymbattle")
    assert before["sets"][1]["species"] == "Miltank"
    hgss_rom.merge(chars)
    v = _variant(chars, "whitney", "hgssgymbattle")
    clefairy, miltank = v["sets"]
    assert v["cartridge"] is True and v["rom"] == 30 and v["ai"] == hgss_rom.ai_for(v["ai_flags"])
    assert miltank["species"] == "Miltank" and miltank["level"] == 19 and miltank["item"] == "Lum Berry" and miltank["nature"] == "Calm"
    assert miltank["moves"] == ["Rollout", "Attract", "Stomp", "Milk Drink"]
    assert miltank["ivs"] == {s: 12 for s in ("hp", "atk", "def", "spa", "spd", "spe")}   # the game rolls one IV for all six stats
    assert clefairy["moves"] == ["Double Slap", "Mimic", "Encore", "Metronome"] and clefairy["nature"] == "Modest"
    # a team of another game keeps Bulbapedia's sets and carries no mark
    assert "cartridge" not in _variant(chars, "whitney", "gsc")
    # every team the preset knows is marked, with the species and levels the characters already had
    for key, e in hgss_rom.data()["variants"].items():
        ck, vid = key.split(":", 1)
        v = _variant(chars, ck, vid)
        assert v["cartridge"] and v["rom"] == e["rom"] and v["ai_flags"] == e["flags"] and len(v["sets"]) == len(e["sets"]), key
    assert "pret/pokeheartgold" in chars["source"]
    # the preset itself is not changed by what happens to the characters
    v["sets"][0]["level"] = 99
    assert hgss_rom.data()["variants"]["whitney:hgssgymbattle"]["sets"][0]["level"] == 17


def test_cartridge_trainers_without_a_character_become_characters():
    chars = _characters()
    assert "naoko" not in chars["by_key"] and "eusine" in chars["by_key"]
    hgss_rom.merge(chars)
    hgss_rom.merge(chars)   # twice changes nothing
    for key in ("naoko", "sayo", "zuki", "kuni", "miki", "elderli"):
        c = chars["by_key"][key]
        assert len(c["variants"]) == 1 and c["variants"][0]["cartridge"] and c["variants"][0]["games"] == ["hgss"], key
        assert c["variants"][0]["sprite"] in {s["id"] for s in c["sprites"]}, key
        assert c["name_es"] and c["variants"][0]["trainer_class_es"], key
    assert sum(1 for c in chars["characters"] if c["key"] == "naoko") == 1
    assert chars["by_key"]["elderli"]["name_es"] == "Anselmo"
    # Eusine was there already (from Bulbapedia): the cartridge's sets go over his team and he gets no second one
    eusine = chars["by_key"]["eusine"]
    assert len(eusine["variants"]) == 1 and eusine["variants"][0]["cartridge"] and eusine["variants"][0]["rom"] == 498
    assert [s["species"] for s in eusine["variants"][0]["sets"]] == ["Drowzee", "Haunter", "Electrode"] and eusine["variants"][0]["sets"][0]["nature"]


# ------------------------------------------------------------------------------------------------------------------ lines
def test_the_lines_come_in_castellano_and_english_under_silver_s_keys():
    es, en = hgss_rom.lines(30, "es"), hgss_rom.lines(30, "en")      # Whitney
    assert es["last_low"] == "¡Ay, pobre de mí!" and en["last_low"] == "Poor me!"
    assert es["lose"] == "Ugh..." and "last" in es and "last" in en
    falkner_first = hgss_rom.gym_trainer_indexes(hgss_rom.gym("falkner"))[0]
    assert hgss_rom.lines(falkner_first, "es")["intro"].startswith("¡No me creo lo alto que es esto!")
    assert hgss_rom.lines(falkner_first, "en")["after"].startswith("Even though you")
    assert hgss_rom.lines(498, "es")["win"].startswith("¡Muy bien!")      # Eusine
    assert hgss_rom.lines(999999, "es") == {}
    seen = set()
    for idx, both in hgss_rom.data()["lines"].items():
        for lang, lines in both.items():
            assert lang in ("es", "en") and lines and set(lines) <= LINE_KEYS, idx
            assert all(0 < len(x) <= 280 for x in lines.values()), idx
            seen |= set(lines)
    assert seen == LINE_KEYS   # all six are there: last_low and after are the new ones
    # a double battle's partners speak in one line each, named
    amy = hgss_rom.lines(10, "es")
    assert "Amy:" in amy["intro"] and "May:" in amy["intro"]
    assert hgss_rom.trainer_row(hgss_rom.gym_trainer_indexes(hgss_rom.gym("bugsy"))[0])["name"]


def test_a_gym_trainer_row_has_the_class_name_team_ai_and_lines():
    idx = hgss_rom.gym_trainer_indexes(hgss_rom.gym("falkner"))[0]
    row = hgss_rom.trainer_row(idx, "es")
    assert row["name"] == "Ornitólogo Abe" and row["sprite"].startswith("birdkeeper")
    assert row["team"][0]["species"] == "Spearow" and row["team"][0]["nature"] == "Hardy" and row["team"][0]["ivs"]["hp"] == 3
    assert (row["ai_level"], row["ai_style"]) == ("easy", "balanced") and row["ai_scripts"] == ["basic"]
    assert row["dialogue"]["intro"].startswith("¡No me creo") and row["flags"] == 1
    assert hgss_rom.trainer_row(idx, "en")["dialogue"]["lose"] == "This can’t be true!"
    with pytest.raises(SilverError):
        hgss_rom.trainer_row(1)   # not a gym trainer of the data


# ------------------------------------------------------------------------------------------------------------------- maps
def test_every_gym_has_a_map_that_passes_the_checks():
    gyms = hgss_rom.data()["gyms"]
    assert {g["leader"] for g in gyms} == {"falkner", "bugsy", "whitney", "morty", "chuck", "jasmine", "pryce", "clair", "brock", "misty", "ltsurge",
                                           "erika", "janine", "sabrina", "blaine", "blue"}
    for g in gyms:
        indexes = hgss_rom.gym_trainer_indexes(g)
        ids = {i: f"trainer-{i}" for i in indexes}
        m = hgss_rom.gym_map(g["leader"], ids)
        assert 7 <= m["w"] <= 32 and 7 <= m["h"] <= 24 and len(m["tiles"]) == m["w"] * m["h"], g["leader"]
        assert sorted(p["id"] for p in m["trainers"]) == sorted(ids.values()), g["leader"]
        gymmap.clean(m, list(ids.values()))   # it still passes when it comes back in
        spots = {(p["x"], p["y"]) for p in m["trainers"]} | {(m["leader"]["x"], m["leader"]["y"])}
        assert len(spots) == len(indexes) + 1, g["leader"]      # nobody on somebody else's tile
        assert all(m["tiles"][y * m["w"] + x] in gymmap.WALKABLE for x, y in spots), g["leader"]
        assert all(p["facing"] in gymmap.FACING and 1 <= p["sight"] <= 6 for p in m["trainers"]), g["leader"]


def test_the_maps_keep_what_the_game_has():
    for_ids = lambda k: {i: f"t{i}" for i in hgss_rom.gym_trainer_indexes(hgss_rom.gym(k))}   # noqa: E731
    jasmine = hgss_rom.gym_map("jasmine", for_ids("jasmine"))
    assert jasmine["trainers"] == [] and jasmine["leader"]["facing"] in gymmap.FACING     # she stands alone
    mahogany = hgss_rom.gym_map("pryce", for_ids("pryce"))
    assert "_" in mahogany["tiles"] and len(mahogany["trainers"]) == 5                    # the ice of Mahogany Town's gym
    bugsy = hgss_rom.gym_map("bugsy", for_ids("bugsy"))
    assert len(bugsy["trainers"]) == 4 and bugsy["h"] > bugsy["w"]                       # two rooms, one above the other
    assert hgss_rom.gym("blaine")["quiz"] is True and not hgss_rom.gym("falkner").get("quiz")
    with pytest.raises(SilverError):
        hgss_rom.gym_map("lance", {})
    with pytest.raises(SilverError):
        hgss_rom.gym_map("falkner", {})   # the trainers' ids are needed


def test_the_data_an_agent_reads():
    info = hgss_rom.info("whitney")
    assert [g["leader"] for g in info["gyms"]] == ["whitney"] and "pret/pokeheartgold" in info["source"]
    assert len(info["gyms"][0]["rooms"][0]["trainers"]) == 4 and info["teams"] == 79 and info["ai_bits"][2] == {"bit": 2, "script": "expert"}
    one = hgss_rom.info(index=30)["trainer"]
    assert one["sets"][1]["item"] == "Lum Berry" and one["ai"] == hgss_rom.ai_for(one["ai_flags"])
    assert one["lines"]["en"]["last_low"] == "Poor me!"
    with pytest.raises(SilverError):
        hgss_rom.info(index=799)
    assert len(hgss_rom.info()["gyms"]) == 16


# ------------------------------------------------------------------------------------------------------ in the app (engine)
@needs_engine
def test_the_characters_carry_the_cartridge_data(call):
    c = call("character_get", {"key": "whitney"})
    v = next(x for x in c["variants"] if x["id"] == "hgssgymbattle")
    miltank = v["sets"][1]
    assert v["cartridge"] and v["rom"] == 30 and miltank["item"] == "Lum Berry" and miltank["nature"] == "Calm" and miltank["ivs"]["spe"] == 12
    assert miltank["moves"] == ["Rollout", "Attract", "Stomp", "Milk Drink"] and v["species"] == ["Clefairy", "Miltank"]
    assert not next(x for x in c["variants"] if x["id"] == "gsc").get("cartridge")
    assert "pret/pokeheartgold" in call("characters_list", {})["source"]
    # the cartridge trainers that were nobody's character
    eusine = call("character_get", {"key": "eusine"})
    assert eusine["variants"][0]["species"] == ["Drowzee", "Haunter", "Electrode"] and eusine["variants"][0]["cartridge"] and len(eusine["variants"]) == 1
    kimono = [c["key"] for c in call("characters_list", {"game": "hgss", "category": "others"})["characters"]]
    assert {"naoko", "sayo", "zuki", "kuni", "miki", "eusine", "elderli"} <= set(kimono)
    assert call("character_get", {"key": "naoko"})["variants"][0]["trainer_class_es"] == "Chica Kimono"
    li = call("character_install", {"key": "elderli"})["trainer"]
    assert li["team"] and li["avatar"] == "sd:li" and li["dialogue"]


@needs_engine
def test_a_cartridge_team_installs_with_its_ai_its_lines_and_its_mark(call):
    falkner = call("character_install", {"key": "falkner", "variant": "hgssgymbattle"})["trainer"]
    assert (falkner["ai_level"], falkner["ai_style"]) == ("normal", "balanced")         # flags 3: basic and evaluate attack
    assert falkner["dialogue"] and "pret/pokeheartgold" in falkner["notes"] and "Bulbapedia" not in falkner["notes"]
    silver = call("character_install", {"key": "silver", "variant": "hgssfirstbattlechikorita"})["trainer"]
    assert (silver["ai_level"], silver["ai_style"]) == ("easy", "balanced")              # flags 1: basic only
    whitney = call("character_install", {"key": "whitney", "variant": "hgssgymbattle", "lang": "es"})["trainer"]
    assert whitney["dialogue"]["last_low"] == "¡Ay, pobre de mí!" and whitney["dialogue"]["lose"] == "Ugh..."
    assert whitney["team"][1]["item"] == "Lum Berry" and whitney["team"][1]["ivs"]["hp"] == 12
    # the player's own choice wins over the cartridge's; English lines come with lang en
    own = call("character_install", {"key": "whitney", "variant": "hgssgymbattle", "name": "Whitney (English)", "lang": "en", "ai_level": "master", "ai_style": "stall"})["trainer"]
    assert (own["ai_level"], own["ai_style"]) == ("master", "stall") and own["dialogue"]["last_low"] == "Poor me!"
    # a team that is not from the cartridge is as it always was
    old = call("character_install", {"key": "whitney", "variant": "gsc"})["trainer"]
    assert (old["ai_level"], old["ai_style"]) == ("hard", "balanced") and old["dialogue"] == {} and "Bulbapedia" in old["notes"]
    again = call("character_install", {"key": "whitney", "variant": "hgssgymbattle"})["trainer"]
    assert again["id"] == whitney["id"] and again["existing"]


@needs_engine
def test_a_trainer_made_before_the_cartridge_data_is_brought_up_to_date(call, services):
    t = call("character_install", {"key": "whitney", "variant": "hgssgymbattle"})["trainer"]
    # as an earlier version made it: Bulbapedia's team, the default AI, no lines, and never touched since
    old_team = [{"species": "Clefairy", "level": 17, "moves": ["Double Slap"]}, {"species": "Miltank", "level": 19, "moves": ["Stomp"]}]
    services.store.db.execute("UPDATE trainers SET team_json = ?, ai_level = 'hard', ai_style = 'balanced', dialogue_json = '{}', notes = ?, updated_at = created_at WHERE id = ?",
                              (json.dumps(old_team), "Equipo de Bulbapedia (CC BY-NC-SA); sprite de Pokémon Showdown.", t["id"]))
    again = call("character_install", {"key": "whitney", "variant": "hgssgymbattle"})["trainer"]
    assert again["id"] == t["id"] and again["team"][1]["moves"] == ["Rollout", "Attract", "Stomp", "Milk Drink"] and again["dialogue"]["last_low"]
    assert "pret/pokeheartgold" in again["notes"]
    # one the player changed since is theirs: it stays as it is
    services.store.update_trainer(t["id"], {"team": old_team})
    services.store.db.execute("UPDATE trainers SET notes = ?, updated_at = created_at + 600 WHERE id = ?", ("Mi Whitney", t["id"]))
    kept = call("character_install", {"key": "whitney", "variant": "hgssgymbattle"})["trainer"]
    assert kept["team"][1]["moves"] == ["Stomp"] and kept["notes"] == "Mi Whitney"


@needs_engine
def test_the_hgss_leagues_come_with_their_gym_trainers_and_maps(call, services):
    listed = {lg["key"]: lg for lg in call("canon_list", {})["leagues"]}
    assert "kanto-hgss" in listed and len(listed["kanto-hgss"]["gyms"]) == 8 and listed["kanto-hgss"]["gyms"][6]["city_es"] == "Islas Espuma"
    assert listed["kanto-hgss"]["gyms"][7]["leader"] == "char:blue"
    for key in ("johto-hgss", "kanto-hgss"):
        lg = call("canon_install", {"league_key": key, "lang": "es"})["league"]
        assert len(lg["gyms"]) == 8 and lg["badges_required"] == 8 and len(lg["elite_four"]) == 4 and lg["champion_id"], key
    gyms = {g["canon_key"]: g for g in services.store.gyms() if g.get("canon_key")}
    assert len(gyms) == 16
    for g in hgss_rom.data()["gyms"]:
        key = ("johto-hgss:" if g["leader"] in ("falkner", "bugsy", "whitney", "morty", "chuck", "jasmine", "pryce", "clair") else "kanto-hgss:") + g["leader"]
        gym = gyms[key]
        want = hgss_rom.gym_trainer_indexes(g)
        trainers = [services.store.trainer(i) for i in gym["trainers"]]
        assert [t["canon_key"] for t in trainers] == [f"rom:hgss:{i}" for i in want], key            # in the order you meet them
        leader = services.store.trainer(gym["leader_id"])
        for t in trainers:
            assert t["origin"] == "canon" and t["format"] == leader["format"] and t["team"] and t["avatar"].startswith("sd:"), key
            assert t["dialogue"] or t["canon_key"] == "rom:hgss:0", t["name"]
            services.check_team(t["team"], t["format"])      # the game's own sets play in the format
        assert gym["map"]["w"] and sorted(p["id"] for p in gym["map"]["trainers"]) == sorted(gym["trainers"]), key
        gymmap.clean(gym["map"], gym["trainers"])
    falkner = gyms["johto-hgss:falkner"]
    first = services.store.trainer(falkner["trainers"][0])
    assert first["name"] == "Ornitólogo Abe" and first["title"].startswith("Ornitólogo") and (first["ai_level"], first["ai_style"]) == ("easy", "balanced")
    assert first["dialogue"]["intro"].startswith("¡No me creo lo alto") and first["team"][0]["nature"] == "Hardy"
    assert len(gyms["johto-hgss:jasmine"]["trainers"]) == 0 and gyms["johto-hgss:jasmine"]["map"]["w"]    # Jasmine waits alone
    assert "_" in gyms["johto-hgss:pryce"]["map"]["tiles"]
    # installing again gives the same league and does not make the trainers twice
    n = len(services.store.trainers())
    call("canon_install", {"league_key": "johto-hgss"})
    assert len(services.store.trainers()) == n


@needs_engine
def test_a_league_installed_before_gets_its_gym_trainers_when_installed_again(call, services):
    call("canon_install", {"league_key": "johto-hgss"})
    gym = services.store.gym_by_canon("johto-hgss:falkner")
    for t in gym["trainers"]:
        services.store.trash_trainers([t])
    services.store.db.execute("UPDATE gyms SET trainers_json = '[]', map_json = '{}' WHERE id = ?", (gym["id"],))
    call("canon_install", {"league_key": "johto-hgss"})
    back = services.store.gym(gym["id"])
    assert len(back["trainers"]) == 2 and back["map"]["w"]
    # a gym the player filled with their own trainers is left alone
    mine = call("trainer_create", {"name": "Mío", "paste": TEAM})
    services.store.update_gym(gym["id"], {"trainers": [mine["id"]], "map": {}})
    call("canon_install", {"league_key": "johto-hgss"})
    assert services.store.gym(gym["id"])["trainers"] == [mine["id"]]


@needs_engine
def test_a_gym_challenge_meets_the_gym_trainers_with_their_lines(call, services):
    call("canon_install", {"league_key": "johto-hgss", "lang": "es"})
    falkner = services.store.gym_by_canon("johto-hgss:falkner")
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})
    r = call("challenge_start", {"kind": "gym", "target_id": falkner["id"], "challenger_id": me["id"]})
    assert r["map"] is True
    walk = call("challenge_get", {"id": r["id"]})
    assert set(walk["people"]) == {*falkner["trainers"], "leader"} and walk["map"]["w"] == falkner["map"]["w"]
    out = call("challenge_next", {"id": r["id"], "stage": falkner["trainers"][0]})
    battle = call("battle_get", {"id": out["current"]["battle_id"]})
    assert battle["p2"]["name"] == "Ornitólogo Abe" and battle["p2"]["dialogue"]["intro"].startswith("¡No me creo lo alto")
    call("battle_forfeit", {"id": battle["id"], "side": "p2"})
    # without walking, the battles come one after another: the gym's trainers, then the leader
    plain = call("challenge_start", {"kind": "gym", "target_id": falkner["id"], "challenger_id": me["id"], "walk_map": False})
    assert plain["map"] is False and [s["trainer_id"] for s in plain["stages"]] == [*falkner["trainers"], falkner["leader_id"]]


@needs_engine
def test_the_new_lines_are_kept_and_written(call, services, monkeypatch):
    t = call("trainer_create", {"name": "Hablador", "paste": TEAM})
    got = call("trainer_update", {"id": t["id"], "dialogue": {"last_low": "¡Aguanta!", "after": "Buen combate.", "intro": "Hola"}})
    assert got["dialogue"] == {"intro": "Hola", "last_low": "¡Aguanta!", "after": "Buen combate."}
    assert call("trainer_get", {"id": t["id"]})["dialogue"]["after"] == "Buen combate."
    asked = {}

    def chat(messages, **kw):
        asked["prompt"] = messages[0]["content"]
        asked["keys"] = set(kw["json"]["properties"])
        return {"ok": True, "json": {"intro": "a", "win": "b", "lose": "c", "last": "d", "last_low": "e", "after": "f", "on_ko": "g",
                                     "on_faint": "h", "on_super": "i", "on_switch": "j"}, "model": "test"}

    monkeypatch.setattr("silvers_hoard.services.family.chat", chat)
    written = services.trainer_write_dialogue(t["id"], personality="tímido")
    assert {"last_low", "after"} <= asked["keys"] and "last_low" in asked["prompt"] and "after" in asked["prompt"]
    assert written["dialogue"]["last_low"] == "e" and written["dialogue"]["after"] == "f"


@needs_engine
def test_the_agent_reads_the_cartridge_data(call, client):
    out = call("hgss_rom_get", {"gym": "whitney"})
    assert [g["leader"] for g in out["gyms"]] == ["whitney"] and out["teams"] == 79 and "pret/pokeheartgold" in out["source"]
    assert call("hgss_rom_get", {"index": 30})["trainer"]["sets"][1]["species"] == "Miltank"
    call("hgss_rom_get", {"index": 799}, status=404)
    tool = next(t for t in client.get("/api/agent/tools").json()["tools"] if t["name"] == "hgss_rom_get")
    assert "HeartGold" in tool["description"] and "Sinónimos" in tool["description"] and len(tool["description"].split("\n")[0]) <= 110
    # the character tools say that the HGSS teams are the cartridge's
    for name in ("character_get", "character_install", "canon_install"):
        text = next(t for t in client.get("/api/agent/tools").json()["tools"] if t["name"] == name)["description"]
        assert "kanto-hgss" in text or "cartridge" in text.lower(), name


def test_a_cartridge_gym_trainer_shows_its_names_in_the_reader_s_language(call, services):
    lg = call("canon_install", {"league_key": "johto-hgss"})["league"]
    gym = services.store.gym(lg["gyms"][0])
    abe = services.store.trainer(gym["trainers"][0])
    assert abe["name"] == "Ornitólogo Abe" and abe["canon_key"] == "rom:hgss:50"
    n = names_i18n.trainer(abe, services)
    assert n["es"] == {"name": "Ornitólogo Abe", "title": "Ornitólogo · Gimnasio de Ciudad Malva"}
    assert n["en"] == {"name": "Bird Keeper Abe", "title": "Bird Keeper · Violet City Gym"}
    # the player renamed it: the name stays theirs, the title still follows the language
    services.store.update_trainer(abe["id"], {"name": "Abe el pajarero"})
    n = names_i18n.trainer(services.store.trainer(abe["id"]), services)
    assert "name" not in n["en"] and n["en"]["title"] == "Bird Keeper · Violet City Gym"
    # a gym of the Kanto league, and a number the cartridge does not have
    kanto = call("canon_install", {"league_key": "kanto-hgss"})["league"]
    blaine = services.store.gym(kanto["gyms"][6])
    first = names_i18n.trainer(services.store.trainer(blaine["trainers"][0]), services)
    assert first["en"]["title"].endswith("· Seafoam Islands Gym") and first["es"]["title"].endswith("· Gimnasio de las Islas Espuma")
    assert names_i18n.trainer({"name": "x", "canon_key": hgss_rom.CANON_PREFIX + "9999", "title": ""}, services) is None


def test_a_league_makes_the_lines_in_the_language_it_is_installed_in(call, services):
    lg = call("canon_install", {"league_key": "johto-hgss", "lang": "en"})["league"]
    gym = services.store.gym(lg["gyms"][0])
    abe = services.store.trainer(gym["trainers"][0])
    assert abe["name"] == "Ornitólogo Abe"   # the names are castellano: names_i18n shows them in the reader's language
    assert "ridiculously high" in abe["dialogue"]["intro"] and "rookie" in abe["dialogue"]["after"]
    falkner = services.store.trainer(gym["leader_id"])
    assert falkner["dialogue"]["last"].startswith("The wind is finally with us") and falkner["name"].startswith("Falkner (")
    # installing again in the other language leaves what is there: the lines are the player's once they exist
    again = call("canon_install", {"league_key": "johto-hgss", "lang": "es"})["league"]
    assert again["id"] == lg["id"] and "ridiculously high" in services.store.trainer(gym["trainers"][0])["dialogue"]["intro"]
