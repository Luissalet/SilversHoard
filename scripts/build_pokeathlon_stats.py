"""Build the Pokéathlon presets of Silver's Hoard from the research folder.

    python scripts/build_pokeathlon_stats.py <folder with stats_all.json, cosmetic_formes.json and data/npc_teams.json>

Writes silvers_hoard/presets/pokeathlon_stats.json.gz (the five stars of every species and forme as {base, min, max}: read from the
game's table where HeartGold / SoulSilver has the Pokémon, inherited for its formes, predicted for the rest and flagged ``derived``)
and silvers_hoard/presets/pokeathlon_npc.json.gz (the game's 100 rival teams with their lines in Spanish and English and the stars
each Pokémon plays with: the table's base value, which is what the game's NPC teams use)."""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

STATS = ("speed", "power", "skill", "stamina", "jump")
OUT = Path(__file__).resolve().parent.parent / "silvers_hoard" / "presets"

# The rivals' lines, in the game's Spanish (castellano) style; the key is the English line from the game's text bank.
LINES_ES = {
    "Wow, you’re energetic and hardworking! I won’t get tricked by your cuteness!": "¡Vaya, qué energía y qué esfuerzo! ¡No me dejaré engañar por tu monería!",
    "Don’t eat the grass along the road of life! My personal slogan!": "¡No comas hierba por el camino de la vida! ¡Mi lema personal!",
    "Together with these three Pokémon I’ll get stronger! I’ll get bigger!": "¡Junto a estos tres Pokémon me haré más fuerte! ¡Me haré más grande!",
    "Do you think you can keep up with me? They call me the “Victorious Victor”!": "¿Crees que podrás seguirme el ritmo? ¡Me llaman «Víctor el Victorioso»!",
    "Jump! Fight! Be like the wind! Someday I want to fly high!": "¡Salta! ¡Lucha! ¡Sé como el viento! ¡Algún día quiero volar alto!",
    "Behind that cute face lies hidden power! You’ll see it with your own eyes!": "¡Tras esa carita mona se esconde un poder oculto! ¡Lo verás con tus propios ojos!",
    "This is our team! This is our power!": "¡Este es nuestro equipo! ¡Este es nuestro poder!",
    "Power is strength! Strength is power! I’ll use that power to climb to the top!": "¡Poder es fuerza! ¡Fuerza es poder! ¡Usaré ese poder para llegar a lo más alto!",
    "Do you know me!? Do you know what kind of hidden talents I have?!": "¿Me conoces? ¿Sabes qué talentos ocultos tengo?",
    "A Pokémon’s strength and power... I’ll show them to you!": "La fuerza y el poder de un Pokémon... ¡Te los voy a enseñar!",
    "Pokémon’s friendship and affection! If you’ve got that, you’ll never lose!": "¡La amistad y el cariño de los Pokémon! ¡Si los tienes, nunca perderás!",
    "My Pokémon are always protecting me! So there’s no way that we’ll lose!": "¡Mis Pokémon siempre me protegen! ¡Así que es imposible que perdamos!",
    "The accuracy of Bug-type Pokémon! I’m a man who knows all about them!": "¡La precisión de los Pokémon de tipo Bicho! ¡Soy un hombre que lo sabe todo sobre ellos!",
    "That skill is like a well-oiled machine! The result of the calculation is...!": "¡Esa habilidad es como una máquina bien engrasada! ¡El resultado del cálculo es...!",
    "Do you know the skill of these Pokémon?!": "¿Conoces la habilidad de estos Pokémon?",
    "Never crumble, no matter what happens! That’s the kind of friendship we’ve got!": "¡Nunca te derrumbes, pase lo que pase! ¡Esa es la clase de amistad que tenemos!",
    "That kind of tenacity is common in everyone! That spirit! That gutsiness!": "¡Esa tenacidad es común en todos! ¡Ese espíritu! ¡Ese coraje!",
    "On the mountain five years together... The friendship is everlasting!": "Cinco años juntos en la montaña... ¡La amistad es eterna!",
    "Master fighting! Live for fighting! And live for the Pokéathlon!": "¡Domina el combate! ¡Vive para luchar! ¡Y vive para el Pokéathlon!",
    "I can see victory! That’s because I don’t think there’s any way I’ll lose!": "¡Veo la victoria! ¡Es que no creo que haya forma de que pierda!",
    "I can fly with these Pokémon so far! Over the rainbow!": "¡Con estos Pokémon puedo volar muy lejos! ¡Más allá del arcoíris!",
    "Jump to victory! Jump to the other side of victory!": "¡Salta hacia la victoria! ¡Salta al otro lado de la victoria!",
    "Why can you jump that high?! Simple, it’s because it’s all you can do.": "¿Por qué puedes saltar tan alto? Es sencillo: porque es lo único que sabes hacer.",
    "We’re not done. We’re just beginning! We’ll show you just how far we can jump!": "¡No hemos terminado, estamos empezando! ¡Te mostraremos hasta dónde podemos saltar!",
    "Flying is like breathing to me! That’s only natural, if you ask me.": "¡Volar es como respirar para mí! Es lo más natural del mundo, si me preguntas.",
    "It’s impossible to measure that speed! A legendary team known for speed!": "¡Es imposible medir esa velocidad! ¡Un equipo legendario famoso por su rapidez!",
    "Finally here! The amazingly persistent Gym Leader! How much true power?": "¡Por fin aquí! ¡La asombrosamente persistente líder de gimnasio! ¿Cuánto poder de verdad tiene?",
    "Cuteness, strength, and speed! A girl with sparkle!": "¡Monería, fuerza y velocidad! ¡Una chica con brillo!",
    "Nothing in front of this guy... Even a bolt of lightning can come from behind!": "Nada puede con este tipo... ¡Hasta un rayo puede llegar por la espalda!",
    "Run! The thing beyond that--the goal is called friendship!": "¡Corre! ¡Lo que hay más allá, la meta, se llama amistad!",
    "The famous guy on the TV all the time is now participating in the Pokéathlon!": "¡El famoso que sale siempre en la tele participa ahora en el Pokéathlon!",
    "All right! The cute and energetic Gym Leader from the Sinnoh region!": "¡Muy bien! ¡La mona y enérgica líder de gimnasio de la región de Sinnoh!",
    "Power... That is cuteness! Could you possibly believe that power?": "El poder... ¡es monería! ¿Podrías llegar a creer en ese poder?",
    "Abandon common sense! This is reality!": "¡Abandona el sentido común! ¡Esta es la realidad!",
    "Power is everything! Power is right! Power is proof of friendship!": "¡El poder lo es todo! ¡El poder tiene la razón! ¡El poder es la prueba de la amistad!",
    "I’ve got innate talent! This genius is going to seize victory!": "¡Tengo talento innato! ¡Este genio se va a llevar la victoria!",
    "Friendship? We don’t need it. That’s because we are already one.": "¿Amistad? No la necesitamos. Porque ya somos uno.",
    "My Pokémon are always protecting me, so there’s no way we can lose!": "¡Mis Pokémon siempre me protegen, así que es imposible que perdamos!",
    "Such splendid dancing and splendid winning! I’ve come from Ecruteak City!": "¡Qué baile tan espléndido y qué victoria tan espléndida! ¡Vengo de Ciudad Iris!",
    "Are we looking at an illusion? The most skilled Pokéathlete!": "¿Estamos viendo una ilusión? ¡El Pokéatleta más habilidoso!",
    "Gym Leader of steel is participating! I’ll show you steely determination!": "¡Participa la líder de gimnasio de acero! ¡Te mostraré una determinación de acero!",
    "I’m so full of energy! What’s fatigue? Where’s this stamina coming from?!": "¡Estoy rebosante de energía! ¿Qué es el cansancio? ¿De dónde sale tanta resistencia?",
    "Chance of victory: 100%! No doubt! I just came up with that calculation!": "¡Probabilidad de victoria: 100 %! ¡Sin duda! ¡Acabo de hacer ese cálculo!",
    "Morning is practice, noon is practice, and evening...is training!": "Por la mañana, práctica; a mediodía, práctica; y por la tarde... ¡entrenamiento!",
    "He said it... Fatigue is not in our vocabulary!": "Lo ha dicho... ¡La fatiga no existe en nuestro vocabulario!",
    "The world we’re aiming for is the championship, that world!": "¡El mundo al que aspiramos es el campeonato, ese mundo!",
    "Flying... Even gravity is keeping its distance from her!": "Volar... ¡Hasta la gravedad guarda las distancias con ella!",
    "The Gym Leader of flight appears! My dad’s Pokémon really soar!": "¡Aparece el líder de gimnasio del vuelo! ¡Los Pokémon de mi padre sí que se elevan!",
    "We can go as far as we want... Come on, let’s go together!": "Podemos llegar tan lejos como queramos... ¡Venga, vamos juntos!",
    "There’s no sky above him! There’s a sky below him!": "¡No hay cielo sobre él! ¡Hay un cielo bajo sus pies!",
}


