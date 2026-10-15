"""Whole leagues of more games, built from the characters' teams game by game (presets/characters.json.gz): each gym leader's,
Elite Four member's and champion's first team in that game, with the gym's city, type and badge. Installed like the in-game leagues
of Crystal, FireRed/LeafGreen and Emerald (canon_install with league_key); the trainers are the characters' installed trainers.

Each gym is (character key, variant id, city, city es, type, badge, badge es); the Elite Four and champion are (key, variant id)."""

from __future__ import annotations

from typing import Any

KANTO = [("Pewter City", "Ciudad Plateada", "Rock", "Boulder Badge", "Medalla Roca"), ("Cerulean City", "Ciudad Celeste", "Water", "Cascade Badge", "Medalla Cascada"),
         ("Vermilion City", "Ciudad Carmín", "Electric", "Thunder Badge", "Medalla Trueno"), ("Celadon City", "Ciudad Azulona", "Grass", "Rainbow Badge", "Medalla Arcoíris"),
         ("Fuchsia City", "Ciudad Fucsia", "Poison", "Soul Badge", "Medalla Alma"), ("Saffron City", "Ciudad Azafrán", "Psychic", "Marsh Badge", "Medalla Pantano"),
         ("Cinnabar Island", "Isla Canela", "Fire", "Volcano Badge", "Medalla Volcán"), ("Viridian City", "Ciudad Verde", "Ground", "Earth Badge", "Medalla Tierra")]
JOHTO = [("Violet City", "Ciudad Malva", "Flying", "Zephyr Badge", "Medalla Céfiro"), ("Azalea Town", "Pueblo Azalea", "Bug", "Hive Badge", "Medalla Colmena"),
         ("Goldenrod City", "Ciudad Trigal", "Normal", "Plain Badge", "Medalla Planicie"), ("Ecruteak City", "Ciudad Iris", "Ghost", "Fog Badge", "Medalla Niebla"),
         ("Cianwood City", "Ciudad Orquídea", "Fighting", "Storm Badge", "Medalla Tormenta"), ("Olivine City", "Ciudad Olivo", "Steel", "Mineral Badge", "Medalla Mineral"),
         ("Mahogany Town", "Pueblo Caoba", "Ice", "Glacier Badge", "Medalla Glaciar"), ("Blackthorn City", "Ciudad Endrino", "Dragon", "Rising Badge", "Medalla Dragón")]
HOENN = [("Rustboro City", "Ciudad Férrica", "Rock", "Stone Badge", "Medalla Piedra"), ("Dewford Town", "Pueblo Azuliza", "Fighting", "Knuckle Badge", "Medalla Puño"),
         ("Mauville City", "Ciudad Malvalona", "Electric", "Dynamo Badge", "Medalla Dinamo"), ("Lavaridge Town", "Pueblo Lavacalda", "Fire", "Heat Badge", "Medalla Calor"),
         ("Petalburg City", "Ciudad Petalia", "Normal", "Balance Badge", "Medalla Equilibrio"), ("Fortree City", "Ciudad Arborada", "Flying", "Feather Badge", "Medalla Pluma"),
         ("Mossdeep City", "Ciudad Algaria", "Psychic", "Mind Badge", "Medalla Mente"), ("Sootopolis City", "Arrecípolis", "Water", "Rain Badge", "Medalla Lluvia")]
SINNOH_PT = [("Oreburgh City", "Ciudad Pirita", "Rock", "Coal Badge", "Medalla Lignito"), ("Eterna City", "Ciudad Vetusta", "Grass", "Forest Badge", "Medalla Bosque"),
             ("Hearthome City", "Ciudad Corazón", "Ghost", "Relic Badge", "Medalla Reliquia"), ("Veilstone City", "Ciudad Rocavelo", "Fighting", "Cobble Badge", "Medalla Adoquín"),
             ("Pastoria City", "Ciudad Pradera", "Water", "Fen Badge", "Medalla Ciénaga"), ("Canalave City", "Ciudad Canal", "Steel", "Mine Badge", "Medalla Mina"),
             ("Snowpoint City", "Ciudad Puntaneva", "Ice", "Icicle Badge", "Medalla Carámbano"), ("Sunyshore City", "Ciudad Marina", "Electric", "Beacon Badge", "Medalla Faro")]
