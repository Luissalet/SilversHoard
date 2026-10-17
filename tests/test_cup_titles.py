"""Translate generated cup titles without guessing which names the person wrote."""
import pytest

from conftest import needs_engine

pytestmark = needs_engine


@pytest.fixture
def seats(call):
    return [call("trainer_create", {"name": name, "format": "gen9customgame",
                                    "paste": "Magikarp\n- Splash"})["id"] for name in ("Cup A", "Cup B")]


def create(call, seats, **options):
    return call("cup_start", {"trainer_ids": seats, "human_id": seats[0], "format": "gen9customgame", **options})


def test_new_default_title_has_english_native_value_and_both_ui_languages(call, services, seats):
    cup = create(call, seats)
    assert cup["title"] == "Cup: 2 trainers"
    assert cup["i18n"] == {"es": {"title": "Copa: 2 entrenadores"}, "en": {"title": "Cup: 2 trainers"}}
    assert call("cups_list", {})["cups"][0]["i18n"] == cup["i18n"]
    assert services.cups.battle_link(cup["id"])["i18n"] == cup["i18n"]
    assert services.store.cup(cup["id"])["spec"]["title_default"] is True


@pytest.mark.parametrize("title", ["Copa de 2", "Cup: 2 trainers", "Copa personal 🌿"])
def test_explicit_titles_stay_literal_even_when_they_resemble_defaults(call, seats, title):
    cup = create(call, seats, title=title)
    assert cup["title"] == title and "i18n" not in cup
    listed = call("cups_list", {})["cups"][0]
    assert listed["title"] == title and "i18n" not in listed


def test_old_unmarked_titles_remain_literal_after_loading(call, services, seats):
    cup = create(call, seats)
    saved = services.store.cup(cup["id"])
    saved["spec"].pop("title_default", None)
    services.store.update_cup(cup["id"], {"title": "Copa de 2", "spec": saved["spec"]})
    old = call("cup_get", {"id": cup["id"]})
    assert old["title"] == "Copa de 2" and "i18n" not in old
    assert "i18n" not in services.cups.battle_link(cup["id"])
