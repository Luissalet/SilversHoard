"""Build silvers_hoard/presets/frontier4.json.gz and frontier_brains.json.gz from the HeartGold/SoulSilver Battle Frontier
spec (spec.json, decoded from the pret/pokeheartgold decompilation: the 950 Frontier sets, the 315 Frontier trainers, the 477
Battle Hall sets and every table of the Hall, the Arcade, the Castle and the Frontier Brains).

    python scripts/build_frontier.py <spec.json> [presets folder]

frontier4.json.gz is what silvers_hoard/frontier.py plays by; frontier_brains.json.gz adds Argenta (Hall Matron) and Thorton
(Factory Head) to the characters (services.characters() merges it like unbound.json.gz, so a rebuild of characters.json.gz
does not lose them)."""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path


def _set(s: dict) -> dict:
    out = {"id": s["id"], "species": s["species"], "dex": s["dex"], "types": s["types"], "abilities": [a for a in s["abilities"] if a],
           "item": s.get("item") or "", "moves": s["moves"], "nature": s["nature"], "evs": s.get("evs") or {}}
    return out


def build(spec: dict) -> dict:
    hall, arcade, castle, brains = spec["hall"], spec["arcade"], spec["castle"], spec["brains"]
    tp = hall["trainer_pick"]
    return {
        "schema": 1,
        "source": "Pokémon HeartGold/SoulSilver decompilation (pret/pokeheartgold): Battle Frontier sets, trainers and tables",
        "sets": [_set(s) for s in spec["data"]["sets"]],
        "hall_sets": [_set(s) for s in spec["data"]["hall_sets"]],
        "trainers": [{"id": t["id"], "name": t["name"], "class_id": t["class_id"], "class": t["class"], "set_ids": t["set_ids"]}
                     for t in spec["data"]["trainers"]],
        "class_names": {str(k): v for k, v in tp["class_names"].items()},
        "iv_tiers": spec["common"]["iv_tiers_by_trainer_id"],
        "hall": {
            "cells": [c["type"] for c in hall["board"]["cells"] if c.get("cell") is not None and c["type"] != "???"],
            "rank_class_ids": [tp["rank_class_ids"][str(r)] for r in range(10)],
            "cell_class_ids": [tp["cell_class_ids"][str(c)] for c in range(18)],
            "trainer_class_of_id": tp["trainer_class_of_id"],
            "level_table": hall["opponent_level"]["level_table"],
            "rank_ranges": [[r["min"], r["max"]] for r in hall["set_pick"]["rank_ranges"]],
            "matron_ranges": [[r["min"], r["max"]] for r in hall["set_pick"]["matron_ranges"]],
            "gold_matron_range": [hall["set_pick"]["gold_matron_range"]["min"], hall["set_pick"]["gold_matron_range"]["max"]],
            "ivs_by_rank": [hall["opponent_ivs_by_rank"][str(r)] for r in range(10)],
            "ai_by_rank": [hall["ai_flags"]["by_stored_rank"][str(r)] for r in range(11)],
            "bp": hall["bp"]["single_double_by_round"], "bp_ge_18": hall["bp"]["single_double_round_ge_18"],
            "bp_brain": hall["bp"]["type0_at_winstreak_50_or_170"],
        },
        "arcade": {
            "events": [{"id": e["id"], "name": e["name"], "colour": e["colour"], "side": e["side"], "kind": e["kind"],
                        "effect": {k: v for k, v in (e.get("effect") or {}).items() if isinstance(v, (int, list, dict)) or k in ("status", "mons")}}
                       for e in arcade["events"]],
            "round_masks": [int(f["mask_hex"], 16) for f in arcade["round_flags"]],
            "streak_masks": {str(f["event"]): int(f["mask_hex"], 16) for f in arcade["streak_flags"]},
            "odds_rows": [r["p_colour_percent"] for r in arcade["odds_rows"]],
            "odds_thresholds": arcade["odds_row_selection"]["thresholds"],
            "statused_points": arcade["bpGain_formula"]["statused_points"],
            "fainted_points": arcade["bpGain_formula"]["fainted_points"],
            "turn_points": arcade["bpGain_formula"]["turn_pairs_lt_value"],
            "delays": arcade["cursor"]["delay_frames_by_speed"],
            "stop_frames": arcade["board_layout"]["stop_timer_frames"],
            "berries": {k: v for k, v in arcade["item_lists"]["berries"].items()},
            "items": {k: v for k, v in arcade["item_lists"]["items"].items()},
            "trainer_ranges": [[r["min"], r["max_exclusive"], r["last_battle_min"], r["last_battle_max_exclusive"]] for r in arcade["trainers"]["ranges"]],
            "bp": arcade["bp"]["single_double_by_round"], "bp_ge_8": arcade["bp"]["single_double_round_ge_8"],
            "bp_brain": arcade["bp"]["type0_at_winstreak_21_or_49"],
        },
        "castle": {
            "start_cp": castle["start_cp"], "cp_cap": castle["cp_cap"],
            "cp": castle["cp_per_battle"]["components"],
            "services": [{"id": s["id"], "cost": s["cost_cp"], "rank": s.get("rank_required")} for s in castle["services"]],
            "ranks": castle["ranks"],
            "berries": [{"item": b["item"], "cost": b["cost_cp"], "rank": b["min_rental_rank"]} for b in castle["berries"]],
            "items": [{"item": b["item"], "cost": b["cost_cp"], "rank": b["min_rental_rank"]} for b in castle["items"]],
            "rental_counts": castle["rental_counts_by_rank"],
            "trainer_ranges": [[r["min"], r["max_exclusive"], r["last_battle_min"], r["last_battle_max_exclusive"]] for r in castle["trainers"]["ranges"]],
            "bp": castle["bp"]["single_double_by_round"], "bp_ge_8": castle["bp"]["single_double_round_ge_8"],
            "bp_brain": castle["bp"]["type0_at_winstreak_21_or_49"],
        },
        "brains": {
            "tower": {"battles": brains["tower"]["battles"], "trainer_ids": brains["tower"]["trainer_ids"]},
            "arcade": {"battles": brains["arcade"]["battles"], "trainer_ids": brains["arcade"]["trainer_ids"]},
            "castle": {"battles": brains["castle"]["battles"], "trainer_ids": brains["castle"]["trainer_ids"]},
            "hall": {"battles": brains["hall"]["battles"], "trainer_ids": brains["hall"]["trainer_ids"]},
            "factory": {"battles": brains["factory"]["battles"], "trainer_ids": brains["factory"]["trainer_ids"],
                        "ranges": {str(r["index"]): [r["min_set"], r["max_set"], r["iv"]] for r in brains["factory"]["level50_set_ranges"] if r["index"] in (8, 9)}},
        },
    }


