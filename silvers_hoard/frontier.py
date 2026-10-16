"""The Battle Frontier of HeartGold/SoulSilver (and Platinum) with the game's own rules: the Battle Hall, the Battle Arcade and the
Battle Castle, and the Frontier Brains' teams (Argenta, Dahlia, Darach, Thorton) on their battles.

The rules and tables come from the decompiled game (pret/pokeheartgold) through presets/frontier4.json.gz, built by
scripts/build_frontier.py: the 950 Frontier sets and 315 Frontier trainers shared by the facilities, the 477 Battle Hall sets,
the Hall's level table and trainer classes, the Arcade's 32 roulette events with their odds, the Castle's points and services.

This module is the pure part (random draws, rivals, the Hall board, the roulette, the Castle's points and services); the streak
itself (a run of kind ``facility``) and its battles are kept by frontier_runs.py through services.py. Comments marked
[UNVERIFIED] are general knowledge of the games, not read from the decompilation."""

from __future__ import annotations

import gzip
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

PRESETS = Path(__file__).resolve().parent / "presets"
STATS = ("hp", "atk", "def", "spa", "spd", "spe")
KINDS = {"hall4": "hall", "arcade4": "arcade", "castle4": "castle"}
ROUND = {"hall": 10, "arcade": 7, "castle": 7}
PARTY = {"hall": 1, "arcade": 3, "castle": 3}
LEVEL_CAP = 50   # the Arcade and the Castle copy the challenger's Pokémon at level 50 at most (exp reset above it)


@lru_cache(maxsize=1)
def data() -> dict[str, Any]:
    return json.loads(gzip.decompress((PRESETS / "frontier4.json.gz").read_bytes()).decode("utf-8"))


def kind_of(facility_id: str) -> str:
    """hall, arcade or castle for the three Gen 4 facilities with their own rules, else ''."""
    return KINDS.get(facility_id or "", "")


# ---------------------------------------------------------------- random numbers
class LCRandom:
    """The game's generator (math_util.c LCRandom): state = state * 1103515245 + 24691, a 16-bit number from the top half."""

    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFF

    def __call__(self) -> int:
        self.state = (self.state * 1103515245 + 24691) & 0xFFFFFFFF
        return self.state >> 16


def lc(*parts: Any) -> LCRandom:
    """A generator seeded from the run and what is drawn (a streak replays the same rivals and boards)."""
    text = ":".join(str(p) for p in parts)
    return LCRandom(int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:4], "little"))


# ---------------------------------------------------------------- trainers and their Pokémon
# Spanish class names of the Spanish Gen IV games (WikiDex) and the Showdown sprite of each class id of the Frontier trainers
CLASSES: dict[int, tuple[str, str, bool]] = {
    2: ("Joven", "youngster", False), 3: ("Chica", "lass", True), 4: ("Campista", "camper", False), 5: ("Dominguera", "picnicker", True),
    6: ("Cazabichos", "bugcatcher", False), 7: ("Señorita aroma", "aromalady", True), 9: ("Montañero", "hiker", False),
    10: ("Luchadora", "battlegirl", True), 11: ("Pescador", "fisherman", False), 12: ("Ciclista", "cyclist", False),
    13: ("Ciclista", "cyclistf", True), 14: ("Karateka", "blackbelt", False), 16: ("Criapokémon", "pokemonbreeder", False),
    17: ("Criapokémon", "pokemonbreederf", True), 18: ("Vaquera", "cowgirl", True), 19: ("Corredor", "jogger", False),
    20: ("Pokéfan", "pokefan", False), 21: ("Pokéfan", "pokefanf", True), 22: ("Pokéchica", "pokekid", True),
    24: ("Entrenador guay", "acetrainer", False), 25: ("Entrenadora guay", "acetrainerf", True), 26: ("Camarera", "waitress", True),
    27: ("Veterano", "veteran", False), 28: ("Chico ninja", "ninjaboy", False), 29: ("Domadragón", "dragontamer", False),
    30: ("Ornitóloga", "birdkeeper", True), 32: ("Niño bien", "richboy", False), 33: ("Damisela", "lady", True),
    34: ("Duque", "gentleman", False), 35: ("Marquesa", "lady", True), 36: ("Bella", "beauty", True), 37: ("Pokécolector", "collector", False),
    38: ("Policía", "policeman", False), 39: ("Pokéguarda", "pokemonranger", False), 40: ("Pokéguarda", "pokemonrangerf", True),
    41: ("Científico", "scientist", False), 44: ("Playero", "tuber", False), 45: ("Playera", "tuberf", True), 46: ("Marinero", "sailor", False),
    48: ("Ruinamaníaco", "ruinmaniac", False), 49: ("Médium", "psychic", False), 50: ("Médium", "psychicf", True),
    51: ("Detective", "gentleman", False), 52: ("Guitarrista", "guitarist", False), 53: ("Entrenador guay", "acetrainer", False),
    54: ("Entrenadora guay", "acetrainerf", True), 57: ("Calvo", "roughneck", False), 58: ("Payaso", "clown", False),
    59: ("Obrero", "worker", False), 60: ("Escolar", "schoolkid", False), 61: ("Escolar", "schoolkidf", True),
    69: ("Ornitólogo", "birdkeeper", False), 71: ("Ranchero", "rancher", False), 78: ("Supernecio", "supernerd", False),
    80: ("Dama parasol", "parasollady", True), 81: ("Camarero", "waiter", False), 83: ("Cámara", "cameraman", False),
    84: ("Reportera", "reporter", True), 85: ("Famosa", "idol", True),
}
CLASS_EN_FIX = {"₧₦ Breeder": "Pokémon Breeder", "₧₦ Ranger": "Pokémon Ranger", "₧₦ Trainer": "Pokémon Trainer"}
# the Frontier Brains: character key (characters.json.gz / frontier_brains.json.gz), class es/en, Silver/Gold Print
BRAINS = {305: ("palmer", "Amo Torre", "Tower Tycoon", "silver"), 306: ("palmer", "Amo Torre", "Tower Tycoon", "gold"),
          307: ("argenta", "Dama Salón", "Hall Matron", "silver"), 308: ("argenta", "Dama Salón", "Hall Matron", "gold"),
          309: ("thorton", "Jefe Fábrica", "Factory Head", "silver"), 310: ("thorton", "Jefe Fábrica", "Factory Head", "gold"),
          311: ("dahlia", "Astro Ruleta", "Arcade Star", "silver"), 312: ("dahlia", "Astro Ruleta", "Arcade Star", "gold"),
          313: ("darach", "Mayordomo", "Castle Valet", "silver"), 314: ("darach", "Mayordomo", "Castle Valet", "gold")}
