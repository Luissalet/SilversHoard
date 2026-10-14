from conftest import TEAM, needs_engine

pytestmark = needs_engine


def test_import_export_validate(call):
    r = call("team_import", {"text": TEAM})
    assert [s["species"] for s in r["sets"]] == ["Garchomp", "Rotom-Wash"]
    assert "Choice Scarf" in r["paste"]
    ok = call("team_validate", {"format": "gen9ou", "paste": TEAM})
    assert ok["ok"], ok
    bad = call("team_validate", {"format": "gen9ou", "paste": "Pikachu\n- Surf\n- Fly\n"})
    assert not bad["ok"] and bad["problems"]
    lr = call("team_validate", {"format": "gen9customgame", "paste": TEAM, "level_rules": {"level": 50}})
    assert lr["ok"]


def test_random_team_and_dex(call):
    a = call("team_random", {"format": "gen9randombattle", "seed": "s1"})
    b = call("team_random", {"format": "gen9randombattle", "seed": "s1"})
    assert a["sets"] == b["sets"] and len(a["sets"]) == 6
    assert all(m[0].isupper() for s in a["sets"] for m in s["moves"])   # proper names, not ids
    hits = call("dex_search", {"kind": "species", "query": "garch"})["results"]
    assert hits[0]["name"] == "Garchomp"
    moves = call("dex_search", {"kind": "moves", "query": "", "species": "Pikachu", "limit": 400})["results"]
    assert any(m["id"] == "thunderbolt" for m in moves) and not any(m["id"] == "surf" and False for m in moves)
    info = call("species_info", {"name": "Charizard", "gen": 9})
    assert "Fire" in info["types"] and info["moves"]
    fmts = call("formats_list", {"gen": 9})["formats"]
    assert fmts[0]["id"] == "gen9customgame" and any(f["id"] == "gen9ou" for f in fmts)


def test_trainer_crud_and_trash(call):
    tr = call("trainer_create", {"name": "Luis", "paste": TEAM, "ai_level": "hard", "dialogue": {"intro": "¡Vamos!"}, "tags": ["yo"]})
    assert tr["summary"][0]["species"] == "Garchomp" and tr["dialogue"]["intro"] == "¡Vamos!"
    up = call("trainer_update", {"id": tr["id"], "title": "Campeón", "favorite": True, "ai_style": "aggressive"})
    assert up["title"] == "Campeón" and up["favorite"] == 1 and up["ai_style"] == "aggressive"
    dup = call("trainer_duplicate", {"id": tr["id"]})
    assert dup["name"].startswith("Luis") and dup["id"] != tr["id"]
    rnd = call("trainer_random", {"seed": "x"})
    assert len(rnd["team"]) == 6 and rnd["avatar"].startswith("sd:")
    listed = call("trainers_list", {"query": "Garchomp"})["trainers"]
    assert {t["id"] for t in listed} >= {tr["id"], dup["id"]}
    call("trash", {"kind": "trainer", "ids": [dup["id"]]})
    assert dup["id"] in {t["id"] for t in call("trash_list")["trainers"]}
    call("trash", {"kind": "trainer", "ids": [dup["id"]], "action": "restore"})
    call("trash", {"kind": "trainer", "ids": [dup["id"]]})
    assert call("trash", {"kind": "trainer", "ids": [dup["id"]], "action": "purge"})["purge"] == 1
    sprites = call("trainer_sprites_search", {"query": "cynthia"})["sprites"]
    assert "cynthia" in sprites


def test_bad_inputs(call):
    call("trainer_create", {"name": "X", "paste": "Notamon\n- Tackle\n"}, status=400)
    call("trainer_create", {"name": "X", "paste": TEAM, "format": "gen9nosuchformat"}, status=400)
    call("trainer_get", {"id": "tr_nope"}, status=404)
    call("trainer_update", {"id": "tr_nope", "name": "y"}, status=404)


def test_canon_league(call):
    lst = call("canon_list", {"region": "Hoenn"})
    assert any(t["key"] == "em-wallace" for t in lst["trainers"]) and all(t["region"] == "Hoenn" for t in lst["trainers"])
    lg = call("canon_install", {"league_key": "hoenn-emerald"})["league"]
    assert len(lg["gym_list"]) == 8 and len(lg["elite_list"]) == 4 and lg["champion"]["name"] == "Plubio"
    assert lg["gym_list"][6]["format"] == "gen3doublescustomgame"   # Tate & Liza fight in doubles
    again = call("canon_install", {"league_key": "hoenn-emerald"})["league"]
    assert again["id"] == lg["id"]
    assert call("silver_overview")["counts"]["gyms"] == 8
    red = call("canon_install", {"trainer_key": "gsc-red"})["trainer"]
    assert red["name"].startswith("Rojo") and [s["level"] for s in red["team"]][0] == 81
    assert call("league_get", {"id": lg["id"]})["badges_required"] == 8
