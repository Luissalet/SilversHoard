"""The neural AI level: a small local HTTP server that plays singles battles of generations 1-4 and 9 with a pretrained
reinforcement-learning policy (the metamon project, UT Austin, MIT: a transformer trained on millions of human and self-play battles).

It runs in its own Python environment with PyTorch on a GPU (metamon, amago and their poke-env fork installed there), never in the app's.
The battle engine (engine/src/neural.mjs) calls it on every decision of a side whose AI level is "neural":

    POST /decide {"battle", "side", "name", "gen", "lines": [new protocol lines as that side sees them], "request": {...}}
         -> {"ok": true, "choice": "move 2" | "move 1 terastallize" | "switch 4" | "team 123456", "action": 0-12, "ms": ...}
    POST /end    {"battle"}  forgets a battle
    GET  /health -> {"ok", "model", "device", "battles"}

Each battle keeps the model's memory of it (the policy reads the whole battle as a sequence), so lines must come in order and only once.
The policy only knows OU singles; other formats of those generations are played as the closest OU, and the engine falls back to its own
expert AI for anything else or when this server is not running.

    python scripts/neural_ai_server.py --port 8857 --model Kakuna [--gpu 0] [--checkpoint N] [--cache folder]
"""
from __future__ import annotations

import argparse
import copy
import json
import logging
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("neural")
GENS = {1, 2, 3, 4, 9}
IDLE_S = 1800        # a battle nobody asked about for this long is forgotten
MAX_SESSIONS = 8     # and never more than this many at once (each keeps the model's memory on the GPU)