BRAIN_NAMES_ES = {"palmer": "Jericor", "argenta": "Argenta", "thorton": "Espinal", "dahlia": "Delila", "darach": "Kokuran"}


def trainer(tid: int) -> dict[str, Any]:
    return data()["trainers"][tid]


def trainer_card(tid: int, sprites: Optional[frozenset] = None) -> dict[str, Any]:
    """How a Frontier trainer shows up: name with class in Spanish and English, and a Showdown sprite of the class (gen 4 if any)."""
    t = trainer(tid)
    if tid in BRAINS:
        key, es, en, _print = BRAINS[tid]
        return {"name": f"{es} {BRAIN_NAMES_ES[key]}", "name_en": f"{en} {t['name']}", "title": es, "title_en": en, "avatar": f"sd:{key}",
                "brain": key, "trainer_id": tid}
    es, base, _female = CLASSES.get(t["class_id"], ("Entrenador", "acetrainer", False))
    en = CLASS_EN_FIX.get(t["class"], t["class"])
    sprite = base
    if sprites:
        sprite = next((c for c in (f"{base}-gen4", f"{base}-gen4dp", base) if c in sprites), base)
    return {"name": f"{es} {t['name']}", "name_en": f"{en} {t['name']}", "title": es, "title_en": en, "avatar": f"sd:{sprite}", "trainer_id": tid}


def trainer_iv(tid: int) -> int:
    """All six IVs of a Frontier trainer's Pokémon by trainer id (FrontierTrainer_GetMonIv): 3 below 100 ... 31 from 220 on."""
    for tier in data()["iv_tiers"]:
        if tid < tier["lt"]:
            return tier["iv"]
    return 31


def frontier_set(s: dict[str, Any], *, level: int, iv: int, rnd: LCRandom, item: bool = True) -> dict[str, Any]:
    """A Frontier set as a Showdown set: the set's nature, moves and item, EVs split as in the game (255 shown as 252, the same
    stat), the six IVs equal, the ability from the random personality (either of the species' two), friendship 0 with Frustration."""
    abilities = s.get("abilities") or []
    ability = abilities[rnd() & 1] if len(abilities) > 1 else (abilities[0] if abilities else "")
    out = {"species": s["species"], "level": int(level), "moves": list(s["moves"]), "nature": s["nature"], "ability": ability,
           "evs": {k: min(252, int((s.get("evs") or {}).get(k, 0))) for k in STATS}, "ivs": {k: int(iv) for k in STATS}}
    if item and s.get("item"):
        out["item"] = s["item"]
    if "Frustration" in s["moves"]:
        out["happiness"] = 0
    return out


def pick_sets(set_ids: list[int], count: int, rnd: LCRandom) -> list[dict[str, Any]]:
    """FrontierTrainer_PickMonSets: draw sets of the trainer's list until `count`, never two of the same species or held item."""
    sets = data()["sets"]
    out: list[dict[str, Any]] = []
    for _ in range(2000):
        if len(out) >= count:
            break
        s = sets[set_ids[rnd() % len(set_ids)] - 1]
        if any(o["species"] == s["species"] or (o["item"] and o["item"] == s["item"]) for o in out):
            continue
        out.append(s)
    return out


