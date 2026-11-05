"""The Pokéathlon of Pokémon HeartGold / SoulSilver, playable with any Pokémon: the stars of every species, the courses and their
events, the game's 100 rival teams (or rivals picked from the whole Pokédex), and the records of the courses a trainer plays.

The events themselves run in the browser (client/src/pokeathlon); this module holds what must outlive a page: stars, rival draws and
the saved courses. Rules and numbers come from the game's own code. The five stars (Speed, Power, Skill, Stamina, Jump, shown
1-5) are read from the game's table for the 493 Pokémon of generations 1-4 and the formes HeartGold / SoulSilver has; for every
other Pokémon they are predicted from base stats, size, types and evolution (about half of the base values come out exactly right
and nearly all within one star), and flagged ``estimated``.

Saved courses are checked here again: event points, bonuses, totals and the winner are computed from the raw scores the page sends,
so a record never depends on what the browser claims."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, Optional

from pydantic import BaseModel, Field

from .errors import SilverError
from .hoard_link.ids import new_id
from .hoard_link.sqlkit import dumps, loads

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services

PRESETS = Path(__file__).resolve().parent / "presets"
STATS = ("speed", "power", "skill", "stamina", "jump")
MEDAL_BITS = {"speed": 1, "power": 2, "skill": 4, "stamina": 8, "jump": 16}
STAT_NAMES = {"speed": ("Velocidad", "Speed"), "power": ("Fortaleza", "Power"), "skill": ("Precisión", "Skill"),
              "stamina": ("Resistencia", "Stamina"), "jump": ("Salto", "Jump")}
NEUTRAL = {k: [3, 1, 5] for k in STATS}

# SCHEMA_V8 of the database (store.py appends it to the migrations; another branch may renumber it): saved courses, the rounds of
# the courses a trainer played, and the medals of each species. Nothing here refers to another table.
SCHEMA = """
CREATE TABLE pokeathlon_courses (
  id TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL DEFAULT '',
  course INTEGER NOT NULL,
  supreme INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'play',
  seed TEXT NOT NULL DEFAULT '',
  team INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  place INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  medals INTEGER NOT NULL DEFAULT 0,
  athlete_points INTEGER NOT NULL DEFAULT 0,
  cheer INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX pokeathlon_courses_recent ON pokeathlon_courses(created_at);
CREATE INDEX pokeathlon_courses_trainer ON pokeathlon_courses(trainer_id, course);
CREATE TABLE pokeathlon_rounds (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL DEFAULT '',
  event INTEGER NOT NULL,
  raw INTEGER NOT NULL,
  points INTEGER NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  species_json TEXT NOT NULL DEFAULT '[]',
  created_at REAL NOT NULL
);
CREATE INDEX pokeathlon_rounds_event ON pokeathlon_rounds(trainer_id, event);
CREATE TABLE pokeathlon_medals (
  trainer_id TEXT NOT NULL,
  species TEXT NOT NULL,
  bits INTEGER NOT NULL DEFAULT 0,
  updated_at REAL NOT NULL,
  PRIMARY KEY (trainer_id, species)
);
"""

# id, key, Spanish, English, stats it reads (the first two are the ones the game names), seconds on the intro card, lower is better,
# target score (a record "beats" it), trophy score
_E = [
    (0, "hurdle_dash", "Saltaobstáculos", "Hurdle Dash", ("speed", "jump", "skill"), 50, True, 3000, 2400),
    (1, "pennant_capture", "Atrapabanderas", "Pennant Capture", ("skill", "speed", "power", "stamina"), 60, False, 35, 50),
    (2, "circle_push", "Pisacírculos", "Circle Push", ("power", "stamina", "speed"), 70, False, 40, 60),
    (3, "block_smash", "Rompelosas", "Block Smash", ("power", "stamina", "skill"), 30, False, 80, 130),
    (4, "disc_catch", "Atrapadiscos", "Disc Catch", ("jump", "power", "speed"), 60, False, 40, 70),
    (5, "lamp_jump", "Botaluces", "Lamp Jump", ("jump", "skill", "stamina"), 60, False, 350, 500),
    (6, "relay_run", "Carrera de relevos", "Relay Run", ("stamina", "speed", "power", "skill"), 90, False, 12288, 16384),
    (7, "ring_drop", "Fuera del ring", "Ring Drop", ("stamina", "power", "speed", "jump"), 60, False, 70, 100),
    (8, "snow_throw", "Nieve cruzada", "Snow Throw", ("skill", "power", "stamina"), 60, False, 30, 55),
    (9, "goal_roll", "Metegoles", "Goal Roll", ("skill", "power", "stamina", "speed"), 90, False, 3, 9),
]
EVENTS = [{"id": i, "key": k, "es": es, "en": en, "stats": list(st), "seconds": sec, "lower_is_better": low, "target": tgt, "trophy": tro}
          for i, k, es, en, st, sec, low, tgt, tro in _E]

# id, Spanish, English, events, medals
_C = [
    (0, "Competición de Velocidad", "Speed Course", (0, 1, 6), ("speed",)),
    (1, "Competición de Fortaleza", "Power Course", (3, 2, 9), ("power",)),
    (2, "Competición de Precisión", "Skill Course", (8, 9, 1), ("skill",)),
    (3, "Competición de Resistencia", "Stamina Course", (7, 6, 3), ("stamina",)),
    (4, "Competición de Salto", "Jump Course", (5, 4, 0), ("jump",)),
    (5, "Competición de Velocidad y Salto", "Speed & Jump Course", (0, 5, 4, 6), ("speed", "jump")),
    (6, "Competición de Salto y Precisión", "Jump & Skill Course", (5, 4, 1, 8), ("jump", "skill")),
    (7, "Competición de Precisión y Fortaleza", "Skill & Power Course", (9, 8, 1, 3), ("skill", "power")),
    (8, "Competición de Fortaleza y Resistencia", "Power & Stamina Course", (3, 2, 9, 7), ("power", "stamina")),
    (9, "Competición de Resistencia y Velocidad", "Stamina & Speed Course", (6, 7, 0, 2), ("stamina", "speed")),
    (10, "Competición Suprema", "Supreme Course", (), ()),
]
MASTER_SETS = ((4, 2, 9, 7), (7, 2, 3, 8), (5, 0, 9, 7), (3, 6, 8, 5), (8, 5, 3, 0), (1, 2, 9, 4), (2, 6, 5, 3), (0, 7, 3, 9), (9, 8, 4, 1),
               (6, 3, 7, 0))
COURSES = [{"id": i, "es": es, "en": en, "mode": "solo" if i < 5 else "link" if i < 10 else "master", "rounds": len(ev) or 4,
            "events": list(ev), "medals": list(md), "medal_mask": sum(MEDAL_BITS[m] for m in md)}
           for i, es, en, ev, md in _C]
RANK_POINTS = (100, 80, 70, 60)   # Goal Roll: points of a place; tied teams all get the points of the lowest place of their tie
NPC_RANGE = {False: (31, 45), True: (39, 48)}    # the sum of the 15 base stars of the game's normal and Supreme teams


def toid(text: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


# ------------------------------------------------------------------------------------------------------------ rules
def rank_scores(scores: list[int], lower_is_better: bool = False) -> list[int]:
    """Competition ranks starting at 0 (20, 20, 15, 10 -> 0, 0, 2, 3); equal scores keep the lower team number first."""
    order = sorted(range(len(scores)), key=lambda i: (scores[i] if lower_is_better else -scores[i], i))
    ranks = [0] * len(scores)
    for pos, i in enumerate(order):
        ranks[i] = ranks[order[pos - 1]] if pos and scores[i] == scores[order[pos - 1]] else pos
    return ranks


def event_points(event: int, scores: list[int]) -> list[int]:
    """The 0-200 event points of the four teams' scores in an event (the game's own conversion)."""
    if event == 9:
        ranks = rank_scores(scores)
        out = []
        for i, s in enumerate(scores):
            ties = sum(1 for j, r in enumerate(ranks) if j != i and r == ranks[i])
            out.append(min(200, RANK_POINTS[min(3, ranks[i] + ties)] + 5 * int(s)))
        return out
    out = []
    for s in scores:
        s = int(s)
        if event == 0:
            v = 200 if s <= 0 else 11500 / (s / 30.0)
        elif event in (1, 2, 8):
            v = 3 * s
        elif event == 3:
            v = s
        elif event == 4:
            v = 150 - 120 / (1 + 0.08 * s)
        elif event == 5:
            v = s / 3.5
        elif event == 6:
            v = s / 1024 * 10
        elif event == 7:
            v = 1.5 * s
        else:
            raise SilverError("invalid", f"Not an event: {event}")
        out.append(max(0, min(200, int(v))))
    return out


def challenge_bonus(base_stars: list[int]) -> int:
    """75 minus the 15 base stars of a team (weak teams are helped), kept between 0 and 75."""
    return max(0, min(75, 75 - sum(base_stars)))


def rank_teams(totals: list[int], lots: list[int]) -> list[int]:
    """Places of the four teams (0 = first). A tie for first is drawn: the team with the highest lot wins, the other tied teams are second."""
    places = rank_scores(totals)
    top = [i for i, p in enumerate(places) if p == 0]
    if len(top) > 1:
        winner = max(top, key=lambda i: lots[i])
        for i in top:
            places[i] = 0 if i == winner else 1
    return places


def medal_names(mask: int, lang: str = "es") -> list[str]:
    word = "Insignia" if lang == "es" else "Badge"
    return [f"{word} {STAT_NAMES[k][0 if lang == 'es' else 1]}" for k in STATS if mask & MEDAL_BITS[k]]


class LC:
    """The game's own random generator (LCRandom), seeded from any text."""

    def __init__(self, seed: Any):
        self.state = int.from_bytes(hashlib.sha256(str(seed).encode("utf-8")).digest()[:4], "big")

    def next(self) -> int:
        self.state = (self.state * 1103515245 + 24691) & 0xFFFFFFFF
        return self.state >> 16

    def below(self, n: int) -> int:
        return self.next() % max(1, n)


