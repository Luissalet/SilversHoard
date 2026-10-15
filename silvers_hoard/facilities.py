"""Battle facilities (Battle Tower, Subway, Maison, Tree): win streaks against one rival after another at level 50, with the
facility's own bosses (Palmer, Ingo and Emmet, the Battle Chatelaines, Red and Blue, Anabel, Leon) on the battles where the games
put them. The other rivals are generated: a trainer class of the facility's era with a team from Showdown's random sets of that
generation. Each battle is independent (both teams start healed), each side brings 3 Pokémon (4 in doubles) picked at team preview.

In the Battle Factory there is no team of one's own: three of six rental Pokémon, a swap after each win, new rentals each round.

A streak is a run of kind ``facility``; its stages grow one battle at a time. The record of a trainer at a facility is its longest
run there."""

from __future__ import annotations

import json
import random
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

PRESETS = Path(__file__).resolve().parent / "presets"

# id: name, Spanish name, generation, game type, Pokémon per side, bosses [(battle number, character key, variant id, label es, label en)],
# special rivals that show up now and then (character key, variant id), and the trainer classes of the era (sprite base, es, en)
FACILITIES: list[dict[str, Any]] = [
    {"id": "tower3", "name": "Battle Tower (Emerald)", "name_es": "Torre Batalla (Esmeralda)", "gen": 3, "game": "E", "gametype": "singles", "size": 3,
     "bosses": [(35, "anabel", "esilversymbolchallenge", "Símbolo Plata", "Silver Symbol"), (70, "anabel", "egoldsymbolchallenge", "Símbolo Oro", "Gold Symbol")]},
    {"id": "tower4", "name": "Battle Tower (Sinnoh)", "name_es": "Torre Batalla (Sinnoh)", "gen": 4, "game": "DPPt", "gametype": "singles", "size": 3,
     "bosses": [(21, "palmer", "dpon21stconsecutivebattle", "Combate 21", "Battle 21"), (49, "palmer", "dpon49thconsecutivebattle", "Combate 49", "Battle 49")]},
    {"id": "subway_single", "name": "Battle Subway: Single Trains", "name_es": "Metro Batalla: trenes individuales", "gen": 5, "game": "BW", "gametype": "singles",
     "size": 3, "bosses": [(21, "ingo", "bwb2w2singletrainson21stconsecutivebattl", "Combate 21", "Battle 21"),
                           (49, "ingo", "bwb2w2supersingletrainson49thconsecutive", "Supertren, combate 49", "Super Train, battle 49")]},
    {"id": "subway_double", "name": "Battle Subway: Double Trains", "name_es": "Metro Batalla: trenes dobles", "gen": 5, "game": "BW", "gametype": "doubles",
     "size": 4, "bosses": [(21, "emmet", "bwb2w2doubletrainson21stconsecutivebattl", "Combate 21", "Battle 21"),
                           (49, "emmet", "bwb2w2superdoubletrainson49thconsecutive", "Supertren, combate 49", "Super Train, battle 49")]},
    {"id": "maison_single", "name": "Battle Maison: Singles", "name_es": "Batalla Chatelet: individuales", "gen": 6, "game": "XY", "gametype": "singles", "size": 3,
     "bosses": [(20, "nita", "xyorassinglebattleon20thconsecutivebattl", "Combate 20", "Battle 20"),
                (50, "nita", "xyorassupersinglebattleon50thconsecutive", "Súper, combate 50", "Super, battle 50")]},
    {"id": "maison_double", "name": "Battle Maison: Doubles", "name_es": "Batalla Chatelet: dobles", "gen": 6, "game": "XY", "gametype": "doubles", "size": 4,
     "bosses": [(20, "evelyn", "xyorasdoublebattleon20thconsecutivebattl", "Combate 20", "Battle 20"),
                (50, "evelyn", "xyorassuperdoublebattleon50thconsecutive", "Súper, combate 50", "Super, battle 50")]},
    {"id": "tree_single", "name": "Battle Tree: Singles", "name_es": "Árbol Batalla: individuales", "gen": 7, "game": "SM", "gametype": "singles", "size": 3,
     "bosses": [(20, "red", "smusumbattletreesinglebattleon20thconsec", "Combate 20", "Battle 20"),
                (50, "red", "smusumbattletreesupersinglebattleon50thc", "Súper, combate 50", "Super, battle 50")],
     "specials": [("cynthia", "smusumbattletree"), ("wally", "smusumbattletree"), ("grimsley", "smusumbattletree"), ("colress", "smusumbattletree"),
                  ("anabel", "smusumbattletree"), ("kukui", "usumbattletree"), ("guzma", "mumbattletree"), ("mallow", "mumbattletree"),
                  ("kiawe", "susbattletree")]},
    {"id": "tree_double", "name": "Battle Tree: Doubles", "name_es": "Árbol Batalla: dobles", "gen": 7, "game": "SM", "gametype": "doubles", "size": 4,
     "bosses": [(20, "blue", "smusumbattletreedoublebattleon20thconsec", "Combate 20", "Battle 20"),
                (50, "blue", "smusumbattletreesuperdoublebattleon50thc", "Súper, combate 50", "Super, battle 50")],
     "specials": [("cynthia", "smusumbattletree"), ("grimsley", "smusumbattletree"), ("colress", "smusumbattletree"), ("kukui", "usumbattletree")]},
    {"id": "tower8", "name": "Battle Tower (Galar)", "name_es": "Torre Batalla (Galar)", "gen": 8, "game": "SwSh", "gametype": "singles", "size": 3,
     "bosses": [(10, "leon", "swshbattletowerbeginnertier", "Nivel principiante", "Beginner Tier"),
                (20, "leon", "swshbattletowerpokballtier", "Nivel Poké Ball", "Poké Ball Tier"),
                (30, "leon", "swshbattletowergreatballtier", "Nivel Super Ball", "Great Ball Tier"),
                (40, "leon", "swshbattletowerultraballtier", "Nivel Ultra Ball", "Ultra Ball Tier"),
                (50, "leon", "swshbattletowermasterballtier", "Nivel Master Ball", "Master Ball Tier")]},
]
# Battle Factory: no team of your own; pick 3 of 6 rental Pokémon, swap one for one of the beaten rival's after each win, and get six
# new rentals every round of seven. The rentals and the rivals are Showdown random sets of that generation at level 50.
FACILITIES += [
    {"id": "factory3", "name": "Battle Factory (Emerald)", "name_es": "Fábrica Batalla (Esmeralda)", "gen": 3, "game": "E", "gametype": "singles",
     "size": 3, "rental": True, "bosses": []},
    {"id": "factory4", "name": "Battle Factory (Platinum)", "name_es": "Fábrica Batalla (Platino)", "gen": 4, "game": "Pt", "gametype": "singles",
     "size": 3, "rental": True, "bosses": []},
    {"id": "factory9", "name": "Rental Factory (Scarlet/Violet)", "name_es": "Fábrica de alquiler (Escarlata/Púrpura)", "gen": 9, "game": "SV",
     "gametype": "singles", "size": 3, "rental": True, "bosses": []},
]
RENTALS = 6
BY_ID = {f["id"]: f for f in FACILITIES}
ROUND = 7