def round_trainers(kind: str, round_: int, rnd: LCRandom) -> list[int]:
    """The 14 trainer ids of a round of the Arcade or the Castle (slots 6 and 13 from the last-battle range, no repeats); the
    single battles use the first seven."""
    r = data()[kind]["trainer_ranges"][min(round_, 7)]
    ids: list[int] = []
    for slot in range(14):
        lo, hi = (r[2], r[3]) if slot in (6, 13) else (r[0], r[1])
        for _ in range(1000):
            tid = lo + rnd() % (hi - lo)   # the maximum is exclusive (battle_arcade_setup.c:44-90)
            if tid not in ids:
                ids.append(tid)
                break
    return ids


def ai_level(flags: int) -> str:
    """The game's AI flags as Silver's AI: 0 (no scoring scripts: the move is picked without judgement) plays as easy, 1 (the basic
    script) as normal and 7 (basic + attack evaluation + expert) as expert. The bit names are [UNVERIFIED]."""
    return "expert" if flags >= 7 else "normal" if flags >= 1 else "easy"


def brain_number(kind: str, number: int) -> Optional[int]:
    """The Frontier Brain's trainer id on this streak battle (singles), else None."""
    b = data()["brains"][kind]
    if number == b["battles"]["silver"]:
        return b["trainer_ids"]["silver"]
    if number == b["battles"]["gold"]:
        return b["trainer_ids"]["gold"]
    return None


def round_bp(kind: str, rounds_done: int, streak: int) -> int:
    """Battle Points paid when a round ends (the round counter already advanced): the facility's table, 20 on a Brain's round."""
    d = data()[kind]
    brain = (50, 170) if kind == "hall" else (21, 49)
    if streak in brain:
        return d["bp_brain"]
    table = d["bp"]
    cap = d["bp_ge_18"] if kind == "hall" else d["bp_ge_8"]
    return table[rounds_done] if rounds_done < len(table) else cap


# ---------------------------------------------------------------- the Battle Hall
def hall_types() -> list[str]:
    """The 17 type cells of the board in cursor order (4 columns, 5 rows; the last row holds two empty cells and the ??? cell)."""
    return data()["hall"]["cells"]


def hall_new(lead: dict[str, Any], party_level: int) -> dict[str, Any]:
    """A new Hall streak: every rank 0 (17 type cells plus the ??? cell of the Hall Matron), the lead's level as the party level."""
    return {"kind": "hall", "phase": "type", "ranks": [0] * 18, "level": int(party_level), "lead_num": int(lead.get("num") or 0),
            "round_sets": [], "round_trainers": [], "bp": 0, "rounds": 0, "cell": -1}


def hall_reset_if_maxed(st: dict[str, Any]) -> bool:
    """Before each pick: when the 17 type cells are all at rank 10 they go back to 9 (battle_hall_data.c:440-455)."""
    ranks = st["ranks"]
    if all(ranks[c] >= 10 for c in range(17)):
        for c in range(17):
            ranks[c] = 9
        return True
    return False


def hall_level(party_level: int, rank: int, others: int) -> int:
    """The rival's level (BattleHallData_CalcOpponentLevel): from the party level P, the chosen cell's rank before the battle and
    how many other rank slots are not 0. The table is the float32 emulation of the game's formula, about
    ceil(0.5 * others + P - 3 * sqrt(P) + rank * sqrt(P) / 5), never above P."""
    p = max(1, min(100, int(party_level)))
    return data()["hall"]["level_table"][p - 1][min(max(rank, 0), 9)][min(max(others, 0), 17)]


def hall_others(ranks: list[int], cell: int) -> int:
    return sum(1 for i, r in enumerate(ranks) if i != cell and r)


def hall_pick_trainers(st: dict[str, Any], cell: int, rank: int, rnd: LCRandom) -> list[int]:
    """BattleHall_PickTrainerClasses + PickTrainerIds for the two trainers a battle rolls (only the first is fought in singles):
    2 in 3 from the rank's classes, 1 in 3 from the cell's; a trainer of that class not met yet this round."""
    h = data()["hall"]
    clamped = min(rank, 9)
    classes = []
    for _ in range(2):
        r = rnd() % 12
        classes.append(h["rank_class_ids"][clamped][r] if r < 8 else h["cell_class_ids"][cell][r - 8])
    used = list(st.get("round_trainers") or [])
    out: list[int] = []
    of = h["trainer_class_of_id"]
    for cls in classes:
        tid = rnd() % 300
        start = tid
        for _ in range(100_000):
            if of[tid] == cls and tid not in used and tid not in out:
                out.append(tid)
                break
            tid = (tid + 1) % 300
            if tid == start:   # nobody of this class left this round: another class of the rank
                new = cls
                while new == cls:
                    new = h["rank_class_ids"][clamped][rnd() % 8]
                cls = new
    return out


