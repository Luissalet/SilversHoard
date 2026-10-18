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
        rival_source: str = "trainers",
        rival_ai_level: str = "normal",
        sample_job_id: str = "",
    ) -> dict[str, Any]:
        from .services import RT_RULES_VERSION, _rt_arena

        ids = list(dict.fromkeys(variant_ids))
        rivals = list(dict.fromkeys(rival_ids))
        meta = rival_source == "metagame"
        if len(ids) < (1 if meta else 2):
            raise SilverError("invalid", "Pick at least two team variants to compare.")
        if not meta and not rivals:
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

        sample = None
        if meta and sample_job_id:
            previous = self.s.store.job(sample_job_id)
            result = previous.get("result") or {}
            sample = result.get("metagame")
            if previous.get("kind") != "benchmark" or previous.get("status") != "done" or not sample:
                raise SilverError("invalid", "Choose a completed metagame benchmark to reuse its sample.")
            if (sample.get("format_requested") != fmt or sample.get("rules") != (rules or []) or
                    sample.get("level_rules") != (level_rules or {}) or result.get("mode") != ("realtime" if rt else "classic")):
                raise SilverError("invalid", "The saved sample uses different format, rules, levels or battle mode.")
            if not seed:
                seed = str(result["seed"])

        variants = []
        for tid in ids:
            seat = self.s._seat({"trainer_id": tid, "ai_level": ai_level or None}, tid)
            variants.append({"id": tid, "name": seat["name"], "sets": seat["sets"], "ai": seat["ai"]})
        rival_seats = []
        for tid in ([] if meta else rivals):
            seat = self.s._seat({"trainer_id": tid, "ai_level": ai_level or None}, tid)
            rival_seats.append({"id": tid, "name": seat["name"], "sets": seat["sets"], "ai": seat["ai"]})

        title = f"Benchmark · {len(variants)} equipos × {100 if meta else len(rival_seats)} rivales"
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
            **({"rival_source": "metagame", "rival_ai_level": rival_ai_level} if meta else {}),
        }

        def work(jid: str, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict[str, Any]:
            from .metagame import collect_corpus

            if meta:
                if sample:
                    payload["sample"] = sample
                else:
                    payload["corpus"] = collect_corpus(self.s, fmt, lambda p: progress(p * 0.15), cancelled)
            res = self.s.engine.run_job("benchmark", payload,
                                        progress=(lambda p: progress(0.15 + p * 0.85)) if meta else progress,
                                        cancelled=cancelled, timeout=6 * 3600)
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
                **({"rival_source": "metagame", "rival_ai_level": rival_ai_level, "sample_job_id": sample_job_id,
                    "rules": rules or [], "level_rules": level_rules or {}, "seed": seed,
                    "ai_level": ai_level, "time_limit": limit, "rt_arena": rt_arena} if meta else {}),
            },
            work,
        )
