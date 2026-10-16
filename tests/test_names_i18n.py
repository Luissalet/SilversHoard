from conftest import TEAM, needs_engine

from silvers_hoard import names_i18n

pytestmark = needs_engine


def test_a_characters_trainer_in_both_languages_unless_renamed(call, services):
    es = call("character_install", {"key": "giovanni", "variant": "rgbgymbattle", "lang": "es"})["trainer"]
    t = services.store.trainer(es["id"])
    n = names_i18n.trainer(t, services)
    assert n["es"]["name"] == t["name"] and n["es"]["title"] == t["title"]
    assert n["en"]["name"] == "Giovanni (Red and Blue · Gym battle)" and "Rojo" not in n["en"]["title"] and "Red and Blue" in n["en"]["title"]
    assert n["es"]["name"] == "Giovanni (Rojo y Azul · Combate de gimnasio)"
    # the English install makes exactly the English names
    en = call("character_install", {"key": "giovanni", "variant": "rgbgymbattle", "lang": "en", "name": "x"})["trainer"]
    made = names_i18n.char_trainer_name(services, services._character("giovanni"),
                                        next(v for v in services._character("giovanni")["variants"] if v["id"] == "rgbgymbattle"), custom=False, lang="en")
    assert n["en"] == {"name": made[0], "title": made[1]} and en["title"] == made[1]
    # renamed by the user: the name stays theirs, the title (still the app's) keeps both languages
    call("trainer_update", {"id": t["id"], "name": "Mi Giovanni"})
    n2 = names_i18n.trainer(services.store.trainer(t["id"]), services)
    assert "name" not in n2["en"] and n2["en"]["title"] == n["en"]["title"]
    # an older shortened name still counts as the app's
    services.store.update_trainer(t["id"], {"name": "Giovanni (Rojo y Azul · Combate de gimnasio con texto que se c"})
    assert names_i18n.trainer(services.store.trainer(t["id"]), services)["en"]["name"] == n["en"]["name"]


def test_random_and_cartridge_trainers(call, services):
    rnd = call("trainer_random", {"seed": "i18n"})
    n = names_i18n.trainer(services.store.trainer(rnd["id"]), services)
    num = rnd["name"].split()[-1]
    assert n == {"es": {"name": f"Entrenador {num}"}, "en": {"name": f"Trainer {num}"}}
    own = call("trainer_create", {"name": "Luis", "paste": TEAM})
    assert names_i18n.trainer(services.store.trainer(own["id"]), services) is None
    lance = call("canon_install", {"trainer_key": "gsc-lance"})["trainer"]
    n = names_i18n.trainer(services.store.trainer(lance["id"]), services)
    assert n["es"]["title"] == "Campeón · Cristal" and n["en"] == {"name": "Lance", "title": "Champion · Crystal"}


def test_gyms_and_leagues_of_the_games(call, services):
    lg = call("canon_install", {"league_key": "kanto-rgb"})["league"]
    n = names_i18n.league(services.store.league(lg["id"]), services)
    assert n["en"] == {"name": "Kanto League (Red/Blue)", "description": "Red/Blue"} and n["es"]["name"] == "Liga Kanto (Rojo y Azul)"
    assert n["es"]["description"] == "Rojo y Azul"
    gyms = [services.store.gym(g) for g in lg["gyms"]]
    first = names_i18n.gym(gyms[0], services)
    assert first["en"] == {"name": "Pewter City Gym", "city": "Pewter City", "badge": "Boulder Badge", "description": "Boulder Badge · Pewter City · Red/Blue"}
    assert first["es"]["name"] == "Gimnasio de Ciudad Plateada" and first["es"]["description"] == "Medalla Roca · Ciudad Plateada · Rojo y Azul"
    # a gym the user renamed keeps its name, the rest still follows the language
    services.store.update_gym(gyms[0]["id"], {"name": "Mi gimnasio"})
    renamed = names_i18n.gym(services.store.gym(gyms[0]["id"]), services)
    assert "name" not in renamed["en"] and renamed["en"]["badge"] == "Boulder Badge"
    crystal = call("canon_install", {"league_key": "johto-crystal"})["league"]
    n = names_i18n.league(services.store.league(crystal["id"]), services)
    assert n["en"]["name"] == "Johto League" and n["es"]["description"] == "Cristal"
    g = names_i18n.gym(services.store.gym(crystal["gyms"][0]), services)
    assert g["en"]["name"] == "Violet City Gym" and g["es"]["name"] == "Gimnasio de Ciudad Malva"
    galar = call("canon_install", {"league_key": "galar-sw"})["league"]
    assert names_i18n.gym(services.store.gym(galar["gyms"][0]), services)["en"]["name"] == "Turffield Stadium"


def test_mass_battle_titles_and_facilities():
    from silvers_hoard.mass import PRESETS
    from silvers_hoard import facilities
    doc = {"preset": "starters", "title": "Los 27 iniciales en battle royale"}
    assert names_i18n.mass_title(doc, PRESETS)["en"]["title"] == "The 27 starters in a battle royale"
    assert names_i18n.mass_title({**doc, "title": "Mi campal"}, PRESETS) is None
    f = next(x for x in facilities.FACILITIES if x["id"] == "factory3")
    assert names_i18n.facility(f) == {"es": {"name": "Fábrica Batalla (Esmeralda)"}, "en": {"name": "Battle Factory (Emerald)"}}


