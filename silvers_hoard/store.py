"""The database: trainers, gyms, leagues, battles, gym and league runs, badges, the hall of fame, cups and finished background work.

Deleting a trainer, gym or league moves it to the trash (``deleted_at``); it comes back with ``restore`` and goes for good with
``purge``. Teams, rules and seats are JSON columns: they travel as they are to the engine and to the files sent to friends."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Iterable, Optional

from .errors import SilverError
from .hoard_link.ids import new_id
from .hoard_link.sqlkit import Database, dumps, loads

SCHEMA_V1 = """
CREATE TABLE trainers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'own',
  format TEXT NOT NULL,
  team_json TEXT NOT NULL DEFAULT '[]',
  ai_level TEXT NOT NULL DEFAULT 'normal',
  ai_style TEXT NOT NULL DEFAULT 'balanced',
  avatar TEXT NOT NULL DEFAULT '',
  dialogue_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  canon_key TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL
);
CREATE INDEX trainers_live ON trainers(deleted_at, updated_at);

CREATE TABLE gyms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  badge TEXT NOT NULL DEFAULT '',
  badge_color TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '[]',
  level_rules_json TEXT NOT NULL DEFAULT '{}',
  leader_id TEXT NOT NULL DEFAULT '',
  trainers_json TEXT NOT NULL DEFAULT '[]',
  owner TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'own',
  canon_key TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL
);

CREATE TABLE leagues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '[]',
  level_rules_json TEXT NOT NULL DEFAULT '{}',
  gyms_json TEXT NOT NULL DEFAULT '[]',
  elite_json TEXT NOT NULL DEFAULT '[]',
  champion_id TEXT NOT NULL DEFAULT '',
  badges_required INTEGER NOT NULL DEFAULT 0,
  owner TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'own',
  canon_key TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL
);

CREATE TABLE battles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  format TEXT NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '[]',
  level_rules_json TEXT NOT NULL DEFAULT '{}',
  p1_json TEXT NOT NULL,
  p2_json TEXT NOT NULL,
  winner_side TEXT NOT NULL DEFAULT '',
  winner_name TEXT NOT NULL DEFAULT '',
  turns INTEGER NOT NULL DEFAULT 0,
  log_text TEXT NOT NULL DEFAULT '',
  summary_json TEXT NOT NULL DEFAULT '{}',
  snapshot TEXT NOT NULL DEFAULT '',
  seed TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL DEFAULT '',
  job_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX battles_recent ON battles(updated_at);
CREATE INDEX battles_run ON battles(run_id);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL DEFAULT '',
  challenger_id TEXT NOT NULL,
  challenger_json TEXT NOT NULL,
  stages_json TEXT NOT NULL DEFAULT '[]',
  step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL,
  gym_name TEXT NOT NULL,
  badge TEXT NOT NULL DEFAULT '',
  badge_color TEXT NOT NULL DEFAULT '',
  challenger_name TEXT NOT NULL,
  challenger_trainer_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  battle_id TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL DEFAULT '',
  proof_json TEXT NOT NULL DEFAULT '{}',
  earned_at REAL NOT NULL
);

