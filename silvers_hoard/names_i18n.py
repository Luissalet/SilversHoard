"""The names the app makes up, in both languages: a character's trainer ("Giovanni (Red/Blue · Gym battle)"), the in-game
trainers of Crystal, FireRed/LeafGreen and Emerald, a random trainer ("Trainer 512"), the gyms and leagues of the games (their
city, badge and description) and the ready-made mass battles. They were saved in the language the app had when they were made;
the screens show them in the reader's language instead.

Only what the app made is translated: a name or title the user typed or edited is theirs and keeps showing as it is. A name counts
as made by the app when it is exactly what the app would make now in either language or, for a character's trainer, when it still
starts with the character's name and a bracket (older versions shortened long names differently).

Each function returns {"es": {...}, "en": {...}} with only the fields it can vouch for, or None."""

from __future__ import annotations

import re
from typing import Any, Optional

from . import game_leagues, hgss_rom
from .errors import SilverError

LANGS = ("es", "en")
RANDOM_NAME = re.compile(r"^(?:Entrenador|Trainer) (\d{1,4})$")
# the games of the in-game teams read from the cartridges (presets/canon.json)
CANON_GAMES_ES = {"Crystal": "Cristal", "FireRed/LeafGreen": "Rojo Fuego y Verde Hoja", "Emerald": "Esmeralda"}
CANON_CLASSES = {"leader": ("Líder de gimnasio", "Gym Leader"), "elite": ("Alto Mando", "Elite Four"), "champion": ("Campeón", "Champion"),
                 "rival": ("Rival", "Rival"), "boss": ("Jefe", "Boss"), "legend": ("Leyenda", "Legend")}
OWN_TEAM = {"es": "Equipo propio", "en": "Own team"}
# the game card (characters_list's `games`) of each league of the games, for the filters by game
GAME_IDS = {"kanto-rgb": "rb", "johto-hgss": "hgss", "kanto-hgss": "hgss", "hoenn-oras": "oras", "sinnoh-pt": "pt", "unova-bw": "bw",
            "unova-b2w2": "b2w2", "kalos-xy": "xy", "alola-sm": "sm", "alola-usum": "usum", "galar-sw": "swsh", "paldea-sv": "sv",
            "johto-crystal": "gsc", "kanto-crystal": "gsc", "kanto-frlg": "frlg", "hoenn-emerald": "e"}
REGIONS_ES = {"Unova": "Teselia"}
HGSS_LEAGUES = ("johto-hgss", "kanto-hgss")   # the leagues whose gym trainers come from the HeartGold/SoulSilver cartridge


def _pair(es: dict[str, Any], en: dict[str, Any]) -> Optional[dict[str, Any]]:
    es = {k: v for k, v in es.items() if v}
    en = {k: v for k, v in en.items() if v}
    return {"es": es, "en": en} if es or en else None


def _drop_unmade(stored: dict[str, Any], made: dict[str, dict[str, Any]], fields: tuple[str, ...], loose: dict[str, Any] | None = None) -> None:
    """Keep a field only when the stored value is the app's own (in either language), or passes its loose test."""
    for f in fields:
        value = str(stored.get(f) or "")
        mine = any(made[l].get(f) == value for l in LANGS) or bool(loose and loose.get(f) and loose[f](value))
        if not mine:
            for l in LANGS:
                made[l].pop(f, None)


# ---------------------------------------------------------------------------------------------------------- trainers
_FACILITY: Optional[tuple[dict[str, str], list[tuple[str, str]]]] = None


def _facility_names() -> tuple[dict[str, str], list[tuple[str, str]]]:
    """The trainers of the battle facilities, Spanish to English: the Frontier Brains by full name, the trainer classes (longest
    first) for "Class Name". A facility seat keeps only the name it was given in Spanish."""
    global _FACILITY
    if _FACILITY is None:
        exact: dict[str, str] = {}
        classes: dict[str, str] = {}
        try:
            from . import facilities
            for _base, es, en in facilities.CLASSES:
                classes.setdefault(es, en)
        except Exception:   # noqa: BLE001 - without the facilities their seats keep the saved name
            pass
        try:
            from . import frontier
            trainers = frontier.data()["trainers"]
            for tid, (key, es, en, _print) in frontier.BRAINS.items():
                exact[f"{es} {frontier.BRAIN_NAMES_ES[key]}"] = f"{en} {trainers[tid]['name']}"
            for t in trainers:
                c = frontier.CLASSES.get(t.get("class_id"))
                if c and t.get("class"):
                    classes.setdefault(c[0], frontier.CLASS_EN_FIX.get(t["class"], t["class"]))
        except Exception:   # noqa: BLE001
            pass
        _FACILITY = (exact, sorted(((es, en) for es, en in classes.items() if es != en), key=lambda p: -len(p[0])))
    return _FACILITY