UNOVA_BW = [("Striaton City", "Ciudad Gres", "Grass", "Trio Badge", "Medalla Trío"), ("Nacrene City", "Ciudad Esmalte", "Normal", "Basic Badge", "Medalla Base"),
            ("Castelia City", "Ciudad Porcelana", "Bug", "Insect Badge", "Medalla Élitro"), ("Nimbasa City", "Ciudad Mayólica", "Electric", "Bolt Badge", "Medalla Voltio"),
            ("Driftveil City", "Ciudad Fayenza", "Ground", "Quake Badge", "Medalla Temblor"), ("Mistralton City", "Ciudad Loza", "Flying", "Jet Badge", "Medalla Jet"),
            ("Icirrus City", "Ciudad Teja", "Ice", "Freeze Badge", "Medalla Hielo"), ("Opelucid City", "Ciudad Caolín", "Dragon", "Legend Badge", "Medalla Leyenda")]
UNOVA_B2W2 = [("Aspertia City", "Ciudad Engobe", "Normal", "Basic Badge", "Medalla Base"), ("Virbank City", "Ciudad Hormigón", "Poison", "Toxic Badge", "Medalla Toxina"),
              ("Castelia City", "Ciudad Porcelana", "Bug", "Insect Badge", "Medalla Élitro"), ("Nimbasa City", "Ciudad Mayólica", "Electric", "Bolt Badge", "Medalla Voltio"),
              ("Driftveil City", "Ciudad Fayenza", "Ground", "Quake Badge", "Medalla Temblor"), ("Mistralton City", "Ciudad Loza", "Flying", "Jet Badge", "Medalla Jet"),
              ("Opelucid City", "Ciudad Caolín", "Dragon", "Legend Badge", "Medalla Leyenda"), ("Humilau City", "Ciudad Marga", "Water", "Wave Badge", "Medalla Ola")]
KALOS = [("Santalune City", "Ciudad Novarte", "Bug", "Bug Badge", "Medalla Insecto"), ("Cyllage City", "Ciudad Relieve", "Rock", "Cliff Badge", "Medalla Muro"),
         ("Shalour City", "Ciudad Yantra", "Fighting", "Rumble Badge", "Medalla Lucha"), ("Coumarine City", "Ciudad Témpera", "Grass", "Plant Badge", "Medalla Planta"),
         ("Lumiose City", "Ciudad Luminalia", "Electric", "Voltage Badge", "Medalla Voltaje"), ("Laverre City", "Ciudad Romantis", "Fairy", "Fairy Badge", "Medalla Hada"),
         ("Anistar City", "Ciudad Fluxus", "Psychic", "Psychic Badge", "Medalla Psique"), ("Snowbelle City", "Ciudad Fractal", "Ice", "Iceberg Badge", "Medalla Iceberg")]
GALAR_SW = [("Turffield", "Hoyuelo", "Grass", "Grass Badge", "Medalla Planta", "Estadio de Hoyuelo"),
            ("Hulbury", "Amura", "Water", "Water Badge", "Medalla Agua", "Estadio de Amura"),
            ("Motostoke", "Pistón", "Fire", "Fire Badge", "Medalla Fuego", "Estadio de Pistón"),
            ("Stow-on-Side", "Ladera", "Fighting", "Fighting Badge", "Medalla Lucha", "Estadio de Ladera"),
            ("Ballonlea", "Plié", "Fairy", "Fairy Badge", "Medalla Hada", "Estadio de Plié"),
            ("Circhester", "Auriga", "Rock", "Rock Badge", "Medalla Roca", "Estadio de Auriga"),
            ("Spikemuth", "Pueblo Crampón", "Dark", "Dark Badge", "Medalla Siniestro", "Pueblo Crampón"),
            ("Hammerlocke", "Artejo", "Dragon", "Dragon Badge", "Medalla Dragón", "Estadio de Artejo")]