def hall_pick_set(lo: int, hi: int, cell_type: str, lead_num: int, round_sets: list[int], rnd: LCRandom, matron: bool) -> int:
    """BattleHall_PickSetIds: a random start in the range, then set by set; not a set of an earlier battle this round, not the
    challenger's species and (but for the Matron) of the cell's type. As in the game the scan wraps before the range's last id, and
    after a full lap it only compares with the previous battle's set."""
    hall_sets = data()["hall_sets"]
    index = lo + rnd() % (hi - lo + 1) - 1
    start = index
    wrapped = False
    for _ in range(4 * len(hall_sets)):
        used = (index + 1) in round_sets if not wrapped else bool(round_sets) and index + 1 == round_sets[-1]
        if not used:
            s = hall_sets[index]
            if s["dex"] != lead_num and (matron or cell_type in s["types"]):
                return index + 1
        index += 1
        if index + 1 >= hi:
            index = lo - 1
        if index == start:
            wrapped = True
    # the game would search forever; the tables always have a candidate, this is only a guard
    pool = [s["id"] for s in hall_sets if (matron or cell_type in s["types"]) and s["dex"] != lead_num] or [hall_sets[0]["id"]]
    return pool[rnd() % len(pool)]


def hall_rival(st: dict[str, Any], number: int, cell: int, run_id: str, sprites: Optional[frozenset] = None) -> dict[str, Any]:
    """The rival of the battle `number` of the streak on the type cell `cell` (0-16): a trainer, one Hall set of that type at the
    level of the formula, IVs and AI by the cell's rank; the Hall Matron Argenta on battles 50 and 170 (party level, IV 31)."""
    h = data()["hall"]
    rnd = lc(run_id, "hall", number)
    rank = st["ranks"][cell]
    clamped = min(rank, 9)
    cell_type = hall_types()[cell]
    trainers = hall_pick_trainers(st, cell, rank, rnd)
    matron = brain_number("hall", number)
    if matron:
        lo, hi = h["gold_matron_range"] if matron == 308 else _matron_range(st["lead_num"])
        set_id = hall_pick_set(lo, hi, cell_type, st["lead_num"], st.get("round_sets") or [], rnd, True)
        level, iv, flags, tid = st["level"], 31, 7, matron
    else:
        lo, hi = h["rank_ranges"][clamped]
        set_id = hall_pick_set(lo, hi, cell_type, st["lead_num"], st.get("round_sets") or [], rnd, False)
        level = hall_level(st["level"], rank, hall_others(st["ranks"], cell))
        iv, flags, tid = h["ivs_by_rank"][clamped], h["ai_by_rank"][min(rank, 10)], trainers[0]
    s = data()["hall_sets"][set_id - 1]
    mon = frontier_set(s, level=level, iv=iv, rnd=rnd)
    card = trainer_card(tid, sprites)
    return {"number": number, "boss": bool(matron), "trainer": tid, "set_id": set_id, "cell": cell, "type": cell_type, "rank": rank,
            "level": level, "iv": iv, "ai_flags": flags, "trainers_rolled": trainers, **card,
            "seat": {"team": [mon], "ai_level": ai_level(flags), "ai_style": "balanced"}}


def _matron_range(lead_num: int) -> tuple[int, int]:
    """Argenta's Silver Print range: by where the challenger's species first shows up in the Hall sets."""
    h = data()["hall"]
    found = next((i for i, s in enumerate(data()["hall_sets"]) if s["dex"] == lead_num), 376)
    for lo, hi in h["matron_ranges"]:
        if found < hi:
            return lo, hi
    return tuple(h["matron_ranges"][3])


def hall_after_win(st: dict[str, Any], stage: dict[str, Any], streak: int) -> dict[str, Any]:
    """After a win: the picked cell goes up a rank (max 10); the set and trainers count as used this round; after the 10th win of a
    round, Battle Points. Returns what happened."""
    cell = stage["cell"]
    st["ranks"][cell] = min(10, st["ranks"][cell] + 1)
    st["round_sets"] = [*(st.get("round_sets") or []), stage["set_id"]]
    st["round_trainers"] = [*(st.get("round_trainers") or []), *(stage.get("trainers_rolled") or [])]
    out = {"rank": st["ranks"][cell], "bp": 0}
    if streak % ROUND["hall"] == 0:
        st["rounds"] = st.get("rounds", 0) + 1
        out["bp"] = round_bp("hall", st["rounds"], streak)
        st["bp"] = st.get("bp", 0) + out["bp"]
        st["round_sets"], st["round_trainers"] = [], []
    return out


def hall_auto_cell(st: dict[str, Any], rnd: LCRandom) -> int:
    """The AI's pick on the board: a cell with the lowest rank (the easiest rival), at random among them."""
    open_ = [c for c in range(17) if st["ranks"][c] < 10]
    low = min(st["ranks"][c] for c in open_)
    best = [c for c in open_ if st["ranks"][c] == low]
    return best[rnd() % len(best)]


# ---------------------------------------------------------------- the Battle Arcade
STATUS_IDS = {"poison": "psn", "paralysis": "par", "burn": "brn", "sleep": "slp", "freeze": "frz"}
WEATHER_IDS = {18: "sunnyday", 19: "raindance", 20: "sandstorm", 21: "hail", 22: "fog"}


def arcade_event(eid: int) -> dict[str, Any]:
    return data()["arcade"]["events"][eid]