# ------------------------------------------------------------------------------------------------------------ args
class StatsArgs(BaseModel):
    species: list[str] = Field(default_factory=list, max_length=60, description="Exact names (Showdown spelling, e.g. Rotom-Wash).")
    query: str = Field("", max_length=60, description="Part of a name or a Pokédex number.")
    gen: int = Field(0, ge=0, le=9, description="Only this generation (0 = all).")
    estimated: Optional[bool] = Field(None, description="true = only the Pokémon whose stars are predicted; false = only the game's own.")
    limit: int = Field(30, ge=1, le=300)


class RivalsArgs(BaseModel):
    course: int = Field(0, ge=0, le=10, description="0-4 solo courses, 5-9 two-medal courses, 10 the Supreme Course.")
    supreme: bool = Field(False, description="The Supreme Cup: the game's harder rival teams (always on for course 10).")
    seed: str = Field("", max_length=60, description="Same seed, same rivals and (course 10) same events.")
    any_pokemon: bool = Field(False, description="Rivals made of random Pokémon from the whole Pokédex, balanced like the game's.")
    count: int = Field(3, ge=1, le=3)


class MonIn(BaseModel):
    species: str = Field(..., min_length=1, max_length=60)
    name: str = Field("", max_length=40)
    stars: dict[Literal["speed", "power", "skill", "stamina", "jump"], int] = Field(..., description="The stars it played with, 1-5 each.")


