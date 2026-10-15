"""A trainer's progress, worked out from what is already stored: its battles (record, streaks, kinds, KOs and the Pokémon it used and
beat), its challenges and facility streaks, badges and hall of fame entries, and the achievements those unlock."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable

# id, Spanish name, English name, Spanish description, English description, test over the computed numbers
ACHIEVEMENTS: list[tuple[str, str, str, str, str, Callable[[dict[str, Any]], bool]]] = [
    ("first_win", "Primera victoria", "First win", "Gana un combate.", "Win a battle.", lambda p: p["record"]["wins"] >= 1),
    ("wins_10", "Diez victorias", "Ten wins", "Gana 10 combates.", "Win 10 battles.", lambda p: p["record"]["wins"] >= 10),
    ("wins_50", "Cincuenta victorias", "Fifty wins", "Gana 50 combates.", "Win 50 battles.", lambda p: p["record"]["wins"] >= 50),
    ("wins_100", "Cien victorias", "A hundred wins", "Gana 100 combates.", "Win 100 battles.", lambda p: p["record"]["wins"] >= 100),
    ("streak_5", "En racha", "On a roll", "Gana 5 combates seguidos.", "Win 5 battles in a row.", lambda p: p["streaks"]["best"] >= 5),
    ("streak_10", "Imparable", "Unstoppable", "Gana 10 combates seguidos.", "Win 10 battles in a row.", lambda p: p["streaks"]["best"] >= 10),
    ("sweep", "Barrida", "Clean sweep", "Gana sin perder ni un Pokémon.", "Win without losing a single Pokémon.", lambda p: p["feats"]["sweeps"] >= 1),
    ("comeback", "Por los pelos", "By a hair", "Gana con un solo Pokémon en pie (equipo de tres o más).", "Win with one Pokémon left standing (a team of three or more).",
     lambda p: p["feats"]["comebacks"] >= 1),
    ("doubles_win", "Pareja de oro", "Golden pair", "Gana un combate doble.", "Win a doubles battle.", lambda p: p["feats"]["doubles_wins"] >= 1),
    ("realtime_win", "Reflejos", "Reflexes", "Gana un combate en tiempo real.", "Win a real-time battle.", lambda p: p["feats"]["realtime_wins"] >= 1),
    ("ko_100", "Cien K.O.", "A hundred KOs", "Debilita 100 Pokémon rivales.", "Knock out 100 rival Pokémon.", lambda p: p["record"]["kos"] >= 100),
    ("badge_1", "Primera medalla", "First badge", "Consigue una medalla de gimnasio.", "Earn a gym badge.", lambda p: p["challenges"]["badges"] >= 1),
    ("badges_8", "Estuche completo", "Full badge case", "Consigue 8 medallas.", "Earn 8 badges.", lambda p: p["challenges"]["badges"] >= 8),
    ("champion", "Campeón", "Champion", "Entra en el Hall de la Fama de una liga.", "Enter a league's hall of fame.", lambda p: p["challenges"]["hall"] >= 1),
    ("facility_7", "Ronda superada", "Round cleared", "Gana 7 seguidos en una instalación.", "Win 7 in a row at a battle facility.",
     lambda p: p["facilities"]["best"] >= 7),
    ("facility_21", "Veterano de la Torre", "Tower veteran", "Llega a 21 seguidos en una instalación.", "Reach 21 in a row at a battle facility.",
     lambda p: p["facilities"]["best"] >= 21),
    ("facility_49", "Leyenda de la Torre", "Tower legend", "Llega a 49 seguidos en una instalación.", "Reach 49 in a row at a battle facility.",
     lambda p: p["facilities"]["best"] >= 49),
    ("facility_boss", "Cara a cara con el jefe", "Face to face with the boss", "Vence al as de una instalación.", "Beat a facility's boss.",
     lambda p: p["facilities"]["bosses"] >= 1),
    ("factory_7", "Alquiler con éxito", "Rental success", "Gana 7 seguidos en la Fábrica Batalla.", "Win 7 in a row at the Battle Factory.",
     lambda p: p["facilities"]["factory_best"] >= 7),
    ("dex_25", "Coleccionista", "Collector", "Combate con 25 especies distintas.", "Battle with 25 different species.", lambda p: len(p["pokedex"]["used"]) >= 25),
    ("dex_100", "Pokédex en marcha", "Pokédex on its way", "Combate con 100 especies distintas.", "Battle with 100 different species.",
     lambda p: len(p["pokedex"]["used"]) >= 100),
    ("beaten_100", "Cazador", "Hunter", "Debilita 100 especies distintas.", "Knock out 100 different species.", lambda p: len(p["pokedex"]["beaten"]) >= 100),
]


def _side_of(b: dict[str, Any], trainer_id: str) -> str:
    for side in ("p1", "p2"):
        if (b.get(side) or {}).get("trainer_id") == trainer_id:
            return side
    return ""


def compute(trainer: dict[str, Any], battles: list[dict[str, Any]], runs: list[dict[str, Any]], badges: list[dict[str, Any]],
            hall: list[dict[str, Any]], *, rental_ids: frozenset[str] = frozenset()) -> dict[str, Any]:
    tid = trainer["id"]
    record = {"battles": 0, "wins": 0, "losses": 0, "ties": 0, "kos": 0, "lost_pokemon": 0}
    by_kind: dict[str, dict[str, int]] = defaultdict(lambda: {"wins": 0, "losses": 0, "ties": 0})
    feats = {"sweeps": 0, "comebacks": 0, "doubles_wins": 0, "realtime_wins": 0}
    mons: dict[str, dict[str, int]] = defaultdict(lambda: {"battles": 0, "kos": 0, "fainted": 0, "wins": 0})
    used: set[str] = {s["species"] for s in trainer.get("team") or [] if s.get("species")}
    beaten: set[str] = set()
    seen: set[str] = set()
    streak = best = 0
    last_results: list[str] = []
    for b in sorted(battles, key=lambda x: x.get("created_at") or 0):
        if b.get("status") != "ended":
            continue
        side = _side_of(b, tid)
        if not side:
            continue
        foe = "p2" if side == "p1" else "p1"
        summary = b.get("summary") or {}
        sides = summary.get("sides") or {}
        mine = sides.get(side) or {}
        theirs = sides.get(foe) or {}
        winner = b.get("winner_side") or summary.get("winner_side") or ""
        result = "win" if winner == side else "loss" if winner == foe else "tie"
        record["battles"] += 1
        record[{"win": "wins", "loss": "losses", "tie": "ties"}[result]] += 1
        by_kind[b.get("kind") or "play"][{"win": "wins", "loss": "losses", "tie": "ties"}[result]] += 1
        record["kos"] += int(mine.get("kos") or 0)
        record["lost_pokemon"] += int(mine.get("lost") or 0)
        team_size = len((b.get(side) or {}).get("sets") or []) or len(mine.get("pokemon") or [])
        if result == "win":
            streak += 1
            best = max(best, streak)
            if not mine.get("lost"):
                feats["sweeps"] += 1
            if team_size >= 3 and int(mine.get("lost") or 0) == team_size - 1:
                feats["comebacks"] += 1
            if "doubles" in (b.get("format") or ""):
                feats["doubles_wins"] += 1
            if (b.get("mode") or "classic") == "realtime":
                feats["realtime_wins"] += 1
        elif result == "loss":
            streak = 0
        last_results.append(result)
        for p in mine.get("pokemon") or []:
            sp = p.get("species") or p.get("name")
            if not sp:
                continue
            used.add(sp)
            m = mons[sp]
            m["battles"] += 1
            m["kos"] += int(p.get("kos") or 0)
            m["fainted"] += 1 if p.get("fainted") else 0
            m["wins"] += 1 if result == "win" else 0
        for p in theirs.get("pokemon") or []:
            sp = p.get("species") or p.get("name")
            if not sp:
                continue
            seen.add(sp)
            if p.get("fainted"):
                beaten.add(sp)
    mvp = sorted(({"species": k, **v} for k, v in mons.items()), key=lambda x: (-x["kos"], x["fainted"], -x["battles"]))
    fac_best = factory_best = bosses = 0
    per_facility: dict[str, int] = {}
    for r in runs:
        if r.get("kind") != "facility":
            continue
        wins = sum(1 for st in r.get("stages") or [] if st.get("result") == "won")
        per_facility[r["target_id"]] = max(per_facility.get(r["target_id"], 0), wins)
        fac_best = max(fac_best, wins)
        if r["target_id"] in rental_ids:
            factory_best = max(factory_best, wins)
        bosses += sum(1 for st in r.get("stages") or [] if st.get("boss") and st.get("result") == "won")
    gyms_won = sum(1 for r in runs if r.get("kind") == "gym" and r.get("status") == "won")
    out = {
        "trainer_id": tid, "name": trainer["name"], "record": record, "by_kind": dict(by_kind),
        "win_rate": round(record["wins"] / record["battles"], 3) if record["battles"] else 0,
        "streaks": {"current": streak, "best": best, "last": last_results[-10:]},
        "feats": feats, "mvp": mvp[:10],
        "challenges": {"badges": len(badges), "hall": len(hall), "gyms_won": gyms_won,
                       "leagues_won": sum(1 for r in runs if r.get("kind") == "league" and r.get("status") == "won")},
        "facilities": {"best": fac_best, "factory_best": factory_best, "bosses": bosses, "per_facility": per_facility},
        "pokedex": {"used": sorted(used), "beaten": sorted(beaten), "seen": sorted(seen | beaten)},
    }
    out["achievements"] = [{"id": a[0], "name_es": a[1], "name": a[2], "desc_es": a[3], "desc": a[4], "unlocked": bool(a[5](out))} for a in ACHIEVEMENTS]
    out["unlocked"] = sum(1 for a in out["achievements"] if a["unlocked"])
    return out