# trainer classes of the facilities: Showdown sprite base, Spanish and English class names
CLASSES = [
    ("acetrainer", "Entrenador Guay", "Ace Trainer"), ("acetrainerf", "Entrenadora Guay", "Ace Trainer"), ("veteran", "Veterano", "Veteran"),
    ("veteranf", "Veterana", "Veteran"), ("gentleman", "Caballero", "Gentleman"), ("lady", "Dama", "Lady"), ("blackbelt", "Karateka", "Black Belt"),
    ("battlegirl", "Luchadora", "Battle Girl"), ("scientist", "Científico", "Scientist"), ("hiker", "Montañero", "Hiker"),
    ("birdkeeper", "Ornitólogo", "Bird Keeper"), ("fisherman", "Pescador", "Fisherman"), ("psychic", "Médium", "Psychic"),
    ("psychicf", "Médium", "Psychic"), ("dragontamer", "Domadragones", "Dragon Tamer"), ("beauty", "Bella", "Beauty"), ("sailor", "Marinero", "Sailor"),
    ("pokefan", "Pokéfan", "Poké Fan"), ("pokefanf", "Pokéfan", "Poké Fan"), ("ruinmaniac", "Ruinamaníaco", "Ruin Maniac"),
    ("pokemaniac", "Pokémaníaco", "Poké Maniac"), ("backpacker", "Mochilero", "Backpacker"), ("backpackerf", "Mochilera", "Backpacker"),
    ("pilot", "Piloto", "Pilot"), ("worker", "Operario", "Worker"), ("roughneck", "Macarra", "Roughneck"), ("parasollady", "Dama Parasol", "Parasol Lady"),
    ("idol", "Ídolo", "Idol"), ("richboy", "Niño Rico", "Rich Boy"), ("collector", "Coleccionista", "Collector"), ("guitarist", "Guitarrista", "Guitarist"),
    ("cyclist", "Ciclista", "Cyclist"), ("cyclistf", "Ciclista", "Cyclist"), ("aromalady", "Dama Aroma", "Aroma Lady"), ("rancher", "Granjero", "Rancher"),
    ("artist", "Artista", "Artist"), ("madame", "Señora", "Madame"), ("doctor", "Doctor", "Doctor"), ("nurse", "Enfermera", "Nurse"),
]
NAMES_M = ["Álex", "Bruno", "Dani", "Fabio", "Hugo", "Jaime", "Marco", "Óscar", "Quique", "Sergio", "Unai", "Xavi", "Yago", "Blas", "Darío", "Félix",
           "Iker", "Leo", "Nico", "Pablo", "Saúl", "Teo"]