def facility_seat(name: str) -> Optional[dict[str, Any]]:
    """A facility trainer's seat ("Entrenadora Guay Nora" / "Ace Trainer Nora"), or None for any other name."""
    exact, classes = _facility_names()
    if name in exact:
        return _pair({"name": name}, {"name": exact[name]})
    for es, en in classes:
        if name.startswith(es + " ") and len(name) > len(es) + 1:
            return _pair({"name": name}, {"name": en + name[len(es):]})
    return None


def char_trainer_name(svc: Any, c: dict[str, Any], v: Optional[dict[str, Any]], *, custom: bool, lang: str) -> tuple[str, str]:
    """The name and title character_install gives a character's trainer in a language (names hold 60 characters: when the whole
    label does not fit, the game goes in the title only)."""
    from .services import _CLASS_ES   # here, not at the top: services imports this module

    es = lang != "en"
    display = c["name_es"] if es else c["name"]
    if custom or not v:
        title = OWN_TEAM["es" if es else "en"]
        return f"{display} ({title.lower()})", title
    title = f"{_CLASS_ES.get(v['trainer_class'], v['trainer_class']) if es else v['trainer_class']} · {v['game_name_es'] if es else v['game_name']}".strip(" ·")
    inner = svc._variant_label(v, "es" if es else "en")
    labels = (v["labels_es"] if es else v["labels"]) + ([("con " if es else "with ") + v["with"]] if v.get("with") else [])
    short = " · ".join(labels) or (v["game_name_es"] if es else v["game_name"])
    name = next((f"{display} ({x})" for x in (inner, short) if len(display) + len(x) + 3 <= 60), "")
    if not name:
        name = f"{display} ({short[:60 - len(display) - 4].rsplit(' ', 1)[0]}…)"
    return name, title


def trainer(t: dict[str, Any], svc: Any) -> Optional[dict[str, Any]]:
    key = str(t.get("canon_key") or "")
    name = str(t.get("name") or "")
    m = RANDOM_NAME.match(name)
    if m and t.get("origin") in ("random", "own"):
        return {"es": {"name": f"Entrenador {m.group(1)}"}, "en": {"name": f"Trainer {m.group(1)}"}}
    if key.startswith("char:"):
        parts = key.split(":")
        try:
            c = svc._character(parts[1])
        except Exception:   # noqa: BLE001 - a character no longer in the data: its name stays as saved
            return None
        custom = len(parts) > 2 and parts[2] == "own"
        v = None if custom else next((x for x in c["variants"] if len(parts) > 2 and x["id"] == parts[2]), None)
        if not custom and not v:
            return None
        made = {l: dict(zip(("name", "title"), char_trainer_name(svc, c, v, custom=custom, lang=l))) for l in LANGS}
        starts = tuple(f"{c[k]} (" for k in ("name", "name_es"))
        _drop_unmade(t, made, ("name", "title"), loose={"name": lambda s: s.startswith(starts)})
        return _pair(made["es"], made["en"])
    if key.startswith(hgss_rom.CANON_PREFIX):
        return rom_trainer(t, svc, key)
    canon = next((x for x in svc.canon()["trainers"] if x["key"] == key), None) if key else None
    if canon:
        cls_es, cls_en = CANON_CLASSES.get(canon.get("class", ""), (canon.get("class_es", ""), canon.get("class", "")))
        game_en = canon["game"]
        made = {"es": {"name": canon["name_es"] + (f" ({canon.get('variant_es') or canon['variant']})" if canon.get("variant") else ""),
                       "title": f"{canon.get('class_es') or cls_es} · {CANON_GAMES_ES.get(game_en, game_en)}"},
                "en": {"name": canon["name"] + (f" ({canon['variant']})" if canon.get("variant") else ""), "title": f"{cls_en} · {game_en}"}}
        # older installs titled them with the English game ("Campeón · Crystal")
        _drop_unmade(t, made, ("name", "title"), loose={"title": lambda s: s == f"{canon.get('class_es') or cls_es} · {game_en}"})
        return _pair(made["es"], made["en"])
    return None