class TeamIn(BaseModel):
    name: str = Field("", max_length=60)
    color: str = Field("", max_length=20)
    human: bool = False
    mons: list[MonIn] = Field(..., min_length=3, max_length=3)


class RoundIn(BaseModel):
    event: int = Field(..., ge=0, le=9)
    raw: list[int] = Field(..., min_length=4, max_length=4, description="The four teams' scores in the event's own unit.")


class BonusIn(BaseModel):
    no_miss: int = Field(0, ge=0, le=30)
    leader: int = Field(0, ge=0, le=60)
    effort: int = Field(0, ge=0, le=30)


class SaveArgs(BaseModel):
    course: int = Field(..., ge=0, le=10)
    supreme: bool = False
    mode: Literal["play", "watch"] = Field("play", description="watch = the CPU played your team too: kept in the history, no records or medals.")
    seed: str = Field("", max_length=60)
    trainer_id: str = Field("", max_length=80, description="Whose record it is ('' = a guest).")
    team: int = Field(0, ge=0, le=3, description="Which of the four teams is yours.")
    teams: list[TeamIn] = Field(..., min_length=4, max_length=4)
    rounds: list[RoundIn] = Field(..., min_length=3, max_length=4)
    bonuses: list[BonusIn] = Field(..., min_length=4, max_length=4, description="Per team: the No-Miss, Points Leader and Prize for Effort bonuses (the Challenge Bonus is computed here).")
    lots: list[int] = Field(default_factory=lambda: [0, 1, 2, 3], min_length=4, max_length=4, description="The drawing of lots for a tie for first place.")


