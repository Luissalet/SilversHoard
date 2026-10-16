"""The Pokéathlon of Pokémon HeartGold / SoulSilver, playable with any Pokémon: the stars of every species, the courses and their events,
the game's 100 rival teams and the records of what a trainer has played.

The events run in the browser (client/src/pokeathlon); this module holds what must outlive a page: the stars, the rival teams and the saved
courses. The five stars (Speed, Power, Skill, Stamina, Jump, 1-5) are read from the game's table for the Pokémon HeartGold / SoulSilver has
(and inherited by their formes); every other Pokémon has them predicted from base stats, size, types and evolution, flagged ``derived``.

A saved course is checked again here: the event points, the Challenge Bonus, the No-Miss / Points Leader / Prize for Effort bonuses (when the
page sent the Pokémon's counters), the totals and the places come from the raw scores, so a record never depends on what the browser says.
Only the drawing of lots that breaks a tie for first place stays with the page (any tied team is accepted)."""

from __future__ import annotations

import gzip
import json
import re
import threading
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
COUNTERS = ("failed", "jumped", "points", "hit", "fell", "dashed", "switched", "impeded")
EFFORT_KINDS = ("jumped", "hit", "failed", "dashed")   # the statistics the Prize for Effort looks at, in the game's order
ATHLETE_CAP = 99999
GOLD, SILVER = 450, 420    # the best total of a course that earns its gold and its silver

