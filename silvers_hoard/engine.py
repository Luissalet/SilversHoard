"""The battle engine: a Node process running ``engine/src/server.mjs`` (Pokémon Showdown's simulator plus the trainers' AI).

One JSON request per line in, one JSON answer per line out, matched by id. The process starts on the first call and again after a
crash; live battles are kept in it, and their snapshots in the database, so a restarted engine picks a battle up where it was.
Long work (series of battles, tournaments) runs in a separate one-shot process (``engine/src/cli.mjs``) so the live one stays free."""

from __future__ import annotations

import itertools
import json
import logging
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from .errors import SilverError
from .hoard_link.proc import kill_tree, no_window_kwargs

log = logging.getLogger("silver.engine")

ENGINE_CODES = {"invalid_format", "invalid_team", "empty_team", "unknown_species", "invalid_choice", "not_your_turn", "ended",
                "match_not_loaded", "invalid", "unknown_command", "bad_json"}


class Engine:
    def __init__(self, node: Callable[[], str], engine_dir: Path, cwd: Path):
        self._node = node
        self.engine_dir = Path(engine_dir)
        self.cwd = Path(cwd)
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.RLock()
        self._write_lock = threading.Lock()
        self._pending: dict[int, dict[str, Any]] = {}
        self._ids = itertools.count(1)
        self.started_at = 0.0
        self.restarts = 0
        self.last_error = ""
        self.node_version = ""

    # ------------------------------------------------------------ process
    def _spawn(self) -> None:
        node = self._node()
        if not node:
            raise SilverError("engine_unavailable", "Node.js was not found.",
                              hint="Install Node.js 20 or newer, or set its path in Settings (node_path).")
        server = self.engine_dir / "src" / "server.mjs"
        if not server.exists():
            raise SilverError("engine_unavailable", f"The engine is missing: {server}")
        if not (self.cwd / "node_modules" / "@pkmn" / "sim").exists():
            raise SilverError("engine_unavailable", "The engine's packages are not installed.", hint="Run `npm install` in the app folder.")
        proc = subprocess.Popen([node, str(server)], cwd=str(self.cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace", bufsize=1, **no_window_kwargs())
        ready = proc.stdout.readline() if proc.stdout else ""
        try:
            first = json.loads(ready)
        except ValueError:
            err = proc.stderr.read()[-800:] if proc.stderr else ""
            kill_tree(proc, grace_s=1)
            raise SilverError("engine_unavailable", f"The engine did not start: {(ready or err).strip()[:400]}")
        self.node_version = str((first.get("result") or {}).get("node") or "")
        self._proc = proc
        self.started_at = time.time()
        threading.Thread(target=self._read, args=(proc,), name="silver-engine-out", daemon=True).start()
        threading.Thread(target=self._drain_err, args=(proc,), name="silver-engine-err", daemon=True).start()
        log.info("engine started (node %s, pid %s)", self.node_version, proc.pid)

    def _read(self, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                log.warning("engine said: %s", line[:300])
                continue
            slot = self._pending.get(msg.get("id"))
            if slot is not None:
                slot["msg"] = msg
                slot["event"].set()
        # the process ended: wake everyone waiting
        for slot in list(self._pending.values()):
            slot.setdefault("msg", {"ok": False, "error": {"code": "engine_unavailable", "message": "The engine stopped."}})
            slot["event"].set()

    def _drain_err(self, proc: subprocess.Popen) -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            if line.strip():
                self.last_error = line.strip()[:500]
                log.warning("engine: %s", self.last_error)

    def running(self) -> bool:
        return bool(self._proc and self._proc.poll() is None)

    def ensure(self) -> None:
        with self._lock:
            if self.running():
                return
            if self._proc is not None:
                self.restarts += 1
            self._spawn()

    def stop(self) -> None:
        with self._lock:
            proc, self._proc = self._proc, None
        if proc and proc.poll() is None:
            try:
                if proc.stdin:
                    proc.stdin.close()
                proc.wait(timeout=2)
            except Exception:  # noqa: BLE001 - make sure it ends
                kill_tree(proc, grace_s=1)

    # ------------------------------------------------------------ calls
    def call(self, cmd: str, args: Optional[dict[str, Any]] = None, *, timeout: float = 60.0) -> Any:
        self.ensure()
        rid = next(self._ids)
        slot: dict[str, Any] = {"event": threading.Event()}
        self._pending[rid] = slot
        try:
            line = json.dumps({"id": rid, "cmd": cmd, "args": args or {}}, ensure_ascii=False)
            with self._write_lock:
                proc = self._proc
                if not proc or not proc.stdin:
                    raise SilverError("engine_unavailable", "The engine is not running.")
                try:
                    proc.stdin.write(line + "\n")
                    proc.stdin.flush()
                except OSError as exc:
                    raise SilverError("engine_unavailable", f"The engine stopped: {exc}") from None
            if not slot["event"].wait(timeout):
                raise SilverError("timeout", f"The engine took more than {timeout:.0f} s ({cmd}).")
        finally:
            self._pending.pop(rid, None)
        msg = slot.get("msg") or {}
        if msg.get("ok"):
            return msg.get("result")
        err = msg.get("error") or {}
        code = str(err.get("code") or "engine_error")
        raise SilverError(code if code in ENGINE_CODES or code in SilverError.STATUS else "invalid", str(err.get("message") or "Engine error"),
                          **({"engine_code": code} if code not in SilverError.STATUS else {}))

    def run_job(self, cmd: str, args: dict[str, Any], *, progress: Callable[[float], None] = lambda _p: None,
                cancelled: Callable[[], bool] = lambda: False, timeout: float = 3600.0) -> Any:
        """A long run in its own Node process (``cli.mjs``): progress from its stderr, the answer from its stdout."""
        node = self._node()
        if not node:
            raise SilverError("engine_unavailable", "Node.js was not found.", hint="Install Node.js 20 or newer, or set node_path in Settings.")
        cli = self.engine_dir / "src" / "cli.mjs"
        proc = subprocess.Popen([node, str(cli)], cwd=str(self.cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace", **no_window_kwargs())
        out_chunks: list[str] = []

        def read_out() -> None:
            assert proc.stdout is not None
            out_chunks.append(proc.stdout.read())

        def read_err() -> None:
            assert proc.stderr is not None
            for line in proc.stderr:
                try:
                    data = json.loads(line)
                except ValueError:
                    if line.strip():
                        log.warning("engine job: %s", line.strip()[:300])
                    continue
                if isinstance(data, dict) and "progress" in data:
                    try:
                        progress(float(data["progress"]))
                    except Exception:  # noqa: BLE001 - progress is best effort
                        pass

        t_out = threading.Thread(target=read_out, daemon=True)
        t_err = threading.Thread(target=read_err, daemon=True)
        t_out.start()
        t_err.start()
        assert proc.stdin is not None
        proc.stdin.write(json.dumps({"cmd": cmd, "args": args}, ensure_ascii=False))
        proc.stdin.close()
        deadline = time.monotonic() + timeout
        while proc.poll() is None:
            if cancelled():
                kill_tree(proc, grace_s=1)
                raise SilverError("cancelled", "Cancelled.")
            if time.monotonic() > deadline:
                kill_tree(proc, grace_s=1)
                raise SilverError("timeout", f"The run took more than {timeout:.0f} s.")
            time.sleep(0.1)
        t_out.join(5)
        t_err.join(2)
        raw = "".join(out_chunks).strip()
        try:
            msg = json.loads(raw)
        except ValueError:
            raise SilverError("engine_error", f"The run failed: {raw[-400:] or self.last_error}") from None
        if msg.get("ok"):
            return msg.get("result")
        err = msg.get("error") or {}
        raise SilverError(str(err.get("code") or "invalid") if str(err.get("code")) in SilverError.STATUS else "invalid", str(err.get("message") or "Engine error"))

    def status(self) -> dict[str, Any]:
        return {"running": self.running(), "node": self.node_version, "restarts": self.restarts, "started_at": self.started_at or None,
                "last_error": self.last_error or None}
