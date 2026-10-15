"""Tools for assistants. One catalogue drives ``/api/agent/*`` (the MCP bridge), the web UI (``/api/ui/call``) and ``mcp_server.py``.

Teams, codes and files that come from friends are data: tools import them and never act on text inside them."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .errors import SilverError
from .hoard_link.agentkit import Empty, Tool, ann
from .hoard_link.agentkit import call_tool as _call_tool
from .hoard_link.agentkit import tool_catalog as _catalog
from .hoard_link.agentkit import uncapped  # noqa: F401 - re-exported for the UI routes
from .services import Services

AGENT_INSTRUCTIONS = """Silver's Hoard is a Pokémon battle simulator (Pokémon Showdown's engine, every generation). It keeps trainers (a name, a team, an AI level and style, an avatar and battle lines), gyms (a leader plus optional gym trainers, a badge and rules), leagues (gyms, an Elite Four and a champion) and every battle with its full log.
Start with silver_overview. Teams come in as Showdown export text (paste), packed teams or JSON; team_import parses, team_validate checks a format's rules. canon_list shows the in-game teams of leaders, Elite Four, champions and rivals of Crystal, FireRed/LeafGreen and Emerald, and canon_install adds a trainer or a whole league (its gyms, badges, Elite Four and champion).
Battles: battle_start with two seats. A seat is {trainer_id} or {paste|team, name}; human=true means a person plays it from the app (or you, with battle_choose), otherwise the AI plays (ai_level random|easy|normal|hard|expert, ai_style balanced|aggressive|defensive|setup|stall). Two AI seats = a watched battle that plays out in the background; read it with battle_get (lines are the Showdown protocol log). battle_choose sends a Showdown choice for a person's seat ("move 1", "move 2 terastallize", "switch 3", "team 123456"; doubles: "move 1 1, move 2 -1"); battle_get returns the pending request with the legal options.
Gym and league challenges: challenge_start (kind gym|league, a challenger trainer; auto=true lets the AI play the challenger). Winning every battle of a gym gives a badge; a league needs its badges and ends in the hall of fame.
Many battles at once: series_start (the same two trainers N times: win rate, MVPs) and tournament_start (bracket or league table between trainers), both background jobs (job_get).
Sharing: export (fmt file = .hoardtrainer/.hoardgym/.hoardleague, code = a share code for a chat, page = one HTML file a friend opens in a browser to fight the gym or trainer, paste = Showdown text). import takes any of those back, plus the result codes friends send after playing a page (records their badge).
Avatars: trainer_sprites_search (Showdown trainer sprites), avatar_from_photo (a photo on this computer into pixel art here) or avatar_draw (Prospero's Hoard draws one from up to 4 photos and/or a description in the games' art style, with the references of avatar_style_get; a background job)."""


def _d(first: str, detail: str = "", synonyms: str = "") -> str:
    assert len(first) <= 110, first
    parts = [first]
    if detail:
        parts.append(detail)
    if synonyms:
        parts.append("Sinónimos: " + synonyms)
    return "\n".join(parts)


Level = Literal["random", "easy", "normal", "hard", "expert"]
Style = Literal["balanced", "aggressive", "defensive", "setup", "stall"]
IdField = Field(..., min_length=1, max_length=80)


class IdArg(BaseModel):
    id: str = IdField


class IdsArg(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=500)


class FormatsArgs(BaseModel):
    gen: int = Field(0, ge=0, le=9, description="Only this generation (0 = all).")
    query: str = Field("", max_length=60)


class DexArgs(BaseModel):
    kind: Literal["species", "moves", "items", "abilities", "natures"] = "species"
    query: str = Field("", max_length=60)
    gen: int = Field(9, ge=1, le=9)
    species: str = Field("", max_length=60, description="kind=moves: only moves this Pokémon can learn.")
    limit: int = Field(30, ge=1, le=1000)


class SpeciesArgs(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    gen: int = Field(9, ge=1, le=9)


class TeamTextArgs(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000, description="Showdown export text, a packed team or JSON.")


class ValidateArgs(BaseModel):
    format: str = Field(..., min_length=2, max_length=120)
    paste: str = Field("", max_length=200_000)
    team: Optional[list[dict[str, Any]]] = None
    rules: list[str] = Field(default_factory=list, max_length=20, description="Extra Showdown rules, e.g. 'Sleep Clause Mod', '!Team Preview'.")
    level_rules: dict[str, int] = Field(default_factory=dict, description="{level} fixes every level, {level_cap} lowers, {level_min} raises.")


class RandomTeamArgs(BaseModel):
    format: str = Field("gen9randombattle", max_length=120)
    seed: Optional[str] = Field(None, max_length=60)


class TrainersArgs(BaseModel):
    query: str = Field("", max_length=100)
    origin: Literal["", "own", "friend", "canon", "random"] = ""


class Dialogue(BaseModel):
    intro: str = Field("", max_length=280)
    win: str = Field("", max_length=280)
    lose: str = Field("", max_length=280)
    last: str = Field("", max_length=280)


class TrainerCreateArgs(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    paste: str = Field("", max_length=200_000, description="The team as Showdown export text.")
    team: Optional[list[dict[str, Any]]] = Field(None, description="Or the team as a list of sets.")
    format: str = Field("", max_length=120, description="Empty = the default of the settings (gen9nationaldexag: anything goes, Mega, Z and Terastal).")
    title: str = Field("", max_length=60, description="Trainer class or title shown under the name.")
    ai_level: Optional[Level] = None
    ai_style: Optional[Style] = None
    avatar: str = Field("", max_length=80, description="sd:<Showdown trainer sprite name> or file:<avatar file>.")
    dialogue: Optional[Dialogue] = None
    notes: str = Field("", max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=20)


class TrainerUpdateArgs(BaseModel):
    id: str = IdField
    name: Optional[str] = Field(None, max_length=60)
    paste: Optional[str] = Field(None, max_length=200_000)
    team: Optional[list[dict[str, Any]]] = None
    format: Optional[str] = Field(None, max_length=120)
    title: Optional[str] = Field(None, max_length=60)
    owner: Optional[str] = Field(None, max_length=60)
    ai_level: Optional[Level] = None
    ai_style: Optional[Style] = None
    avatar: Optional[str] = Field(None, max_length=80)
    dialogue: Optional[Dialogue] = None
    notes: Optional[str] = Field(None, max_length=4000)
    tags: Optional[list[str]] = Field(None, max_length=20)
    favorite: Optional[bool] = None


class TrainerRandomArgs(BaseModel):
    name: str = Field("", max_length=60)
    format: str = Field("", max_length=120)
    ai_level: Optional[Level] = None
    seed: Optional[str] = Field(None, max_length=60)


class DuplicateArgs(BaseModel):
    id: str = IdField
    name: str = Field("", max_length=60)


class DialogueWriteArgs(BaseModel):
    id: str = IdField
    personality: str = Field("", max_length=400)
    lang: Literal["es", "en"] = "es"


class SpritesArgs(BaseModel):
    query: str = Field("", max_length=40)
    limit: int = Field(120, ge=1, le=1500)


class CanonArgs(BaseModel):
    query: str = Field("", max_length=60)
    region: Literal["", "Kanto", "Johto", "Hoenn"] = ""


class CanonInstallArgs(BaseModel):
    trainer_key: str = Field("", max_length=60, description="One in-game trainer (key from canon_list).")
    league_key: str = Field("", max_length=60, description="A whole league: its gyms, badges, Elite Four and champion.")


class GymSaveArgs(BaseModel):
    id: str = Field("", max_length=80, description="Empty creates a gym.")
    name: Optional[str] = Field(None, max_length=60)
    city: Optional[str] = Field(None, max_length=60)
    type: Optional[str] = Field(None, max_length=20, description="Speciality type, e.g. Fire.")
    badge: Optional[str] = Field(None, max_length=60)
    badge_color: Optional[str] = Field(None, max_length=20)
    description: Optional[str] = Field(None, max_length=2000)
    format: Optional[str] = Field(None, max_length=120)
    rules: Optional[list[str]] = Field(None, max_length=20)
    level_rules: Optional[dict[str, int]] = None
    leader_id: Optional[str] = Field(None, max_length=80)
    trainers: Optional[list[str]] = Field(None, max_length=20, description="Gym trainers fought before the leader, in order.")


class LeagueSaveArgs(BaseModel):
    id: str = Field("", max_length=80, description="Empty creates a league.")
    name: Optional[str] = Field(None, max_length=80)
    description: Optional[str] = Field(None, max_length=2000)
    format: Optional[str] = Field(None, max_length=120)
    rules: Optional[list[str]] = Field(None, max_length=20)
    level_rules: Optional[dict[str, int]] = None
    gyms: Optional[list[str]] = Field(None, max_length=40)
    elite_four: Optional[list[str]] = Field(None, max_length=10)
    champion_id: Optional[str] = Field(None, max_length=80)
    badges_required: Optional[int] = Field(None, ge=0, le=40)


class TrashArgs(BaseModel):
    kind: Literal["trainer", "gym", "league"]
    ids: list[str] = Field(..., min_length=1, max_length=500)
    action: Literal["trash", "restore", "purge"] = "trash"


class Seat(BaseModel):
    trainer_id: str = Field("", max_length=80)
    paste: str = Field("", max_length=200_000)
    team: Optional[list[dict[str, Any]]] = None
    name: str = Field("", max_length=60)
    human: bool = Field(False, description="A person (or you with battle_choose) plays this seat.")
    ai_level: Optional[Level] = None
    ai_style: Optional[Style] = None


class BattleStartArgs(BaseModel):
    p1: Seat
    p2: Seat
    format: str = Field("", max_length=120, description="Empty: the first trainer's format.")
    rules: list[str] = Field(default_factory=list, max_length=20)
    level_rules: dict[str, int] = Field(default_factory=dict)
    seed: Optional[str] = Field(None, max_length=60, description="Same seed and choices = same battle.")


class BattleGetArgs(BaseModel):
    id: str = IdField
    since: int = Field(0, ge=0, description="Return log lines from this index (log_length of the previous answer).")


class ChooseArgs(BaseModel):
    id: str = IdField
    side: Literal["p1", "p2"] = "p1"
    choice: str = Field(..., min_length=1, max_length=200)
    since: int = Field(0, ge=0)


class ForfeitArgs(BaseModel):
    id: str = IdField
    side: Literal["p1", "p2"] = "p1"
    since: int = Field(0, ge=0)


class BattlesArgs(BaseModel):
    kind: str = Field("", max_length=20, description="play, watch, gym, league, series, tournament, friend.")
    status: Literal["", "live", "running", "ended", "failed"] = ""
    trainer_id: str = Field("", max_length=80)
    limit: int = Field(30, ge=1, le=500)
    offset: int = Field(0, ge=0)


class ChallengeArgs(BaseModel):
    kind: Literal["gym", "league"]
    target_id: str = IdField
    challenger_id: str = IdField
    auto: bool = Field(False, description="The AI plays the challenger too (the whole challenge runs by itself).")
    ignore_badges: bool = False
    format: str = Field("", max_length=120, description="Play every battle in this format instead of the gym's (e.g. gen9nationaldexag for a modern team against a gen 2 gym).")


class ChallengesArgs(BaseModel):
    status: Literal["", "active", "won", "lost", "abandoned"] = ""
    kind: Literal["", "gym", "league"] = ""


class BadgesArgs(BaseModel):
    trainer_id: str = Field("", max_length=80)
    gym_id: str = Field("", max_length=80)


class HallArgs(BaseModel):
    league_id: str = Field("", max_length=80)


class SeriesArgs(BaseModel):
    p1: Seat
    p2: Seat
    count: int = Field(0, ge=0, le=1000, description="0 = the default of the settings (20).")
    format: str = Field("", max_length=120)
    rules: list[str] = Field(default_factory=list, max_length=20)
    level_rules: dict[str, int] = Field(default_factory=dict)


class TournamentArgs(BaseModel):
    trainer_ids: list[str] = Field(..., min_length=2, max_length=64)
    kind: Literal["bracket", "league"] = "bracket"
    best_of: int = Field(1, ge=1, le=9)
    format: str = Field("", max_length=120)
    rules: list[str] = Field(default_factory=list, max_length=20)
    level_rules: dict[str, int] = Field(default_factory=dict)
    title: str = Field("", max_length=80)
    ai_level: Optional[Level] = Field(None, description="Same AI for everybody; empty = each trainer's own.")


class JobsArgs(BaseModel):
    kind: Literal["", "series", "tournament", "avatar"] = ""
    status: Literal["", "queued", "running", "done", "failed", "cancelled"] = ""


class ExportArgs(BaseModel):
    kind: Literal["trainer", "gym", "league"]
    id: str = IdField
    fmt: Literal["file", "code", "page", "paste"] = "file"


class ImportArgs(BaseModel):
    content: str = Field("", max_length=20_000_000, description="A share code, result code, .hoard* JSON, playable page HTML or Showdown team.")
    path: str = Field("", max_length=1000, description="Or a file on this computer to read.")
    name: str = Field("", max_length=60, description="Name for a plain team.")
    format: str = Field("", max_length=120)


class AvatarPhotoArgs(BaseModel):
    path: str = Field(..., min_length=1, max_length=1000, description="A photo on this computer.")
    trainer_id: str = Field("", max_length=80, description="Set it as this trainer's avatar.")
    mode: Literal["pixel", "upload", "prospero"] = "pixel"
    remove_background: bool = True


class AvatarDrawArgs(BaseModel):
    paths: list[str] = Field(default_factory=list, max_length=4, description="Up to 4 photos of the same person on this computer.")
    description: str = Field("", max_length=300, description="Who or what to draw (with or without photos): a name, a look, clothes.")
    trainer_id: str = Field("", max_length=80, description="Set the first result as this trainer's avatar.")
    count: int = Field(2, ge=1, le=4, description="How many pictures Prospero draws.")
    style: bool = Field(True, description="Send the art-style references too (avatar_style_get), so it is drawn in the games' style.")


class AvatarStyleArgs(BaseModel):
    sprites: Optional[str] = Field(None, max_length=200, description="Showdown trainer sprite names, comma separated (up to 3); empty = none.")
    add_paths: list[str] = Field(default_factory=list, max_length=3, description="Pictures on this computer to add as style references.")
    remove: list[str] = Field(default_factory=list, max_length=20, description="Style pictures to remove (file names from avatar_style_get).")


class SettingsSetArgs(BaseModel):
    player_name: Optional[str] = Field(None, max_length=60)
    default_format: Optional[str] = Field(None, max_length=120)
    default_ai_level: Optional[Level] = None
    default_ai_style: Optional[Style] = None
    sprite_set: Optional[Literal["gen5", "gen5ani", "ani", "home", "dex"]] = None
    playback_ms: Optional[int] = Field(None, ge=0, le=5000)
    max_turns: Optional[int] = Field(None, ge=20, le=2000)
    node_path: Optional[str] = Field(None, max_length=500)
    sprite_downloads: Optional[bool] = None
    prospero_prompt: Optional[str] = Field(None, max_length=1000)
    prospero_style_sprites: Optional[str] = Field(None, max_length=200, description="Trainer sprites used as art-style references.")
    prospero_engine: Optional[Literal["", "auto", "qwen21", "flux", "sdxl"]] = Field(None, description="Image engine for drawn sprites; empty = Prospero's default.")
    series_default: Optional[int] = Field(None, ge=1, le=1000)


def _seat(s: Seat) -> dict[str, Any]:
    return s.model_dump(exclude_none=True)


def _read_path(path: str, limit: int = 20 * 1024 * 1024) -> bytes:
    p = Path(path).expanduser()
    if not p.is_file():
        raise SilverError("not_found", f"File not found: {path}")
    if p.stat().st_size > limit:
        raise SilverError("too_large", "The file is too large.")
    return p.read_bytes()


def _import(s: Services, a: ImportArgs) -> Any:
    content: Any = a.content
    if a.path:
        content = _read_path(a.path)
    if not content:
        raise SilverError("invalid", "Give content or path.")
    return s.import_any(content, name=a.name, format_=a.format)


def _canon_install(s: Services, a: CanonInstallArgs) -> Any:
    if a.league_key:
        return {"league": s.canon_install_league(a.league_key)}
    if a.trainer_key:
        return {"trainer": s.canon_install_trainer(a.trainer_key)}
    raise SilverError("invalid", "Give trainer_key or league_key.")


R = ann(read_only=True)
W = ann()
WD = ann(draft_safe=True)
D = ann(destructive=True)

TOOLS: list[Tool] = [
    Tool("silver_overview", _d("Counts, live battles, running jobs, recent battles and active challenges. Resumen del simulador.",
                               synonyms="estado, inicio, pokémon, combates en curso"), Empty, R, lambda s, a: s.overview()),
    Tool("formats_list", _d("Showdown battle formats (all generations, singles and doubles). Formatos de combate.",
                            synonyms="reglas, ou, vgc, custom game, generación"), FormatsArgs, R, lambda s, a: s.formats(a.gen, a.query)),
    Tool("dex_search", _d("Search the Pokédex: Pokémon, moves, items, abilities or natures of a generation. Buscar en la Pokédex.",
                          synonyms="pokédex, movimientos, objetos, habilidades, naturalezas, aprende"), DexArgs, R,
         lambda s, a: {"results": s.dex_search(a.kind, a.query, a.gen, a.limit, a.species)}),
    Tool("species_info", _d("A Pokémon's types, base stats, abilities, evolutions and learnable moves. Ficha de Pokémon.",
                            synonyms="estadísticas base, tipos, evoluciones, movimientos que aprende"), SpeciesArgs, R, lambda s, a: s.species(a.name, a.gen)),
    Tool("team_import", _d("Parse a team (Showdown text, packed or JSON) into sets and back to clean text. Leer equipo.",
                           synonyms="importar equipo, pokepaste, showdown"), TeamTextArgs, R, lambda s, a: s.import_team(a.text)),
    Tool("team_validate", _d("Check a team against a format's rules (Showdown's validator). Validar equipo.",
                             synonyms="legal, baneos, cláusulas, comprobar equipo"), ValidateArgs, R,
         lambda s, a: s.validate_team(a.format, a.team if a.team else a.paste, a.rules, a.level_rules)),
    Tool("team_random", _d("A random team from Showdown's random-battle sets. Equipo aleatorio.", synonyms="equipo al azar, random battle"),
         RandomTeamArgs, R, lambda s, a: s.random_team(a.format, a.seed)),
    Tool("trainers_list", _d("Trainers: name, title, team species, AI, avatar, record. Lista de entrenadores.",
                             synonyms="entrenadores, personajes, npc, equipos guardados"), TrainersArgs, R, lambda s, a: {"trainers": s.trainers_list(a.query, a.origin)}),
    Tool("trainer_get", _d("One trainer with team details, Showdown text, recent battles and badges. Ver entrenador.",
                           synonyms="ficha, equipo completo"), IdArg, R, lambda s, a: s.trainer_get(a.id)),
    Tool("trainer_create", _d("Create a trainer from a team (Showdown text or sets) with AI, avatar and lines. Crear entrenador.",
                              synonyms="nuevo entrenador, importar equipo de personaje, npc"), TrainerCreateArgs, WD,
         lambda s, a: s.trainer_create(name=a.name, team=a.team, paste=a.paste, format_=a.format, title=a.title, ai_level=a.ai_level or "",
                                       ai_style=a.ai_style or "", avatar=a.avatar, dialogue=a.dialogue.model_dump() if a.dialogue else None,
                                       notes=a.notes, tags=a.tags)),
    Tool("trainer_update", _d("Change a trainer: name, team, format, AI, avatar, lines, notes, favourite. Editar entrenador.",
                              synonyms="cambiar equipo, renombrar"), TrainerUpdateArgs, WD,
         lambda s, a: s.trainer_update(a.id, a.model_dump(exclude_none=True, exclude={"id"}))),
    Tool("trainer_random", _d("Create a trainer with a random team and a random trainer sprite. Entrenador aleatorio.",
                              synonyms="npc al azar, rival aleatorio"), TrainerRandomArgs, WD,
         lambda s, a: s.trainer_random(name=a.name, format_=a.format, ai_level=a.ai_level or "", seed=a.seed)),
    Tool("trainer_duplicate", _d("Copy a trainer (team, AI, avatar, lines) under a new name. Duplicar entrenador.", synonyms="clonar"),
         DuplicateArgs, WD, lambda s, a: s.trainer_duplicate(a.id, a.name)),
    Tool("trainer_dialogue_write", _d("Write a trainer's battle lines with the family's language model. Escribir frases del entrenador.",
                                      "Uses Hoard Hub's model (the Sparks, Faustus or Ollama); saves intro, win, lose and last.",
                                      synonyms="diálogo, frases, personalidad"), DialogueWriteArgs, WD,
         lambda s, a: s.trainer_write_dialogue(a.id, personality=a.personality, lang=a.lang), 240.0),
    Tool("trainer_sprites_search", _d("Search Showdown's trainer sprites by name to use as avatars. Buscar sprite de entrenador.",
                                      synonyms="avatar, imagen de entrenador, red, cynthia"), SpritesArgs, R,
         lambda s, a: {"sprites": s.trainer_sprites(a.query, a.limit)}),
    Tool("canon_list", _d("In-game teams of leaders, Elite Four, champions and rivals (Crystal, FRLG, Emerald). Equipos de los juegos.",
                          synonyms="líderes de gimnasio, alto mando, campeón, rojo, red, plata, personajes, ligas oficiales"), CanonArgs, R,
         lambda s, a: s.canon_list(a.query, a.region)),
    Tool("canon_install", _d("Add an in-game trainer, or a whole league with gyms, badges, Elite Four and champion. Instalar liga.",
                             synonyms="importar personaje, liga kanto, liga johto, liga hoenn"), CanonInstallArgs, WD, _canon_install),
    Tool("gyms_list", _d("Gyms with leader, type, badge and rules. Lista de gimnasios.", synonyms="gimnasios, medallas, líderes"),
         TrainersArgs, R, lambda s, a: {"gyms": s.gyms_list(a.query)}),
    Tool("gym_get", _d("One gym: leader, gym trainers, rules and who earned its badge. Ver gimnasio.", synonyms="medallas ganadas"),
         IdArg, R, lambda s, a: s.gym_get(a.id)),
    Tool("gym_save", _d("Create or change a gym: leader, gym trainers, badge, type, format and level rules. Crear gimnasio.",
                        synonyms="nuevo gimnasio, editar gimnasio, reglas de nivel"), GymSaveArgs, WD,
         lambda s, a: s.gym_save(a.id, **a.model_dump(exclude_none=True, exclude={"id"}))),
    Tool("leagues_list", _d("Leagues with their gyms, Elite Four, champion and hall of fame. Ligas.", synonyms="liga pokémon, alto mando"),
         Empty, R, lambda s, a: {"leagues": s.leagues_list()}),
    Tool("league_get", _d("One league in detail. Ver liga.", synonyms="hall de la fama"), IdArg, R, lambda s, a: s.league_get(a.id)),
    Tool("league_save", _d("Create or change a league: gyms in order, Elite Four, champion, badges needed. Crear liga.",
                           synonyms="nueva liga, editar liga"), LeagueSaveArgs, WD,
         lambda s, a: s.league_save(a.id, **a.model_dump(exclude_none=True, exclude={"id"}))),
    Tool("trash", _d("Move trainers, gyms or leagues to the trash, restore them or delete them for good. Papelera.",
                     synonyms="borrar, eliminar, recuperar"), TrashArgs, D, lambda s, a: s.trash(a.kind, a.ids, a.action)),
    Tool("trash_list", _d("What is in the trash. Ver papelera.", synonyms="borrados"), Empty, R, lambda s, a: s.trash_list()),
    Tool("battle_start", _d("Start a battle: two seats (trainer or team; person or AI). Two AIs = a watched battle. Empezar combate.",
                            synonyms="combatir, pelea, simular combate, npc contra npc, jugar"), BattleStartArgs, W,
         lambda s, a: s.battle_start(p1=_seat(a.p1), p2=_seat(a.p2), format_=a.format, rules=a.rules, level_rules=a.level_rules, seed=a.seed), 180.0),
    Tool("battle_get", _d("A battle: protocol log (from since), pending choices of person seats, result. Ver combate.",
                          synonyms="estado del combate, log, repetición"), BattleGetArgs, R, lambda s, a: s.battle_get(a.id, since=a.since)),
    Tool("battle_choose", _d("Send a person seat's choice: 'move 1', 'move 2 terastallize', 'switch 3', 'team 123456'. Elegir.",
                             synonyms="atacar, cambiar pokémon, movimiento"), ChooseArgs, W,
         lambda s, a: s.battle_choose(a.id, a.side, a.choice, since=a.since), 120.0),
    Tool("battle_forfeit", _d("Give up a live battle for one side. Rendirse.", synonyms="abandonar combate"), ForfeitArgs, W,
         lambda s, a: s.battle_forfeit(a.id, a.side, since=a.since)),
    Tool("battles_list", _d("Battles: live, watched, gym, league, series, tournament, from friends. Historial de combates.",
                            synonyms="historial, repeticiones"), BattlesArgs, R,
         lambda s, a: {"battles": s.battles_list(a.kind, a.status, a.trainer_id, a.limit, a.offset)}),
    Tool("battles_delete", _d("Delete finished battles and their logs. Borrar combates.", synonyms="limpiar historial"), IdsArg, D,
         lambda s, a: s.battles_delete(a.ids)),
    Tool("challenge_start", _d("Challenge a gym or a league with a trainer (you play, or the AI with auto). Retar gimnasio.",
                               synonyms="reto, medalla, alto mando, desafío"), ChallengeArgs, W,
         lambda s, a: s.run_start(kind=a.kind, target_id=a.target_id, challenger_id=a.challenger_id, auto=a.auto, ignore_badges=a.ignore_badges,
                                  format_override=a.format), 180.0),
    Tool("challenge_next", _d("Start the next battle of an active challenge. Siguiente combate del reto.", synonyms="continuar reto"),
         IdArg, W, lambda s, a: s.run_next(a.id), 180.0),
    Tool("challenge_abandon", _d("Give up an active challenge. Abandonar reto.", synonyms="rendirse"), IdArg, W, lambda s, a: s.run_abandon(a.id)),
    Tool("challenges_list", _d("Gym and league challenges with their stages and results. Retos.", synonyms="progreso, retos activos"),
         ChallengesArgs, R, lambda s, a: {"challenges": s.runs_list(a.status, a.kind)}),
    Tool("badges_list", _d("Badges earned (here or by friends through result codes). Medallas.", synonyms="medallas, estuche"),
         BadgesArgs, R, lambda s, a: {"badges": s.badges_list(a.trainer_id, a.gym_id)}),
    Tool("hall_of_fame", _d("League champions with their teams. Hall de la fama.", synonyms="campeones"), HallArgs, R,
         lambda s, a: {"hall": s.hall_list(a.league_id)}),
    Tool("series_start", _d("Play the same two AI trainers N times: win rate, average turns, MVPs (a job). Serie de combates.",
                            synonyms="simular muchas veces, probabilidad de ganar, estadísticas"), SeriesArgs, W,
         lambda s, a: s.series_start(p1=_seat(a.p1), p2=_seat(a.p2), count=a.count, format_=a.format, rules=a.rules, level_rules=a.level_rules)),
    Tool("tournament_start", _d("A tournament between trainers played by the AI: bracket or league table (a job). Torneo.",
                                synonyms="copa, eliminatoria, liguilla, todos contra todos"), TournamentArgs, W,
         lambda s, a: s.tournament_start(trainer_ids=a.trainer_ids, kind=a.kind, best_of=a.best_of, format_=a.format, rules=a.rules,
                                         level_rules=a.level_rules, title=a.title, ai_level=a.ai_level or "")),
    Tool("jobs_list", _d("Series, tournaments and sprite drawings, running or finished. Trabajos.", synonyms="progreso, cola"),
         JobsArgs, R, lambda s, a: {"jobs": s.jobs_list(a.kind, a.status)}),
    Tool("job_get", _d("One job with its result (series stats, tournament bracket or table) and battles. Resultado.",
                       synonyms="resultado del torneo, estadísticas de la serie"), IdArg, R, lambda s, a: s.job_get(a.id)),
    Tool("job_cancel", _d("Stop a running job. Cancelar trabajo.", synonyms="parar"), IdArg, W, lambda s, a: s.job_cancel(a.id)),
    Tool("jobs_delete", _d("Delete finished jobs and their battles. Borrar trabajos.", synonyms="limpiar"), IdsArg, D, lambda s, a: s.jobs_delete(a.ids)),
    Tool("export", _d("Export a trainer, gym or league: file, share code, playable HTML page or Showdown text. Enviar a un amigo.",
                      "page = one HTML file a friend opens in any browser to fight it; it gives them a result code to send back.",
                      synonyms="compartir, enviar entrenador, código, html jugable"), ExportArgs, R, lambda s, a: s.export(a.kind, a.id, fmt=a.fmt)),
    Tool("import", _d("Import a share code, result code, .hoard* file, playable page or Showdown team. Importar.",
                      "Result codes from friends record their badge or win here.", synonyms="código de amigo, resultado, cargar"),
         ImportArgs, WD, _import),
    Tool("avatar_draw", _d("Have Prospero's Hoard draw a trainer sprite from up to 4 photos and/or a description (a job). Dibujar sprite.",
                           "Each result is a 96-px pixel-art sprite plus the drawing itself; job_get gives them as candidates.",
                           synonyms="sprite con ia, dibujar entrenador, sprite desde fotos, sprite de un famoso"), AvatarDrawArgs, WD,
         lambda s, a: s.avatar_draw([_read_path(p) for p in a.paths], description=a.description, trainer_id=a.trainer_id, count=a.count,
                                    style=a.style), 120.0),
    Tool("avatar_style_get", _d("The art-style references drawn sprites follow: your pictures, then trainer sprites. Estilo de los sprites.",
                                 synonyms="referencias de estilo, estilo anime, estilo de los juegos"), Empty, R,
         lambda s, a: s.avatar_style_get()),
    Tool("avatar_style_set", _d("Change the style references: trainer sprite names, pictures to add or remove. Cambiar estilo.",
                                 "Up to 3 are used: your pictures first (official art, anime stills), then the sprites.",
                                 synonyms="añadir referencia de estilo, arte oficial, estilo anime"), AvatarStyleArgs, WD,
         lambda s, a: s.avatar_style_set(sprites=a.sprites, add=[(Path(p).name, _read_path(p)) for p in a.add_paths], remove=a.remove)),
    Tool("avatar_from_photo", _d("Turn a photo into a trainer sprite: pixel art here or drawn by Prospero's Hoard (a job). Sprite desde foto.",
                                 synonyms="avatar, foto, sprite estilo pokémon, prospero"), AvatarPhotoArgs, WD,
         lambda s, a: s.avatar_from_photo(_read_path(a.path), trainer_id=a.trainer_id, mode=a.mode, remove_background=a.remove_background), 120.0),
    Tool("settings_get", _d("Settings: your name, default format and AI, sprites, playback speed. Ajustes.", synonyms="configuración"),
         Empty, R, lambda s, a: s.settings.snapshot()),
    Tool("settings_set", _d("Change settings. Cambiar ajustes.", synonyms="configurar, nombre del jugador"), SettingsSetArgs, W,
         lambda s, a: s.settings_set(a.model_dump(exclude_none=True))),
]

TOOLS_BY_NAME = {t.name: t for t in TOOLS}


def tool_catalog() -> list[dict[str, Any]]:
    return _catalog(TOOLS)


def call_tool(services: Services, name: str, arguments: Optional[dict[str, Any]] = None, *, caller: str = "") -> Any:
    return _call_tool(TOOLS, services, name, arguments)