PALDEA = [("Cortondo", "Pueblo Pirotín", "Bug", "Bug Badge", "Medalla Bicho"), ("Artazon", "Pueblo Altamía", "Grass", "Grass Badge", "Medalla Planta"),
          ("Levincia", "Ciudad Leudal", "Electric", "Electric Badge", "Medalla Eléctrica"), ("Cascarrafa", "Ciudad Cántara", "Water", "Water Badge", "Medalla Agua"),
          ("Medali", "Pueblo Mestura", "Normal", "Normal Badge", "Medalla Normal"), ("Montenevera", "Pueblo Hozkailu", "Ghost", "Ghost Badge", "Medalla Fantasma"),
          ("Alfornada", "Pueblo Alforno", "Psychic", "Psychic Badge", "Medalla Psíquica"), ("Glaseado Mountain", "Sierra Napada", "Ice", "Ice Badge", "Medalla Hielo")]


def _gyms(leaders: list[tuple[str, str]], places: list[tuple]) -> list[dict[str, Any]]:
    return [{"key": k, "variant": v, "city": p[0], "city_es": p[1], "type": p[2], "badge": p[3], "badge_es": p[4], "gym_es": p[5] if len(p) > 5 else ""}
            for (k, v), p in zip(leaders, places)]


def _team(pairs: list[tuple[str, str]]) -> list[dict[str, str]]:
    return [{"key": k, "variant": v} for k, v in pairs]


