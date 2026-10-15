from conftest import needs_engine, wait_for

pytestmark = needs_engine


def test_characters_catalog(call):
    lst = call("characters_list", {})
    assert lst["total"] >= 150 and "Bulbapedia" in lst["source"]
    lance = next(c for c in lst["characters"] if c["key"] == "lance")
    assert lance["teams"] >= 10 and lance["sprites"] >= 5 and "hgss" in lance["games"]
    cards = {g["id"]: g for g in lst["games"]}
    assert {"rb", "gsc", "e", "hgss", "b2w2", "sv"} <= set(cards) and cards["e"]["categories"]["leaders"] >= 8 and cards["e"]["faces"]
    emerald = call("characters_list", {"game": "e"})["characters"]
    assert any(c["key"] == "wallace" and "champions" in c["categories"] for c in emerald)
    assert any(c["key"] == "maxie" for c in call("characters_list", {"game": "e", "category": "villains"})["characters"])
    assert {c["key"] for c in call("characters_list", {"game": "rb", "category": "elite"})["characters"]} >= {"lorelei", "bruno", "agatha", "lance"}
    call("characters_list", {"category": "nope"}, status=400)
    assert any(c["key"] == "cynthia" for c in call("characters_list", {"query": "Cintia"})["characters"])   # Spanish names
    gen2 = call("characters_list", {"gen": 2})["characters"]
    assert gen2 and all(2 in c["gens"] for c in gen2)

    c = call("character_get", {"key": "lance"})
    ids = {v["id"] for v in c["variants"]}
    assert {"rgb", "gsc", "frlgrematch", "hgssrematch"} <= ids
    rematch = next(v for v in c["variants"] if v["id"] == "hgssrematch")
    assert rematch["label_es"] == "Oro HeartGold y Plata SoulSilver · Revancha"
    assert rematch["species"][0] == "Salamence" and rematch["sets"][0]["item"] == "Lum Berry" and rematch["max_level"] == 75
    first = next(v for v in c["variants"] if v["id"] == "hgssfirstbattle")
    assert "bag" not in first and "Full Restore" not in first["note"]   # held items only, no potions
    assert {"lance-gen1rb", "lance-gen2", "lance-lgpe"} <= {s["id"] for s in c["sprites"]}
    assert {g["id"] for g in c["games"]} >= {"rb", "hgss", "b2w2"} and rematch["category"] == "champions" and rematch["games"] == ["hgss"]
    assert next(v for v in c["variants"] if v["id"] == "gsc")["sprite"] == "lance-gen2"
    # A tag battle keeps the character's own side.
    clair = next(v for v in c["variants"] if v["id"] == "hgssmultibattlewithclair")
    assert clair["species"] == ["Gyarados", "Charizard", "Dragonite"]
    # Rivals: one team per starter, told apart by the Pokémon only that team has.
    hau = call("character_get", {"key": "hau"})
    assert {"Rowlet", "Litten", "Popplio"} <= {v.get("with") for v in hau["variants"]}


def test_character_install_and_custom(call):
    tr = call("character_install", {"key": "lance", "variant": "gsc", "sprite": "lance-gen1rb"})["trainer"]
    assert tr["avatar"] == "sd:lance-gen1rb" and tr["format"] == "gen2customgame" and tr["origin"] == "canon"
    assert tr["name"] == "Lance (Oro, Plata y Cristal)" and [s["species"] for s in tr["team"]][-1] == "Dragonite"
    assert "Restaurar Todo" not in tr["notes"] and "bolsa" not in tr["notes"]
    again = call("character_install", {"key": "lance", "variant": "gsc", "sprite": "lance-gen1rb"})["trainer"]
    assert again["id"] == tr["id"] and again["existing"]
    own = call("character_install", {"key": "lance", "custom": True, "sprite": "lance-masters"})["trainer"]
    assert own["origin"] == "own" and own["team"] == [] and own["avatar"] == "sd:lance-masters"
    start = call("character_install", {"key": "cynthia", "custom": True})["trainer"]
    assert start["team"] == []
    c = call("character_get", {"key": "lance"})
    assert {t["id"] for t in c["installed"]} >= {tr["id"], own["id"]}
    call("character_install", {"key": "lance", "variant": "nope"}, status=404)
    call("character_install", {"key": "nobody"}, status=404)
    call("character_install", {"key": "lance", "sprite": "not-a-sprite-xyz"}, status=400)