def arcade_pool(round_: int, position: int) -> list[int]:
    """BuildEventPool: the events allowed on this round (bit min(round, 6)) and, for the board and special events, on this battle
    of the round (bit winStreak % 7)."""
    a = data()["arcade"]
    r = min(round_, 6)
    out = []
    for e in range(32):
        if not (a["round_masks"][e] >> r) & 1:
            continue
        m = a["streak_masks"].get(str(e))
        if m is not None and not (m >> position) & 1:
            continue
        out.append(e)
    return out


def arcade_odds_row(bp_gain: int) -> int:
    for i, t in enumerate(data()["arcade"]["odds_thresholds"]):
        if bp_gain >= t:
            return i
    return 4


def arcade_speed_start(round_: int) -> int:
    """Cursor speed when a challenge session starts: 5 from round 7, 4 from round 4, else 3."""
    return 5 if round_ >= 7 else 4 if round_ >= 4 else 3


def arcade_board(round_: int, position: int, bp_gain: int, speed: int, random_motion: bool, rnd: LCRandom) -> dict[str, Any]:
    """The 16 panels of the roulette for the next battle: each panel's colour drawn with the odds row of the previous battle's
    score, then an event of that colour from the pool. When a colour has no events here (round 0 and round 4, seventh battle) the
    game takes a modulo by zero; this goes on to the next colour, as SPEC 3.3 recommends [ROM-undefined]."""
    a = data()["arcade"]
    pool = arcade_pool(round_, position)
    by_colour = [[e for e in pool if a["events"][e]["colour"] == c] for c in range(4)]
    row = arcade_odds_row(bp_gain)
    odds = a["odds_rows"][row]
    event_random = rnd()   # drawn once per board: which Pokémon a sleep/freeze hits, which berry or item is given
    panels = []
    for _ in range(16):
        x, acc, colour = rnd() % 100, 0, 3
        for c, p in enumerate(odds):
            acc += p
            if x < acc:
                colour = c
                break
        k = colour
        while not by_colour[k]:
            k = (k + 1) % 4
        panels.append(by_colour[k][rnd() % len(by_colour[k])])
    start = rnd() % 16
    delay = a["delays"][max(0, min(7, speed))]
    steps = a["stop_frames"] // max(1, delay) + 1
    jumps = [rnd() % 16 for _ in range(steps)] if random_motion else []
    return {"panels": panels, "start": start, "speed": speed, "delay": delay, "frames_per_step": max(1, delay), "random_motion": bool(random_motion),
            "jumps": jumps, "odds_row": row, "odds": odds, "bp_gain": bp_gain, "event_random": event_random, "stop_frames": a["stop_frames"],
            "round": round_, "position": position, "pool": pool}


def arcade_panel_at(board: dict[str, Any], frames: int) -> int:
    """The panel under the cursor after `frames` frames of motion (one step every max(delay, 1) frames; random motion jumps)."""
    frames = max(0, min(int(frames), board["stop_frames"]))
    steps = frames // board["frames_per_step"]
    if board.get("random_motion") and board.get("jumps"):
        return board["jumps"][steps - 1] if steps else board["start"]
    return (board["start"] + steps) % 16


def _immune(mon: dict[str, Any], immune: dict[str, Any]) -> bool:
    return bool(set(mon.get("types") or []) & set(immune.get("types") or [])) or mon.get("ability") in (immune.get("abilities") or [])


def _item_list(kind: str, round_: int) -> list[str]:
    lists = data()["arcade"]["berries" if kind == "held_berry" else "items"]
    return lists["0" if round_ < 3 else "3" if round_ < 6 else "6"]


def arcade_apply(eid: int, board: dict[str, Any], mine: list[dict[str, Any]], theirs: list[dict[str, Any]], rnd: LCRandom) -> dict[str, Any]:
    """What a roulette event does to the next battle. `mine` and `theirs` are the two parties as frontier_party describes them
    (species, types, ability, ...). Returns {event, side, start: {p1: [...], p2: [...], field: {...}}, give_item, level_up,
    skip, bp, speed, random_next, swap, lucky (every candidate was immune: no effect), hit: [indexes]}."""
    ev = arcade_event(eid)
    out: dict[str, Any] = {"event": eid, "name": ev["name"], "colour": ev["colour"], "kind": ev["kind"], "side": ev["side"],
                           "start": {"p1": [{} for _ in mine], "p2": [{} for _ in theirs], "field": {}}, "hit": [], "lucky": False}
    side = "p2" if ev["side"] == "opponent" else "p1"
    party = theirs if side == "p2" else mine
    eff = ev.get("effect") or {}
    kind = ev["kind"]
    if kind == "hp_loss":
        for i in range(len(party)):
            out["start"][side][i]["hp_cut"] = 0.2   # HP = maxHP - (floor(maxHP * 1.2) - maxHP), about 80 %
        out["hit"] = list(range(len(party)))
    elif kind == "status":
        status = STATUS_IDS.get(str(eff.get("status")), "")
        immune = eff.get("immune") or {}
        if eid in (4, 5, 13, 14):   # sleep and freeze: one Pokémon, from slot eventRandom % count on, the first not immune
            first = (board["event_random"] & 0xFF) % len(party)
            target = next(((first + k) % len(party) for k in range(len(party)) if not _immune(party[(first + k) % len(party)], immune)), None)
            targets = [] if target is None else [target]
        else:
            targets = [i for i, m in enumerate(party) if not _immune(m, immune)]
        if not targets:
            out["lucky"] = True
        for i in targets:
            out["start"][side][i]["status"] = status
            if status == "slp":
                out["start"][side][i]["sleep_turns"] = rnd() % 4 + 2
        out["hit"] = targets
    elif kind in ("held_berry", "held_item"):
        items = _item_list(kind, board["round"])
        out["give_item"] = {"side": side, "item": items[board["event_random"] % len(items)]}
        out["hit"] = list(range(len(party)))
    elif kind == "level":
        out["level_up"] = {"side": side, "levels": 3}
        out["hit"] = list(range(len(party)))
    elif kind == "weather":
        if eid == 23:
            out["start"]["field"]["trickroom"] = 5
        else:
            out["start"]["field"]["weather"] = WEATHER_IDS[eid]
    elif kind == "cursor_speed":
        out["speed"] = 1 if eid == 24 else -1
    elif kind == "random_motion":
        out["random_next"] = True
    elif kind == "swap":
        out["swap"] = True
    elif kind == "bp":
        out["bp"] = int(eff.get("bp") or (1 if eid == 28 else 3))
    elif kind == "skip":
        out["skip"] = True
    return out