def rom_trainer(t: dict[str, Any], svc: Any, key: str) -> Optional[dict[str, Any]]:
    """A gym trainer made from the HeartGold/SoulSilver cartridge (canon_key rom:hgss:<number>): its class and name in each language,
    and the class with the gym's name as its title."""
    try:
        index = int(key[len(hgss_rom.CANON_PREFIX):])
        rows = {l: hgss_rom.trainer_row(index, l) for l in LANGS}
    except (ValueError, SilverError):   # a number the cartridge data does not have: the name stays as saved
        return None
    leader = hgss_rom.gym_of(index)
    gyms = next((g for g in (_gym_names(svc, f"{lk}:{leader}") for lk in HGSS_LEAGUES) if g), None) if leader else None
    made = {l: {"name": rows[l]["name"], "title": f"{rows[l]['class']} · {gyms[l]['name']}"[:60] if gyms else ""} for l in LANGS}
    _drop_unmade(t, made, ("name", "title"))
    return _pair(made["es"], made["en"])


# ---------------------------------------------------------------------------------------------------------- gyms and leagues
def _game_es(lg: dict[str, Any]) -> str:
    m = re.search(r"\(([^()]+)\)$", lg.get("name_es", ""))
    return m.group(1) if m else CANON_GAMES_ES.get(lg.get("game", ""), lg.get("game", ""))


def _league_source(key: str) -> tuple[Optional[dict[str, Any]], str]:
    """A league of the games by its key: (league, "characters" | "canon")."""
    lg = game_leagues.BY_KEY.get(key)
    return (lg, "characters") if lg else (None, "")


def place(lkey: str, svc: Any) -> Optional[dict[str, Any]]:
    """Where a league of the games (and its gyms) belongs: {region, game_id, i18n: {es: {region, game}, en: {...}}}."""
    lg, _ = _league_source(lkey)
    if not lg:
        lg = next((x for x in svc.canon()["leagues"] if x["key"] == lkey), None)
    if not lg:
        return None
    game_id = GAME_IDS.get(lkey, "")
    if not game_id:   # a league added later: its game card by name
        try:
            game_id = next((g["id"] for g in svc._character_games() if lg["game"].replace("/", " and ") == g.get("name")), "")
        except Exception:   # noqa: BLE001
            game_id = ""
    region = lg.get("region", "")
    return {"region": region, "game_id": game_id,
            "i18n": {"es": {"region": REGIONS_ES.get(region, region), "game": _game_es(lg)}, "en": {"region": region, "game": lg["game"]}}}


def _gym_names(svc: Any, gkey: str) -> Optional[dict[str, dict[str, Any]]]:
    if ":" not in gkey:
        return None
    lkey, rest = gkey.split(":", 1)
    lg, _ = _league_source(lkey)
    g = None
    if lg:
        g = next((x for x in lg["gyms"] if x["key"] == rest), None)
    else:
        lg = next((x for x in svc.canon()["leagues"] if x["key"] == lkey), None)
        g = next((x for x in (lg or {}).get("gyms", []) if x["leader"] == rest), None) if lg else None
    if not g:
        return None
    gym_es = g.get("gym_es") or f"Gimnasio de {g['city_es']}"
    if g.get("gym_es", "").startswith("Estadio de"):
        gym_en = f"{g['city']} Stadium"
    elif g.get("gym_es") and g["gym_es"] == g["city_es"]:
        gym_en = g["city"]
    else:
        gym_en = f"{g['city']} Gym"
    return {"es": {"name": gym_es, "city": g["city_es"], "badge": g["badge_es"], "description": f"{g['badge_es']} · {g['city_es']} · {_game_es(lg)}"},
            "en": {"name": gym_en, "city": g["city"], "badge": g["badge"], "description": f"{g['badge']} · {g['city']} · {lg['game']}"}}