def test_character_teams_battle(call):
    """Two characters from different generations fight in the classic engine with the trainers made from them."""
    a = call("character_install", {"key": "lance", "variant": "hgssrematch"})["trainer"]
    b = call("character_install", {"key": "cynthia"})["trainer"]
    battle = call("battle_start", {"p1": {"trainer_id": a["id"], "human": False}, "p2": {"trainer_id": b["id"], "human": False}, "format": a["format"]})
    done = wait_for(lambda: (lambda x: x if x["status"] == "ended" else None)(call("battle_get", {"id": battle["id"]})))
    assert done["status"] == "ended"


def test_equalized_levels(call):
    """The 'equalized' mode: every Pokémon at 50 or 100 whatever its own level, in a battle and in a whole challenge."""
    a = call("character_install", {"key": "lance", "variant": "rgb"})["trainer"]          # levels 56-62
    b = call("character_install", {"key": "brock", "variant": "rgb"})["trainer"]          # levels 12-14
    battle = call("battle_start", {"p1": {"trainer_id": a["id"], "human": True}, "p2": {"trainer_id": b["id"], "human": False}, "level_rules": {"level": 50}})
    got = call("battle_get", {"id": battle["id"]})
    assert got["level_rules"] == {"level": 50}
    side = got["requests"]["p1"]["side"]["pokemon"]
    assert side and all(", L50" in p["details"] for p in side)
    gym = call("gym_save", {"name": "Gimnasio Igualado", "type": "Rock", "badge": "Medalla", "leader_id": b["id"], "format": "gen1customgame"})
    run = call("challenge_start", {"kind": "gym", "target_id": gym["id"], "challenger_id": a["id"], "level": 100})
    first = call("battle_get", {"id": run["stages"][0]["battle_id"]})
    assert first["level_rules"] == {"level": 100}
    call("challenge_abandon", {"id": run["id"]})
    call("challenge_start", {"kind": "gym", "target_id": gym["id"], "challenger_id": a["id"], "level": 101}, status=400)
    assert call("settings_set", {"default_level": 50})["default_level"] == 50
    call("settings_set", {"default_level": 70}, status=400)


def test_character_names_fit(call):
    """Long game and battle names still give a trainer name of at most 60 characters with balanced brackets."""
    for key, variant in (("cynthia", ""), ("lance", "b2w2pokmonworldtournamentchallengethecha"), ("hau", "")):
        name = call("character_install", {"key": key, "variant": variant})["trainer"]["name"]
        assert len(name) <= 60 and name.count("(") == name.count(")"), name


def test_battle_facilities_and_villains(call):
    """Frontier Brains and battle facility pools, villains' admins: each in its game's section."""
    brains = {c["key"] for c in call("characters_list", {"game": "e", "category": "facilities"})["characters"]}
    assert {"anabel", "brandon", "tucker", "lucy", "spenser", "greta"} <= brains
    assert {"archer", "ariana", "proton", "petrel"} <= {c["key"] for c in call("characters_list", {"game": "hgss", "category": "villains"})["characters"]}
    red = call("character_get", {"key": "red"})
    tree = next(v for v in red["variants"] if v["category"] == "facilities" and v.get("pool"))
    assert tree["pool"] > 6 and any(s.get("evs") for s in tree["sets"])
    tr = call("character_install", {"key": "red", "variant": tree["id"]})["trainer"]
    assert len(tr["team"]) == 6 and "Grupo de" in tr["notes"]
    assert call("character_get", {"key": "matt"})["name_es"] == "Matías"
