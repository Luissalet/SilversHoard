"""Freeze the usage and written sets used to generate a benchmark's opponent pool."""

from __future__ import annotations

import hashlib
import copy
import json
from typing import Any, Callable, TYPE_CHECKING

from .errors import SilverError

if TYPE_CHECKING:
    from .services import Services


def collect_corpus(
    svc: Services, fmt: str, progress: Callable[[float], None], cancelled: Callable[[], bool]
) -> dict[str, Any]:
    def check_cancelled() -> None:
        if cancelled():
            raise SilverError("cancelled", "Metagame benchmark cancelled.")

    check_cancelled()
    top = svc.smogon.top(fmt, 60)
    entries = []
    missing = []
    rows = top["species"]
    for index, row in enumerate(rows):
        check_cancelled()
        found = svc.sets_popular(row["species"], fmt)
        sets = []
        for popular in found.get("sets") or []:
            if not popular.get("moves"):
                continue
            # Reuse the team builder's species/Mega normalization; set labels are not Pokémon nicknames.
            member = {key: popular[key] for key in (
                "moves", "item", "ability", "nature", "evs", "ivs", "teraType", "level"
            ) if key in popular}
            member.update(species=found.get("team_species") or found.get("species") or row["species"], name="")
            sets.append(member)
        if sets:
            entries.append({
                "species": row["species"], "usage": row["usage"], "sets": sets,
                "source_formats": list(dict.fromkeys(x for x in (
                    found.get("format"), found.get("usage_format")
                ) if x)),
            })
        else:
            missing.append(row["species"])
        progress((index + 1) / max(1, len(rows)))
    check_cancelled()
    corpus = {
        "format_requested": fmt, "usage_format": top["format"], "battles": top["battles"],
        "source": "Smogon sets and Showdown usage statistics via data.pkmn.cc",
        "entries": entries, "missing_sets": missing,
    }
    raw = json.dumps(corpus, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {**copy.deepcopy(corpus), "sha256": hashlib.sha256(raw).hexdigest()}