def to_id(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def patch_flash_attention() -> None:
    """A plain-PyTorch stand-in for the flash-attention layer the policies were trained with (flash-attn and Triton do not install
    on every computer): the same causal sliding window (the layer's window_size from the model's gin file), the same key/value cache,
    no parameters of its own, so the trained weights load unchanged."""
    import math

    import torch
    from amago.nets import transformer as T

    T.flash_attn = True   # FlashAttention checks the module imported; its forward below needs nothing from it

    @torch.compiler.disable
    def forward(self, qkv, key_cache=None, val_cache=None, cache_seqlens=None):
        window = int((getattr(self, "window_size", (-1, -1)) or (-1, -1))[0])
        q, k, v = torch.unbind(qkv, dim=2)          # (B, L, H, E)
        B, L, H, E = q.shape
        scale = 1.0 / math.sqrt(E)
        if key_cache is not None and val_cache is not None and cache_seqlens is not None:
            idx = torch.arange(B, device=qkv.device)
            pos0 = cache_seqlens.long()
            for i in range(L):                      # rollouts feed one step at a time
                key_cache[idx, pos0 + i] = k[:, i].to(key_cache.dtype)
                val_cache[idx, pos0 + i] = v[:, i].to(val_cache.dtype)
            n = int((pos0 + L).max())
            kc = torch.nan_to_num(key_cache[:, :n]).float()
            vc = torch.nan_to_num(val_cache[:, :n]).float()
            qpos = pos0[:, None] + torch.arange(L, device=qkv.device)[None, :]          # (B, L)
            kpos = torch.arange(n, device=qkv.device)[None, None, :]                   # (1, 1, S)
            mask = kpos > qpos[:, :, None]
            if window >= 0:
                mask |= kpos < (qpos[:, :, None] - window)
            scores = torch.einsum("blhe,bshe->bhls", q.float(), kc) * scale
            scores = scores.masked_fill(mask[:, None], float("-inf"))
            return torch.einsum("bhls,bshd->blhd", torch.softmax(scores, dim=-1), vc).to(qkv.dtype)
        i = torch.arange(L, device=qkv.device)
        mask = i[None, :] > i[:, None]
        if window >= 0:
            mask |= i[None, :] < (i[:, None] - window)
        scores = torch.einsum("blhe,bshe->bhls", q.float(), k.float()) * scale
        scores = scores.masked_fill(mask[None, None], float("-inf"))
        return torch.einsum("bhls,bshd->blhd", torch.softmax(scores, dim=-1), v.float()).to(qkv.dtype)

    T.FlashAttention.forward = forward


class Brain:
    """The loaded policy and one session per battle."""

    def __init__(self, model_name: str, checkpoint: int | None, temperature: float):
        import numpy as np
        import torch
        from metamon.rl.pretrained import get_pretrained_model

        self.np, self.torch = np, torch
        self.model = get_pretrained_model(model_name)
        try:
            import flash_attn  # noqa: F401
        except ImportError:   # the same attention without flash-attn
            patch_flash_attention()
        self.model_name = model_name
        self.experiment = self.model.initialize_agent(checkpoint=checkpoint, log=False, action_temperature=temperature)
        self.policy = self.experiment.policy
        self.policy.eval()
        self.device = self.experiment.DEVICE
        self.lock = threading.Lock()
        self.sessions: dict[str, Session] = {}

    def session(self, key: str, gen: int, name: str) -> "Session":
        s = self.sessions.get(key)
        if s is None:
            s = self.sessions[key] = Session(self, key, gen, name)
        s.seen = time.time()
        for k in [k for k, v in self.sessions.items() if time.time() - v.seen > IDLE_S]:
            self.sessions.pop(k, None)
        while len(self.sessions) > MAX_SESSIONS:
            self.sessions.pop(min(self.sessions, key=lambda k: self.sessions[k].seen), None)
        return s

    def act(self, timestep_input, hidden):
        obs, rl2, t = timestep_input
        torch = self.torch
        obs = {k: torch.from_numpy(v).to(self.device).unsqueeze(1) for k, v in obs.items()}
        rl2 = torch.from_numpy(rl2).to(self.device).unsqueeze(1)
        t = torch.from_numpy(t).to(self.device).unsqueeze(1)
        with torch.no_grad(), self.experiment.caster():
            actions, hidden = self.policy.get_actions(obs=obs, rl2s=rl2, time_idxs=t, sample=True, hidden_state=hidden)
        return actions.squeeze(1).cpu().numpy(), hidden


class Session:
    """One battle from one side: metamon's battle object fed with the protocol, the observation space, the model's memory."""

    def __init__(self, brain: Brain, key: str, gen: int, name: str):
        import gymnasium as gym
        import numpy as np
        from metamon.env.metamon_battle import MetamonBackendBattle
        from metamon.interface import UniversalAction, UniversalState
        from metamon.rl.metamon_to_amago import MetamonAMAGOWrapper

        self.brain, self.key, self.gen, self.seen = brain, key, gen, time.time()
        self.UniversalState, self.UniversalAction = UniversalState, UniversalAction
        self.battle = MetamonBackendBattle(battle_tag=f"battle-gen{gen}ou-{abs(hash(key)) % 10**9}", username=name,
                                           logger=log, save_replays=False, gen=gen)
        self.obs_space = copy.deepcopy(brain.model.observation_space)
        self.action_space = brain.model.action_space
        self.reward_fn = brain.model.reward_function
        self.last_state = None
        session = self

        class _Feed(gym.Env):
            """A gym env whose steps are the battle as it already is: the server feeds the protocol before asking."""

            def __init__(self):
                super().__init__()
                self.observation_space = copy.deepcopy(session.obs_space.gym_space)
                self.metamon_action_space = session.action_space
                self.action_space = session.action_space.gym_space
                self.metamon_battle_format = f"gen{gen}ou"
                self.metamon_opponent_name = "silver"

            def reset(self, *args, **kwargs):
                return session.observe(first=True)

            def step(self, action):
                obs, info = session.observe(first=False)
                return obs, info.pop("reward"), False, False, info

        self.env = MetamonAMAGOWrapper(_Feed())
        self.hidden = None
        self.timestep = None
        self.prev_action = None
        self.np = np

    def observe(self, first: bool):
        state = self.UniversalState.from_Battle(self.battle)
        legal = [self.action_space.action_to_agent_output(state=state, action=a)
                 for a in self.UniversalAction.definitely_valid_actions(state=state, battle=self.battle)]
        if first:
            self.obs_space.reset()
        obs = self.obs_space.state_to_obs(state)
        reward = 0.0 if first or self.last_state is None else float(self.reward_fn(self.last_state, state))
        self.last_state = state
        return obs, {"legal_actions": legal, "reward": reward}

    NOISE = {"", "t:", "split", "request", "inactive", "inactiveoff", "j", "l", "n", "c", "chat", "raw", "html", "uhtml", "debug",
             "message", "bigerror", "-message", "hint"}

    def feed(self, lines: list[str], request: dict | None) -> None:
        for line in lines:
            if not line or not line.startswith("|"):
                continue
            parts = line.split("|")
            if len(parts) <= 1 or parts[1] in self.NOISE:
                continue
            try:
                self.battle.parse_message(parts)
            except Exception as exc:  # noqa: BLE001 - one odd line does not stop the battle
                log.debug("%s: %s (%s)", self.key, line[:80], exc)
        if request:
            self.battle.parse_request(request)

    def decide(self, request: dict) -> dict:
        np = self.np
        rqid = request.get("rqid")
        if rqid is not None and rqid == getattr(self, "last_rqid", None):   # asked twice for the same decision: the same answer
            return self.last_out
        out = self._decide(request)
        self.last_rqid, self.last_out = rqid, out
        return out

    def _decide(self, request: dict) -> dict:
        np = self.np
        if request.get("teamPreview"):
            n = len((request.get("side") or {}).get("pokemon") or []) or 6
            return {"choice": "team " + "".join(str(i) for i in range(1, n + 1)), "action": -1}
        if self.timestep is None:
            self.timestep, _ = self.env.reset()
        else:
            self.timestep, *_ = self.env.step(np.array([[self.prev_action]], dtype=np.int64))
        if self.hidden is None:
            self.hidden = self.brain.policy.traj_encoder.init_hidden_state(1, self.brain.device)
        action, self.hidden = self.brain.act(self.timestep.as_input(), self.hidden)
        idx = int(np.asarray(action).reshape(-1)[0])
        self.prev_action = idx
        return {"choice": self.choice(idx, request), "action": idx}

    def choice(self, idx: int, request: dict) -> str:
        """The policy's action as a choice for this request's slots, picked from the same ordered lists metamon uses (moves 0-3, the
        same moves with Terastallization 9-12, switches 4-8); one it cannot match becomes the first legal option."""
        from metamon.interface import UniversalAction, consistent_move_order, consistent_pokemon_order

        b = self.battle
        side = request.get("side") or {}
        mons = side.get("pokemon") or []
        active = (request.get("active") or [{}])[0]
        moves = active.get("moves") or []
        legal = UniversalAction.action_idx_to_BattleOrder(b, action_idx=idx) is not None
        if legal:
            tera = idx >= 9
            i = idx - 9 if tera else idx
            if i <= 3 and not request.get("forceSwitch"):
                opts = consistent_move_order(list(b.active_pokemon.moves.values()))
                if i < len(opts):
                    want = to_id(getattr(opts[i], "id", "") or getattr(opts[i], "name", ""))
                    for j, m in enumerate(moves):
                        if not m.get("disabled") and to_id(m.get("id") or m.get("move")) in (want, "struggle", "recharge"):
                            return f"move {j + 1}" + (" terastallize" if tera and active.get("canTerastallize") else "")
                    if len(moves) == 1 and not moves[0].get("disabled"):   # Struggle, recharge, a locked move
                        return "move 1"
            elif 4 <= i <= 8:
                pool = [p for p in b.team.values() if (p.fainted if b.reviving else not p.fainted) and not p.active]
                opts = consistent_pokemon_order(pool)
                k = i - 4
                if k < len(opts):
                    want = {to_id(getattr(opts[k], "name", "")), to_id(getattr(opts[k], "species", ""))} - {""}
                    for j, p in enumerate(mons):
                        if p.get("active"):
                            continue
                        names = {to_id(str(p.get("ident", "")).split(":", 1)[-1]), to_id(str(p.get("details", "")).split(",")[0])}
                        if names & want:
                            return f"switch {j + 1}"
        if request.get("forceSwitch"):
            for j, p in enumerate(mons):
                if not p.get("active") and not str(p.get("condition", "")).endswith(" fnt"):
                    return f"switch {j + 1}"
            return "pass"
        for j, m in enumerate(moves):
            if not m.get("disabled"):
                return f"move {j + 1}"
        return "default"


def serve(brain: Brain, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # noqa: N802 - quiet
            log.debug(fmt, *args)

        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):  # noqa: N802
            if self.path.rstrip("/") == "/health":
                return self._send(200, {"ok": True, "model": brain.model_name, "device": str(brain.device), "battles": len(brain.sessions),
                                        "gens": sorted(GENS)})
            return self._send(404, {"ok": False, "error": "not found"})

        def do_POST(self):  # noqa: N802
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            except ValueError:
                return self._send(400, {"ok": False, "error": "bad json"})
            path = self.path.rstrip("/")
            key = f"{req.get('battle')}:{req.get('side')}"
            if path == "/end":
                with brain.lock:
                    brain.sessions.pop(key, None)
                return self._send(200, {"ok": True})
            if path != "/decide":
                return self._send(404, {"ok": False, "error": "not found"})
            gen = int(req.get("gen") or 9)
            if gen not in GENS:
                return self._send(200, {"ok": False, "error": f"generation {gen} is not supported (1-4 and 9)"})
            started = time.time()
            try:
                with brain.lock:
                    s = brain.session(key, gen, str(req.get("name") or "silver"))
                    s.feed(req.get("lines") or [], req.get("request"))
                    out = s.decide(req.get("request") or {})
            except Exception as exc:  # noqa: BLE001 - the engine falls back to its own AI
                log.exception("decide %s", key)
                with brain.lock:
                    brain.sessions.pop(key, None)
                return self._send(200, {"ok": False, "error": str(exc)[:300]})
            return self._send(200, {"ok": True, **out, "ms": int((time.time() - started) * 1000)})

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    log.info("neural AI %s on %s, port %s", brain.model_name, brain.device, port)
    httpd.serve_forever()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8857)
    ap.add_argument("--model", default="Kakuna")
    ap.add_argument("--checkpoint", type=int, default=None)
    ap.add_argument("--gpu", default="")
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--cache", default="", help="where the model weights are downloaded (METAMON_CACHE_DIR)")
    ap.add_argument("--check", action="store_true", help="only say whether metamon imports, as JSON")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cache = a.cache or os.environ.get("METAMON_CACHE_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "cache", "neural")
    os.makedirs(cache, exist_ok=True)
    os.environ["METAMON_CACHE_DIR"] = os.path.abspath(cache)
    os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")   # torch.compile needs Triton, which most Windows installs lack: plain eager mode
    if a.gpu != "":
        os.environ.setdefault("CUDA_DEVICE_ORDER", "PCI_BUS_ID")
        os.environ["CUDA_VISIBLE_DEVICES"] = str(a.gpu)
    if a.check:
        try:
            import metamon  # noqa: F401
            import torch
            print(json.dumps({"ok": True, "cuda": bool(torch.cuda.is_available()),
                              "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else ""}))
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(exc)[:300]}))
        return
    brain = Brain(a.model, a.checkpoint, a.temperature)
    serve(brain, a.port)


if __name__ == "__main__":
    sys.exit(main())
