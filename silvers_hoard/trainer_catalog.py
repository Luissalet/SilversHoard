"""Game regions shared by the character catalogue and saved trainer filters."""

GAME_REGIONS = {
    "rb": ["Kanto"], "y": ["Kanto"], "stadium": ["Kanto"], "frlg": ["Kanto"], "lgpe": ["Kanto"],
    "gsc": ["Johto", "Kanto"], "hgss": ["Johto", "Kanto"], "stadium2": ["Johto", "Kanto"],
    "rs": ["Hoenn"], "e": ["Hoenn"], "oras": ["Hoenn"],
    "dp": ["Sinnoh"], "pt": ["Sinnoh"], "bdsp": ["Sinnoh"], "la": ["Hisui"],
    "bw": ["Unova"], "b2w2": ["Unova"], "xy": ["Kalos"], "za": ["Kalos"],
    "sm": ["Alola"], "usum": ["Alola"], "swsh": ["Galar"], "sv": ["Paldea", "Kitakami", "Unova"],
    "unbound": ["Borrius"],
}


def regions_for(games):
    return list(dict.fromkeys(r for game in games for r in GAME_REGIONS.get(game, [])))
