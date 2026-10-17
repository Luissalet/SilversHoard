"""Each new battle keeps its commentary language across background work."""
import json
import pytest

from conftest import needs_engine, wait_for
from silvers_hoard.hoard_link import family

pytestmark = needs_engine


@pytest.fixture
def trainers(call):
    a = call("trainer_create", {"name": "Commentary protagonist", "format": "gen9customgame",
                                "paste": "Pikachu\nLevel: 100\n- Thunderbolt"})
    b = call("trainer_create", {"name": "Commentary rival", "format": "gen9customgame",
                                "paste": "Magikarp\nLevel: 1\n- Splash"})
    return a, b


def start(call, trainers, **options):
    a, b = trainers
    return call("battle_start", {"p1": {"trainer_id": a["id"], "human": True},
                                  "p2": {"trainer_id": b["id"], "human": True}, **options})


def note(turn):
    return {"turn": turn, "side": "p2", "choice": "move 1",
            "slots": [{"mon": "Magikarp", "picked": {"kind": "move", "name": "Splash"}}]}


def test_interleaved_banter_uses_each_battles_language(call, services, trainers, monkeypatch):
    prompts = []
    def chat(messages, **kwargs):
        prompts.append(messages[0]["content"])
        return {"ok": True, "json": {"lines": [{"i": 0, "line": "Fixture line"}]}}
    monkeypatch.setattr(family, "chat", chat)
    en = start(call, trainers)
    es = start(call, trainers, lang="es")
    for battle, turn in ((en, 1), (es, 1), (en, 2)):
        services._banter(battle["id"], [note(turn)])
    assert "in English," in prompts[0] and "in castellano de España," in prompts[1] and "in English," in prompts[2]
    assert services.store.battle(en["id"])["replay"]["lang"] == "en"
    assert services.store.battle(es["id"])["replay"]["lang"] == "es"
    before = services.banter_of(es["id"])
    services._banter(es["id"], [note(1)])
    assert len(prompts) == 3 and services.banter_of(es["id"]) == before


@pytest.fixture
def watched(call, trainers):
    a, b = trainers
    battle = call("battle_start", {"p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}, "lang": "es"})
    return wait_for(lambda: (x := call("battle_get", {"id": battle["id"]}))["status"] == "ended" and x)


def test_watched_battle_keeps_language_after_background_completion(services, watched):
    assert services.store.battle(watched["id"])["replay"]["lang"] == "es"


def test_legacy_lines_stay_literal_and_new_commentary_defaults_to_english(services, monkeypatch):
    bid = services.store.add_battle({"kind": "watch", "status": "ended", "format": "gen9customgame",
                                     "p1": {"name": "Legacy A"}, "p2": {"name": "Legacy B"}})
    legacy = {"turn": 1, "side": "p2", "line": "Texto guardado 🌿"}
    path = services._banter_path(bid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([legacy], ensure_ascii=False), encoding="utf-8")
    prompts = []
    def chat(messages, **kwargs):
        prompts.append(messages[0]["content"])
        return {"ok": True, "json": {"lines": [{"i": 0, "line": "New fixture line"}]}}
    monkeypatch.setattr(family, "chat", chat)
    services._banter(bid, [note(2)])
    assert "in English," in prompts[0]
    assert services.banter_of(bid) == [legacy, {"turn": 2, "side": "p2", "line": "New fixture line"}]


def test_automatic_gym_challenge_passes_language_to_every_stage(call, services, trainers):
    a, b = trainers
    gym = call("gym_save", {"name": "Language gym", "leader_id": b["id"], "trainers": [b["id"]],
                            "format": "gen9customgame", "badge": "Language badge"})
    run = call("challenge_start", {"kind": "gym", "target_id": gym["id"], "challenger_id": a["id"],
                                   "auto": True, "walk_map": False, "lang": "es"})
    done = wait_for(lambda: (x := call("challenge_get", {"id": run["id"]}))["status"] != "active" and x)
    assert done["status"] == "won" and len(done["stages"]) == 2
    assert services.store.run(run["id"])["challenger"]["lang"] == "es"
    assert all(services.store.battle(stage["battle_id"])["replay"]["lang"] == "es" for stage in done["stages"])


def test_practice_and_exercise_attempts_capture_the_requested_language(call, services, watched):
    branch = call("battle_practice", {"id": watched["id"], "turn": 1, "lang": "es"})
    assert services.store.battle(branch["id"])["replay"]["lang"] == "es"
    exercise = call("exercise_create", {"battle_id": watched["id"], "turn": 1, "title": "Commentary exercise"})
    attempt = call("exercise_start", {"id": exercise["id"], "lang": "es"})
    assert services.store.battle(attempt["id"])["replay"]["lang"] == "es"
    default = call("exercise_start", {"id": exercise["id"]})
    assert services.store.battle(default["id"])["replay"]["lang"] == "en"


@pytest.mark.parametrize("target", ["tower4", "factory4", "hall4"])
def test_facility_creation_and_deferred_choices_keep_language(call, services, target):
    trainer = call("trainer_create", {"name": "Facility commentary", "format": "gen4customgame",
                                      "team": [{"species": name, "moves": ["Tackle"]}
                                               for name in ("Pikachu", "Eevee", "Bulbasaur")]})
    run = call("challenge_start", {"kind": "facility", "target_id": target,
                                   "challenger_id": trainer["id"], "lang": "es"})
    assert services.store.run(run["id"])["challenger"]["lang"] == "es"
    if target == "factory4":
        run = call("factory_pick", {"id": run["id"], "picks": [0, 1, 2]})
    elif target == "hall4":
        run = call("frontier_hall_pick", {"id": run["id"], "cell": "fuego"})
    battle = services.store.battle(run["stages"][0]["battle_id"])
    assert battle["replay"]["lang"] == "es"


def test_cup_play_and_deferred_watch_keep_creation_language(call, services, trainers):
    a, b = trainers
    cup = call("cup_start", {"trainer_ids": [a["id"], b["id"]], "human_id": a["id"],
                             "format": "gen9customgame", "lang": "es"})
    played = call("cup_play", {"id": cup["id"]})
    assert services.store.battle(played["battle_id"])["replay"]["lang"] == "es"
    call("battle_forfeit", {"id": played["battle_id"], "side": "p1"})
    deferred = services.cups.create(trainer_ids=[a["id"], b["id"]], format_="gen9customgame", autoplay=False, lang="es")
    watched = call("cup_watch", {"id": deferred["id"], "round": 0, "match": 0})
    ended = wait_for(lambda: (x := call("battle_get", {"id": watched["battle_id"]}))["status"] == "ended" and x)
    assert services.store.battle(ended["id"])["replay"]["lang"] == "es"