def gym(g: dict[str, Any], svc: Any) -> Optional[dict[str, Any]]:
    made = _gym_names(svc, str(g.get("canon_key") or ""))
    if not made:
        return None
    _drop_unmade(g, made, ("name", "city", "badge", "description"))
    return _pair(made["es"], made["en"])


def league(lg: dict[str, Any], svc: Any) -> Optional[dict[str, Any]]:
    key = str(lg.get("canon_key") or "")
    src, _ = _league_source(key)
    if not src:
        src = next((x for x in svc.canon()["leagues"] if x["key"] == key), None) if key else None
    if not src:
        return None
    made = {"es": {"name": src["name_es"], "description": _game_es(src)}, "en": {"name": src["name"], "description": src["game"]}}
    # the description was made as "<English name> · <game>"
    _drop_unmade(lg, made, ("name", "description"), loose={"description": lambda s: s == f"{src['name']} · {src['game']}"})
    return _pair(made["es"], made["en"])


def league_catalog_entry(name: str, name_es: str, game: str, game_es: str) -> dict[str, Any]:
    """A league of the games not installed yet (leagues_catalog)."""
    return {"es": {"name": name_es, "description": game_es}, "en": {"name": name, "description": game}}


# ---------------------------------------------------------------------------------------------------------- the rest
def facility(f: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not f.get("name") or not f.get("name_es"):
        return None
    return {"es": {"name": f["name_es"]}, "en": {"name": f["name"]}}


def mass_title(doc: dict[str, Any], presets: list[tuple]) -> Optional[dict[str, Any]]:
    """A mass battle made from a ready-made one keeps its title in both languages while nobody renamed it."""
    p = next((x for x in presets if x[0] == doc.get("preset")), None)
    if not p or doc.get("title") not in (p[1], p[2]):
        return None
    return {"es": {"title": p[1]}, "en": {"title": p[2]}}


# ---------------------------------------------------------------------------------------------------------- what the screens receive
_CATALOG_GYM = re.compile(r"^([a-z0-9-]+):(\d+)$")


def _person(i: str, x: dict[str, Any], svc: Any) -> Optional[dict[str, Any]]:
    """An Elite Four member or champion of a league not installed yet: a character ("cynthia:ptbeforestarkmountain") or an
    in-game trainer of the cartridges ("gsc-lance")."""
    name = x.get("name")
    canon = next((t for t in svc.canon()["trainers"] if t["key"] == i), None)
    if canon:
        return {"es": {"name": canon["name_es"]}, "en": {"name": canon["name"]}} if name in (canon["name_es"], canon["name"]) else None
    try:
        c = svc._character(i.split(":", 1)[0])
    except Exception:   # noqa: BLE001
        return None
    return {"es": {"name": c["name_es"]}, "en": {"name": c["name"]}} if name in (c["name_es"], c["name"]) else None


def _catalog_gym(i: str, x: dict[str, Any], svc: Any) -> Optional[dict[str, Any]]:
    m = _CATALOG_GYM.match(i)
    if not m:
        return None
    lkey, idx = m.group(1), int(m.group(2))
    lg, _ = _league_source(lkey)
    gyms = lg["gyms"] if lg else next((x2["gyms"] for x2 in svc.canon()["leagues"] if x2["key"] == lkey), [])
    if idx >= len(gyms):
        return None
    g = gyms[idx]
    key = f"{lkey}:{g['key'] if lg else g['leader']}"
    made = _gym_names(svc, key)
    if not made:
        return None
    _drop_unmade(x, made, ("name", "city", "badge"))
    for l in LANGS:
        made[l].pop("description", None)
    return _pair(made["es"], made["en"])


def _target(r: dict[str, Any], svc: Any) -> Optional[dict[str, Any]]:
    """What a challenge is against (a gym, a league, a battle facility), in both languages while it is the app's own name."""
    from . import facilities

    kind, tid, name = r["kind"], str(r["target_id"]), r["target_name"]
    if kind == "facility":
        f = facilities.BY_ID.get(tid)
        n = facility(f) if f else None
    else:
        try:
            obj = svc.store.gym(tid, deleted=True) if kind == "gym" else svc.store.league(tid, deleted=True)
        except Exception:   # noqa: BLE001 - gone: the saved name stays
            return None
        n = gym(obj, svc) if kind == "gym" else league(obj, svc)
    if not n or name not in (n["es"].get("name"), n["en"].get("name"), *(([obj["name"]]) if kind != "facility" else [])):
        return None
    if not (n["es"].get("name") and n["en"].get("name")):
        return None
    return {"es": {"target_name": n["es"]["name"]}, "en": {"target_name": n["en"]["name"]}}


def annotate(obj: Any, svc: Any) -> Any:
    """Give every object the UI receives that the app made up its names in both languages (an `i18n` field), in place: trainers,
    battle seats, gyms, leagues (installed or from the catalog), their members, mass battles. Never fails a response."""
    from .mass import PRESETS

    trainers: dict[str, Any] = {}

    def trainer_of(tid: str) -> Optional[dict[str, Any]]:
        if tid not in trainers:
            try:
                trainers[tid] = svc.store.trainer(tid, deleted=True)
            except Exception:   # noqa: BLE001 - a seat whose trainer is gone keeps its saved name
                trainers[tid] = None
        return trainers[tid]

    def names(x: dict[str, Any]) -> Optional[dict[str, Any]]:
        i = str(x.get("id") or "")
        if i.startswith("tr_") and "name" in x:
            return trainer(x, svc)
        if i.startswith("gym_") and "badge" in x:
            return gym(x, svc)
        if i.startswith("lg_") and "elite_list" in x or (not i and x.get("canon_key") and "installed" in x):
            return league(x, svc)
        if i.startswith("mass_") and "preset" in x:
            return mass_title(x, PRESETS)
        if str(x.get("trainer_id") or "").startswith("tr_") and "name" in x and not i:   # a battle seat
            t = trainer_of(str(x["trainer_id"]))
            n = trainer(t, svc) if t and t.get("name") == x["name"] else None
            return _pair({"name": n["es"].get("name")}, {"name": n["en"].get("name")}) if n else None
        if "human" in x and "ai" in x and x.get("name") and not i and not str(x.get("trainer_id") or "").startswith("tr_"):   # a facility seat
            return facility_seat(str(x["name"]))
        if x.get("target_name") and x.get("target_id") and x.get("kind") in ("gym", "league", "facility"):   # a challenge
            return _target(x, svc)
        if x.get("gym_id") and x.get("gym_name"):   # a badge
            n = _target({"kind": "gym", "target_id": x["gym_id"], "target_name": x["gym_name"]}, svc)
            return {l: {"gym_name": n[l]["target_name"]} for l in LANGS} if n else None
        if i and "badge" in x and "city" in x:
            return _catalog_gym(i, x, svc)
        if i and "avatar_url" in x and "name" in x and len(x) <= 4:
            return _person(i, x, svc)
        return None

    def places(x: dict[str, Any]) -> Optional[dict[str, Any]]:
        """A gym or league of the games (installed, or from the catalog): its region and game, for the filters."""
        i = str(x.get("id") or "")
        key = str(x.get("canon_key") or "")
        if i.startswith("lg_") and key or (not i and key and "installed" in x):
            return place(key, svc)
        if i.startswith("gym_") and ":" in key:
            return place(key.split(":", 1)[0], svc)
        m = _CATALOG_GYM.match(i) if "badge" in x else None
        return place(m.group(1), svc) if m else None

    def walk(x: Any, depth: int = 0) -> None:
        if depth > 10:
            return
        if isinstance(x, list):
            for y in x:
                walk(y, depth + 1)
            return
        if not isinstance(x, dict):
            return
        try:
            n = names(x)
            if n:
                x["i18n"] = n
            where = places(x)
            if where:
                x["region"], x["game_id"] = where["region"], where["game_id"]
                for l in LANGS:
                    x.setdefault("i18n", {"es": {}, "en": {}}).setdefault(l, {}).update(where["i18n"][l])
        except Exception:   # noqa: BLE001 - names are a nicety: a response never fails for them
            pass
        for v in list(x.values()):
            walk(v, depth + 1)

    walk(obj)
    return obj
