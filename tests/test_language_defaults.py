"""English defaults reach native handlers; explicit Spanish remains a user choice."""
import pytest

from conftest import needs_engine
from silvers_hoard.hoard_link import family

pytestmark = needs_engine


@pytest.mark.parametrize("route", ["api", "service"])
def test_new_cartridge_trainers_default_to_english_lines(call, services, route):
    if route == "api":
        trainer = call("character_install", {"key": "whitney", "variant": "hgssgymbattle"})["trainer"]
    else:
        trainer = services.character_install("whitney", variant="hgssgymbattle")
    assert trainer["dialogue"]["last_low"] == "Poor me!"
    spanish = call("character_install", {"key": "whitney", "variant": "hgssgymbattle", "name": "Spanish choice", "lang": "es"})["trainer"]
    assert spanish["dialogue"]["last_low"] == "¡Ay, pobre de mí!"


def test_new_game_leagues_default_to_english_cartridge_lines(call, services):
    call("canon_install", {"league_key": "johto-hgss"})
    gym = services.store.gym_by_canon("johto-hgss:whitney")
    trainer = services.store.trainer(gym["leader_id"])
    assert trainer["dialogue"]["last_low"] == "Poor me!"


@pytest.mark.parametrize("route", ["api", "service"])
def test_dialogue_generation_requests_english_by_default_and_honors_spanish(call, services, monkeypatch, route):
    prompts = []
    def chat(messages, **kwargs):
        prompts.append(messages[0]["content"])
        return {"ok": True, "json": {"intro": "Recorded fixture line"}}
    monkeypatch.setattr(family, "chat", chat)
    trainer = call("trainer_create", {"name": "Dialogue default", "format": "gen9customgame"})
    if route == "api":
        call("trainer_dialogue_write", {"id": trainer["id"]})
    else:
        services.trainer_write_dialogue(trainer["id"])
    assert "in English." in prompts[-1]
    call("trainer_dialogue_write", {"id": trainer["id"], "lang": "es"})
    assert "in castellano de España." in prompts[-1]


def test_classic_video_defaults_to_english_but_explicit_spanish_is_kept(call, services, monkeypatch):
    trainer = call("trainer_create", {"name": "Video default", "format": "gen9customgame", "paste": "Pikachu\n- Tackle"})
    battle = call("battle_start", {"p1": {"trainer_id": trainer["id"], "human": True},
                                  "p2": {"trainer_id": trainer["id"], "human": True}})
    call("battle_forfeit", {"id": battle["id"], "side": "p1"})
    monkeypatch.setattr(services, "video_status", lambda: {"playwright": True, "browser": True})
    monkeypatch.setattr(services, "_record_video", lambda *args, **kwargs: {"lang": args[3]})
    monkeypatch.setattr(services, "_job", lambda kind, title, args, run: run("qa", lambda value: None, lambda: False))
    assert call("battle_video", {"id": battle["id"]})["lang"] == "en"
    assert call("battle_video", {"id": battle["id"], "lang": "es"})["lang"] == "es"