def arcade_score(end_side: list[dict[str, Any]], turns: int) -> int:
    """The performance score of a won battle (bpGain), which picks the odds of the next board: Pokémon with a status, fainted
    Pokémon and how many turns it took."""
    a = data()["arcade"]
    statused = sum(1 for m in end_side if m.get("status") and not m.get("fainted"))
    fainted = sum(1 for m in end_side if m.get("fainted"))
    pts = a["statused_points"][min(statused, len(a["statused_points"]) - 1)] + a["fainted_points"][min(fainted, len(a["fainted_points"]) - 1)]
    for lt, value in a["turn_points"]:
        if turns < lt:
            return pts + value
    return pts


def arcade_auto_frames(board: dict[str, Any], rnd: LCRandom) -> int:
    """When the AI (or nobody) stops the roulette: a moment within the 15 s before it stops by itself."""
    return rnd() % board["stop_frames"]


# ---------------------------------------------------------------- the Battle Castle
def castle_service(sid: str) -> dict[str, Any]:
    return next(s for s in data()["castle"]["services"] if s["id"] == sid)


def castle_new() -> dict[str, Any]:
    c = data()["castle"]
    return {"kind": "castle", "phase": "castle", "cp": c["start_cp"], "ranks": {"heal": 1, "rental": 1, "info": 1}, "bp": 0, "rounds": 0}


def castle_points(end_side: list[dict[str, Any]], start_pp: list[list[int]], raised: int) -> dict[str, Any]:
    """Castle Points for a won battle (BattleCastleData_CalcPointsEarned): per Pokémon alive +3, and +3 at full HP, +2 at half or
    more, +1 below half, +1 without a status; once for the PP used (<= 5: +8, <= 10: +6, <= 15: +4); +7 per rival Pokémon whose
    level was raised; at least 1."""
    c = data()["castle"]["cp"]
    total = 0
    parts = []
    for m in end_side:
        if m.get("fainted") or not m.get("hp"):
            continue
        p = c["alive"]
        if m["hp"] >= m["maxhp"]:
            p += c["alive_full_hp"]
        elif m["hp"] >= m["maxhp"] // 2:
            p += c["alive_hp_ge_half_not_full"]
        else:
            p += c["alive_hp_lt_half"]
        if not m.get("status"):
            p += c["alive_no_status"]
        parts.append(p)
        total += p
    used = 0
    for m, before in zip(end_side, start_pp):
        used += sum(max(0, b - a) for b, a in zip(before, m.get("pp") or []))
    pp_points = c["pp_used_le_5"] if used <= 5 else c["pp_used_le_10"] if used <= 10 else c["pp_used_le_15"] if used <= 15 else 0
    total += pp_points + c["per_opponent_level_up"] * raised
    if total <= 0:
        total = c["min_total"]
    return {"total": total, "per_mon": parts, "pp_used": used, "pp_points": pp_points, "raised": raised}


def castle_rentals(kind: str, rank: int) -> list[dict[str, Any]]:
    """The berries (rental rank 1+) or items (rank 2+) on offer at this rental rank, with their CP."""
    c = data()["castle"]
    lst = c["berries" if kind == "berry" else "items"]
    count = c["rental_counts"]["berries" if kind == "berry" else "items"][str(rank)]
    return lst[:count] if (kind == "berry" or rank >= 2) else []


RANK_UP = {"heal": [0, 100, 100], "rental": [0, 100, 150], "info": [0, 50]}
RANK_MAX = {"heal": 3, "rental": 3, "info": 2}