# SCHEMA_V8 of the database (store.py appends it to the migrations): the courses saved, the rounds of the ones a trainer played and the
# medals of each species. Nothing here refers to another table.
SCHEMA = """
CREATE TABLE pokeathlon_courses (
  id TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL DEFAULT '',
  course_key TEXT NOT NULL,
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
  created_at REAL NOT NULL
);
CREATE INDEX pokeathlon_courses_recent ON pokeathlon_courses(created_at);
CREATE INDEX pokeathlon_courses_trainer ON pokeathlon_courses(trainer_id, course_key);
CREATE TABLE pokeathlon_rounds (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  raw INTEGER NOT NULL,
  points INTEGER NOT NULL,
  place INTEGER NOT NULL DEFAULT 0,
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

# id, number in the game, Spanish, English, stats it reads, lower score is better, target score (a record "beats" it), trophy score, unit
_E = [
    ("hurdle_dash", 0, "Saltaobstáculos", "Hurdle Dash", ("speed", "jump", "skill"), True, 3000, 2400, "frames"),
    ("pennant_capture", 1, "Atrapabanderas", "Pennant Capture", ("skill", "speed", "power", "stamina"), False, 35, 50, "pennants"),
    ("circle_push", 2, "Pisacírculos", "Circle Push", ("power", "stamina", "speed"), False, 40, 60, "points"),
    ("block_smash", 3, "Rompelosas", "Block Smash", ("power", "stamina", "skill"), False, 80, 130, "blocks"),
    ("disc_catch", 4, "Atrapadiscos", "Disc Catch", ("jump", "power", "speed"), False, 40, 70, "points"),
    ("lamp_jump", 5, "Botaluces", "Lamp Jump", ("jump", "skill", "stamina"), False, 350, 500, "points"),
    ("relay_run", 6, "Carrera de relevos", "Relay Run", ("stamina", "speed", "power", "skill"), False, 12288, 16384, "laps*1024+px"),
    ("ring_drop", 7, "Fuera del ring", "Ring Drop", ("stamina", "power", "speed", "jump"), False, 70, 100, "points"),
    ("snow_throw", 8, "Nieve cruzada", "Snow Throw", ("skill", "power", "stamina"), False, 30, 55, "hits"),
    ("goal_roll", 9, "Metegoles", "Goal Roll", ("skill", "power", "stamina", "speed"), False, 3, 9, "goals"),
]
EVENTS = [{"id": i, "n": n, "es": es, "en": en, "stats": list(st), "lower_is_better": low, "target": tgt, "trophy": tro, "unit": unit}
          for i, n, es, en, st, low, tgt, tro, unit in _E]
EVENT_IDS = [e["id"] for e in EVENTS]
EVENT_BY_ID = {e["id"]: e for e in EVENTS}
RANK_POINTS = (100, 80, 70, 60)   # Goal Roll: the points of a place; tied teams all get the points of the lowest place of their tie

_ev = lambda *nums: [EVENT_IDS[n] for n in nums]   # noqa: E731
MASTER_SETS = [_ev(*s) for s in ((4, 2, 9, 7), (7, 2, 3, 8), (5, 0, 9, 7), (3, 6, 8, 5), (8, 5, 3, 0), (1, 2, 9, 4), (2, 6, 5, 3), (0, 7, 3, 9),
                                 (9, 8, 4, 1), (6, 3, 7, 0))]

# key, game's course number, Spanish, English, events, medal
_C = [
    ("speed", 0, "Competición de Velocidad", "Speed Course", _ev(0, 1, 6), "speed"),
    ("power", 1, "Competición de Fortaleza", "Power Course", _ev(3, 2, 9), "power"),
    ("skill", 2, "Competición de Precisión", "Skill Course", _ev(8, 9, 1), "skill"),
    ("stamina", 3, "Competición de Resistencia", "Stamina Course", _ev(7, 6, 3), "stamina"),
    ("jump", 4, "Competición de Salto", "Jump Course", _ev(5, 4, 0), "jump"),
]
COURSES = [{"key": k, "id": n, "es": es, "en": en, "events": ev, "medal": md, "medal_mask": MEDAL_BITS[md]} for k, n, es, en, ev, md in _C]
COURSES.append({"key": "supreme", "id": 10, "es": "Competición Suprema", "en": "Supreme Course", "events": [], "sets": MASTER_SETS, "medal": "", "medal_mask": 0})
COURSE_BY_KEY = {c["key"]: c for c in COURSES}
SINGLE = "single"
SUPREME_WIN_BONUS, WIN_BONUS = 300, 100    # Athlete Points a win pays on top of the total (the Supreme Cup pays more)
CHEER = (10, 5, 0, -5)                     # the crowd's popularity by place (solo)


_GUARD = threading.Lock()


def service(services: "Services") -> "Pokeathlon":
    """The Pokéathlon of a ``Services`` (made on first use, so nothing else has to know about it)."""
    got = getattr(services, "pokeathlon", None)
    if got is None:
        with _GUARD:
            got = getattr(services, "pokeathlon", None)
            if got is None:
                got = Pokeathlon(services)
                services.pokeathlon = got
    return got


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


def event_points(event: str, scores: list[int]) -> list[int]:
    """The 0-200 event points of the four teams' scores in an event (the game's own conversion)."""
    if event == "goal_roll":
        ranks = rank_scores(scores)
        return [min(200, RANK_POINTS[min(3, ranks[i] + sum(1 for j, r in enumerate(ranks) if j != i and r == ranks[i]))] + 5 * max(0, min(99, int(s))))
                for i, s in enumerate(scores)]
    out = []
    for s in scores:
        s = int(s)
        if event == "hurdle_dash":
            v = 200 if s <= 0 else 11500 / (s / 30.0)
        elif event in ("pennant_capture", "circle_push", "snow_throw"):
            v = 3 * s
        elif event == "block_smash":
            v = s
        elif event == "disc_catch":
            v = 150 - 120 / (1 + 0.08 * s)
        elif event == "lamp_jump":
            v = s / 3.5
        elif event == "relay_run":
            v = s / 1024 * 10
        elif event == "ring_drop":
            v = 1.5 * s
        else:
            raise SilverError("invalid", f"Not an event: {event}")
        out.append(max(0, min(200, int(v))))
    return out


def challenge_bonus(base_stars: list[int]) -> int:
    """75 minus the 15 base stars of a team (weak teams are helped), kept between 0 and 75."""
    return max(0, min(75, 75 - sum(base_stars)))


def norm_counters(raw: Any) -> dict[str, int]:
    out = dict.fromkeys(COUNTERS, 0)
    if isinstance(raw, dict):
        for k in COUNTERS:
            try:
                out[k] = max(0, min(9999, int(raw.get(k) or 0)))
            except (TypeError, ValueError):
                pass
    return out


def award_bonuses(mons: list[list[dict[str, int]]], effort_kind: int = -1) -> dict[str, Any]:
    """The three bonuses the closing ceremony hands out per Pokémon, from the counters of a whole course (4 teams x 3 Pokémon).
    No-Miss: +10 for a Pokémon that never failed, fell or hit itself. Points Leader: +20 for the Pokémon with the most points (nobody
    scored: nobody leads; the original gave all twelve the bonus). Prize for Effort: +10 for the Pokémon with the most of one statistic
    (the page draws which: jumped, hit, failed or dashed; an empty one is skipped to the next)."""
    flat = [(t, s, c) for t, team in enumerate(mons) for s, c in enumerate(team)]
    no_miss = [(t, s) for t, s, c in flat if not c["failed"] and not c["fell"] and not c["impeded"]]
    best = max((c["points"] for _, _, c in flat), default=0)
    leader = [(t, s) for t, s, c in flat if c["points"] == best] if best > 0 else []
    valid = [k for k, name in enumerate(EFFORT_KINDS) if max((c[name] for _, _, c in flat), default=0) > 0]
    kind = effort_kind if effort_kind in valid else (valid[0] if valid else -1)
    effort = []
    if kind >= 0:
        top = max(c[EFFORT_KINDS[kind]] for _, _, c in flat)
        effort = [(t, s) for t, s, c in flat if c[EFFORT_KINDS[kind]] == top]

    def per(picked: list[tuple[int, int]], amount: int) -> list[int]:
        return [sum(1 for t, _ in picked if t == i) * amount for i in range(len(mons))]

    return {"no_miss": per(no_miss, 10), "points_leader": per(leader, 20), "effort": per(effort, 10), "effort_kind": kind,
            "awards": [len([1 for t, _ in no_miss + leader + effort if t == i]) for i in range(len(mons))]}


def settle(totals: list[int], winner: int = -1) -> tuple[list[int], int, bool]:
    """Places of the four teams (0 = first) and the winner. A tie for first is drawn by lots on the page: the winner it names is kept
    when it is one of the tied teams (the others are second), otherwise the lowest team number wins."""
    places = rank_scores(totals)
    top = [i for i, p in enumerate(places) if p == 0]
    tie = len(top) > 1
    chosen = winner if winner in top else top[0]
    if tie:
        for i in top:
            places[i] = 0 if i == chosen else 1
    return places, chosen, tie


def medal_names(mask: int, lang: str = "es") -> list[str]:
    if lang == "es":
        return [f"Insignia {STAT_NAMES[k][0]}" for k in STATS if mask & MEDAL_BITS[k]]
    return [f"{STAT_NAMES[k][1]} Badge" for k in STATS if mask & MEDAL_BITS[k]]


def course_medal(best: int) -> str:
    return "gold" if best >= GOLD else "silver" if best >= SILVER else ""


# ------------------------------------------------------------------------------------------------------------ args
class StatsArgs(BaseModel):
    species: list[str] = Field(default_factory=list, max_length=60, description="Exact names (Showdown spelling, e.g. Rotom-Wash): only those.")
    query: str = Field("", max_length=60, description="Part of a name or a Pokédex number.")
    gen: int = Field(0, ge=0, le=9, description="Only this generation (0 = all).")
    derived: Optional[bool] = Field(None, description="true = only the Pokémon whose stars are predicted; false = only the game's own.")
    limit: int = Field(30, ge=0, le=2000, description="How many to give; 0 = all of them.")


class NpcArgs(BaseModel):
    team: int = Field(0, ge=0, le=100, description="One team by its number (1-100); 0 = the list.")
    supreme: Optional[bool] = Field(None, description="true = only the Supreme Cup's stronger teams (51-75 and 76-100); false = the normal ones.")
    course: str = Field("", max_length=12, description="speed|power|skill|stamina|jump|supreme: only the teams that course draws from (pool).")


class MonIn(BaseModel):
    species: str = Field(..., min_length=1, max_length=60)
    num: int = 0
    form: str = Field("", max_length=40)
    name: str = Field("", max_length=60)
    stars: dict[str, int] = Field(..., description="The stars it played with, 1-5 each (speed, power, skill, stamina, jump).")
    base: dict[str, int] = Field(default_factory=dict, description="Its base stars, when the table does not know the species.")
    derived: bool = False


class TeamIn(BaseModel):
    name: str = Field("", max_length=60)
    color: str = Field("", max_length=20)
    human: bool = False
    cpu: int = Field(0, ge=0, le=1, description="1 = it played at the Supreme difficulty.")
    npc: int = Field(0, ge=0, le=100, description="The game's team number it is (1-100), 0 = made by hand or at random.")
    mons: list[MonIn] = Field(..., min_length=3, max_length=3)


class RoundIn(BaseModel):
    event: str = Field(..., max_length=20)
    raw: list[float] = Field(..., min_length=4, max_length=4, description="The four teams' scores in the event's own unit.")
    counters: Optional[list[list[dict[str, Any]]]] = Field(None, description="Per team and Pokémon: failed, jumped, points, hit, fell, dashed, switched, impeded.")


class BonusIn(BaseModel):
    challenge: list[int] = Field(default_factory=list)
    no_miss: list[int] = Field(default_factory=lambda: [0, 0, 0, 0], max_length=4)
    points_leader: list[int] = Field(default_factory=lambda: [0, 0, 0, 0], max_length=4)
    effort: list[int] = Field(default_factory=lambda: [0, 0, 0, 0], max_length=4)
    effort_kind: int = Field(-1, ge=-1, le=3)


class SaveArgs(BaseModel):
    course: str = Field(..., max_length=12, description="speed|power|skill|stamina|jump|supreme, or single for one event on its own.")
    supreme: bool = Field(False, description="The Supreme Cup: the stronger rivals (always on for the supreme course).")
    mode: Literal["play", "watch"] = Field("play", description="watch = the CPU played your team too: kept in the history, no records, medals or points.")
    seed: int | str = Field(0, description="The seed the page used.")
    trainer_id: str = Field("", max_length=80, description="Whose record it is ('' = the guest of this app).")
    teams: list[TeamIn] = Field(..., min_length=4, max_length=4, description="The four teams; yours is the first with human=true (or the first).")
    rounds: list[RoundIn] = Field(..., min_length=1, max_length=4)
    bonuses: Optional[BonusIn] = Field(None, description="Closing ceremony bonuses (a full course); recomputed when the rounds carry counters.")
    winner: int = Field(0, ge=0, le=3, description="The team the page drew as the winner of a tie for first place.")
    place: list[int] = Field(default_factory=list, max_length=4)
    tie: bool = False
    lang: str = Field("es", max_length=5)


class RecordsArgs(BaseModel):
    trainer_id: str = Field("", max_length=80, description="Whose records ('' = the guest of this app).")
    everyone: bool = Field(False, description="All trainers together.")
    recent: int = Field(8, ge=0, le=50, description="How many of the latest courses to list.")


class HistoryArgs(BaseModel):
    id: str = Field("", max_length=80, description="One saved course with every round (empty = the list).")
    trainer_id: str = Field("", max_length=80)
    limit: int = Field(20, ge=1, le=200)


# ------------------------------------------------------------------------------------------------------------ service
class Pokeathlon:
    def __init__(self, services: "Services"):
        self.s = services
        self._lock = threading.Lock()
        self._rows: Optional[list[dict[str, Any]]] = None
        self._index: dict[str, dict[str, Any]] = {}
        self._npc: Optional[list[dict[str, Any]]] = None

    # -- data
    def _load(self) -> None:
        with self._lock:
            if self._rows is not None:
                return
            with gzip.open(PRESETS / "pokeathlon_stats.json.gz", "rt", encoding="utf-8") as f:
                rows = json.load(f)["pokemon"]
            with gzip.open(PRESETS / "pokeathlon_npc.json.gz", "rt", encoding="utf-8") as f:
                self._npc = json.load(f)["teams"]
            self._index = {e["id"]: e for e in rows}
            self._rows = rows

    def find(self, name: str) -> Optional[dict[str, Any]]:
        self._load()
        got = self._index.get(toid(name))
        if got is None and "-" in str(name):   # a forme the table does not know: its species
            got = self._index.get(toid(str(name).split("-")[0]))
        return got

    def stats(self, a: StatsArgs) -> dict[str, Any]:
        self._load()
        assert self._rows is not None
        if a.species:
            found = [(n, self.find(n)) for n in a.species]
            return {"species": [e for _, e in found if e], "missing": [n for n, e in found if not e], "total": sum(1 for _, e in found if e), "full": False}
        q = a.query.strip().lower()
        rows = []
        for e in self._rows:
            if a.gen and e["gen"] != a.gen:
                continue
            if a.derived is not None and e["derived"] != a.derived:
                continue
            if q and not (q.isdigit() and e["num"] == int(q)) and q not in e["name"].lower() and q not in e["id"]:
                continue
            rows.append(e)
        rows.sort(key=lambda e: (e["num"], e["forme"] != "", e["name"]))
        shown = rows if a.limit == 0 else rows[: a.limit]
        return {"species": shown, "total": len(rows), "full": len(shown) == len(self._rows)}

    def courses(self) -> dict[str, Any]:
        return {
            "courses": COURSES, "events": EVENTS,
            "stats": [{"key": k, "es": STAT_NAMES[k][0], "en": STAT_NAMES[k][1]} for k in STATS],
            "medals": [{"stat": k, "bit": MEDAL_BITS[k], "es": f"Insignia {STAT_NAMES[k][0]}", "en": f"{STAT_NAMES[k][1]} Badge"} for k in STATS],
            "rules": {"teams": 4, "mons_per_team": 3, "challenge_bonus": "75 minus the 15 base stars of the team (0-75)",
                      "no_miss": "10 per Pokémon that never failed, fell or hit itself", "points_leader": "20 per Pokémon with the most points",
                      "prize_for_effort": "10 per Pokémon with the most of one statistic (jumped, hit, failed or dashed)",
                      "event_points": "0-200 per event (SPEC 3.2); Goal Roll pays 100/80/70/60 by place plus 5 per goal",
                      "win_bonus": {"course": WIN_BONUS, "supreme": SUPREME_WIN_BONUS}, "supreme_total_multiplier": 2, "medal_gold": GOLD, "medal_silver": SILVER},
        }

    def npc_teams(self, a: NpcArgs) -> dict[str, Any]:
        self._load()
        assert self._npc is not None
        teams = self._npc
        if a.team:
            teams = [t for t in teams if t["team"] == a.team]
        pool: list[int] = []
        if a.course:
            c = COURSE_BY_KEY.get(a.course)
            if not c:
                raise SilverError("invalid", f"Not a course: {a.course}")
            base = range(25, 50) if c["id"] == 10 else range(5 * c["id"], 5 * c["id"] + 5)
            pool = [n + 1 + (50 if (a.supreme or c["id"] == 10) else 0) for n in base]
            teams = [t for t in teams if t["team"] in pool]
        if a.supreme is not None and not a.course:
            teams = [t for t in teams if bool(t["supreme"]) == a.supreme]
        if a.team and not teams:
            raise SilverError("not_found", f"No such team: {a.team}")
        return {"teams": teams, "total": len(teams), "pool": pool}

    # -- saving
    def _base_of(self, team: TeamIn) -> list[int]:
        if team.npc:
            self._load()
            assert self._npc is not None
            t = next((x for x in self._npc if x["team"] == team.npc), None)
            if t:
                return [v for m in t["mons"] for v in m["stars"].values()]
        out: list[int] = []
        for m in team.mons:
            e = self.find(m.species)
            if e:
                out.extend(e["stars"][k]["base"] for k in STATS)
            else:
                out.extend(int(m.base.get(k) or m.stars.get(k) or 1) for k in STATS)
        return out

    @staticmethod
    def _check_events(a: SaveArgs) -> list[str]:
        events = [r.event for r in a.rounds]
        for e in events:
            if e not in EVENT_BY_ID:
                raise SilverError("invalid", f"Not an event: {e}. They are {', '.join(EVENT_IDS)}.")
        if len(set(events)) != len(events):
            raise SilverError("invalid", "An event is not repeated inside a course.")
        if a.course == SINGLE:
            if len(events) != 1:
                raise SilverError("invalid", "A single event is one round.")
            return events
        course = COURSE_BY_KEY.get(a.course)
        if not course:
            raise SilverError("invalid", f"Not a course: {a.course}. They are {', '.join(COURSE_BY_KEY)} or {SINGLE}.")
        if course["events"] and events != course["events"]:
            raise SilverError("invalid", f"The {a.course} course is played in {course['events']}, not {events}.")
        if not course["events"] and events not in course["sets"]:
            raise SilverError("invalid", "The supreme course plays one of the game's ten sets of four events.")
        return events

    def save(self, a: SaveArgs) -> dict[str, Any]:
        events = self._check_events(a)
        for t in a.teams:
            for m in t.mons:
                if set(m.stars) != set(STATS) or any(not 1 <= int(v) <= 5 for v in m.stars.values()):
                    raise SilverError("invalid", "Every Pokémon has the five stars (speed, power, skill, stamina, jump), 1 to 5 each.")
        if a.trainer_id:
            self.s.store.trainer(a.trainer_id)
        full = a.course != SINGLE
        course = COURSE_BY_KEY.get(a.course)
        supreme = a.supreme or a.course == "supreme"
        me = next((i for i, t in enumerate(a.teams) if t.human), 0)

        rounds = []
        event_totals = [0, 0, 0, 0]
        for r in a.rounds:
            ev = EVENT_BY_ID[r.event]
            raw = [max(0, min(10_000_000, int(v))) for v in r.raw]
            pts = event_points(r.event, raw)
            rounds.append({"event": r.event, "raw": raw, "points": pts, "ranks": rank_scores(raw, ev["lower_is_better"])})
            event_totals = [x + p for x, p in zip(event_totals, pts)]

        bonus = {"challenge": [0] * 4, "no_miss": [0] * 4, "points_leader": [0] * 4, "effort": [0] * 4, "effort_kind": -1, "awards": [0] * 4}
        if full:
            bonus["challenge"] = [challenge_bonus(self._base_of(t)) for t in a.teams]
            counted = [self._counters(a.rounds, ti) for ti in range(4)] if all(r.counters for r in a.rounds) else None
            given = a.bonuses
            if counted is not None:
                bonus.update(award_bonuses(counted, given.effort_kind if given else -1))
            elif given is not None:
                for key, step, top in (("no_miss", 10, 30), ("points_leader", 20, 60), ("effort", 10, 30)):
                    vals = list(getattr(given, key)) + [0] * 4
                    if any(v < 0 or v % step or v > top for v in vals[:4]):
                        raise SilverError("invalid", f"{key} comes in multiples of {step}, at most {top} per team.")
                    bonus[key] = vals[:4]
                bonus["effort_kind"] = given.effort_kind
        totals = [event_totals[i] + bonus["challenge"][i] + bonus["no_miss"][i] + bonus["points_leader"][i] + bonus["effort"][i] for i in range(4)]
        if full:
            places, winner, tie = settle(totals, a.winner)
        else:
            places, winner, tie = list(rounds[0]["ranks"]), (rounds[0]["ranks"].index(0)), False
        won = places[me] == 0
        playing = a.mode == "play"
        total = totals[me]
        medals = course["medal_mask"] if (playing and full and won and course) else 0
        points, cheer = 0, 0
        if playing and full:
            points = total * (2 if a.course == "supreme" else 1) + ((SUPREME_WIN_BONUS if supreme else WIN_BONUS) if won else 0)
            cheer = CHEER[min(3, places[me])]
        elif playing:
            cheer = 0

        db = self.s.store.db
        best_before = db.scalar("SELECT MAX(total) FROM pokeathlon_courses WHERE trainer_id = ? AND course_key = ? AND supreme = ? AND mode = 'play' AND won = 1",
                                (a.trainer_id, a.course, int(supreme)), default=0) or 0
        now = time.time()
        id_ = new_id("pka")
        detail = {"teams": [t.model_dump() for t in a.teams], "rounds": rounds, "bonus": bonus, "totals": totals, "event_totals": event_totals,
                  "places": places, "winner": winner, "tie": tie, "lang": a.lang}
        species = [m.species for m in a.teams[me].mons]
        with db.tx():
            db.insert("pokeathlon_courses", {
                "id": id_, "trainer_id": a.trainer_id, "course_key": a.course, "supreme": int(supreme), "mode": a.mode, "seed": str(a.seed), "team": me,
                "total": total, "place": places[me], "won": int(won), "medals": medals, "athlete_points": points, "cheer": cheer,
                "detail_json": dumps(detail), "created_at": now})
            if playing:
                for r in rounds:
                    db.insert("pokeathlon_rounds", {
                        "id": new_id("pkr"), "course_id": id_, "trainer_id": a.trainer_id, "event": r["event"], "raw": int(r["raw"][me]),
                        "points": r["points"][me], "place": r["ranks"][me], "species_json": dumps(species), "created_at": now})
                if medals:
                    for sp in dict.fromkeys(species):
                        have = db.scalar("SELECT bits FROM pokeathlon_medals WHERE trainer_id = ? AND species = ?", (a.trainer_id, sp), default=0) or 0
                        db.insert("pokeathlon_medals", {"trainer_id": a.trainer_id, "species": sp, "bits": int(have) | medals, "updated_at": now}, on_conflict="replace")
        athlete_total = db.scalar("SELECT COALESCE(SUM(athlete_points), 0) FROM pokeathlon_courses WHERE trainer_id = ? AND mode = 'play'", (a.trainer_id,), default=0) or 0
        self.s.emit("pokeathlon.saved", {"id": id_, "course": a.course, "won": won})
        return {
            "id": id_, "saved": True, "course": a.course, "supreme": supreme, "mode": a.mode, "team": me, "events": events,
            "rounds": rounds, "bonus": bonus, "event_totals": event_totals, "totals": totals, "total": total, "places": places, "place": places[me],
            "winner": winner, "tie": tie, "won": won,
            "medal_mask": medals, "medals": {"es": medal_names(medals, "es"), "en": medal_names(medals, "en")},
            "new_course_record": bool(playing and full and won and total > best_before), "best_before": int(best_before),
            "athlete_points": points, "athlete_total": min(ATHLETE_CAP, int(athlete_total)), "cheer": cheer,
        }

    @staticmethod
    def _counters(rounds: list[RoundIn], team: int) -> list[dict[str, int]]:
        """The three Pokémon's counters of a team added up over the whole course."""
        out = [dict.fromkeys(COUNTERS, 0) for _ in range(3)]
        for r in rounds:
            row = r.counters[team] if r.counters and team < len(r.counters) else []
            for slot in range(3):
                c = norm_counters(row[slot] if slot < len(row) else None)
                for k in COUNTERS:
                    out[slot][k] = min(9999, out[slot][k] + c[k])
        return out

    # -- records
    def records(self, a: RecordsArgs) -> dict[str, Any]:
        db = self.s.store.db
        who, args = ("", ()) if a.everyone else ("trainer_id = ? AND ", (a.trainer_id,))
        rows = db.query(f"SELECT id, course_key, supreme, total, place, won, athlete_points, cheer, created_at FROM pokeathlon_courses WHERE {who}mode = 'play' "
                        f"ORDER BY created_at", args)

        def card(group: list[Any]) -> dict[str, Any]:
            wins = [r for r in group if r["won"]]
            best = max(wins, key=lambda r: r["total"]) if wins else None
            top = best["total"] if best else 0
            return {"best": top, "plays": len(group), "wins": len(wins), "medal": course_medal(top), "best_id": best["id"] if best else "",
                    "best_place": min(r["place"] for r in group), "last_at": max(r["created_at"] for r in group)}

        courses: dict[str, Any] = {}
        supreme_courses: dict[str, Any] = {}
        for c in COURSES:
            plain = [r for r in rows if r["course_key"] == c["key"] and bool(r["supreme"]) == (c["key"] == "supreme")]
            if plain:
                courses[c["key"]] = card(plain)
            if c["key"] != "supreme":
                hard = [r for r in rows if r["course_key"] == c["key"] and r["supreme"]]
                if hard:
                    supreme_courses[c["key"]] = card(hard)
        events: dict[str, list[dict[str, Any]]] = {}
        event_stats: dict[str, dict[str, int]] = {}
        for ev in EVENTS:
            order = "ASC" if ev["lower_is_better"] else "DESC"
            valid = " AND raw > 0" if ev["lower_is_better"] else ""
            top = db.query(f"SELECT id, course_id, raw, points, place, species_json, created_at FROM pokeathlon_rounds WHERE {who}event = ?{valid} "
                           f"ORDER BY raw {order}, created_at LIMIT 5", (*args, ev["id"]))
            events[ev["id"]] = [{"score": r["raw"], "points": r["points"], "place": r["place"], "species": loads(r["species_json"], []), "at": r["created_at"],
                                 "course_id": r["course_id"]} for r in top]
            agg = db.one(f"SELECT COUNT(*) AS n, COALESCE(SUM(place = 0), 0) AS firsts FROM pokeathlon_rounds WHERE {who}event = ?", (*args, ev["id"]))
            if agg and agg["n"]:
                event_stats[ev["id"]] = {"plays": int(agg["n"]), "firsts": int(agg["firsts"])}
        merged: dict[str, int] = {}
        for r in db.query("SELECT species, bits FROM pokeathlon_medals" + ("" if a.everyone else " WHERE trainer_id = ?"), () if a.everyone else (a.trainer_id,)):
            merged[r["species"]] = merged.get(r["species"], 0) | int(r["bits"])
        medals = [{"species": sp, "mask": b, "names": {"es": medal_names(b, "es"), "en": medal_names(b, "en")}, "complete": b == 31} for sp, b in sorted(merged.items())]
        full_rows = [r for r in rows if r["course_key"] != SINGLE]
        popularity = 0
        for r in full_rows:
            popularity = max(0, min(65535, popularity + int(r["cheer"])))
        recent = []
        if a.recent:
            for r in db.query(f"SELECT * FROM pokeathlon_courses WHERE {who}1 = 1 ORDER BY created_at DESC LIMIT ?", (*args, a.recent)):
                recent.append(self._card(r))
        return {
            "trainer_id": "" if a.everyone else a.trainer_id,
            "athlete_points": min(ATHLETE_CAP, sum(int(r["athlete_points"]) for r in full_rows)), "popularity": popularity,
            "totals": {"courses": len(full_rows), "wins": sum(1 for r in full_rows if r["won"]), "singles": len(rows) - len(full_rows)},
            "courses": courses, "supreme_courses": supreme_courses, "events": events, "event_stats": event_stats,
            "medals": medals, "medalists": sum(1 for m in medals if m["complete"]), "recent": recent,
        }

    def _card(self, r: Any) -> dict[str, Any]:
        d = loads(r["detail_json"], {})
        teams = d.get("teams") or []
        mine = teams[r["team"]] if r["team"] < len(teams) else {}
        return {"id": r["id"], "course": r["course_key"], "supreme": bool(r["supreme"]), "mode": r["mode"], "trainer_id": r["trainer_id"], "total": r["total"],
                "place": r["place"], "won": bool(r["won"]), "at": r["created_at"], "species": [m.get("species") for m in mine.get("mons", [])],
                "athlete_points": r["athlete_points"], "totals": d.get("totals", [])}

    def history(self, a: HistoryArgs) -> dict[str, Any]:
        db = self.s.store.db
        if a.id:
            r = db.one("SELECT * FROM pokeathlon_courses WHERE id = ?", (a.id,))
            if not r:
                raise SilverError("not_found", f"Course not found: {a.id}")
            return {**self._card(r), "seed": r["seed"], "team": r["team"], "medal_mask": r["medals"], "cheer": r["cheer"], "detail": loads(r["detail_json"], {})}
        rows = db.query("SELECT * FROM pokeathlon_courses WHERE (? = '' OR trainer_id = ?) ORDER BY created_at DESC LIMIT ?", (a.trainer_id, a.trainer_id, a.limit))
        return {"courses": [self._card(r) for r in rows]}