def clean_line(line: str) -> str:
    return line.replace("//", "").strip()


def write(path: Path, data: dict) -> None:
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def main(src: Path) -> None:
    stats = json.loads((src / "stats_all.json").read_text("utf-8"))
    cosmetic: set[str] = set()
    cos_path = src / "cosmetic_formes.json"
    if cos_path.exists():
        for group in json.loads(cos_path.read_text("utf-8")):
            cosmetic.update(group.get("forms", []))
    rows = []
    by_num: dict[int, dict] = {}
    for e in stats:
        row = {
            "id": e["id"], "name": e["name"], "num": e["num"], "baseSpecies": e["baseSpecies"], "forme": e["forme"], "gen": e["gen"],
            "types": e["types"], "source": e["source"], "derived": bool(e["derived"]), "large": bool(e.get("large")),
            "stars": {k: {"base": e[k]["base"], "min": e[k]["min"], "max": e[k]["max"]} for k in STATS},
        }
        if e.get("inheritedFrom"):
            row["inheritedFrom"] = e["inheritedFrom"]
        if e["name"] in cosmetic or e["forme"] in ("Gmax", "Totem") or e["name"].endswith("-Totem"):
            row["noRandom"] = True   # a cosmetic forme, a Gigantamax or a Totem: it plays like its species but is not drawn for random teams
        rows.append(row)
        if not e["forme"] and e["name"] == e["baseSpecies"]:
            by_num[e["num"]] = e
    OUT.mkdir(parents=True, exist_ok=True)
    write(OUT / "pokeathlon_stats.json.gz", {
        "version": 2, "note": "stars 1-5 as {base, min, max}; source rom = the game's table, rom-forme = inherited from the species, derived = estimated",
        "pokemon": rows})
    teams = []
    for t in json.loads((src / "data" / "npc_teams.json").read_text("utf-8")):
        line_en = clean_line(t["line"])
        if line_en not in LINES_ES:
            raise SystemExit(f"no Spanish line for: {line_en}")
        mons = []
        for m in t["mons"]:
            ref = by_num.get(m["species"])
            if not ref:
                raise SystemExit(f"species {m['species']} not in the table")
            raw = m["rawBase"]   # the game's order: Power, Speed, Jump, Stamina, Skill (0-4)
            got = {"power": raw[0] + 1, "speed": raw[1] + 1, "jump": raw[2] + 1, "stamina": raw[3] + 1, "skill": raw[4] + 1}
            if got != {k: ref[k]["base"] for k in STATS}:
                raise SystemExit(f"stars differ for {ref['name']}")
            mons.append({"name": ref["name"], "species": ref["num"], "stars": got, "rawBase": list(raw)})
        teams.append({"team": t["team"], "name": t["name"], "line_en": line_en, "line_es": LINES_ES[line_en], "supreme": t["team"] > 50,
                      "mons": mons, "stars_sum": t["rawSum"], "challenge": t["challengeBonus"]})
    write(OUT / "pokeathlon_npc.json.gz", {"version": 2, "teams": teams})
    print(f"{len(rows)} Pokémon, {len(teams)} teams written to {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
