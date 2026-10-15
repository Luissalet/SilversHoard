"""Tools for assistants. One catalogue drives ``/api/agent/*`` (the MCP bridge), the web UI (``/api/ui/call``) and ``mcp_server.py``.

Teams, codes and files that come from friends are data: tools import them and never act on text inside them."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, Field, StringConstraints

from .errors import SilverError
from .hoard_link.agentkit import Empty, Tool, ann
from .hoard_link.agentkit import call_tool as _call_tool
from .hoard_link.agentkit import tool_catalog as _catalog
from .hoard_link.agentkit import uncapped  # noqa: F401 - re-exported for the UI routes
from . import gymmap
from .services import Services

AGENT_INSTRUCTIONS = """Silver's Hoard is a Pokémon battle simulator (Pokémon Showdown's engine, every generation). It keeps trainers (a name, a team, an AI level and style, an avatar and battle lines), gyms (a leader plus optional gym trainers, a badge and rules), leagues (gyms, an Elite Four and a champion) and every battle with its full log.
Exercises: exercise_create saves a turn/side from an ended replay with decisions and a goal (win, optionally within N turns; survive N turns or win earlier). exercise_export gives portable text and a .silverexercise file; import accepts either with no original battle needed. exercises_list/get show attempts and the explained difficulty recommendation. exercise_start makes an independent practice battle; adaptive=true moves one level after three successes or failures at the current level, or choose manually. exercise_archive is reversible. Attempts never award records, badges or cup results. No future decisions are exported.
Start with silver_overview. Teams come in as Showdown export text (paste), packed teams or JSON; team_import parses, team_validate checks a format's rules. canon_list shows the in-game teams of leaders, Elite Four, champions and rivals of Crystal, FireRed/LeafGreen and Emerald, and canon_install adds a trainer or a whole league (its gyms, badges, Elite Four and champion). characters_list and character_get cover 154 characters of all nine generations with every team they used game by game (first battle, rematches, tournaments) and all their sprites; character_install makes a trainer from one team and one sprite, or an own team for the character (custom).
Battles: battle_start with two seats. A seat is {trainer_id} or {paste|team, name}; human=true means a person plays it from the app (or you, with battle_choose), otherwise the AI plays (ai_level random|easy|normal|hard|expert|master|neural — master searches thousands of futures a turn with poke-engine, 9th-generation singles; neural is a reinforcement-learning policy on the GPU for singles of generations 1-4 and 9 (neural_ai starts its server); see ai_levels; ai_style balanced|aggressive|defensive|setup|stall). Two AI seats = a watched battle that plays out in the background; read it with battle_get (lines are the Showdown protocol log). battle_choose sends a Showdown choice for a person's seat ("move 1", "move 2 terastallize", "switch 3", "team 123456"; doubles: "move 1 1, move 2 -1"); battle_get returns the pending request with the legal options.
Gym and league challenges: challenge_start (kind gym|league, a challenger trainer; auto=true lets the AI play the challenger). Winning every battle of a gym gives a badge; a league needs its badges and ends in the hall of fame. Battle facilities (facilities_list): challenge_start kind=facility starts a win streak against one rival after another with the facility's bosses on their battles; the record is the longest streak. In the Battle Factory (factory3, factory4, factory9) there is no own team: factory_pick takes 3 of 6 rentals each round and factory_swap trades one for the beaten rival's after a win.
Many battles at once: series_start (the same two trainers N times: win rate, MVPs) and tournament_start (bracket or league table between trainers), both background jobs (job_get). Cups with a live bracket: cup_start (picked and/or random trainers, optionally human_id = the user's trainer), then cup_get to follow it; the AI's matches play in the background one after another, the user's wait for cup_play (a battle to play) or cup_simulate; cup_watch turns an AI match into a battle to watch. benchmark_start compares several team variants against the same rivals with shared seeds (wins/losses per rival, delta vs a reference team, improved and worsened lists; a job; never writes the hall of fame).
Levels: level_rules {level: 50} (or 100) on battle_start, series_start, tournament_start and benchmark_start, or level on challenge_start, equalizes every Pokémon of both sides at that level, so teams of different levels fight on even terms.
Real time: battle_start, challenge_start, series_start, tournament_start and benchmark_start take mode=realtime for battles after Pokémon Legends: Z-A (the same trainers and teams on a 2D arena, no turns: every move has a cooldown in seconds instead of PP, a wind-up and a range; attacks can be dodged; one-stage stat changes that wear off; three switches that come back after each KO; a Mega Power gauge for Mega Evolution (no Plus moves since rules version 4); lock-on held or free aim; doubles formats field two Pokémon per trainer, a person moving one while the AI drives its partner, with spread moves, Helping Hand and Follow Me) and rt_arena=rocks (default: 3-6 rocks that block walking and projectiles) or open. A person plays it on the app's screen; two AI seats play it in the background. rt_cooldowns shows how a team's moves translate (Z-A's own cooldowns, or derived from PP and power); rt_rules explains the rules. battle_get of a real-time battle returns English event lines and the spec + inputs that replay it exactly.
Sharing: export (fmt file = .hoardtrainer/.hoardgym/.hoardleague, code = a share code for a chat, page = one HTML file a friend opens in a browser to fight the gym or trainer, turn by turn or in real time as friend_mode says, weekly=true for this week's challenge with the same luck for everyone, paste = Showdown text). import takes any of those back, plus the result codes friends send after playing a page (every battle in it is replayed and checked first, then the badge and the leaderboard entry are recorded; a code counts once). leaderboard ranks friends per gym or trainer and per week.
progress_get shows a trainer's record, streaks, MVPs, achievements and Pokédex (progress_list ranks them).
sets_popular gives Smogon's sets and the ladder usage of a species (for the team builder); usage_top and sample_team rank the format's Pokémon and build a team from them.
damage_calc measures one Pokémon's moves against another (rolls, crits, KOs) with the game's own formula.
battle_video records a finished battle's replay as an MP4 clip with its sound (a job; lumiere=true sends it to the video editor).
Move animations: the turn-based screen plays Pokémon Showdown's own animation of each move (934) or Silver's effects, as the viewer picks in Settings; fx_cache shows the cached effect pictures and prefetch=true downloads them all for battles without internet.
battle_explain says why the AI chose each move (the options it weighed with expected damage and KOs, the threat it was under, the expert's play-outs) and, in a live battle, what the expert would do now on your side.
Avatars: trainer_sprites_search (Showdown trainer sprites), avatar_from_photo (a photo on this computer into pixel art here) or avatar_draw (Prospero's Hoard draws one from up to 4 photos and/or a description in the games' art style, with the references of avatar_style_get; a background job). avatar_poses_draw draws a trainer's own sprite again from behind (shown on the player's side of a battle) and in a victory pose (shown when it wins); avatar_pose_set picks another candidate."""


def _d(first: str, detail: str = "", synonyms: str = "") -> str:
    assert len(first) <= 110, first
    parts = [first]
    if detail:
        parts.append(detail)
    if synonyms:
        parts.append("Sinónimos: " + synonyms)
    return "\n".join(parts)


Level = Literal["random", "easy", "normal", "hard", "expert", "master", "neural"]
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


Boosts = dict[Literal["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"], int]
PokemonSpec = Field(..., description="One Pokémon: Showdown export text or a set {species, item, ability, nature, evs, ivs, level, moves, teraType}.")


class DamageCalcArgs(BaseModel):
    attacker: str | dict[str, Any] = PokemonSpec
    defender: str | dict[str, Any] = PokemonSpec
    format: str = Field("", max_length=120, description="Its generation's rules apply (empty = generation 9).")
    moves: list[str] = Field(default_factory=list, max_length=8, description="Empty = the attacker's own moves.")
    attacker_boosts: Optional[Boosts] = None
    defender_boosts: Optional[Boosts] = None
    attacker_tera: str = Field("", max_length=20, description="A type, or 'yes' for the set's own Tera type (generation 9).")
    defender_tera: str = Field("", max_length=20)
    attacker_mega: bool = Field(False, description="Mega Evolve (or Ultra Burst) first when the item allows it.")
    defender_mega: bool = False
    weather: Optional[Literal["", "sun", "rain", "sand", "hail", "snow"]] = Field(None, description="Left out = what the abilities set; '' = none.")
    terrain: Optional[Literal["", "electric", "grassy", "psychic", "misty"]] = Field(None, description="Left out = what the abilities set; '' = none.")
    screens: list[Literal["reflect", "lightscreen", "auroraveil"]] = Field(default_factory=list, max_length=3, description="On the defender's side.")
    defender_hp: Optional[int] = Field(None, ge=1, le=100, description="HP left, % of max (default full).")


def _damage_calc(s: Services, a: DamageCalcArgs) -> Any:
    args = a.model_dump(exclude_none=True)
    for key in ("attacker_tera", "defender_tera"):
        if args.get(key) == "yes":
            args[key] = True
        elif not args.get(key):
            args.pop(key, None)
    return s.engine.call("damage_calc", args)


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
    on_ko: str = Field("", max_length=280, description="Said when its Pokémon knocks out a foe.")
    on_faint: str = Field("", max_length=280, description="Said when one of its Pokémon faints.")
    on_super: str = Field("", max_length=280, description="Said when it lands a super-effective hit.")
    on_switch: str = Field("", max_length=280, description="Said when it switches Pokémon.")
    phase_when: Literal["", "half", "last"] = Field("", description="Change of tactics: half = when its team's HP falls to half; last = with its last Pokémon; '' = never.")
    phase_level: Literal["", "random", "easy", "normal", "hard", "expert", "master", "neural"] = Field("", description="AI level from then on ('' = the same).")
    phase_style: Literal["", "balanced", "aggressive", "defensive", "setup", "stall"] = Field("", description="AI style from then on ('' = the same).")
    phase: str = Field("", max_length=280, description="What it says when it changes tactics (shown with its Pokémon's face).")


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


class CreditsArgs(BaseModel):
    species: str = Field("", max_length=60, description="A Pokémon: the artists of its walking sprite in the real-time arena.")
    sprite: str = Field("", max_length=64, description="A Showdown trainer sprite name (acerola, sd:acerola): its artist.")


class SpritesArgs(BaseModel):
    query: str = Field("", max_length=40)
    limit: int = Field(120, ge=1, le=1500)


class CanonArgs(BaseModel):
    query: str = Field("", max_length=60)
    region: Literal["", "Kanto", "Johto", "Hoenn"] = ""


class CanonInstallArgs(BaseModel):
    trainer_key: str = Field("", max_length=60, description="One in-game trainer (key from canon_list).")
    league_key: str = Field("", max_length=60, description="A whole league: its gyms, badges, Elite Four and champion.")


class StatPointsArgs(BaseModel):
    trainer_id: str = Field("", max_length=80, description="Read (and with save, change) this trainer's team.")
    team: Any = Field(None, description="Or a team as sets/JSON/paste.")
    paste: str = Field("", max_length=20000)
    format: str = Field("", max_length=120)
    points: dict[str, dict[str, int]] = Field(default_factory=dict, description="Slot (0-5) -> {hp, atk, def, spa, spd, spe} points; 66 in all, 32 per stat.")
    save: bool = Field(False, description="Store the new points on the trainer.")


class CharactersArgs(BaseModel):
    query: str = Field("", max_length=60, description="Name (English or Spanish), game or a Pokémon of the team.")
    gen: int = Field(0, ge=0, le=9, description="Only teams of this generation (0 = all).")
    game: str = Field("", max_length=12, description="Game card id (rb, y, gsc, rs, e, frlg, dp, pt, hgss, bw, b2w2, xy, oras, sm, usum, lgpe, swsh, bdsp, sv, za, stadium, stadium2) or a game code.")
    category: Literal["", "leaders", "elite", "champions", "trials", "rivals", "villains", "facilities", "tournaments", "others"] = ""


class CharacterKeyArg(BaseModel):
    key: str = Field(..., max_length=40, description="Character key from characters_list, e.g. lance.")


class CharacterInstallArgs(BaseModel):
    key: str = Field(..., max_length=40, description="Character key from characters_list, e.g. lance.")
    variant: str = Field("", max_length=60, description="Team id from character_get (game and battle). Empty: the latest team.")
    sprite: str = Field("", max_length=60, description="Trainer sprite id from character_get (e.g. lance-gen2). Empty: the one of that game.")
    name: str = Field("", max_length=60, description="Trainer name. Empty: character, game and battle.")
    custom: bool = Field(False, description="An own team for the character: the chosen team as a start (or empty without variant), to edit freely.")
    ai_level: str = Field("", max_length=12)
    ai_style: str = Field("", max_length=12)
    lang: Literal["es", "en"] = "es"


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
    badge_image: Optional[str] = Field(None, max_length=200, description="Badge picture: shape:<hexagon|boulder|drop|bolt|leaf|flame|heart|star|flake|wing|gear|fist|eye|moon|scale|shell|rainbow|crown>, file:<from badge_image_set or badge_draw> or '' for the plain badge.")
    rt_arena: Optional[str] = Field(None, max_length=90, description="Where its real-time battles are fought: '' (the challenger picks), open, rocks or custom:<arena id>.")
    backdrop: Optional[str] = Field(None, max_length=120, description="Backdrop of its turn-based battles: a backdrop file name (bg-volcanocave.png, bg-icecave.jpg…), file:<picture> from backdrop_image_set, or '' for the usual one.")
    map: Optional[dict[str, Any]] = Field(None, description="The map walked to the leader: {w, h, tiles (w*h chars: . floor, # wall, ~ water, o boulder, * plant, = carpet, , grass), start: [x, y], leader: {x, y, facing}, trainers: [{id, x, y, facing, sight}]} (gym_map_generate makes one); {} removes it.")


class BadgeImageArgs(BaseModel):
    gym_id: str = Field("", max_length=80, description="Put the picture on this gym at once.")
    path: str = Field("", max_length=500, description="A picture on this computer to use as the badge.")
    data_base64: str = Field("", max_length=14_000_000, description="Or the picture itself, base64.")
    remove_background: bool = False


class BackdropImageArgs(BaseModel):
    gym_id: str = Field("", max_length=80, description="Put the picture on this gym at once.")
    path: str = Field("", max_length=500, description="A picture on this computer to use as the backdrop.")
    data_base64: str = Field("", max_length=14_000_000, description="Or the picture itself, base64.")


class BadgeDrawArgs(BaseModel):
    gym_id: str = Field("", max_length=80, description="The gym (its type and badge name fill the description in; the first picture goes on it).")
    description: str = Field("", max_length=300, description="What the badge looks like.")
    count: int = Field(2, ge=1, le=4)


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
    ai_hidden: Optional[bool] = Field(None, description="The AI sees only what the battle shows of the other team (guessing the rest from usage statistics). Default: the ai_hidden_info setting.")


Mode = Literal["classic", "realtime"]
ModeField = Field("classic", description="classic = turns (Showdown's engine); realtime = Legends: Z-A rules (cooldowns, 2D arena; doubles formats put two Pokémon per trainer on it).")
TimeLimitField = Field(0, ge=0, le=1800, description="realtime: seconds before time is called (0 = the settings' value, 300).")
RtArena = Annotated[str, StringConstraints(pattern=r"^(open|rocks|custom:[A-Za-z0-9_]{1,80})$")]
RtArenaField = Field("rocks", description="realtime: the arena. rocks = 3-6 rocks from the seed (block walking and projectiles); open = no obstacles; custom:<id> = an arena from the arena designer (arenas_list).")


class TrainingArgs(BaseModel):
    trainer_id: str = Field(..., min_length=1, max_length=80, description="Your trainer (you play it).")
    pattern: Literal["still", "walk", "dodge", "fight"] = Field("still", description="The dummy: still, walk (in circles), dodge (rolls away from attacks) or fight (attacks like the easy AI).")
    dummy_id: str = Field("", max_length=80, description="A trainer whose team is the dummy (default: a Sudowoodo).")
    format: str = Field("", max_length=120)
    rt_arena: RtArena = Field("open", description="open, rocks or custom:<id>.")
    time_limit: int = Field(300, ge=30, le=1800)


class BattleStartArgs(BaseModel):
    p1: Seat
    p2: Seat
    format: str = Field("", max_length=120, description="Empty: the first trainer's format.")
    rules: list[str] = Field(default_factory=list, max_length=20)
    level_rules: dict[str, int] = Field(default_factory=dict, description="{level: 50|100} equalizes every Pokémon at that level; {level_cap}, {level_min} cap or raise.")
    seed: Optional[str] = Field(None, max_length=60, description="Same seed and choices = same battle.")
    mode: Mode = ModeField
    time_limit: int = TimeLimitField
    rt_arena: RtArena = RtArenaField


class RtFinishArgs(BaseModel):
    id: str = IdField
    inputs: list[list[Any]] = Field(default_factory=list, max_length=200_000, description="The screen's input log: [tick, side, mx, my, move, roll, switch, focus, plus, mega] plus [ctl, tgt] in doubles (controlled slot, locked foe slot; older rows have the first seven).")
    tick: int = Field(0, ge=0, le=60 * 30 * 30)
    forfeit: Literal["", "p1", "p2"] = ""


class RtSaveArgs(BaseModel):
    id: str = IdField
    inputs: list[list[Any]] = Field(default_factory=list, max_length=200_000)
    tick: int = Field(0, ge=0, le=60 * 30 * 30)


class RtCooldownArgs(BaseModel):
    trainer_id: str = Field("", max_length=80)
    paste: str = Field("", max_length=200_000)
    team: Optional[list[dict[str, Any]]] = None
    format: str = Field("", max_length=120)
    level_rules: dict[str, int] = Field(default_factory=dict)


class PracticeArgs(BaseModel):
    id: str = IdField
    turn: int = Field(..., ge=1, description="Rebuild to the start of this turn's move decision.")
    side: Literal["p1", "p2"] = "p1"


class ExerciseCreateArgs(BaseModel):
    battle_id: str = IdField
    turn: int = Field(..., ge=1)
    side: Literal["p1", "p2"] = "p1"
    title: str = Field("", max_length=200)
    goal: Literal["win", "survive"] = "win"
    target_turns: int = Field(0, ge=0, le=1000, description="Win: 0 means unlimited. Survive: at least one turn; winning early also passes.")


class ExerciseListArgs(BaseModel):
    archived: bool = False


class ExerciseArchiveArgs(IdArg):
    archived: bool = True


class ExerciseStartArgs(IdArg):
    adaptive: bool = True
    ai_level: Literal["random", "easy", "normal", "hard", "expert", "master"] = "normal"


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
    kind: str = Field("", max_length=20, description="play, watch, gym, league, series, tournament, cup, friend.")
    status: Literal["", "live", "running", "ended", "failed"] = ""
    trainer_id: str = Field("", max_length=80)
    limit: int = Field(30, ge=1, le=500)
    offset: int = Field(0, ge=0)


class ChallengeArgs(BaseModel):
    kind: Literal["gym", "league", "facility"] = Field(..., description="facility = a win streak at a battle facility (target_id from facilities_list).")
    target_id: str = IdField
    challenger_id: str = IdField
    auto: bool = Field(False, description="The AI plays the challenger too (the whole challenge runs by itself).")
    ignore_badges: bool = False
    format: str = Field("", max_length=120, description="Play every battle in this format instead of the gym's (e.g. gen9nationaldexag for a modern team against a gen 2 gym).")
    mode: Mode = ModeField
    level: int = Field(0, ge=0, le=100, description="Equalize every Pokémon of every battle at this level (50 or 100); 0 = the gym's own level rules (a facility: 50).")
    rt_arena: RtArena = RtArenaField
    stop_at: int = Field(0, ge=0, le=10_000, description="facility with auto: stop the streak after this many wins (0 = until it is lost).")
    walk_map: bool = Field(True, description="A gym with a map: walk it (challenge_get; challenge_next with the stage you meet). False = the battles one after another.")


class ChallengeNextArgs(BaseModel):
    id: str = IdField
    stage: str = Field("", max_length=80, description="On a gym map: whom you met, a trainer id or leader (the leader once every trainer is beaten).")


class GymMapArgs(BaseModel):
    trainer_ids: list[str] = Field(default_factory=list, max_length=20, description="The gym's trainers, in order.")
    seed: str = Field("", max_length=40)


class ChallengesArgs(BaseModel):
    status: Literal["", "active", "won", "lost", "abandoned"] = ""
    kind: Literal["", "gym", "league", "facility"] = ""


class FactoryPickArgs(BaseModel):
    id: str = IdField
    picks: list[int] = Field(..., min_length=1, max_length=6, description="Indexes (0-5) of the rentals to take, in battle order.")


class FactorySwapArgs(BaseModel):
    id: str = IdField
    give: int = Field(-1, ge=-1, le=5, description="Index of your rental to give away (-1 = keep the team).")
    take: int = Field(-1, ge=-1, le=5, description="Index of the beaten rival's Pokémon to take.")


class ProgressArgs(BaseModel):
    trainer_id: str = IdField


class FacilitiesArgs(BaseModel):
    trainer_id: str = Field("", max_length=80, description="Records and open streak of this trainer (empty = everybody's).")


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
    mode: Mode = ModeField
    time_limit: int = TimeLimitField
    rt_arena: RtArena = RtArenaField


class TournamentArgs(BaseModel):
    trainer_ids: list[str] = Field(..., min_length=2, max_length=64)
    kind: Literal["bracket", "league"] = "bracket"
    best_of: int = Field(1, ge=1, le=9)
    format: str = Field("", max_length=120)
    rules: list[str] = Field(default_factory=list, max_length=20)
    level_rules: dict[str, int] = Field(default_factory=dict)
    title: str = Field("", max_length=80)
    ai_level: Optional[Level] = Field(None, description="Same AI for everybody; empty = each trainer's own.")
    mode: Mode = ModeField
    time_limit: int = TimeLimitField
    rt_arena: RtArena = RtArenaField


class BenchmarkArgs(BaseModel):
    variant_ids: list[str] = Field(..., min_length=2, max_length=8, description="Team variants to compare (trainers). The first is the reference unless reference_id says otherwise.")
    rival_ids: list[str] = Field(..., min_length=1, max_length=16, description="Rivals every variant faces with the same seeds.")
    reference_id: str = Field("", max_length=80, description="Which variant is the baseline for deltas (empty = first of variant_ids).")
    games: int = Field(1, ge=1, le=50, description="Battles per variant×rival with shared seeds.")
    format: str = Field("", max_length=120)
    rules: list[str] = Field(default_factory=list, max_length=20)
    level_rules: dict[str, int] = Field(default_factory=dict)
    seed: str = Field("", max_length=60, description="Master seed that builds the shared per-rival seeds.")
    ai_level: Optional[Level] = Field(None, description="Same AI for everybody; empty = each trainer's own.")
    mode: Mode = ModeField
    time_limit: int = TimeLimitField
    rt_arena: RtArena = RtArenaField


class CupStartArgs(BaseModel):
    trainer_ids: list[str] = Field(default_factory=list, max_length=64, description="The trainers you pick (may be empty with random_count).")
    random_count: int = Field(0, ge=0, le=64, description="Fill the cup up to this many trainers drawn at random from yours (0 = only the picked ones).")
    random_from: str = Field("", max_length=80, description="Only draw trainers whose name, title, tags or team match this text.")
    human_id: str = Field("", max_length=80, description="Your trainer: its matches wait for you to play them (cup_play) or simulate them (cup_simulate). Empty = the AI plays every match.")
    seeding: Literal["random", "chosen"] = Field("random", description="random = a shuffled draw; chosen = seeds in the order of trainer_ids (1 meets the last, the best seeds get the byes).")
    best_of: int = Field(1, ge=1, le=7, description="Games per match (odd).")
    format: str = Field("", max_length=120)
    rules: list[str] = Field(default_factory=list, max_length=20)
    level_rules: dict[str, int] = Field(default_factory=dict)
    title: str = Field("", max_length=80)
    ai_level: Optional[Level] = Field(None, description="Same AI for everybody; empty = each trainer's own.")
    mode: Mode = ModeField
    time_limit: int = TimeLimitField
    rt_arena: RtArena = RtArenaField
    pace: float = Field(1.5, ge=0, le=10, description="Least seconds between the AI's matches, so the bracket can be followed as it fills in.")


class CupsArgs(BaseModel):
    status: Literal["", "active", "done", "abandoned"] = ""


class CupMatchArgs(BaseModel):
    id: str = IdField
    round: int = Field(..., ge=0, le=6, description="0 = the first round.")
    match: int = Field(..., ge=0, le=63, description="0 = the top match of that round.")


class CupSimulateArgs(BaseModel):
    id: str = IdField
    round: Optional[int] = Field(None, ge=0, le=6, description="With match: that match. Without: your current match.")
    match: Optional[int] = Field(None, ge=0, le=63)


class ArenaSaveArgs(BaseModel):
    id: str = Field("", max_length=80, description="Empty creates an arena.")
    name: Optional[str] = Field(None, max_length=60)
    floor: Optional[Literal["grass", "sand", "ice", "cave", "indoor", "water"]] = None
    rocks: Optional[list[dict[str, float]]] = Field(None, max_length=16, description="Up to 16 rocks {x, y, r} in metres on the 28 x 17 m field (r 0.4-3), off the spots at (5, 8.5) and (23, 8.5) where the Pokémon come in.")
    mirror: bool = Field(False, description="Also put each rock's left-right mirror image.")


class JobsArgs(BaseModel):
    kind: Literal["", "series", "tournament", "avatar", "badge"] = ""
    status: Literal["", "queued", "running", "done", "failed", "cancelled"] = ""


class ExportArgs(BaseModel):
    kind: Literal["trainer", "gym", "league"]
    id: str = IdField
    fmt: Literal["file", "code", "page", "paste"] = "file"
    friend_mode: Literal["choose", "turns", "realtime"] = Field(
        "choose", description="Only for fmt=page: how the friend may fight. choose = they pick turn by turn or real time for each battle, "
        "turns = turn by turn only, realtime = real time only (the result code carries the replay, which the app checks on import).")
    weekly: bool = Field(False, description="Only for fmt=page: this week's challenge. Everyone who plays the page this week fights turn by turn "
                         "with the same seed and the same AI luck; the import checks it and the results rank in the week's leaderboard.")


class LeaderboardArgs(BaseModel):
    kind: Literal["", "gym", "trainer"] = ""
    target_id: str = Field("", max_length=80, description="A gym or trainer id, or empty for all.")
    week: str = Field("", max_length=12, description="Empty for every result, current for this week's challenge, or a week like 2026-W42.")


class ImportArgs(BaseModel):
    content: str = Field("", max_length=20_000_000, description="A share code, result code, .hoard* JSON, playable page HTML, Showdown team or pokepast.es link.")
    path: str = Field("", max_length=1000, description="Or a file on this computer to read.")
    name: str = Field("", max_length=60, description="Name for a plain team.")
    format: str = Field("", max_length=120)


class UnboundSaveArgs(BaseModel):
    path: str = Field("", max_length=1000, description="The save file on this computer (.sav or .srm of Pokémon Unbound 2.1).")
    data_base64: str = Field("", max_length=400_000, description="Or the save itself, base64.")
    name: str = Field("", max_length=60, description="The new trainer's name (default: the player's name in the save).")
    format: str = Field("", max_length=120, description="Default gen8customgame, as Unbound's Battle Frontier trainers.")


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


class SetsArgs(BaseModel):
    species: str = Field(..., min_length=1, max_length=60)
    format: str = Field("", max_length=120, description="Empty: the default format. Custom games use the generation's OU.")


class UsageArgs(BaseModel):
    format: str = Field("", max_length=120)
    limit: int = Field(30, ge=1, le=200)


class SampleTeamArgs(BaseModel):
    format: str = Field("", max_length=120)


class RefreshArg(BaseModel):
    refresh: bool = Field(False, description="Check poke-engine again (after installing it).")


class BattleVideoArgs(BaseModel):
    id: str = IdField
    speed: Literal["slow", "normal", "fast"] = Field("normal", description="Replay speed of the clip.")
    size: Literal["720p", "1080p"] = "720p"
    lang: Literal["", "es", "en"] = Field("", description="Language of the battle texts; empty = the app's.")
    lumiere: bool = Field(False, description="Also send the clip to Lumiere's Hoard, the family's video editor.")


class BattleExplainArgs(BaseModel):
    id: str = IdField
    side: Literal["", "p1", "p2"] = Field("", description="Only this side's decisions (and advice for it); empty = both.")
    turn: int = Field(0, ge=0, le=1000, description="Only this turn's decisions.")
    from_turn: int = Field(0, ge=0, le=1000, description="Every decision from this turn on.")
    advice: bool = Field(True, description="In a live battle, also what the expert AI would do now on the person's side.")
    limit: int = Field(6, ge=1, le=800, description="Without turn or from_turn: the last N decisions.")


class AvatarPosesArgs(BaseModel):
    trainer_id: str = Field("", max_length=80, description="The trainer whose current sprite gets the poses.")
    avatar: str = Field("", max_length=200, description="Or the sprite itself: file:<name> (your own sprites only).")
    poses: list[Literal["back", "win"]] = Field(default_factory=list, max_length=2, description="back (from behind), win (victory pose); empty = both.")
    count: int = Field(1, ge=1, le=4, description="Pictures per pose; the first is used, the rest are candidates.")
    style: bool = Field(True, description="Send the art-style references too (avatar_style_get).")


class AvatarPosesGetArgs(BaseModel):
    trainer_id: str = Field("", max_length=80)
    avatar: str = Field("", max_length=200, description="Or the sprite itself: file:<name>.")


class AvatarPoseSetArgs(BaseModel):
    avatar: str = Field(..., max_length=200, description="The sprite the pose belongs to: file:<name>.")
    pose: Literal["back", "win"]
    file: str = Field("", max_length=200, description="A picture in the avatars folder (file:<name>, e.g. another candidate); empty drops the pose.")


class AvatarStyleArgs(BaseModel):
    sprites: Optional[str] = Field(None, max_length=200, description="Showdown trainer sprite names, comma separated (up to 3); empty = none.")
    add_paths: list[str] = Field(default_factory=list, max_length=3, description="Pictures on this computer to add as style references.")
    remove: list[str] = Field(default_factory=list, max_length=20, description="Style pictures to remove (file names from avatar_style_get).")


class FxCacheArgs(BaseModel):
    prefetch: bool = Field(False, description="Download every picture the move animations use now (for battles without internet later).")


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
    ai_hidden_info: Optional[bool] = Field(None, description="AIs see only what the battle has shown of the opponent's team.")
    music_source: Optional[Literal["showdown", "pokerogue"]] = Field(None, description="Battle music: showdown (trainer and rival themes) or pokerogue (its community's original tracks, CC BY-NC-SA 4.0: by gym type, Elite Four, champion).")
    pokerogue_audio: Optional[str] = Field(None, max_length=300, description="Where PokeRogue's battle tracks are downloaded from.")
    ai_banter: Optional[bool] = Field(None, description="AI trainers comment their moves in character as the battle goes (the family's language model writes the lines in the background; battle_get returns them as banter).")
    smogon_data: Optional[bool] = Field(None, description="Fetch popular sets and usage statistics from data.pkmn.cc when asked for.")
    sound_downloads: Optional[bool] = None
    prospero_prompt: Optional[str] = Field(None, max_length=1000)
    prospero_style_sprites: Optional[str] = Field(None, max_length=200, description="Trainer sprites used as art-style references.")
    prospero_engine: Optional[Literal["", "auto", "qwen21", "flux", "sdxl"]] = Field(None, description="Image engine for drawn sprites; empty = Prospero's default.")
    series_default: Optional[int] = Field(None, ge=1, le=1000)
    default_mode: Optional[Mode] = None
    default_level: Optional[Literal[0, 50, 100]] = None
    rt_time_limit: Optional[int] = Field(None, ge=30, le=1800)
    pmd_sprites: Optional[bool] = None
    neural_ai_python: Optional[str] = Field(None, max_length=500, description="The python of an environment with PyTorch and metamon; empty turns the neural level off.")
    neural_ai_model: Optional[str] = Field(None, max_length=60, description="Pretrained policy (Kakuna by default).")
    neural_ai_gpu: Optional[str] = Field(None, max_length=2, description="GPU index as nvidia-smi numbers them; empty = the first.")
    neural_ai_port: Optional[int] = Field(None, ge=1024, le=65535)


class NeuralArgs(BaseModel):
    action: Literal["status", "start", "stop"] = "status"
    wait: float = Field(0, ge=0, le=600, description="start: seconds to wait until it answers (the first start downloads the weights).")


def _seat(s: Seat) -> dict[str, Any]:
    return s.model_dump(exclude_none=True)


def _read_path(path: str, limit: int = 20 * 1024 * 1024) -> bytes:
    p = Path(path).expanduser()
    if not p.is_file():
        raise SilverError("not_found", f"File not found: {path}")
    if p.stat().st_size > limit:
        raise SilverError("too_large", "The file is too large.")
    return p.read_bytes()


def _unbound_save(s: Services, a: UnboundSaveArgs) -> Any:
    if a.path:
        data = _read_path(a.path, limit=1024 * 1024)
    elif a.data_base64:
        data = base64.b64decode(a.data_base64)
    else:
        raise SilverError("invalid", "Give path or data_base64.")
    return s.unbound_save_import(data, name=a.name, format_=a.format)


def _import(s: Services, a: ImportArgs) -> Any:
    content: Any = a.content
    if a.path:
        content = _read_path(a.path)
    if not content:
        raise SilverError("invalid", "Give content or path.")
    return s.import_any(content, name=a.name, format_=a.format)


def _badge_image_set(s: Services, a: BadgeImageArgs) -> Any:
    if a.path:
        data = Path(a.path).expanduser().read_bytes() if Path(a.path).expanduser().is_file() else b""
        if not data:
            raise SilverError("not_found", f"No picture at {a.path}")
    elif a.data_base64:
        data = base64.b64decode(a.data_base64)
    else:
        raise SilverError("invalid", "Give path or data_base64.")
    return s.badge_upload(data, gym_id=a.gym_id, remove_background=a.remove_background)


def _picture_bytes(path: str, data_base64: str) -> bytes:
    if path:
        data = Path(path).expanduser().read_bytes() if Path(path).expanduser().is_file() else b""
        if not data:
            raise SilverError("not_found", f"No picture at {path}")
        return data
    if data_base64:
        return base64.b64decode(data_base64)
    raise SilverError("invalid", "Give path or data_base64.")


def _backdrop_image_set(s: Services, a: BackdropImageArgs) -> Any:
    return s.backdrop_upload(_picture_bytes(a.path, a.data_base64), gym_id=a.gym_id)


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
    Tool("damage_calc", _d("Damage of each move of one Pokémon against another: rolls, multi-hit, crits, KOs. Calculadora de daño.",
                           "Measured with the simulator's own formula of the format's generation: abilities (type-changing ones too), items, stat boosts, Tera, Mega Evolution, weather, terrain and screens count; weather and terrain left out = what the abilities set. Each move: per-strike rolls (39 in gen 1–2), multi-hit min–max (Skill Link, Loaded Dice, 2–5), crit range, OHKO chance.",
                           synonyms="calculadora, cuánto quita, rango de daño, ohko, 2hko, cálculo de daño"), DamageCalcArgs, R, _damage_calc),
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
         lambda s, a: s.trainer_update(a.id, {**a.model_dump(exclude_none=True, exclude={"id", "dialogue"}),
                                              # only the lines given change: the others (and the change of tactics) stay
                                              **({"dialogue": a.dialogue.model_dump(exclude_unset=True)} if a.dialogue else {})})),
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
         lambda s, a: (lambda names, artists: {"sprites": names, "artists": {n: artists[n] for n in names if n in artists}})(
             s.trainer_sprites(a.query, a.limit), s.credits.trainers())),
    Tool("credits", _d("Who drew what: sources and licences, trainer sprite artists, walking sprite artists. Créditos.",
                       "With sprite, one trainer sprite's artist; with species, the SpriteCollab artists of that Pokémon; else everything.",
                       synonyms="autores, artistas, licencias, atribución, quién dibujó"), CreditsArgs, R,
         lambda s, a: s.credits_get(species=a.species, sprite=a.sprite), 60.0),
    Tool("canon_list", _d("In-game teams of leaders, Elite Four, champions and rivals (Crystal, FRLG, Emerald). Equipos de los juegos.",
                          "leagues also lists whole leagues of more games built from the characters' teams: kanto-rgb, johto-hgss, hoenn-oras, sinnoh-pt, unova-bw, unova-b2w2, kalos-xy, alola-sm, alola-usum (Elite Four and champion only), galar-sw, paldea-sv.",
                          synonyms="líderes de gimnasio, alto mando, campeón, rojo, red, plata, personajes, ligas oficiales"), CanonArgs, R,
         lambda s, a: s.canon_list(a.query, a.region)),
    Tool("canon_install", _d("Add an in-game trainer, or a whole league with gyms, badges, Elite Four and champion. Instalar liga.",
                             synonyms="importar personaje, liga kanto, liga johto, liga hoenn, liga sinnoh, liga teselia, liga kalos, liga alola, galar, paldea"), CanonInstallArgs, WD, _canon_install),
    Tool("stat_points", _d("Stat points as in Pokémon Champions (66, 32 per stat) for a team, and the stats they give. Puntos de stats.",
                           "Reads the points from the EVs (HOME's rule: 4 EVs the first, 8 each more) and writes them back as EVs.",
                           synonyms="ev, evs, puntos de entrenamiento, champions, repartir puntos, stats"), StatPointsArgs, WD,
         lambda s, a: s.stat_points(trainer_id=a.trainer_id, team=a.team, paste=a.paste, format_=a.format, points=a.points, save=a.save)),
    Tool("characters_list", _d("Characters of all generations (leaders, champions, rivals) with their game teams and sprites. Personajes.",
                               "Teams, levels, held items and bag items from Bulbapedia, one per game and battle (first battle, rematch, tournaments...).",
                               synonyms="lance, cintia, cynthia, rojo, azul, equipos por juego, revancha, sprites por juego"), CharactersArgs, R,
         lambda s, a: s.characters_list(a.query, a.gen, a.game, a.category)),
    Tool("character_get", _d("One character: every team it used game by game (levels, items, bag items) and its sprites. Ver personaje.",
                             synonyms="equipos de lance, sprites de un personaje"), CharacterKeyArg, R, lambda s, a: s.character_get(a.key)),
    Tool("character_install", _d("Make a trainer from a character: one game team and one sprite, or an own team. Crear desde personaje.",
                                 "Same team and sprite twice gives back the trainer already made; custom always makes a new one.",
                                 synonyms="añadir lance, equipo propio, elegir sprite, elegir equipo por juego"), CharacterInstallArgs, WD,
         lambda s, a: {"trainer": s.character_install(a.key, variant=a.variant, sprite=a.sprite, name=a.name, custom=a.custom,
                                                      ai_level=a.ai_level, ai_style=a.ai_style, lang=a.lang)}),
    Tool("gyms_list", _d("Gyms with leader, type, badge and rules. Lista de gimnasios.", synonyms="gimnasios, medallas, líderes"),
         TrainersArgs, R, lambda s, a: {"gyms": s.gyms_list(a.query)}),
    Tool("gym_get", _d("One gym: leader, gym trainers, rules and who earned its badge. Ver gimnasio.", synonyms="medallas ganadas"),
         IdArg, R, lambda s, a: s.gym_get(a.id)),
    Tool("gym_save", _d("Create or change a gym: leader, gym trainers, badge, type, format and level rules. Crear gimnasio.",
                        synonyms="nuevo gimnasio, editar gimnasio, reglas de nivel"), GymSaveArgs, WD,
         lambda s, a: s.gym_save(a.id, **a.model_dump(exclude_none=True, exclude={"id"}))),
    Tool("badge_image_set", _d("Use a picture of your own as a gym badge (from a path or base64). Imagen de medalla.",
                                "Kept as a transparent PNG up to 256 px; travels with the gym in files and playable pages.",
                                synonyms="medalla, imagen de medalla, subir medalla"), BadgeImageArgs, WD, _badge_image_set),
    Tool("backdrop_image_set", _d("Use a picture of your own as the backdrop of a gym's turn-based battles (from a path or base64). Fondo propio.",
                                   "Kept as a PNG up to 800 px, small enough to travel with the gym in files and playable pages; returns the backdrop value for gym_save.",
                                   synonyms="fondo de combate, fondo propio, subir fondo"), BackdropImageArgs, WD, _backdrop_image_set),
    Tool("badge_draw", _d("Have Prospero's Hoard draw gym badges from a description (a job). Dibujar medalla.",
                          "Returns a job; its result lists the candidates (badge_image values for gym_save). Prospero must be running.",
                          synonyms="generar medalla, dibujar medalla, medalla con ia"), BadgeDrawArgs, WD,
         lambda s, a: s.badge_draw(description=a.description, gym_id=a.gym_id, count=a.count)),
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
         lambda s, a: s.battle_start(p1=_seat(a.p1), p2=_seat(a.p2), format_=a.format, rules=a.rules, level_rules=a.level_rules, seed=a.seed,
                                     mode=a.mode, time_limit=a.time_limit, rt_arena=a.rt_arena), 180.0),
    Tool("battle_practice", _d("Play another move from a finished replay as a separate battle. Practicar otra jugada.",
                               "Requires a saved decision record (new played or individually watched turn-based battles). "
                               "The original and trainer records stay intact; the opponent uses revealed information.",
                               synonyms="practicar turno, repetir jugada, rama, entrenamiento"), PracticeArgs, W,
         lambda s, a: s.battle_practice(a.id, turn=a.turn, side=a.side), 120.0),
    Tool("exercises_list", _d("Saved replay exercises with goals, attempts and difficulty suggestions. Ejercicios.", synonyms="entrenar, biblioteca ejercicios"),
         ExerciseListArgs, R, lambda s, a: s.training.list(a.archived)),
    Tool("exercise_create", _d("Save a replay position and goal as an independent exercise. Guardar ejercicio.", synonyms="practicar, compartir posición"),
         ExerciseCreateArgs, W, lambda s, a: s.training.create(a.battle_id, turn=a.turn, side=a.side, title=a.title, goal=a.goal, target_turns=a.target_turns), 120.0),
    Tool("exercise_get", _d("Exercise goal, attempts and explained difficulty recommendation. Ver ejercicio.", synonyms="objetivo, progreso entrenamiento"),
         IdArg, R, lambda s, a: s.training.get(a.id)),
    Tool("exercise_start", _d("Start a separate practice attempt with adaptive or chosen difficulty. Practicar ejercicio.", synonyms="intentar, entrenamiento adaptativo"),
         ExerciseStartArgs, W, lambda s, a: s.training.start(a.id, adaptive=a.adaptive, ai_level=a.ai_level), 120.0),
    Tool("exercise_export", _d("Export a portable exercise as text and a .silverexercise file. Compartir ejercicio.", synonyms="enviar posición, exportar entrenamiento"),
         IdArg, W, lambda s, a: s.training.export(a.id)),
    Tool("exercise_archive", _d("Archive or restore a saved exercise without removing its attempts. Archivar ejercicio.", synonyms="restaurar entrenamiento"),
         ExerciseArchiveArgs, W, lambda s, a: s.training.archive(a.id, a.archived)),
    Tool("battle_compare", _d("Compare a practice battle with its original: winner, turns and team results. Comparar práctica.",
                              synonyms="comparar resultado, original y práctica"), IdArg, R, lambda s, a: s.battle_compare(a.id)),
    Tool("battle_get", _d("A battle: protocol log (from since), pending choices of person seats, result. Ver combate.",
                          synonyms="estado del combate, log, repetición"), BattleGetArgs, R, lambda s, a: s.battle_get(a.id, since=a.since)),
    Tool("battle_choose", _d("Send a person seat's choice: 'move 1', 'move 2 terastallize', 'switch 3', 'team 123456'. Elegir.",
                             synonyms="atacar, cambiar pokémon, movimiento"), ChooseArgs, W,
         lambda s, a: s.battle_choose(a.id, a.side, a.choice, since=a.since), 120.0),
    Tool("battle_forfeit", _d("Give up a live battle for one side. Rendirse.", synonyms="abandonar combate"), ForfeitArgs, W,
         lambda s, a: s.battle_forfeit(a.id, a.side, since=a.since)),
    Tool("training_start", _d("Real-time training against a dummy that never faints: try cooldowns, reach, rolls and combos. Entrenamiento.",
                              "The dummy stands still, walks, dodges or fights back (pattern); a knockout heals it. Open the returned battle in the app "
                              "(#/combate/<id>) to play; the screen shows damage per second. Nothing counts for records, progress or medals.",
                              synonyms="muñeco, practicar tiempo real, entrenar, dps"), TrainingArgs, W,
         lambda s, a: s.training_start(trainer_id=a.trainer_id, pattern=a.pattern, dummy_id=a.dummy_id, format_=a.format, arena=a.rt_arena,
                                       time_limit=a.time_limit)),
    Tool("battle_rt_finish", _d("End a real-time battle: the app replays its inputs and stores the result. Terminar combate en tiempo real.",
                                "Used by the battle screen; a forfeit stops the replay at `tick`.", synonyms="tiempo real, resultado, rendirse"),
         RtFinishArgs, W, lambda s, a: s.rt_finish(a.id, inputs=a.inputs, tick=a.tick, forfeit=a.forfeit), 600.0),
    Tool("battle_rt_save", _d("Keep the inputs of a live real-time battle so a reload resumes it. Guardar combate en tiempo real.",
                              synonyms="tiempo real, guardar partida"), RtSaveArgs, W, lambda s, a: s.rt_save(a.id, inputs=a.inputs, tick=a.tick)),
    Tool("rt_cooldowns", _d("A team's moves in real time: Z-A cooldown or one derived from PP, Speed-adjusted, wind-up. Recargas.",
                            synonyms="tiempo real, PP, enfriamiento, recarga, leyendas z-a"), RtCooldownArgs, R,
         lambda s, a: s.rt_cooldowns(trainer_id=a.trainer_id, team=a.team, paste=a.paste, format_=a.format, level_rules=a.level_rules), 60.0),
    Tool("rt_rules", _d("How the real-time mode works (Legends: Z-A rules) and what it does not cover. Reglas del tiempo real.",
                        synonyms="tiempo real, leyendas z-a, reglas, controles"), Empty, R, lambda s, a: s.rt_rules()),
    Tool("battles_list", _d("Battles: live, watched, gym, league, series, tournament, from friends. Historial de combates.",
                            synonyms="historial, repeticiones"), BattlesArgs, R,
         lambda s, a: {"battles": s.battles_list(a.kind, a.status, a.trainer_id, a.limit, a.offset)}),
    Tool("battles_delete", _d("Delete finished battles and their logs. Borrar combates.", synonyms="limpiar historial"), IdsArg, D,
         lambda s, a: s.battles_delete(a.ids)),
    Tool("challenge_start", _d("Challenge a gym or a league with a trainer (you play, or the AI with auto). Retar gimnasio.",
                               synonyms="reto, medalla, alto mando, desafío"), ChallengeArgs, W,
         lambda s, a: s.run_start(kind=a.kind, target_id=a.target_id, challenger_id=a.challenger_id, auto=a.auto, ignore_badges=a.ignore_badges,
                                  format_override=a.format, mode=a.mode, level=a.level, rt_arena=a.rt_arena, stop_at=a.stop_at,
                                  walk_map=a.walk_map), 180.0),
    Tool("challenge_next", _d("Start the next battle of an active challenge. Siguiente combate del reto.",
                              "On a gym map give stage: the trainer you met (or leader).", synonyms="continuar reto"),
         ChallengeNextArgs, W, lambda s, a: s.run_next(a.id, a.stage), 180.0),
    Tool("challenge_get", _d("One challenge with its stages; on a gym map also the map, the people and who is beaten. Ver reto.",
                             synonyms="recorrido del gimnasio, mapa del reto"), IdArg, R, lambda s, a: s.run_get(a.id)),
    Tool("gym_map_generate", _d("An automatic gym map for these trainers: walls, a winding way, the leader at the top. Generar mapa.",
                                "gym_save map= stores it (edit it first if you like).", synonyms="mapa del gimnasio, plano"),
         GymMapArgs, R, lambda s, a: {"map": gymmap.generate(a.trainer_ids, a.seed or None)}),
    Tool("challenge_abandon", _d("Give up an active challenge. Abandonar reto.", synonyms="rendirse"), IdArg, W, lambda s, a: s.run_abandon(a.id)),
    Tool("facilities_list", _d("Battle facilities (Tower, Subway, Maison, Tree) with bosses and streak records. Instalaciones.",
                               "challenge_start kind=facility target_id=<id> starts a streak: one rival after another at level 50, 3 Pokémon each (4 in doubles) picked at team preview, the facility's bosses on their battle (Palmer 21/49, Ingo and Emmet 21/49, the Chatelaines 20/50, Red and Blue 20/50, Anabel 35/70, Leon every 10). challenge_next starts the next battle; a loss ends the streak.",
                               synonyms="torre batalla, metro batalla, batalla chatelet, árbol batalla, rachas, frente batalla"), FacilitiesArgs, R,
         lambda s, a: s.facilities_list(a.trainer_id)),
    Tool("factory_pick", _d("Battle Factory: take 3 of the 6 rental Pokémon and start the round. Elegir alquiler.",
                            "challenges_list / challenge_start show them in factory.rentals (phase pick). The next battle starts at once.",
                            synonyms="fábrica batalla, pokémon de alquiler"), FactoryPickArgs, W, lambda s, a: s.factory_pick(a.id, a.picks), 180.0),
    Tool("factory_swap", _d("Battle Factory: after a win, swap one rental for one of the beaten rival's, or keep. Cambiar alquiler.",
                            "factory.offer has the rival's Pokémon (phase swap); give/take are indexes, -1/-1 keeps the team. The next battle starts at once.",
                            synonyms="cambio, intercambio de alquiler"), FactorySwapArgs, W, lambda s, a: s.factory_swap(a.id, a.give, a.take), 180.0),
    Tool("progress_get", _d("A trainer's progress: record, streaks, MVPs, achievements and Pokédex of used and beaten. Progreso.",
                            "Worked out from its battles, challenges, facility streaks, badges and hall of fame: wins/losses by kind, current and best streak, KOs, per-species KOs (MVP), 22 achievements (unlocked or not), and the species it used, saw and knocked out.",
                            synonyms="estadísticas, logros, récords, pokédex, mvp, racha"), ProgressArgs, R, lambda s, a: s.progress_get(a.trainer_id)),
    Tool("progress_list", _d("Every own trainer ranked by wins, with best streak, facility record and achievements. Clasificación.",
                             synonyms="ranking, clasificación, mejores entrenadores"), Empty, R, lambda s, a: s.progress_list()),
    Tool("challenges_list", _d("Gym and league challenges and facility streaks with their stages and results. Retos.", synonyms="progreso, retos activos"),
         ChallengesArgs, R, lambda s, a: {"challenges": s.runs_list(a.status, a.kind)}),
    Tool("badges_list", _d("Badges earned (here or by friends through result codes). Medallas.", synonyms="medallas, estuche"),
         BadgesArgs, R, lambda s, a: {"badges": s.badges_list(a.trainer_id, a.gym_id)}),
    Tool("hall_of_fame", _d("League champions with their teams. Hall de la fama.", synonyms="campeones"), HallArgs, R,
         lambda s, a: {"hall": s.hall_list(a.league_id)}),
    Tool("series_start", _d("Play the same two AI trainers N times: win rate, average turns, MVPs (a job). Serie de combates.",
                            synonyms="simular muchas veces, probabilidad de ganar, estadísticas"), SeriesArgs, W,
         lambda s, a: s.series_start(p1=_seat(a.p1), p2=_seat(a.p2), count=a.count, format_=a.format, rules=a.rules, level_rules=a.level_rules,
                                     mode=a.mode, time_limit=a.time_limit, rt_arena=a.rt_arena)),
    Tool("tournament_start", _d("A tournament between trainers played by the AI: bracket or league table (a job). Torneo.",
                                synonyms="copa, eliminatoria, liguilla, todos contra todos"), TournamentArgs, W,
         lambda s, a: s.tournament_start(trainer_ids=a.trainer_ids, kind=a.kind, best_of=a.best_of, format_=a.format, rules=a.rules,
                                         level_rules=a.level_rules, title=a.title, ai_level=a.ai_level or "", mode=a.mode, time_limit=a.time_limit,
                                         rt_arena=a.rt_arena)),
    Tool("benchmark_start", _d("Compare team variants vs the same rivals with shared seeds (deltas vs a reference; a job). Comparar equipos.",
                               "Shows wins/losses/ties per rival, win-rate delta against the reference, and which variants improved or worsened. "
                               "Does not write the hall of fame or competitive records.",
                               synonyms="banco de pruebas, comparar variantes, mismos rivales"), BenchmarkArgs, W,
         lambda s, a: s.benchmarks.start(variant_ids=a.variant_ids, rival_ids=a.rival_ids, reference_id=a.reference_id, games=a.games,
                                         format_=a.format, rules=a.rules, level_rules=a.level_rules, seed=a.seed, ai_level=a.ai_level or "",
                                         mode=a.mode, time_limit=a.time_limit, rt_arena=a.rt_arena)),
    Tool("cup_start", _d("A knockout cup with a live bracket: pick trainers or draw them at random, and play your matches. Copa.",
                         "The AI plays every match that is not yours in the background, one after another (pace seconds apart), so "
                         "cup_get shows the bracket filling in. With human_id your matches wait for cup_play (turns or real time) or "
                         "cup_simulate. tournament_start stays for a quick AI-only bracket or a league table.",
                         synonyms="torneo con cuadro, eliminatoria, cuadro de torneo, copa aleatoria, jugar un torneo"), CupStartArgs, W,
         lambda s, a: s.cups.create(trainer_ids=a.trainer_ids, random_count=a.random_count, random_from=a.random_from, human_id=a.human_id,
                                    seeding=a.seeding, best_of=a.best_of, format_=a.format, rules=a.rules, level_rules=a.level_rules,
                                    mode=a.mode, time_limit=a.time_limit, rt_arena=a.rt_arena, ai_level=a.ai_level or "", title=a.title,
                                    pace=a.pace)),
    Tool("cup_get", _d("One cup: its bracket round by round, scores, games to replay, your next match and the champion. Ver copa.",
                       synonyms="cuadro, bracket, cómo va la copa"), IdArg, R, lambda s, a: s.cups.get(a.id)),
    Tool("cups_list", _d("Cups, playing or over, with their champions. Copas.", synonyms="torneos, copas jugadas"), CupsArgs, R,
         lambda s, a: {"cups": s.cups.list(a.status)}),
    Tool("cup_play", _d("Start (or resume) your next game in a cup: returns the battle to play. Jugar mi combate de la copa.",
                        synonyms="mi partido, jugar la copa"), IdArg, W, lambda s, a: s.cups.play(a.id)),
    Tool("cup_simulate", _d("Let the AI play a cup match now: yours (no round/match) or the one given. Simular combate de la copa.",
                            synonyms="simular mi partido, que juegue la IA"), CupSimulateArgs, W,
         lambda s, a: s.cups.simulate_mine(a.id) if a.round is None or a.match is None else s.cups.simulate_match(a.id, a.round, a.match)),
    Tool("cup_watch", _d("Watch one of the AI's ready cup matches as a battle instead of in the background. Ver en directo.",
                         synonyms="ver combate de la copa"), CupMatchArgs, W, lambda s, a: s.cups.watch(a.id, a.round, a.match)),
    Tool("cup_continue", _d("Let the AI play on the cup's ready matches (after a restart, or to resume). Seguir la copa.",
                            synonyms="continuar copa, reanudar"), IdArg, W, lambda s, a: {**s.cups.advance(a.id), "cup": s.cups.get(a.id)}),
    Tool("cup_abandon", _d("Stop a cup where it is. Abandonar copa.", synonyms="cancelar copa"), IdArg, W, lambda s, a: s.cups.abandon(a.id)),
    Tool("cups_delete", _d("Delete cups and the battles they stored. Borrar copas.", synonyms="limpiar copas"), IdsArg, D,
         lambda s, a: s.cups.delete(a.ids)),
    Tool("arenas_list", _d("Arenas drawn in the arena designer for real-time battles, with the gyms that use them. Arenas.",
                           synonyms="arenas propias, campos de combate, escenarios"), Empty, R, lambda s, a: {"arenas": s.arenas.list()}),
    Tool("arena_get", _d("One arena: its rocks, floor and the gyms that fight on it. Ver arena.", synonyms="arena"), IdArg, R,
         lambda s, a: s.arenas.get(a.id)),
    Tool("arena_save", _d("Create or change an arena for real-time battles: rocks placed by hand and its floor. Diseñar arena.",
                          "Battles use it with rt_arena=custom:<id>; gym_save rt_arena puts a gym on it. A battle keeps the arena "
                          "it was played on, so later edits never change a replay.", synonyms="editor de arenas, crear arena, poner rocas"),
         ArenaSaveArgs, WD, lambda s, a: s.arenas.save(a.id, name=a.name, floor=a.floor, rocks=a.rocks, mirror=a.mirror)),
    Tool("arenas_delete", _d("Delete arenas; gyms on them go back to the challenger's choice. Borrar arenas.", synonyms="quitar arena"),
         IdsArg, D, lambda s, a: s.arenas.delete(a.ids)),
    Tool("jobs_list", _d("Series, tournaments and sprite drawings, running or finished. Trabajos.", synonyms="progreso, cola"),
         JobsArgs, R, lambda s, a: {"jobs": s.jobs_list(a.kind, a.status)}),
    Tool("job_get", _d("One job with its result (series stats, tournament bracket or table) and battles. Resultado.",
                       synonyms="resultado del torneo, estadísticas de la serie"), IdArg, R, lambda s, a: s.job_get(a.id)),
    Tool("job_cancel", _d("Stop a running job. Cancelar trabajo.", synonyms="parar"), IdArg, W, lambda s, a: s.job_cancel(a.id)),
    Tool("jobs_delete", _d("Delete finished jobs and their battles. Borrar trabajos.", synonyms="limpiar"), IdsArg, D, lambda s, a: s.jobs_delete(a.ids)),
    Tool("export", _d("Export a trainer, gym or league: file, share code, playable HTML page or Showdown text. Enviar a un amigo.",
                      "page = one HTML file a friend opens in any browser to fight it (friend_mode: choose, turns or realtime); it gives them a result code to send back.",
                      synonyms="compartir, enviar entrenador, código, html jugable"), ExportArgs, R,
         lambda s, a: s.export(a.kind, a.id, fmt=a.fmt, friend_mode=a.friend_mode, weekly=a.weekly)),
    Tool("leaderboard", _d("Friends' results from playable pages ranked per gym or trainer, and the week's challenge. Clasificación.",
                           "Best result of each friend: a full win first, then checked by replaying, then the furthest battle, the fewest turns and the most HP "
                           "left. week=current gives this week's challenge (pages exported with weekly=true: same seed and AI luck for everyone).",
                           synonyms="ranking de amigos, reto de la semana, reto semanal, clasificación, quién ganó"), LeaderboardArgs, R,
         lambda s, a: s.leaderboard(a.kind, a.target_id, a.week)),
    Tool("leaderboard_remove", _d("Take results off the friends' leaderboard (their battles and badges stay). Quitar de la clasificación.",
                                  "ids from leaderboard entries (an entry's ids are all the attempts of that friend).", synonyms="borrar resultado de amigo"),
         IdsArg, D, lambda s, a: s.leaderboard_remove(a.ids)),
    Tool("pokepaste_export", _d("Publish a trainer's team on pokepast.es and give its link (public). Enlace de pokepaste.",
                                 "Anyone with the link can read the team; import takes pokepast.es links back.",
                                 synonyms="pokepaste, enlace del equipo, compartir equipo por enlace"), IdArg, WD,
         lambda s, a: s.pokepaste_export(a.id), 60.0),
    Tool("import", _d("Import a share code, result code, .hoard* file, playable page, Showdown team or pokepast.es link. Importar.",
                      "Result codes from friends record their badge or win here.", synonyms="código de amigo, resultado, cargar"),
         ImportArgs, WD, _import),
    Tool("unbound_save_import", _d("A Pokémon Unbound save file's party as a new trainer. Importar equipo de mi partida de Unbound.",
                                   "Reads the .sav/.srm: species, items, Unbound's abilities, moves, levels, natures, EVs, IVs, nicknames; "
                                   "eggs and unknown ids are listed in skipped. import also takes save files.",
                                   synonyms="partida guardada, archivo de guardado, sav, emulador, mi equipo de unbound"),
         UnboundSaveArgs, WD, _unbound_save),
    Tool("avatar_draw", _d("Have Prospero's Hoard draw a trainer sprite from up to 4 photos and/or a description (a job). Dibujar sprite.",
                           "Each result is a 96-px pixel-art sprite plus the drawing itself; job_get gives them as candidates.",
                           synonyms="sprite con ia, dibujar entrenador, sprite desde fotos, sprite de un famoso"), AvatarDrawArgs, WD,
         lambda s, a: s.avatar_draw([_read_path(p) for p in a.paths], description=a.description, trainer_id=a.trainer_id, count=a.count,
                                    style=a.style), 120.0),
    Tool("sets_popular", _d("Smogon's popular sets of a species and its ladder usage (items, abilities, moves, teammates). Sets populares.",
                            "From data.pkmn.cc, fetched when asked for and cached; the nearest format with data is used.",
                            synonyms="sets de smogon, set competitivo, estadísticas de uso, qué set lleva"), SetsArgs, R,
         lambda s, a: s.sets_popular(a.species, a.format), 60.0),
    Tool("usage_top", _d("The most used Pokémon of a format on Showdown's ladder. Más usados.", synonyms="uso, ranking de pokémon, metagame"),
         UsageArgs, R, lambda s, a: s.usage_top(a.format, a.limit), 60.0),
    Tool("sample_team", _d("A sample team: the format's six most used Pokémon with their most popular set. Equipo de muestra.",
                           synonyms="equipo de ejemplo, equipo competitivo, equipo meta"), SampleTeamArgs, R,
         lambda s, a: s.sample_team(a.format), 90.0),
    Tool("ai_levels", _d("The AI levels, what each one does and whether the master's search runs here. Niveles de la IA.",
                         "master needs poke-engine (optional, built with Terastallization); without it, it plays as the expert.",
                         synonyms="niveles de dificultad, ia maestra, dificultad de la ia"), RefreshArg, R,
         lambda s, a: s.ai_levels(a.refresh), 90.0),
    Tool("neural_ai", _d("The neural AI level's GPU server: status, start or stop. IA neuronal.",
                         "A policy trained on millions of real battles (metamon) that plays singles of generations 1-4 and 9 with the "
                         "neural level; it runs from its own Python environment (setting neural_ai_python). Without it, that level plays "
                         "as the expert.", synonyms="red neuronal, ia de aprendizaje por refuerzo, metamon, gpu"), NeuralArgs, W,
         lambda s, a: s.neural_ai(a.action, a.wait), 620.0),
    Tool("battle_video", _d("Record a finished battle's replay as a video clip with its sound (a job). Vídeo del combate.",
                            "MP4 in the exports folder (job_get gives its url and path); lumiere=true hands it to the video editor.",
                            synonyms="exportar vídeo, grabar repetición, clip del combate, mandar a lumiere"), BattleVideoArgs, WD,
         lambda s, a: s.battle_video(a.id, speed=a.speed, size=a.size, lang=a.lang, lumiere=a.lumiere), 60.0),
    Tool("video_status", _d("What recording battle videos needs here: Playwright, Chrome or Edge, ffmpeg. Estado del vídeo.",
                            synonyms="requisitos vídeo, grabar vídeo"), Empty, R, lambda s, a: s.video_status()),
    Tool("battle_explain", _d("Why the AI chose each move, turn by turn, and what the expert would do now. Comentar la jugada.",
                              "Each decision lists the options weighed (expected damage, KO, accuracy; a switch's damage taken and dealt), the "
                              "threat on the Pokémon, who was faster and, for the expert AI, the candidate turns it played out.",
                              synonyms="por qué la ia, explicar jugada, consejo, qué haría la ia, comentar combate"), BattleExplainArgs, R,
         lambda s, a: s.battle_explain(a.id, side=a.side, turn=a.turn, from_turn=a.from_turn, advice=a.advice, limit=a.limit), 120.0),
    Tool("avatar_poses_draw", _d("Have Prospero's Hoard draw a trainer's own sprite from behind and in a victory pose (a job). Poses del sprite.",
                                 "The back view stands on the player's side of a battle and the victory pose shows when it wins.",
                                 synonyms="sprite de espaldas, pose de victoria, poses, back sprite"), AvatarPosesArgs, WD,
         lambda s, a: s.avatar_poses_draw(trainer_id=a.trainer_id, avatar=a.avatar, poses=list(a.poses), count=a.count, style=a.style), 120.0),
    Tool("avatar_poses_get", _d("The poses a trainer's sprite has (back view, victory). Ver poses.", synonyms="poses del sprite"), AvatarPosesGetArgs, R,
         lambda s, a: s.avatar_poses_get(trainer_id=a.trainer_id, avatar=a.avatar)),
    Tool("avatar_pose_set", _d("Use another picture for one pose of a sprite, or drop it. Cambiar pose.", synonyms="elegir pose, quitar pose"),
         AvatarPoseSetArgs, WD, lambda s, a: s.avatar_pose_set(avatar=a.avatar, pose=a.pose, file=a.file)),
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
    Tool("fx_cache", _d("Pictures of the move animations (Showdown's effects): what is cached; prefetch downloads them all. Efectos.",
                        "The turn-based screen plays Pokémon Showdown's own animation of each move (934 of them) when the animation style "
                        "setting is Showdown's (the default; the other style is Silver's effects). Its effect pictures come from Showdown "
                        "on first use and stay in data/cache/fx.",
                        synonyms="animaciones de movimientos, efectos visuales, descargar efectos, sin conexión, showdown"), FxCacheArgs, W,
         lambda s, a: s.fx.prefetch() if a.prefetch else s.fx.stats(), 120.0),
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
