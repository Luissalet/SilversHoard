"""Read-only replay coaching; accepting a position reuses the ordinary exercise tools."""
from .errors import SilverError


def suggest(services, id_, *, side="p1", start_turn=1, turn_count=10, min_gap=0.35):
    source = services.store.battle(id_)
    record = (source.get("replay") or {}).get("input")
    if source["status"] != "ended" or source.get("mode") == "realtime" or not record:
        raise SilverError("invalid", "This replay has no saved turn decisions for practice.",
                          hint="Finish a new turn-based battle, then open its replay.")
    return {"battle_id": id_, **services.engine.run_job("practice_suggestions", {
        "input": record, "side": side, "start_turn": start_turn, "turn_count": turn_count, "min_gap": min_gap}, timeout=600)}