NAMES_F = ["Carla", "Elena", "Gala", "Irene", "Lara", "Nora", "Paula", "Rita", "Tania", "Vera", "Zoe", "Abril", "Celia", "Emma", "Gema", "Julia",
           "Mara", "Olga", "Rocío", "Vega"]
FEMALE = {"acetrainerf", "veteranf", "lady", "battlegirl", "psychicf", "beauty", "pokefanf", "backpackerf", "parasollady", "idol", "cyclistf",
          "aromalady", "madame", "nurse"}


@lru_cache(maxsize=1)
def _sprite_names() -> frozenset[str]:
    try:
        return frozenset(json.loads((PRESETS / "trainer_sprites.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return frozenset()


def sprite_for(base: str, gen: int) -> str:
    """The sprite of a trainer class in the facility's generation when the sprite server has one (acetrainer-gen4), else the plain one."""
    names = _sprite_names()
    for cand in (f"{base}-gen{gen}", base):
        if not names or cand in names:
            return cand
    return base


def get(fid: str) -> Optional[dict[str, Any]]:
    return BY_ID.get(fid)


def ai_level_for(number: int) -> str:
    """The rivals get harder as the streak grows: normal for the first round, hard for the second, expert from then on."""
    return "normal" if number <= ROUND else "hard" if number <= 2 * ROUND else "expert"


def boss_at(f: dict[str, Any], number: int) -> Optional[tuple]:
    for b in f["bosses"]:
        if b[0] == number:
            return b
    return None


def pick_sets(sets: list[dict[str, Any]], size: int, rng: random.Random) -> list[dict[str, Any]]:
    """`size` sets of a team or of a facility pool (the Battle Tree legends carry 10-35 Pokémon and use a few)."""
    clean = [{k: v for k, v in s.items() if k != "level_range"} for s in sets]
    if len(clean) <= size:
        return clean
    return rng.sample(clean, size)


def random_format(f: dict[str, Any]) -> str:
    """Showdown's random sets of the facility's generation (doubles sets only exist from generation 8)."""
    if f["gametype"] == "doubles" and f["gen"] >= 8:
        return f"gen{f['gen']}randomdoublesbattle"
    return f"gen{f['gen']}randombattle"


def filler_trainer(f: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    base, es, en = rng.choice(CLASSES)
    who = rng.choice(NAMES_F if base in FEMALE else NAMES_M)
    return {"name": f"{es} {who}", "name_en": f"{en} {who}", "title": es, "avatar": f"sd:{sprite_for(base, f['gen'])}"}


def rng(seed: str) -> random.Random:
    return random.Random(seed)
