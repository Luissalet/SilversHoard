"""The neural AI level: a reinforcement-learning policy trained on real battles (the metamon project, MIT), served on a GPU by
``scripts/neural_ai_server.py`` from its own Python environment (PyTorch with CUDA, metamon and amago installed there; never the app's).

The app only starts, watches and stops that server. The battle engine asks it directly (engine/src/neural.mjs reads its address from
``SILVER_NEURAL_URL``) on every decision of a side whose level is "neural", in singles of generations 1-4 and 9; anywhere else, or
while the server is down, that side plays as the expert. Settings: ``neural_ai_python`` (the python.exe of that environment; empty =
the level is off), ``neural_ai_model`` (Kakuna by default), ``neural_ai_gpu`` (the GPU index, as nvidia-smi numbers them) and
``neural_ai_port``."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Optional

from .config import REPO_ROOT
from .errors import SilverError
from .hoard_link.proc import no_window_kwargs

log = logging.getLogger("silver.neural")
SCRIPT = REPO_ROOT / "scripts" / "neural_ai_server.py"
HINT = ("Create a Python 3.10+ environment with PyTorch for your GPU, then `pip install git+https://github.com/UT-Austin-RPL/metamon` "
        "in it, and set neural_ai_python to its python executable. The model weights (about 600 MB) download on the first start.")
GENS = (1, 2, 3, 4, 9)


class NeuralAI:
    def __init__(self, settings: Any, cache_dir: Path, logs_dir: Path):
        self.settings = settings
        self.cache_dir = Path(cache_dir)
        self.logs_dir = Path(logs_dir)
        self._proc: Optional[subprocess.Popen] = None
        self._started_at = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------ where
    def python(self) -> str:
        return str(self.settings.get("neural_ai_python") or "").strip()

    def enabled(self) -> bool:
        return bool(self.python())

    def weights_dir(self) -> Path:
        """Where metamon keeps the model weights: the ``neural_ai_cache`` setting, else data/cache/neural."""
        custom = str(self.settings.get("neural_ai_cache") or "").strip()
        return Path(custom) if custom else self.cache_dir

    def url(self) -> str:
        return f"http://127.0.0.1:{int(self.settings.get('neural_ai_port') or 8857)}"

    def engine_env(self) -> dict[str, str]:
        """What the engine needs to ask the server (empty when the level is off: it then plays as the expert)."""
        return {"SILVER_NEURAL_URL": self.url()} if self.enabled() else {}

    # ------------------------------------------------------------ state
    def health(self, timeout: float = 1.5) -> Optional[dict[str, Any]]:
        try:
            with urllib.request.urlopen(f"{self.url()}/health", timeout=timeout) as r:   # noqa: S310 - our own localhost server
                return json.loads(r.read().decode())
        except Exception:  # noqa: BLE001 - not running
            return None

    def status(self) -> dict[str, Any]:
        py = self.python()
        h = self.health() if py else None   # off: whatever answers on that port is not ours to use
        starting = bool(self._proc and self._proc.poll() is None and not h)
        out = {"enabled": bool(py), "running": bool(h), "starting": starting, "url": self.url(), "python": py,
               "python_found": bool(py) and Path(py).exists(), "model": str(self.settings.get("neural_ai_model") or "Kakuna"),
               "gpu": str(self.settings.get("neural_ai_gpu") or ""), "gens": list(GENS), "log": str(self.log_path),
               "cache": str(self.weights_dir())}
        if h:
            out.update(device=h.get("device", ""), battles=h.get("battles", 0), model=h.get("model") or out["model"])
        if self._proc and self._proc.poll() is not None and not h:
            out["exited"] = self._proc.returncode
            out["last_lines"] = self._tail()
        if not py or not out["python_found"]:
            out["hint"] = HINT
        return out

    @property
    def log_path(self) -> Path:
        return self.logs_dir / "neural_ai.log"

    def _tail(self, n: int = 12) -> list[str]:
        try:
            return self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-n:]
        except OSError:
            return []

    # ------------------------------------------------------------ start and stop
    def start(self, wait: float = 0.0) -> dict[str, Any]:
        """Starts the server (nothing if it is already running or starting). ``wait`` seconds to wait until it answers: the first
        start downloads the weights and loading them takes a while."""
        py = self.python()
        if not py:
            raise SilverError("invalid", "The neural AI is off: set neural_ai_python first.", hint=HINT)
        if not Path(py).exists():
            raise SilverError("not_found", f"No Python at {py}.", hint=HINT)
        with self._lock:
            if self.health() is None and not (self._proc and self._proc.poll() is None):
                self.logs_dir.mkdir(parents=True, exist_ok=True)
                cache = self.weights_dir()
                cache.mkdir(parents=True, exist_ok=True)
                args = [py, str(SCRIPT), "--port", str(int(self.settings.get("neural_ai_port") or 8857)),
                        "--model", str(self.settings.get("neural_ai_model") or "Kakuna"), "--cache", str(cache)]
                if str(self.settings.get("neural_ai_gpu") or "").strip():
                    args += ["--gpu", str(self.settings.get("neural_ai_gpu")).strip()]
                logf = open(self.log_path, "ab")   # noqa: SIM115 - the child writes to it while it runs
                env = {**os.environ, "PYTHONUNBUFFERED": "1"}
                self._proc = subprocess.Popen(args, stdout=logf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env,
                                              cwd=str(REPO_ROOT), **no_window_kwargs())
                self._started_at = time.time()
                log.info("neural AI server starting (pid %s)", self._proc.pid)
        end = time.time() + max(0.0, wait)
        while time.time() < end and self.health() is None:
            if self._proc and self._proc.poll() is not None:
                break
            time.sleep(1.0)
        return self.status()

    def ensure(self) -> None:
        """Starts the server in the background when the level is on and it is not running (a battle with a neural seat is starting)."""
        if self.enabled() and self.health(timeout=0.5) is None:
            try:
                self.start()
            except SilverError as exc:
                log.info("neural AI: %s", exc.message)

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._proc.terminate()
                try:
                    self._proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self._proc.kill()
            self._proc = None
        return self.status()
