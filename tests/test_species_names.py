"""Pokémon names as a person writes them, in English or Spanish, become names Showdown's Pokédex knows."""
from silvers_hoard.species_names import candidates, ev_from_points


def first_dash(text):
    # the first rewritten candidate (the text itself always comes first)
    return candidates(text)[1].lower()


def test_megas_regions_and_spanish_forms():
    assert first_dash("Mega delphox ") == "delphox-mega"
    assert first_dash("Charizard Mega X") == "charizard-mega-x"
    assert first_dash("Mega Charizard Y") == "charizard-mega-y"
    assert first_dash("Shaymin Forma Cielo") == "shaymin-sky"
    assert first_dash("Raichu alola") == "raichu-alola"
    assert first_dash("Raichu de Alola") == "raichu-alola"
    assert first_dash("Alolan Raichu") == "raichu-alola"
    assert first_dash("Primal Kyogre") == "kyogre-primal"
    assert first_dash("Kyogre Primigenio") == "kyogre-primal"
    assert first_dash("Rotom Lavado") == "rotom-wash"
    assert first_dash("Mr. Mime de Galar") == "mr-mime-galar"
    assert first_dash("Tornadus Forma Tótem") == "tornadus-therian"
    assert first_dash("Pokémon Glaceon") == "glaceon"


def test_the_text_as_written_is_tried_first_and_nothing_is_repeated():
    c = candidates("Raichu-Alola")
    assert c[0] == "Raichu-Alola" and len(c) == len(set(c))
    assert candidates("") == []
    assert candidates("   ") == []


def test_champions_points_as_evs():
    assert [ev_from_points(p) for p in (0, 1, 2, 32, 40, -3, "x")] == [0, 4, 12, 252, 252, 0, 0]