class Refusal(Exception):
    """A Castle service the game refuses (not enough CP, rank too low, nothing to do); nothing is charged."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def castle_do(st: dict[str, Any], rival: dict[str, Any], service: str, mon: int = -1, item: str = "") -> dict[str, Any]:
    """One Castle service between battles, with the game's costs and rank requirements (battle_castle_party_app.c,
    battle_castle_opponent_app.c). `mon` is a party index (heal, rental) or a rival index (check, summary, moves, level).
    Returns {service, cost, ...}; raises Refusal without charging when the game refuses."""
    ranks = st["ranks"]
    party = st["party"]
    opp = rival.setdefault("castle", {"levels": [0] * len(rival["seat"]["team"]), "seen": [{} for _ in rival["seat"]["team"]]})

    def charge(cost: int) -> None:
        if st["cp"] < cost:
            raise Refusal("cp", f"Not enough CP ({st['cp']} of {cost}).")
        st["cp"] -= cost

    def party_mon() -> dict[str, Any]:
        if not 0 <= mon < len(party):
            raise Refusal("invalid", f"mon is 0-{len(party) - 1} (your party).")
        return party[mon]

    def rival_mon() -> int:
        if not 0 <= mon < len(opp["levels"]):
            raise Refusal("invalid", f"mon is 0-{len(opp['levels']) - 1} (the rival's Pokémon).")
        return mon

    def need(kind: str, minimum: int) -> None:
        if ranks[kind] < minimum:
            raise Refusal("rank", f"Needs {kind} rank {minimum} (it is {ranks[kind]}).")

    out: dict[str, Any] = {"service": service, "mon": mon, "cost": 0}
    if service in ("heal_hp", "heal_pp", "heal_all"):
        need("heal", {"heal_hp": 1, "heal_pp": 2, "heal_all": 3}[service])
        m = party_mon()
        hp_full = m["hp"] >= m["maxhp"]
        pp_full = all(a >= b for a, b in zip(m["pp"], m["maxpp"]))
        if (service == "heal_hp" and hp_full) or (service == "heal_pp" and pp_full) or (service == "heal_all" and hp_full and pp_full):
            raise Refusal("no_benefit", "It would do nothing.")
        cost = castle_service(service)["cost"]
        charge(cost)
        if service in ("heal_hp", "heal_all"):
            m["hp"] = m["maxhp"]
        if service in ("heal_pp", "heal_all"):
            m["pp"] = list(m["maxpp"])
        out["cost"] = cost
    elif service in ("heal_rank_up", "rental_rank_up", "info_rank_up"):
        kind = service.split("_")[0]
        if ranks[kind] >= RANK_MAX[kind]:
            raise Refusal("max", f"The {kind} rank is already {RANK_MAX[kind]}.")
        cost = RANK_UP[kind][ranks[kind]]
        charge(cost)
        ranks[kind] += 1
        out.update(cost=cost, rank=ranks[kind])
    elif service in ("rent_berry", "rent_item"):
        what = "berry" if service == "rent_berry" else "item"
        need("rental", 1 if what == "berry" else 2)
        m = party_mon()
        offer = {x["item"].lower(): x for x in castle_rentals(what, ranks["rental"])}
        pick = offer.get(str(item).strip().lower())
        if not pick:
            raise Refusal("invalid", f"{item or '?'} is not on offer at rental rank {ranks['rental']}.")
        if m.get("item"):
            raise Refusal("holding", f"{m['species']} already holds {m['item']}.")
        charge(pick["cost"])
        m["item"] = pick["item"]
        out.update(cost=pick["cost"], item=pick["item"])
    elif service in ("opp_check", "opp_stats", "opp_moves"):
        i = rival_mon()
        seen = opp["seen"][i]
        if service == "opp_moves":
            need("info", 2)
        key = {"opp_check": "species", "opp_stats": "stats", "opp_moves": "moves"}[service]
        if service != "opp_check" and not seen.get("species"):
            raise Refusal("check_first", "Check which Pokémon it is first.")
        if seen.get(key):
            return {**out, "already": True}
        cost = castle_service(service)["cost"]
        charge(cost)
        seen[key] = True
        out["cost"] = cost
    elif service in ("opp_level_up", "opp_level_down"):
        i = rival_mon()
        up = service == "opp_level_up"
        cur = opp["levels"][i]
        if cur == (5 if up else -5):
            raise Refusal("no_benefit", "That Pokémon already has that level change.")
        cost = castle_service(service)["cost"]
        charge(cost)
        opp["levels"][i] = 0 if cur else (5 if up else -5)   # buying the other change puts it back at level 50
        out.update(cost=cost, level=50 + opp["levels"][i])
    else:
        raise Refusal("invalid", f"Unknown service {service}.")
    return out


def castle_after_win(st: dict[str, Any], rival: dict[str, Any], end_side: list[dict[str, Any]], streak: int) -> dict[str, Any]:
    """After a won Castle battle: CP from the end of the battle, then the party as it ended (HP, PP, held item) with every fainted
    Pokémon back at 1 HP and every status cured (BattleCastle_ReviveParty). After the 7th win of a round, Battle Points."""
    raised = sum(1 for x in (rival.get("castle") or {}).get("levels") or [] if x > 0)
    start_pp = [list(m["pp"]) for m in st["party"]]
    by_index = {m["index"]: m for m in end_side if m.get("index", -1) >= 0}
    ordered = [by_index.get(i) or {**m, "fainted": m["hp"] <= 0} for i, m in enumerate(st["party"])]
    cp = castle_points(ordered, start_pp, raised)
    st["cp"] = min(data()["castle"]["cp_cap"], st["cp"] + cp["total"])
    for m, e in zip(st["party"], ordered):
        if e is None:
            continue
        m["hp"] = max(1, int(e.get("hp") or 0)) if not e.get("fainted") else 1
        m["status"] = ""
        if e.get("pp"):
            m["pp"] = [int(x) for x in e["pp"]][: len(m["maxpp"])]
        m["item"] = e.get("item") or ""
    out = {"cp": cp, "bp": 0}
    if streak % ROUND["castle"] == 0:
        st["rounds"] = st.get("rounds", 0) + 1
        out["bp"] = round_bp("castle", st["rounds"], streak)
        st["bp"] = st.get("bp", 0) + out["bp"]
    return out


def castle_skip_ok(number: int) -> bool:
    """Skipping costs 50 CP and is offered from round 4 on (round >= 3), never before a Brain's battle."""
    return (number - 1) // ROUND["castle"] >= 3 and brain_number("castle", number) is None


