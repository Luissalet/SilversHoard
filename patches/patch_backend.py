"""Idempotent edits to the shared backend files (run from the worktree root): the Pokéathlon wiring in store, services and agent_tools."""
import re
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")


def edit(rel, fn):
    p = root / rel
    s = p.read_text("utf-8")
    t = fn(s)
    if t != s:
        p.write_text(t, "utf-8", newline="\n")
        print("patched", rel)
    else:
        print("unchanged", rel)


def store(s):
    if "SCHEMA_V8" in s:
        return s
    s = s.replace("from .hoard_link.sqlkit import Database, dumps, loads\n",
                  "from .hoard_link.sqlkit import Database, dumps, loads\nfrom .pokeathlon import SCHEMA as SCHEMA_V8   # the Pokéathlon's tables\n", 1)
    s = s.replace("SCHEMA_V6, SCHEMA_V7])", "SCHEMA_V6, SCHEMA_V7, SCHEMA_V8])", 1)
    return s


def services(s):
    if "Pokeathlon" in s:
        return s
    s = s.replace("from .arenas import CUSTOM as ARENA_CUSTOM, Arenas, same as arenas_same\n",
                  "from .arenas import CUSTOM as ARENA_CUSTOM, Arenas, same as arenas_same\nfrom .pokeathlon import Pokeathlon\n", 1)
    s = s.replace("        self.arenas = Arenas(self)\n", "        self.arenas = Arenas(self)\n        self.pokeathlon = Pokeathlon(self)\n", 1)
    return s


BLOCK = '''    Tool("pokeathlon_stats", _d("Pokéathlon stars of any Pokémon (Speed, Power, Skill, Stamina, Jump). Estrellas del Pokéathlon.",
                                "Five stars (1-5) with the range the game's daily form moves them in. The game's own table covers generations 1-4 and the "
                                "HeartGold / SoulSilver formes; every other Pokémon is predicted (estimated=true). Give names or a query.",
                                synonyms="estrellas, velocidad fortaleza precisión resistencia salto, pokéathlon, atletismo"),
         AthlonStatsArgs, R, lambda s, a: s.pokeathlon.stats(a)),
    Tool("pokeathlon_courses", _d("The Pokéathlon's courses, events, medals and rules. Competiciones del Pokéathlon.",
                                  "Courses 0-4 (3 events), 5-9 (two medals, 4 events) and 10 (Supreme); each event with its stats, target score and trophy score.",
                                  synonyms="eventos, saltaobstáculos, atrapabanderas, carrera de relevos, rompelosas, pisacírculos, insignias"),
         Empty, R, lambda s, a: s.pokeathlon.courses()),
    Tool("pokeathlon_rivals", _d("Draw a course's rival teams (the game's 100 teams or random Pokémon) and its events. Rivales del Pokéathlon.",
                                 "The same seed gives the same rivals; the Supreme Cup uses the game's harder teams; course 10 also draws its four events.",
                                 synonyms="equipos rivales, copa suprema, competición suprema, cualquier pokémon"), AthlonRivalsArgs, R,
         lambda s, a: s.pokeathlon.rivals(a)),
    Tool("pokeathlon_result_save", _d("Save a finished Pokéathlon course: scores, bonuses, winner, medals and records. Guardar competición.",
                                      "Points, totals and the winner are computed here from the raw scores. A win gives the course's badge to the winning "
                                      "team's species; mode=watch (the CPU played your team) is kept in the history only.",
                                      synonyms="resultado, récord, insignias, puntos de atleta"), AthlonSaveArgs, W, lambda s, a: s.pokeathlon.save(a)),
    Tool("pokeathlon_records", _d("A trainer's Pokéathlon records: best course totals, top 5 per event, badges, points. Récords del Pokéathlon.",
                                  synonyms="mejores marcas, medallas, insignias por pokémon, estadísticas"), AthlonRecordsArgs, R,
         lambda s, a: s.pokeathlon.records(a)),
    Tool("pokeathlon_history", _d("Saved Pokéathlon courses, or one with every round, team and bonus. Historial del Pokéathlon.",
                                  synonyms="competiciones jugadas, ver competición"), AthlonHistoryArgs, R, lambda s, a: s.pokeathlon.history(a)),
'''


def tools(s):
    if "pokeathlon_stats" in s:
        return s
    s = s.replace("from .services import Services\n",
                  "from .pokeathlon import HistoryArgs as AthlonHistoryArgs, RecordsArgs as AthlonRecordsArgs, RivalsArgs as AthlonRivalsArgs, "
                  "SaveArgs as AthlonSaveArgs, StatsArgs as AthlonStatsArgs\nfrom .services import Services\n", 1)
    anchor = '    Tool("settings_get",'
    assert anchor in s
    s = s.replace(anchor, BLOCK + anchor, 1)
    return s


edit("silvers_hoard/store.py", store)
edit("silvers_hoard/services.py", services)
edit("silvers_hoard/agent_tools.py", tools)
