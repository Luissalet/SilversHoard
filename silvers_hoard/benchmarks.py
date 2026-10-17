"""Team variant benchmark: several trainers against the same rivals with shared seeds.

Reuses the engine playOut path (cli job ``benchmark``). Results are a background job only: no hall of
fame, badges or competitive records are written.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable, Optional

from .errors import SilverError

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services


class Benchmarks:
    def __init__(self, svc: "Services"):
        self.s = svc

    def start(
        self,
        *,
        variant_ids: list[str],
        rival_ids: list[str],
        reference_id: str = "",
        games: int = 1,
        format_: str = "",
        rules: Optional[list[str]] = None,
        level_rules: Optional[dict[str, Any]] = None,
        seed: str = "",
        mode: str = "classic",
        time_limit: int = 0,
        rt_arena: str = "rocks",
        ai_level: str = "",
    ) -> dict[str, Any]:
        from .services import RT_RULES_VERSION, _rt_arena

        ids = list(dict.fromkeys(variant_ids))
        rivals = list(dict.fromkeys(rival_ids))
        if len(ids) < 2:
            raise SilverError("invalid", "Pick at least two team variants to compare.")
        if not rivals:
            raise SilverError("invalid", "Pick at least one rival.")
        if len(ids) > 8:
            raise SilverError("invalid", "At most 8 variants.")
        if len(rivals) > 16:
            raise SilverError("invalid", "At most 16 rivals.")
        if reference_id and reference_id not in ids:
            raise SilverError("invalid", "reference_id must be one of the variants.")
        if reference_id and reference_id != ids[0]:
            ids = [reference_id] + [x for x in ids if x != reference_id]

        games = max(1, min(int(games or 1), 50))
        fmt = format_ or self.s.settings["default_format"]
        self.s.format_info(fmt, rules)
        rt = mode == "realtime"
        arena = _rt_arena(rt_arena)
        limit = max(30, min(int(time_limit or self.s.settings["rt_time_limit"]), 1800))
        if rt:
            fmt, rules = self.s._rt_format(fmt), []

        variants = []
        for tid in ids:
            seat = self.s._seat({"trainer_id": tid, "ai_level": ai_level or None}, tid)
            variants.append({"id": tid, "name": seat["name"], "sets": seat["sets"], "ai": seat["ai"]})
        rival_seats = []
        for tid in rivals:
            seat = self.s._seat({"trainer_id": tid, "ai_level": ai_level or None}, tid)
            rival_seats.append({"id": tid, "name": seat["name"], "sets": seat["sets"], "ai": seat["ai"]})

        title = f"Benchmark · {len(variants)} equipos × {len(rival_seats)} rivales"
        payload = {
            "variants": variants,
            "rivals": rival_seats,
            "games": games,
            "format": fmt,
            "rules": rules or [],
            "level_rules": level_rules or {},
            "seed": seed or None,
            "mode": "realtime" if rt else "classic",
            "time_limit": limit,
            "arena": arena,
            "version": RT_RULES_VERSION,
            "silver_special": bool(self.s.settings.get("rt_silver_special", False)),
            "max_turns": self.s.settings["max_turns"],
        }

        def work(jid: str, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict[str, Any]:
            res = self.s.engine.run_job("benchmark", payload, progress=progress, cancelled=cancelled, timeout=6 * 3600)
            slim = []
            for row in res.get("variants") or []:
                slim.append({k: v for k, v in row.items() if k != "pokemon"})
            res["variants"] = slim
            res["hall_of_fame_touched"] = False
            res["job_id"] = jid
            if rt:
                res.update({"silver_special": payload["silver_special"], "version": payload["version"]})
            return res

        return self.s._job(
            "benchmark",
            title,
            {
                "variant_ids": ids,
                "rival_ids": rivals,
                "games": games,
                "format": fmt,
                "mode": "realtime" if rt else "classic",
                **({"silver_special": payload["silver_special"], "version": RT_RULES_VERSION} if rt else {}),
                "reference_id": ids[0],
            },
            work,
        )