class RecordsArgs(BaseModel):
    trainer_id: str = Field("", max_length=80, description="Whose records ('' = the guest).")
    everyone: bool = Field(False, description="All trainers together.")
    recent: int = Field(8, ge=0, le=50)


class HistoryArgs(BaseModel):
    id: str = Field("", max_length=80, description="One saved course with every round (empty = the list).")
    trainer_id: str = Field("", max_length=80)
    limit: int = Field(20, ge=1, le=200)


# ------------------------------------------------------------------------------------------------------------ service
class Pokeathlon:
    def __init__(self, services: "Services"):
        self.s = services
        self._stats: Optional[list[dict[str, Any]]] = None
        self._index: dict[str, dict[str, Any]] = {}
        self._npc: Optional[list[dict[str, Any]]] = None

    # -- data
    def _load(self) -> None:
        if self._stats is not None:
            return
        with gzip.open(PRESETS / "pokeathlon_stats.json.gz", "rt", encoding="utf-8") as f:
            self._stats = json.load(f)["pokemon"]
        self._index = {e["id"]: e for e in self._stats}
        with gzip.open(PRESETS / "pokeathlon_npc.json.gz", "rt", encoding="utf-8") as f:
            self._npc = json.load(f)["teams"]

    def find(self, name: str) -> Optional[dict[str, Any]]:
        self._load()
        key = toid(name)
        got = self._index.get(key)
        if got is None and "-" in str(name):   # a forme the table does not know: the plain species
            got = self._index.get(toid(str(name).split("-")[0]))
        return got

    def _view(self, e: dict[str, Any]) -> dict[str, Any]:
        st = e["stats"]
        return {"name": e["name"], "num": e["num"], "forme": e["forme"], "base_species": e["base"], "gen": e["gen"], "types": e["types"],
                "estimated": e["estimated"], "source": e["source"], "large": e["large"],
                "stars": {k: st[k][0] for k in STATS}, "min": {k: st[k][1] for k in STATS}, "max": {k: st[k][2] for k in STATS}}

    def _unknown(self, name: str) -> dict[str, Any]:
        return {"name": name, "num": 0, "forme": "", "base_species": name, "gen": 0, "types": [], "estimated": True, "source": "unknown", "large": False,
                "missing": True, "stars": {k: 3 for k in STATS}, "min": {k: 1 for k in STATS}, "max": {k: 5 for k in STATS}}

    def stats(self, a: StatsArgs) -> dict[str, Any]:
        self._load()
        assert self._stats is not None
        if a.species:
            found = [self.find(n) for n in a.species]
            return {"pokemon": [self._view(e) if e else self._unknown(n) for n, e in zip(a.species, found)], "total": len(found)}
        q = a.query.strip().lower()
        rows = []
        for e in self._stats:
            if a.gen and e["gen"] != a.gen:
                continue
            if a.estimated is not None and e["estimated"] != a.estimated:
                continue
            if q and not (q.isdigit() and e["num"] == int(q)) and q not in e["name"].lower() and q not in e["id"]:
                continue
            rows.append(e)
        rows.sort(key=lambda e: (e["num"], e["forme"] != "", e["name"]))
        return {"pokemon": [self._view(e) for e in rows[: a.limit]], "total": len(rows)}

    def courses(self) -> dict[str, Any]:
        return {"courses": COURSES, "events": EVENTS, "medals": [{"stat": k, "bit": MEDAL_BITS[k], "es": f"Insignia {STAT_NAMES[k][0]}",
                                                                  "en": f"{STAT_NAMES[k][1]} Badge"} for k in STATS],
                "stats": [{"key": k, "es": STAT_NAMES[k][0], "en": STAT_NAMES[k][1]} for k in STATS],
                "rules": {"teams": 4, "mons_per_team": 3, "challenge_bonus": "75 minus the 15 base stars of the team",
                          "no_miss": "10 per Pokémon that failed, fell and impeded itself never", "points_leader": "20 per Pokémon with the most points",
                          "prize_for_effort": "10 per Pokémon with the most of one statistic",
                          "win_bonus": {"solo": 100, "supreme_solo": 300, "link": [500, 200]}}}

    # -- rivals
    def _npc_team(self, number: int) -> dict[str, Any]:
        self._load()
        assert self._npc is not None
        t = self._npc[number - 1]
        mons = [self._view(self.find(n)) for n in t["mons"]]
        return {"team": t["team"], "npc": True, "name": t["name"], "line_es": t["line_es"], "line_en": t["line_en"], "mons": mons,
                "stars_sum": t["stars_sum"], "challenge": t["challenge"]}

    def _random_team(self, rng: LC, supreme: bool, names: list[str]) -> dict[str, Any]:
        self._load()
        assert self._stats is not None
        pool = [e for e in self._stats if not e.get("no_random") and e["source"] in ("rom", "derived", "rom-forme")]
        low, high = NPC_RANGE[supreme]
        for _ in range(400):
            picks = [pool[rng.below(len(pool))] for _ in range(3)]
            if len({p["id"] for p in picks}) < 3:
                continue
            total = sum(p["stats"][k][0] for p in picks for k in STATS)
            if low <= total <= high:
                break
        name = names.pop(rng.below(len(names))) if names else "Rival"
        mons = [self._view(p) for p in picks]
        return {"team": 0, "npc": False, "name": name, "line_es": "", "line_en": "", "mons": mons, "stars_sum": total,
                "challenge": challenge_bonus([sum(m["stars"].values()) for m in mons])}

    def rivals(self, a: RivalsArgs) -> dict[str, Any]:
        self._load()
        assert self._npc is not None
        seed = a.seed or f"{time.time_ns()}"
        rng = LC(f"{seed}|{a.course}|{int(a.supreme)}")
        supreme = a.supreme or a.course == 10
        events = list(COURSES[a.course]["events"]) or list(MASTER_SETS[rng.below(10)])
        teams: list[dict[str, Any]] = []
        if a.any_pokemon:
            used = list(dict.fromkeys(t["name"] for t in self._npc))
            teams = [self._random_team(rng, supreme, used) for _ in range(a.count)]
        else:
            pool = list(range(25, 50)) if a.course == 10 else [5 * a.course + i for i in range(5)]
            if supreme:
                pool = [p + 50 for p in pool]
            remaining = len(pool)
            for _ in range(a.count):
                at = rng.below(remaining)
                number = pool[at] + 1
                remaining -= 1
                pool[at] = pool[remaining]
                teams.append(self._npc_team(number))
        return {"course": a.course, "supreme": supreme, "seed": seed, "events": events, "teams": teams, "any_pokemon": a.any_pokemon}

    # -- saving
    def _base_stars(self, m: MonIn) -> list[int]:
        e = self.find(m.species)
        return [e["stats"][k][0] for k in STATS] if e else list(m.stars.values())

    def save(self, a: SaveArgs) -> dict[str, Any]:
        course = COURSES[a.course]
        supreme = a.supreme or a.course == 10
        if course["events"]:
            wanted = course["events"]
        else:
            wanted = None
        events = [r.event for r in a.rounds]
        if wanted is not None and events != wanted:
            raise SilverError("invalid", f"Course {a.course} is played in the events {wanted}, not {events}.")
        if wanted is None and (len(events) != 4 or tuple(events) not in MASTER_SETS):
            raise SilverError("invalid", "The Supreme Course plays one of the game's ten sets of four events.")
        if len(set(events)) != len(events):
            raise SilverError("invalid", "An event is not repeated inside a course.")
        for t in a.teams:
            for m in t.mons:
                if any(not 1 <= v <= 5 for v in m.stars.values()) or len(m.stars) != 5:
                    raise SilverError("invalid", "Every Pokémon has the five stars, 1 to 5 each.")
        if a.lots and sorted(a.lots) != [0, 1, 2, 3]:
            raise SilverError("invalid", "lots is a permutation of 0-3.")
        if a.trainer_id:
            self.s.store.trainer(a.trainer_id)
        rounds = []
        totals = [0, 0, 0, 0]
        for r in a.rounds:
            pts = event_points(r.event, r.raw)
            ranks = rank_scores(r.raw, EVENTS[r.event]["lower_is_better"])
            rounds.append({"event": r.event, "raw": list(r.raw), "points": pts, "ranks": ranks})
            totals = [x + p for x, p in zip(totals, pts)]
        bonuses = []
        for i, t in enumerate(a.teams):
            b = a.bonuses[i]
            if b.no_miss % 10 or b.leader % 20 or b.effort % 10:
                raise SilverError("invalid", "Bonuses come in tens (No-Miss, Effort) and twenties (Points Leader).")
            ch = challenge_bonus([v for m in t.mons for v in self._base_stars(m)])
            bonuses.append({"challenge": ch, "no_miss": b.no_miss, "leader": b.leader, "effort": b.effort})
            totals[i] += ch + b.no_miss + b.leader + b.effort
        places = rank_teams(totals, a.lots)
        me = a.team
        won = places[me] == 0
        playing = a.mode == "play"
        total = totals[me]
        medals = course["medal_mask"] if (playing and won) else 0
        link = a.course >= 5
        points = total * (2 if a.course == 10 else 1)
        if playing:
            points += (500 if places[me] == 0 else 200 if places[me] == 1 else 0) if link else (0 if not won else 300 if supreme else 100)
        cheer = {0: 15 if link else 10, 1: 10 if link else 5, 2: 0, 3: -5}.get(places[me], 0) if playing else 0
        detail = {"teams": [t.model_dump() for t in a.teams], "rounds": rounds, "bonuses": bonuses, "totals": totals, "places": places, "lots": a.lots}
        best_before = self.s.store.db.scalar(
            "SELECT MAX(total) FROM pokeathlon_courses WHERE trainer_id = ? AND course = ? AND supreme = ? AND mode = 'play' AND won = 1",
            (a.trainer_id, a.course, int(supreme)), default=0) or 0
        now = time.time()
        id_ = new_id("pka")
        with self.s.store.db.tx():
            self.s.store.db.insert("pokeathlon_courses", {
                "id": id_, "trainer_id": a.trainer_id, "course": a.course, "supreme": int(supreme), "mode": a.mode, "seed": a.seed, "team": me,
                "total": total, "place": places[me], "won": int(won), "medals": medals, "athlete_points": points, "cheer": cheer,
                "detail_json": dumps(detail), "created_at": now, "updated_at": now})
            if playing:
                species = [m.species for m in a.teams[me].mons]
                for r in rounds:
                    self.s.store.db.insert("pokeathlon_rounds", {
                        "id": new_id("pkr"), "course_id": id_, "trainer_id": a.trainer_id, "event": r["event"], "raw": int(r["raw"][me]),
                        "points": r["points"][me], "rank": r["ranks"][me], "species_json": dumps(species), "created_at": now})
                if medals:
                    for sp in species:
                        have = self.s.store.db.scalar("SELECT bits FROM pokeathlon_medals WHERE trainer_id = ? AND species = ?", (a.trainer_id, sp), default=0) or 0
                        self.s.store.db.insert("pokeathlon_medals", {"trainer_id": a.trainer_id, "species": sp, "bits": have | medals, "updated_at": now},
                                               on_conflict="replace")
        athlete_total = self.s.store.db.scalar("SELECT COALESCE(SUM(athlete_points), 0) FROM pokeathlon_courses WHERE trainer_id = ? AND mode = 'play'",
                                               (a.trainer_id,), default=0) or 0
        self.s.emit("pokeathlon.saved", {"id": id_, "course": a.course, "won": won})
        return {"id": id_, "course": a.course, "course_name": {"es": course["es"], "en": course["en"]}, "supreme": supreme, "mode": a.mode, "team": me,
                "totals": totals, "total": total, "places": places, "place": places[me], "won": won, "rounds": rounds, "bonuses": bonuses,
                "medal_bits": medals, "medals": {"es": medal_names(medals, "es"), "en": medal_names(medals, "en")},
                "new_best": bool(playing and won and total > best_before), "best_before": best_before,
                "athlete_points": points, "athlete_total": min(99999, int(athlete_total)), "cheer": cheer}

    # -- records
    def records(self, a: RecordsArgs) -> dict[str, Any]:
        db = self.s.store.db
        who = ("", ()) if a.everyone else ("trainer_id = ? AND ", (a.trainer_id,))
        courses = []
        for c in COURSES:
            for sup in (0, 1):
                rows = db.query(f"SELECT total, won, place, id, created_at FROM pokeathlon_courses WHERE {who[0]}course = ? AND supreme = ? AND mode = 'play'",
                                (*who[1], c["id"], sup))
                if not rows:
                    continue
                won_rows = [r for r in rows if r["won"]]
                best = max(won_rows, key=lambda r: r["total"]) if won_rows else None
                courses.append({"course": c["id"], "supreme": bool(sup), "plays": len(rows), "wins": len(won_rows),
                                "best_total": best["total"] if best else 0, "best_id": best["id"] if best else "",
                                "best_place": min(r["place"] for r in rows), "last_at": max(r["created_at"] for r in rows)})
        events = []
        for ev in EVENTS:
            order = "ASC" if ev["lower_is_better"] else "DESC"
            rows = db.query(f"SELECT raw, points, rank, species_json, created_at, course_id FROM pokeathlon_rounds WHERE {who[0]}event = ? "
                            f"ORDER BY raw {order}, created_at LIMIT 5", (*who[1], ev["id"]))
            if rows:
                top = [{"raw": r["raw"], "points": r["points"], "rank": r["rank"], "species": loads(r["species_json"], []), "at": r["created_at"],
                        "course_id": r["course_id"]} for r in rows]
                best = top[0]["raw"]
                beats = best < ev["target"] if ev["lower_is_better"] else best > ev["target"]
                events.append({"event": ev["id"], "top": top, "beats_target": beats})
        medal_rows = db.query("SELECT species, bits FROM pokeathlon_medals" + ("" if a.everyone else " WHERE trainer_id = ?"), () if a.everyone else (a.trainer_id,))
        merged: dict[str, int] = {}
        for r in medal_rows:
            merged[r["species"]] = merged.get(r["species"], 0) | int(r["bits"])
        medals = [{"species": sp, "bits": b, "names": {"es": medal_names(b, "es"), "en": medal_names(b, "en")}, "complete": b == 31}
                  for sp, b in sorted(merged.items())]
        agg = db.one(f"SELECT COUNT(*) AS n, COALESCE(SUM(won), 0) AS wins, COALESCE(SUM(athlete_points), 0) AS pts, COALESCE(SUM(cheer), 0) AS cheer "
                     f"FROM pokeathlon_courses WHERE {who[0]}mode = 'play'", who[1])
        recent = []
        if a.recent:
            for r in db.query(f"SELECT * FROM pokeathlon_courses WHERE {who[0]}1 = 1 ORDER BY created_at DESC LIMIT ?", (*who[1], a.recent)):
                recent.append(self._card(r))
        return {"trainer_id": "" if a.everyone else a.trainer_id, "courses": courses, "events": events, "medals": medals,
                "medalists": sum(1 for m in medals if m["complete"]),
                "stats": {"courses": agg["n"], "wins": agg["wins"], "athlete_points": min(99999, int(agg["pts"])), "popularity": max(0, min(65535, int(agg["cheer"])))},
                "recent": recent}

    def _card(self, r: Any) -> dict[str, Any]:
        d = loads(r["detail_json"], {})
        team = (d.get("teams") or [{}] * 4)[r["team"]]
        return {"id": r["id"], "course": r["course"], "supreme": bool(r["supreme"]), "mode": r["mode"], "trainer_id": r["trainer_id"], "total": r["total"],
                "place": r["place"], "won": bool(r["won"]), "at": r["created_at"], "species": [m.get("species") for m in team.get("mons", [])],
                "athlete_points": r["athlete_points"], "totals": d.get("totals", [])}

    def history(self, a: HistoryArgs) -> dict[str, Any]:
        db = self.s.store.db
        if a.id:
            r = db.one("SELECT * FROM pokeathlon_courses WHERE id = ?", (a.id,))
            if not r:
                raise SilverError("not_found", f"Course not found: {a.id}")
            return {**self._card(r), "seed": r["seed"], "team": r["team"], "detail": loads(r["detail_json"], {})}
        rows = db.query("SELECT * FROM pokeathlon_courses WHERE (? = '' OR trainer_id = ?) ORDER BY created_at DESC LIMIT ?", (a.trainer_id, a.trainer_id, a.limit))
        return {"courses": [self._card(r) for r in rows]}