CREATE TABLE hall (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL,
  league_name TEXT NOT NULL,
  champion_name TEXT NOT NULL,
  trainer_id TEXT NOT NULL DEFAULT '',
  team_json TEXT NOT NULL DEFAULT '[]',
  run_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  earned_at REAL NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  args_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
"""

# Real-time battles (Legends: Z-A rules): the battle's mode, and what replays it (seed, time limit and the inputs of the people
# who played; the AI replays itself from the seed). Gym and league challenges remember the mode they are played in.
SCHEMA_V2 = """
ALTER TABLE battles ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE battles ADD COLUMN replay_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic';
"""

# Gym badges with a picture: one of the drawn shapes (shape:<id>), an uploaded or drawn picture (file:<name> in the avatars
# folder), and the earned badge keeps the picture it was won with.
SCHEMA_V3 = """
ALTER TABLE gyms ADD COLUMN badge_image TEXT NOT NULL DEFAULT '';
ALTER TABLE badges ADD COLUMN badge_image TEXT NOT NULL DEFAULT '';
"""

# Friends' results from playable pages, one row per imported result code: the leaderboard ranks them per gym or trainer. `week` is
# set when the page was the week's challenge (same seed and AI luck for everyone that week); `fingerprint` stops a code counting twice.
SCHEMA_V4 = """
CREATE TABLE friend_results (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL DEFAULT '',
  challenger TEXT NOT NULL,
  won INTEGER NOT NULL DEFAULT 0,
  battles INTEGER NOT NULL DEFAULT 0,
  battles_won INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  hp_left REAL NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  week TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'classic',
  battle_id TEXT NOT NULL DEFAULT '',
  badge_id TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL DEFAULT '',
  played_at TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX friend_results_target ON friend_results(target_id);
CREATE INDEX friend_results_week ON friend_results(week);
CREATE INDEX friend_results_fingerprint ON friend_results(fingerprint);
"""

# Cups: a knockout bracket that fills in match by match; the bracket (rounds of matches with their games) is one JSON column.
SCHEMA_V5 = """
CREATE TABLE cups (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  spec_json TEXT NOT NULL DEFAULT '{}',
  entrants_json TEXT NOT NULL DEFAULT '[]',
  rounds_json TEXT NOT NULL DEFAULT '[]',
  human_id TEXT NOT NULL DEFAULT '',
  champion TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX cups_recent ON cups(updated_at);
"""

TRAINER_JSON = {"team_json": "team", "dialogue_json": "dialogue", "tags_json": "tags"}
GYM_JSON = {"rules_json": "rules", "level_rules_json": "level_rules", "trainers_json": "trainers"}
LEAGUE_JSON = {"rules_json": "rules", "level_rules_json": "level_rules", "gyms_json": "gyms", "elite_json": "elite_four"}
BATTLE_JSON = {"rules_json": "rules", "level_rules_json": "level_rules", "p1_json": "p1", "p2_json": "p2", "summary_json": "summary",
               "replay_json": "replay"}
RUN_JSON = {"challenger_json": "challenger", "stages_json": "stages"}
BADGE_JSON = {"proof_json": "proof"}
HALL_JSON = {"team_json": "team"}
JOB_JSON = {"args_json": "args", "result_json": "result"}
CUP_JSON = {"spec_json": "spec", "entrants_json": "entrants", "rounds_json": "rounds"}


def _decode(row: Any, json_cols: dict[str, str]) -> Optional[dict[str, Any]]:
    if row is None:
        return None
    out = dict(row)
    for col, key in json_cols.items():
        if col in out:
            out[key] = loads(out.pop(col), [] if key in ("team", "rules", "trainers", "gyms", "elite_four", "tags", "stages", "entrants", "rounds") else {})
    return out


def _encode(values: dict[str, Any], json_cols: dict[str, str]) -> dict[str, Any]:
    out = {}
    back = {v: k for k, v in json_cols.items()}
    for key, value in values.items():
        if key in back:
            out[back[key]] = dumps(value)
        else:
            out[key] = value
    return out


class Store:
    def __init__(self, path: Path):
        self.db = Database(path, migrations=[SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5])

    def close(self) -> None:
        self.db.close()

    # ------------------------------------------------------------ generic
    def _get(self, table: str, id_: str, cols: dict[str, str], what: str, *, deleted: bool = False) -> dict[str, Any]:
        row = self.db.one(f"SELECT * FROM {table} WHERE id = ?", (id_,))
        item = _decode(row, cols)
        if not item or (item.get("deleted_at") and not deleted):
            raise SilverError("not_found", f"{what} not found: {id_}")
        return item

    def _insert(self, table: str, prefix: str, values: dict[str, Any], cols: dict[str, str]) -> str:
        now = time.time()
        id_ = values.get("id") or new_id(prefix)
        row = _encode({**values, "id": id_}, cols)
        if table not in ("badges", "hall"):
            row.setdefault("created_at", now)
            row.setdefault("updated_at", now)
        self.db.insert(table, row)
        return id_

    def _update(self, table: str, id_: str, values: dict[str, Any], cols: dict[str, str]) -> None:
        if not values:
            return
        row = _encode(values, cols)
        if table not in ("badges", "hall"):
            row["updated_at"] = time.time()
        sets = ", ".join(f"{k} = ?" for k in row)
        self.db.execute(f"UPDATE {table} SET {sets} WHERE id = ?", (*row.values(), id_))

    def _trash(self, table: str, ids: Iterable[str]) -> int:
        n = 0
        for id_ in ids:
            n += self.db.execute(f"UPDATE {table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", (time.time(), id_)).rowcount
        return n

    def _restore(self, table: str, ids: Iterable[str]) -> int:
        n = 0
        for id_ in ids:
            n += self.db.execute(f"UPDATE {table} SET deleted_at = NULL WHERE id = ?", (id_,)).rowcount
        return n

    def _purge(self, table: str, ids: Iterable[str]) -> int:
        n = 0
        for id_ in ids:
            n += self.db.execute(f"DELETE FROM {table} WHERE id = ? AND deleted_at IS NOT NULL", (id_,)).rowcount
        return n

    # ------------------------------------------------------------ trainers
    def trainer(self, id_: str, *, deleted: bool = False) -> dict[str, Any]:
        return self._get("trainers", id_, TRAINER_JSON, "Trainer", deleted=deleted)

    def trainers(self, *, query: str = "", origin: str = "", deleted: bool = False, limit: int = 500, ids: Optional[list[str]] = None) -> list[dict[str, Any]]:
        where = ["deleted_at IS NOT NULL" if deleted else "deleted_at IS NULL"]
        params: list[Any] = []
        if query:
            where.append("(name LIKE ? OR title LIKE ? OR owner LIKE ? OR team_json LIKE ? OR tags_json LIKE ?)")
            params += [f"%{query}%"] * 5
        if origin:
            where.append("origin = ?")
            params.append(origin)
        if ids is not None:
            if not ids:
                return []
            where.append(f"id IN ({','.join('?' * len(ids))})")
            params += ids
        rows = self.db.query(f"SELECT * FROM trainers WHERE {' AND '.join(where)} ORDER BY favorite DESC, updated_at DESC LIMIT ?", (*params, limit))
        return [_decode(r, TRAINER_JSON) for r in rows]

    def trainer_by_canon(self, key: str) -> Optional[dict[str, Any]]:
        return _decode(self.db.one("SELECT * FROM trainers WHERE canon_key = ? AND deleted_at IS NULL", (key,)), TRAINER_JSON)

    def trainers_by_canon_prefix(self, prefix: str) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM trainers WHERE canon_key LIKE ? ESCAPE '\\' AND deleted_at IS NULL ORDER BY created_at",
                           (prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%",))
        return [_decode(r, TRAINER_JSON) for r in rows]

    def add_trainer(self, values: dict[str, Any]) -> str:
        return self._insert("trainers", "tr", values, TRAINER_JSON)

    def update_trainer(self, id_: str, values: dict[str, Any]) -> None:
        self.trainer(id_)
        self._update("trainers", id_, values, TRAINER_JSON)

    def record_result(self, trainer_id: str, result: str) -> None:
        col = {"win": "wins", "loss": "losses", "tie": "ties"}.get(result)
        if col and trainer_id:
            self.db.execute(f"UPDATE trainers SET {col} = {col} + 1 WHERE id = ?", (trainer_id,))

    def trash_trainers(self, ids: list[str]) -> int:
        return self._trash("trainers", ids)

    def restore_trainers(self, ids: list[str]) -> int:
        return self._restore("trainers", ids)

    def purge_trainers(self, ids: list[str]) -> int:
        return self._purge("trainers", ids)

    # ------------------------------------------------------------ gyms
    def gym(self, id_: str, *, deleted: bool = False) -> dict[str, Any]:
        return self._get("gyms", id_, GYM_JSON, "Gym", deleted=deleted)

    def gyms(self, *, query: str = "", deleted: bool = False, ids: Optional[list[str]] = None) -> list[dict[str, Any]]:
        where = ["deleted_at IS NOT NULL" if deleted else "deleted_at IS NULL"]
        params: list[Any] = []
        if query:
            where.append("(name LIKE ? OR city LIKE ? OR type LIKE ? OR badge LIKE ?)")
            params += [f"%{query}%"] * 4
        if ids is not None:
            if not ids:
                return []
            where.append(f"id IN ({','.join('?' * len(ids))})")
            params += ids
        rows = self.db.query(f"SELECT * FROM gyms WHERE {' AND '.join(where)} ORDER BY updated_at DESC", params)
        return [_decode(r, GYM_JSON) for r in rows]

    def gym_by_canon(self, key: str) -> Optional[dict[str, Any]]:
        return _decode(self.db.one("SELECT * FROM gyms WHERE canon_key = ? AND deleted_at IS NULL", (key,)), GYM_JSON)

    def add_gym(self, values: dict[str, Any]) -> str:
        return self._insert("gyms", "gym", values, GYM_JSON)

    def update_gym(self, id_: str, values: dict[str, Any]) -> None:
        self.gym(id_)
        self._update("gyms", id_, values, GYM_JSON)

    def trash_gyms(self, ids: list[str]) -> int:
        return self._trash("gyms", ids)

    def restore_gyms(self, ids: list[str]) -> int:
        return self._restore("gyms", ids)

    def purge_gyms(self, ids: list[str]) -> int:
        return self._purge("gyms", ids)

    # ------------------------------------------------------------ leagues
    def league(self, id_: str, *, deleted: bool = False) -> dict[str, Any]:
        return self._get("leagues", id_, LEAGUE_JSON, "League", deleted=deleted)

    def leagues(self, *, deleted: bool = False) -> list[dict[str, Any]]:
        rows = self.db.query(f"SELECT * FROM leagues WHERE {'deleted_at IS NOT NULL' if deleted else 'deleted_at IS NULL'} ORDER BY updated_at DESC")
        return [_decode(r, LEAGUE_JSON) for r in rows]

    def league_by_canon(self, key: str) -> Optional[dict[str, Any]]:
        return _decode(self.db.one("SELECT * FROM leagues WHERE canon_key = ? AND deleted_at IS NULL", (key,)), LEAGUE_JSON)

    def add_league(self, values: dict[str, Any]) -> str:
        return self._insert("leagues", "lg", values, LEAGUE_JSON)

    def update_league(self, id_: str, values: dict[str, Any]) -> None:
        self.league(id_)
        self._update("leagues", id_, values, LEAGUE_JSON)

    def trash_leagues(self, ids: list[str]) -> int:
        return self._trash("leagues", ids)

    def restore_leagues(self, ids: list[str]) -> int:
        return self._restore("leagues", ids)

    def purge_leagues(self, ids: list[str]) -> int:
        return self._purge("leagues", ids)

    # ------------------------------------------------------------ battles
    def battle(self, id_: str) -> dict[str, Any]:
        return self._get("battles", id_, BATTLE_JSON, "Battle")

    def battles(self, *, kind: str = "", status: str = "", trainer_id: str = "", run_id: str = "", job_id: str = "", limit: int = 50,
                offset: int = 0, light: bool = True) -> list[dict[str, Any]]:
        where = ["1 = 1"]
        params: list[Any] = []
        if kind:
            where.append("kind = ?")
            params.append(kind)
        if status:
            where.append("status = ?")
            params.append(status)
        if trainer_id:
            where.append("(p1_json LIKE ? OR p2_json LIKE ?)")
            params += [f'%"trainer_id":"{trainer_id}"%'] * 2
        if run_id:
            where.append("run_id = ?")
            params.append(run_id)
        if job_id:
            where.append("job_id = ?")
            params.append(job_id)
        cols = ("id, kind, status, mode, format, rules_json, level_rules_json, p1_json, p2_json, winner_side, winner_name, turns, summary_json, seed, "
                "run_id, job_id, title, created_at, updated_at") if light else "*"
        rows = self.db.query(f"SELECT {cols} FROM battles WHERE {' AND '.join(where)} ORDER BY updated_at DESC LIMIT ? OFFSET ?", (*params, limit, offset))
        return [_decode(r, BATTLE_JSON) for r in rows]

    def add_battle(self, values: dict[str, Any]) -> str:
        return self._insert("battles", "bt", values, BATTLE_JSON)

    def update_battle(self, id_: str, values: dict[str, Any]) -> None:
        self._update("battles", id_, values, BATTLE_JSON)

    def delete_battles(self, ids: list[str]) -> int:
        n = 0
        for id_ in ids:
            n += self.db.execute("DELETE FROM battles WHERE id = ? AND status != 'live'", (id_,)).rowcount
        return n

    # ------------------------------------------------------------ runs, badges, hall of fame
    def run(self, id_: str) -> dict[str, Any]:
        return self._get("runs", id_, RUN_JSON, "Challenge")

    def runs(self, *, status: str = "", kind: str = "", challenger_id: str = "", limit: int = 50) -> list[dict[str, Any]]:
        where = ["1 = 1"]
        params: list[Any] = []
        for col, val in (("status", status), ("kind", kind), ("challenger_id", challenger_id)):
            if val:
                where.append(f"{col} = ?")
                params.append(val)
        rows = self.db.query(f"SELECT * FROM runs WHERE {' AND '.join(where)} ORDER BY updated_at DESC LIMIT ?", (*params, limit))
        return [_decode(r, RUN_JSON) for r in rows]

    def add_run(self, values: dict[str, Any]) -> str:
        return self._insert("runs", "run", values, RUN_JSON)

    def update_run(self, id_: str, values: dict[str, Any]) -> None:
        self._update("runs", id_, values, RUN_JSON)

    def add_badge(self, values: dict[str, Any]) -> str:
        return self._insert("badges", "bdg", {**values, "earned_at": values.get("earned_at") or time.time()}, BADGE_JSON)

    def badges(self, *, gym_id: str = "", challenger_trainer_id: str = "", challenger_name: str = "") -> list[dict[str, Any]]:
        where = ["1 = 1"]
        params: list[Any] = []
        for col, val in (("gym_id", gym_id), ("challenger_trainer_id", challenger_trainer_id), ("challenger_name", challenger_name)):
            if val:
                where.append(f"{col} = ?")
                params.append(val)
        rows = self.db.query(f"SELECT * FROM badges WHERE {' AND '.join(where)} ORDER BY earned_at DESC", params)
        return [_decode(r, BADGE_JSON) for r in rows]

    def delete_badges(self, ids: list[str]) -> int:
        return sum(self.db.execute("DELETE FROM badges WHERE id = ?", (i,)).rowcount for i in ids)

    def add_hall(self, values: dict[str, Any]) -> str:
        return self._insert("hall", "hof", {**values, "earned_at": values.get("earned_at") or time.time()}, HALL_JSON)

    def hall(self, *, league_id: str = "") -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM hall WHERE (? = '' OR league_id = ?) ORDER BY earned_at DESC", (league_id, league_id))
        return [_decode(r, HALL_JSON) for r in rows]

    # ------------------------------------------------------------ friends' results (the leaderboard)
    def add_friend_result(self, values: dict[str, Any]) -> str:
        return self._insert("friend_results", "fr", values, {})

    def friend_result_by_fingerprint(self, fingerprint: str) -> Optional[dict[str, Any]]:
        return _decode(self.db.one("SELECT * FROM friend_results WHERE fingerprint = ?", (fingerprint,)), {})

    def friend_results(self, *, kind: str = "", target_id: str = "", week: str = "", limit: int = 5000) -> list[dict[str, Any]]:
        where = ["1 = 1"]
        params: list[Any] = []
        for col, val in (("kind", kind), ("target_id", target_id), ("week", week)):
            if val:
                where.append(f"{col} = ?")
                params.append(val)
        rows = self.db.query(f"SELECT * FROM friend_results WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT ?", (*params, limit))
        return [_decode(r, {}) for r in rows]

    def friend_weeks(self) -> list[str]:
        return [r["week"] for r in self.db.query("SELECT DISTINCT week FROM friend_results WHERE week != '' ORDER BY week DESC")]

    def delete_friend_results(self, ids: list[str]) -> int:
        return sum(self.db.execute("DELETE FROM friend_results WHERE id = ?", (i,)).rowcount for i in ids)

    # ------------------------------------------------------------ cups
    def cup(self, id_: str) -> dict[str, Any]:
        return self._get("cups", id_, CUP_JSON, "Cup")

    def cups(self, *, status: str = "", limit: int = 50) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM cups WHERE (? = '' OR status = ?) ORDER BY updated_at DESC LIMIT ?", (status, status, limit))
        return [_decode(r, CUP_JSON) for r in rows]

    def add_cup(self, values: dict[str, Any]) -> str:
        return self._insert("cups", "cup", values, CUP_JSON)

    def update_cup(self, id_: str, values: dict[str, Any]) -> None:
        self._update("cups", id_, values, CUP_JSON)

    def delete_cup(self, id_: str) -> int:
        n = self.db.execute("DELETE FROM cups WHERE id = ?", (id_,)).rowcount
        if n:
            self.db.execute("DELETE FROM battles WHERE run_id = ? AND status != 'live'", (id_,))
        return n

    # ------------------------------------------------------------ jobs
    def job(self, id_: str) -> dict[str, Any]:
        return self._get("jobs", id_, JOB_JSON, "Job")

    def jobs(self, *, kind: str = "", status: str = "", limit: int = 30) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT id, kind, title, status, progress, args_json, error, created_at, updated_at FROM jobs "
                             "WHERE (? = '' OR kind = ?) AND (? = '' OR status = ?) ORDER BY created_at DESC LIMIT ?",
                             (kind, kind, status, status, limit))
        return [_decode(r, JOB_JSON) for r in rows]

    def add_job(self, values: dict[str, Any]) -> str:
        return self._insert("jobs", "job", values, JOB_JSON)

    def update_job(self, id_: str, values: dict[str, Any]) -> None:
        self._update("jobs", id_, values, JOB_JSON)

    def delete_jobs(self, ids: list[str]) -> int:
        n = 0
        for id_ in ids:
            n += self.db.execute("DELETE FROM jobs WHERE id = ? AND status NOT IN ('queued', 'running')", (id_,)).rowcount
            self.db.execute("DELETE FROM battles WHERE job_id = ?", (id_,))
        return n

    def counts(self) -> dict[str, int]:
        q = lambda sql: int(self.db.scalar(sql, default=0) or 0)  # noqa: E731
        return {
            "trainers": q("SELECT COUNT(*) FROM trainers WHERE deleted_at IS NULL"),
            "gyms": q("SELECT COUNT(*) FROM gyms WHERE deleted_at IS NULL"),
            "leagues": q("SELECT COUNT(*) FROM leagues WHERE deleted_at IS NULL"),
            "battles": q("SELECT COUNT(*) FROM battles"),
            "live_battles": q("SELECT COUNT(*) FROM battles WHERE status = 'live'"),
            "badges": q("SELECT COUNT(*) FROM badges"),
            "hall": q("SELECT COUNT(*) FROM hall"),
            "trash": q("SELECT (SELECT COUNT(*) FROM trainers WHERE deleted_at IS NOT NULL) + (SELECT COUNT(*) FROM gyms WHERE deleted_at IS NOT NULL)"
                       " + (SELECT COUNT(*) FROM leagues WHERE deleted_at IS NOT NULL)"),
        }