def test_the_screens_get_both_languages(call, services):
    lg = call("canon_install", {"league_key": "kanto-rgb"})["league"]
    got = call("league_get", {"id": lg["id"]})
    assert got["i18n"]["en"]["name"] == "Kanto League (Red/Blue)"
    assert got["gym_list"][0]["i18n"]["en"]["name"] == "Pewter City Gym"
    assert got["champion"]["i18n"]["en"]["name"].startswith("Blue (")
    cat = call("leagues_catalog", {})["leagues"]
    pt = next(x for x in cat if x["key"] == "sinnoh-pt")
    assert pt["i18n"]["en"] == {"name": "Sinnoh League (Platinum)", "description": "Platinum", "region": "Sinnoh", "game": "Platinum"}
    assert pt["i18n"]["es"]["name"] == "Liga Sinnoh (Platino)"
    assert pt["gym_list"][0]["i18n"]["en"]["badge"] == "Coal Badge" and pt["champion"]["i18n"]["en"]["name"] == "Cynthia"
    assert pt["champion"]["i18n"]["es"]["name"] == pt["champion"]["name"]
    rnd = call("trainer_random", {"seed": "seat"})
    b = call("battle_start", {"p1": {"trainer_id": rnd["id"], "human": True}, "p2": {"trainer_id": got["champion"]["id"]}})
    card = next(x for x in call("battles_list", {})["battles"] if x["id"] == b["id"])
    assert card["p1"]["i18n"]["en"]["name"] == "Trainer " + rnd["name"].split()[-1]
    assert card["p2"]["i18n"]["en"]["name"] == got["champion"]["i18n"]["en"]["name"]
    own = call("trainer_create", {"name": "Luis", "paste": TEAM})
    assert "i18n" not in call("trainer_get", {"id": own["id"]})


def test_challenges_and_badges_name_their_target_in_both_languages(call, services):
    from silvers_hoard.names_i18n import annotate
    lg = call("canon_install", {"league_key": "kanto-rgb"})["league"]
    gym = services.store.gym(lg["gyms"][0])
    run = {"kind": "gym", "target_id": gym["id"], "target_name": gym["name"]}
    badge = {"id": "b1", "gym_id": gym["id"], "gym_name": gym["name"]}
    fac = {"kind": "facility", "target_id": "factory3", "target_name": "Fábrica Batalla (Esmeralda)"}
    annotate([run, badge, fac], services)
    assert run["i18n"]["en"]["target_name"] == "Pewter City Gym" and badge["i18n"]["en"]["gym_name"] == "Pewter City Gym"
    assert fac["i18n"] == {"es": {"target_name": "Fábrica Batalla (Esmeralda)"}, "en": {"target_name": "Battle Factory (Emerald)"}}


def test_gyms_and_leagues_of_the_games_carry_their_region_and_game(call):
    cat = call("leagues_catalog", {})["leagues"]
    unova = next(x for x in cat if x["key"] == "unova-bw")
    assert unova["region"] == "Unova" and unova["game_id"] == "bw"
    assert unova["i18n"]["es"]["region"] == "Teselia" and unova["i18n"]["en"]["game"] == "Black/White" and unova["i18n"]["es"]["game"] == "Negro y Blanco"
    assert unova["gym_list"][0]["game_id"] == "bw"
    crystal = next(x for x in cat if x["key"] == "johto-crystal")
    assert crystal["game_id"] == "gsc" and crystal["i18n"]["es"]["game"] == "Cristal"
    lg = call("canon_install", {"league_key": "galar-sw"})["league"]
    gyms = [g for g in call("gyms_list", {})["gyms"] if g["id"] in lg["gyms"]]
    assert gyms and all(g["region"] == "Galar" and g["game_id"] == "swsh" for g in gyms)
    assert call("league_get", {"id": lg["id"]})["game_id"] == "swsh"


def test_facility_seats_without_a_saved_trainer(services):
    from silvers_hoard import frontier

    assert names_i18n.facility_seat("Entrenadora Guay Nora") == {"es": {"name": "Entrenadora Guay Nora"}, "en": {"name": "Ace Trainer Nora"}}
    assert names_i18n.facility_seat("Luis") is None and names_i18n.facility_seat("Veterano") is None
    tid = next(t for t in frontier.BRAINS if frontier.BRAINS[t][0] == "palmer")
    brain = frontier.trainer_card(tid)
    assert names_i18n.facility_seat(brain["name"])["en"]["name"] == brain["name_en"]
    plain = frontier.trainer_card(next(i for i, t in enumerate(frontier.data()["trainers"]) if t.get("class_id") == 9))
    assert names_i18n.facility_seat(plain["name"])["en"]["name"] == plain["name_en"]
    # a seat in a battle: annotated, unless it is a saved trainer's (those go by the trainer)
    battle = {"p1": {"trainer_id": "", "name": "Entrenadora Guay Nora", "human": False, "ai": {}},
              "p2": {"trainer_id": 42, "name": plain["name"], "human": False, "ai": {}}}
    names_i18n.annotate(battle, services)
    assert battle["p1"]["i18n"]["en"]["name"] == "Ace Trainer Nora" and battle["p2"]["i18n"]["en"]["name"] == plain["name_en"]