LEAGUES: list[dict[str, Any]] = [
    {"key": "kanto-rgb", "name": "Kanto League (Red/Blue)", "name_es": "Liga Kanto (Rojo y Azul)", "region": "Kanto", "game": "Red/Blue", "gen": 1,
     "gyms": _gyms([("brock", "rgb"), ("misty", "rgb"), ("ltsurge", "rgb"), ("erika", "rgb"), ("koga", "rgb"), ("sabrina", "rgb"), ("blaine", "rgb"),
                    ("giovanni", "rgbgymbattle")], KANTO),
     "elite_four": _team([("lorelei", "rgb"), ("bruno", "rgb"), ("agatha", "rgb"), ("lance", "rgb")]), "champion": {"key": "blue", "variant": "rgbchampionbattlecharizard"}},
    {"key": "johto-hgss", "name": "Johto League (HeartGold/SoulSilver)", "name_es": "Liga Johto (Oro HeartGold y Plata SoulSilver)", "region": "Johto",
     "game": "HeartGold/SoulSilver", "gen": 4,
     "gyms": _gyms([(k, "hgssgymbattle") for k in ("falkner", "bugsy", "whitney", "morty", "chuck", "jasmine", "pryce", "clair")], JOHTO),
     "elite_four": _team([(k, "hgssfirstbattle") for k in ("will", "koga", "bruno", "karen")]), "champion": {"key": "lance", "variant": "hgssfirstbattle"}},
    {"key": "hoenn-oras", "name": "Hoenn League (Omega Ruby/Alpha Sapphire)", "name_es": "Liga Hoenn (Rubí Omega y Zafiro Alfa)", "region": "Hoenn",
     "game": "Omega Ruby/Alpha Sapphire", "gen": 6,
     "gyms": _gyms([("roxanne", "oras"), ("brawly", "oras"), ("wattson", "oras"), ("flannery", "oras"), ("norman", "orasgymbattle"), ("winona", "oras"),
                    ("tateandliza", "oras"), ("wallace", "orasgymbattle")], HOENN),
     "elite_four": _team([(k, "orasinitialbattle") for k in ("sidney", "phoebe", "glacia", "drake")]), "champion": {"key": "steven", "variant": "oraschampionbattle"}},
    {"key": "sinnoh-pt", "name": "Sinnoh League (Platinum)", "name_es": "Liga Sinnoh (Platino)", "region": "Sinnoh", "game": "Platinum", "gen": 4,
     "gyms": _gyms([(k, "ptgymbattle") for k in ("roark", "gardenia", "fantina", "maylene", "crasherwake", "byron", "candice", "volkner")], SINNOH_PT),
     "elite_four": _team([(k, "pt") for k in ("aaron", "bertha", "flint", "lucian")]), "champion": {"key": "cynthia", "variant": "ptbeforestarkmountain"}},
    {"key": "unova-bw", "name": "Unova League (Black/White)", "name_es": "Liga Teselia (Negro y Blanco)", "region": "Unova", "game": "Black/White", "gen": 5,
     "gyms": _gyms([("cilan", "bw"), ("lenora", "bw"), ("burgh", "bw"), ("elesa", "bw"), ("clay", "bw"), ("skyla", "bw"), ("brycen", "bw"), ("drayden", "bl")], UNOVA_BW),
     "elite_four": _team([(k, "bwfirstbattleprenationalpokdex") for k in ("shauntal", "grimsley", "caitlin", "marshal")]), "champion": {"key": "alder", "variant": "bw"}},
    {"key": "unova-b2w2", "name": "Unova League (Black 2/White 2)", "name_es": "Liga Teselia (Negro 2 y Blanco 2)", "region": "Unova", "game": "Black 2/White 2", "gen": 5,
     "gyms": _gyms([(k, "b2w2gymbattleeasymodenormalmode") for k in ("cheren", "roxie", "burgh", "elesa", "clay", "skyla", "drayden", "marlon")], UNOVA_B2W2),
     "elite_four": _team([(k, "b2w2firstbattleeasymodenormalmode") for k in ("shauntal", "grimsley", "caitlin", "marshal")]),
     "champion": {"key": "iris", "variant": "b2w2initialbattleeasymodenormalmode"}},
    {"key": "kalos-xy", "name": "Kalos League (X/Y)", "name_es": "Liga Kalos (X e Y)", "region": "Kalos", "game": "X/Y", "gen": 6,
     "gyms": _gyms([(k, "xygymbattle") for k in ("viola", "grant", "korrina", "ramos", "clemont", "valerie", "olympia", "wulfric")], KALOS),
     "elite_four": _team([(k, "xypokmonleague") for k in ("malva", "siebold", "wikstrom", "drasna")]), "champion": {"key": "diantha", "variant": "xypokmonleague"}},
    {"key": "alola-sm", "name": "Alola League (Sun/Moon)", "name_es": "Liga Alola (Sol y Luna)", "region": "Alola", "game": "Sun/Moon", "gen": 7, "gyms": [],
     "elite_four": _team([("hala", "smpokmonleaguebattle"), ("olivia", "smpokmonleaguebattle"), ("acerola", "sminitialbattle"), ("kahili", "sminitialbattle")]),
     "champion": {"key": "kukui", "variant": "smchampionbattleincineroar"}},
    {"key": "alola-usum", "name": "Alola League (Ultra Sun/Ultra Moon)", "name_es": "Liga Alola (Ultrasol y Ultraluna)", "region": "Alola", "game": "Ultra Sun/Ultra Moon",
     "gen": 7, "gyms": [],
     "elite_four": _team([("molayne", "usuminitialbattle"), ("olivia", "usumpokmonleaguebattle"), ("acerola", "usuminitialbattle"), ("kahili", "usuminitialbattle")]),
     "champion": {"key": "hau", "variant": "usumchampionbattleprimarina"}},
    {"key": "galar-sw", "name": "Galar Champion Cup (Sword)", "name_es": "Copa de Campeones de Galar (Espada)", "region": "Galar", "game": "Sword", "gen": 8,
     "gyms": _gyms([("milo", "swshgymbattle"), ("nessa", "swshgymbattle"), ("kabu", "swshgymbattle"), ("bea", "swstowonsidestadium"), ("opal", "swshgymbattle"),
                    ("gordie", "swgymbattle"), ("piers", "swshgymbattle"), ("raihan", "swshgymbattle")], GALAR_SW),
     "elite_four": _team([("nessa", "swshsecondbattle"), ("bede", "swshfourthbattle"), ("raihan", "swshsecondbattle")]),
     "champion": {"key": "leon", "variant": "swshchampionshipmatchcinderace"}},
    {"key": "paldea-sv", "name": "Paldea League (Scarlet/Violet)", "name_es": "Liga Paldea (Escarlata y Púrpura)", "region": "Paldea", "game": "Scarlet/Violet", "gen": 9,
     "gyms": _gyms([(k, "svgymbattle") for k in ("katy", "brassius", "iono", "kofu", "larry", "ryme", "tulip", "grusha")], PALDEA),
     "elite_four": _team([(k, "svchampionassessment") for k in ("rika", "poppy", "larry", "hassel")]), "champion": {"key": "geeta", "variant": "svpaldeabattles"}},
]
BY_KEY = {lg["key"]: lg for lg in LEAGUES}