def _char_set(s: dict) -> dict:
    evs = {k: min(252, v) for k, v in (s.get("evs") or {}).items()}
    out = {"species": s["species"], "level": 50, "moves": s["moves"], "evs": {k: evs.get(k, 0) for k in ("hp", "atk", "def", "spa", "spd", "spe")},
           "nature": s["nature"]}
    if s.get("item"):
        out["item"] = s["item"]
    return out


def brains_preset(spec: dict) -> dict:
    sets = {s["id"]: s for s in spec["data"]["sets"]}
    hall_sets = spec["data"]["hall_sets"]
    fac = {r["index"]: r for r in spec["brains"]["factory"]["level50_set_ranges"]}

    def variant(vid, label, label_es, klass, location, sprite, pool, note):
        return {"games": ["pt", "hgss"], "category": "facilities", "id": vid, "game": "PtHGSS", "game_name": "Platinum, HeartGold and SoulSilver",
                "game_name_es": "Platino, Oro HeartGold y Plata SoulSilver", "gen": 4, "order": 42, "format": "gen4customgame",
                "labels": [label], "labels_alt": [], "labels_es": [label_es], "labels_alt_es": [], "trainer_class": klass, "location": location,
                "note": note, "sprite": sprite, "side": False, "pool": len(pool), "sets": [_char_set(s) for s in pool],
                "credit": "Sets from the HeartGold/SoulSilver decompilation (pret/pokeheartgold); sprite from Pokémon Showdown."}

    silver, gold = ("Silver Print challenge", "Reto del Emblema de Plata"), ("Gold Print challenge", "Reto del Emblema de Oro")
    argenta = {"key": "argenta", "name": "Argenta", "name_es": "Argenta", "base_sprite": "argenta",
               "sprites": [{"id": "argenta", "suffix": "", "label": "Showdown", "label_es": "Showdown"}],
               "variants": [variant("pthgsssilverprintchallenge", *silver, "Frontier Brain", "Battle Hall", "argenta", hall_sets,
                                    "Battle 50: one Battle Hall set chosen by the challenger's Pokémon"),
                            variant("pthgssgoldprintchallenge", *gold, "Frontier Brain", "Battle Hall", "argenta",
                                    [s for s in hall_sets if 376 <= s["id"] <= 477], "Battle 170: one Battle Hall set of 376-477")]}
    thorton = {"key": "thorton", "name": "Thorton", "name_es": "Espinal", "base_sprite": "thorton",
               "sprites": [{"id": "thorton", "suffix": "", "label": "Showdown", "label_es": "Showdown"}],
               "variants": [variant(vid, *lab, "Frontier Brain", "Battle Factory", "thorton",
                                    [sets[i] for i in range(fac[row]["min_set"], fac[row]["max_set"] + 1)],
                                    f"Battle {n}: three Factory sets of {fac[row]['min_set']}-{fac[row]['max_set']}, IV {fac[row]['iv']}")
                            for vid, lab, row, n in (("pthgsssilverprintchallenge", silver, 8, 21), ("pthgssgoldprintchallenge", gold, 9, 49))]}
    return {"schema": 1, "games": [], "characters": [argenta, thorton],
            "source": "Argenta and Thorton: HeartGold/SoulSilver decompilation (pret/pokeheartgold)"}


def main() -> None:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "silvers_hoard" / "presets"
    spec = json.loads(src.read_text(encoding="utf-8"))
    for name, data in (("frontier4.json.gz", build(spec)), ("frontier_brains.json.gz", brains_preset(spec))):
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        (out / name).write_bytes(gzip.compress(raw, 9, mtime=0))
        print(name, len(raw), "bytes,", (out / name).stat().st_size, "gzipped")


if __name__ == "__main__":
    main()