def castle_auto(st: dict[str, Any], rival: dict[str, Any]) -> list[dict[str, Any]]:
    """What the AI buys before a Castle battle: Restore HP for a Pokémon under half HP (and Restore PP for one with a move at 0 PP
    once the heal rank allows it), keeping 10 CP for the next battle."""
    done = []
    for i, m in enumerate(st["party"]):
        for service, wanted in (("heal_hp", m["hp"] * 2 < m["maxhp"]), ("heal_pp", any(p == 0 for p in m["pp"]))):
            if not wanted or st["cp"] - castle_service(service)["cost"] < 10:
                continue
            try:
                done.append(castle_do(st, rival, service, i))
            except Refusal:
                continue
    return done


# ---------------------------------------------------------------- rivals of the Arcade and the Castle, and Thorton
def facility_rival(kind: str, st: dict[str, Any], number: int, run_id: str, sprites: Optional[frozenset] = None) -> dict[str, Any]:
    """The rival of battle `number` at the Arcade or the Castle: the round's trainer for that battle with three of its sets (no
    repeated species or item) at level 50 and the IVs of its trainer id; Dahlia (her three sets) or Darach (three of his six) on
    battles 21 and 49. Arcade rivals hold no items (they only get the roulette's); Castle rivals keep theirs."""
    round_, pos = (number - 1) // 7, (number - 1) % 7
    if st.get("round_no") != round_ or not st.get("round_trainers"):
        st["round_trainers"] = round_trainers(kind, round_, lc(run_id, kind, "round", round_))
        st["round_no"] = round_
    rnd = lc(run_id, kind, number)
    brain = brain_number(kind, number)
    if brain:
        t = trainer(brain)
        sets = [data()["sets"][i - 1] for i in t["set_ids"]] if kind == "arcade" else pick_sets(t["set_ids"], 3, rnd)
        tid, iv, flags = brain, 31, 7
    else:
        tid = st["round_trainers"][pos]
        sets = pick_sets(trainer(tid)["set_ids"], 3, rnd)
        iv = trainer_iv(tid)
        if kind == "arcade":
            flags = 0 if round_ <= 1 else 1 if round_ <= 3 else 7
        else:
            r = round_ + 1
            flags = 0 if r <= 2 else 1 if r <= 4 else 7
    team = [frontier_set(s, level=50, iv=iv, rnd=rnd, item=kind == "castle") for s in sets]
    return {"number": number, "boss": bool(brain), "trainer": tid, "set_ids": [s["id"] for s in sets], "iv": iv, "ai_flags": flags,
            **trainer_card(tid, sprites), "seat": {"team": team, "ai_level": ai_level(flags), "ai_style": "balanced"}}


def thorton_team(number: int, run_id: str) -> Optional[dict[str, Any]]:
    """Thorton at the Platinum Battle Factory on battles 21 (Silver: sets 351-486, IV 12) and 49 (Gold: 759-950, IV 31): three
    sets drawn from the top of the range down (setId = max - rand % span), no repeated species or item, level 50, AI 7."""
    tid = brain_number("factory", number)
    if not tid:
        return None
    lo, hi, iv = data()["brains"]["factory"]["ranges"]["8" if tid == 309 else "9"]
    rnd = lc(run_id, "factory", number)
    sets = data()["sets"]
    picked: list[dict[str, Any]] = []
    for _ in range(5000):
        if len(picked) >= 3:
            break
        s = sets[hi - rnd() % (hi - lo + 1) - 1]
        if any(o["species"] == s["species"] or (o["item"] and o["item"] == s["item"]) for o in picked):
            continue
        picked.append(s)
    return {"trainer": tid, "iv": iv, "set_ids": [s["id"] for s in picked],
            "team": [frontier_set(s, level=50, iv=iv, rnd=rnd) for s in picked], "ai_level": ai_level(7)}
