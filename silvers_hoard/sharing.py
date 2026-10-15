"""Files and codes that travel between friends.

* ``.hoardtrainer`` / ``.hoardgym`` / ``.hoardleague``: JSON with everything needed to fight them (teams, AI, rules, avatars as
  pictures inside the file). Import them into another Silver's Hoard.
* Share codes (``SILVER1-...``): a trainer without its picture, compressed into text to paste in a chat.
* Playable pages: one HTML file with the battle engine inside; a friend opens it in any browser, picks or pastes a team and fights
  the gym or trainer. When they win (or lose) the page gives a result code (``SILVERWIN1-...``) to send back; importing it records
  the badge here. A friend can play each battle turn by turn or in real time (the owner may restrict it when exporting): a result
  that has real-time battles is ``SILVERWIN2-...``, and carries, for each such battle, what the app needs to replay it with the
  real-time simulator (rules version, seed, arena, time limit, the input log); the app only believes what the replay says.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import time
import zlib
from pathlib import Path
from typing import Any

from .errors import SilverError

SCHEMA = 1
KINDS = {"trainer": "silvers-hoard/trainer", "gym": "silvers-hoard/gym", "league": "silvers-hoard/league"}
CODE_PREFIX = "SILVER1-"
RESULT_PREFIX = "SILVERWIN1-"
RESULT_PREFIX_RT = "SILVERWIN2-"   # a result with real-time battles in it (turn-based results keep SILVERWIN1-)
FRIEND_MODES = ("choose", "turns", "realtime")   # what a playable page lets the friend do: pick per battle, turns only, real time only
MAX_CODE = 400_000
MAX_UNPACKED = 24_000_000          # a code never inflates to more than this (a bomb of zeros would fill the memory)
RT_MAX_ROWS = 60_000               # input rows of one real-time battle (a 30-minute battle changing every tick has 54,000)
RT_ROW = 9
PLACEHOLDER = "__SILVER_DATA__"
DATA_TAG = '<script id="silver-data" type="application/json">'



def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    text = re.sub(r"\s+", "", text)
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def pack_code(prefix: str, obj: Any) -> str:
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return prefix + _b64(zlib.compress(raw, 9))


def unpack_code(prefix: str, code: str) -> Any:
    text = (code or "").strip()
    i = text.find(prefix)
    if i < 0:
        raise SilverError("invalid", f"Not a code of this app (it should start with {prefix}).")
    body = re.split(r"[^A-Za-z0-9_\-\s]", text[i + len(prefix):], maxsplit=1)[0]
    if len(body) > MAX_CODE:
        raise SilverError("too_large", "The code is too long.")
    try:
        return json.loads(_inflate(_unb64(body), MAX_UNPACKED).decode("utf-8"))
    except SilverError:
        raise
    except Exception as exc:  # noqa: BLE001 - any decoding error means a damaged code
        raise SilverError("invalid", f"The code is damaged or incomplete: {exc}") from None


def _inflate(data: bytes, limit: int) -> bytes:
    d = zlib.decompressobj()
    out = d.decompress(data, limit)
    if d.unconsumed_tail:
        raise SilverError("too_large", "The code is too long once unpacked.")
    return out + d.flush()


def encode_rt_inputs(rows: list[list[Any]]) -> str:
    """The input log of a real-time battle as it travels in a result code: the person's rows (tick, side, mx, my, move, roll, switch,
    focus, plus, mega) as one flat list of integers, nine per row without the side (always the first seat): ticks since the
    previous row, the two axes in thousandths, then the rest; JSON, deflated, base64url."""
    flat: list[int] = []
    prev = 0
    for row in rows:
        r = [*row, *[1, 0, 0][len(row) - 7:]]   # rows with fewer than ten columns read as focused, no Plus, no Mega
        flat += [int(r[0]) - prev, round(float(r[2]) * 1000), round(float(r[3]) * 1000), int(r[4]), int(r[5]), int(r[6]), int(r[7]), int(r[8]), int(r[9])]
        prev = int(r[0])
    return _b64(zlib.compress(json.dumps(flat, separators=(",", ":")).encode("ascii"), 9))


def decode_rt_inputs(text: Any) -> list[list[Any]]:
    """The rows ``encode_rt_inputs`` packed, in the simulator's own format and checked: a damaged or edited log is refused."""
    bad = SilverError("invalid", "The real-time replay inside the code is damaged.")
    if not isinstance(text, str) or not text:
        raise bad
    try:
        flat = json.loads(_inflate(_unb64(text), 16_000_000).decode("ascii"))
    except SilverError:
        raise
    except Exception:  # noqa: BLE001 - any decoding error means a damaged code
        raise bad from None
    if not isinstance(flat, list) or len(flat) % RT_ROW or len(flat) // RT_ROW > RT_MAX_ROWS:
        raise bad
    rows: list[list[Any]] = []
    tick = 0
    for i in range(0, len(flat), RT_ROW):
        dt, mx, my, use, dodge, sw, focus, plus, mega = flat[i:i + RT_ROW]
        if not all(type(v) is int for v in (dt, mx, my, use, dodge, sw, focus, plus, mega)):
            raise bad
        tick += dt
        if dt < 0 or tick < 1 or abs(mx) > 1000 or abs(my) > 1000 or not -1 <= use <= 3 or not -1 <= sw <= 5 or any(v not in (0, 1) for v in (dodge, focus, plus, mega)):
            raise bad
        rows.append([tick, 0, mx / 1000, my / 1000, use, dodge, sw, focus, plus, mega])
    return rows


def fingerprint(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def wrap(kind: str, payload: dict[str, Any], *, app_version: str, owner: str = "") -> dict[str, Any]:
    return {"kind": KINDS[kind], "schema": SCHEMA, "app": f"Silver's Hoard {app_version}", "owner": owner, "exported_at": int(time.time()),
            kind: payload}


def detect(data: Any) -> tuple[str, dict[str, Any]]:
    """Which kind of shared object ``data`` is (``trainer``/``gym``/``league``/``team``) and its payload."""
    if isinstance(data, dict):
        kind = str(data.get("kind") or "")
        for k, full in KINDS.items():
            if kind == full and isinstance(data.get(k), dict):
                return k, data[k]
        if isinstance(data.get("team"), list) and data.get("name"):
            return "trainer", data
        if isinstance(data.get("team"), list) or isinstance(data.get("sets"), list):
            return "team", data
    if isinstance(data, list):
        return "team", {"team": data}
    raise SilverError("invalid", "This file is not a trainer, gym or league of Silver's Hoard.")


def parse_any(text_or_bytes: Any) -> tuple[str, Any]:
    """A shared object from whatever was pasted or uploaded: a share code, a result code, a JSON file, or Showdown team text.
    Returns (kind, payload); kind ``result`` for a result code, ``paste`` for plain team text."""
    if isinstance(text_or_bytes, (bytes, bytearray)):
        text = bytes(text_or_bytes).decode("utf-8-sig", "replace")
    else:
        text = str(text_or_bytes or "")
    stripped = text.strip()
    if stripped[:200].lstrip().lower().startswith(("<!doctype", "<html")):
        m = re.search(r'<script id="silver-data" type="application/json">(.*?)</script>', stripped, re.S)
        if not m or m.group(1).strip() == PLACEHOLDER:
            raise SilverError("invalid", "This page is not a Silver's Hoard gym or trainer.")
        return detect(json.loads(m.group(1)).get("payload") or {})
    if RESULT_PREFIX_RT in stripped:
        return "result", unpack_code(RESULT_PREFIX_RT, stripped)
    if RESULT_PREFIX in stripped:
        return "result", unpack_code(RESULT_PREFIX, stripped)
    if CODE_PREFIX in stripped:
        return detect(unpack_code(CODE_PREFIX, stripped))
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            return detect(json.loads(stripped))
        except ValueError as exc:
            raise SilverError("invalid", f"The JSON could not be read: {exc}") from None
    if not stripped:
        raise SilverError("invalid", "Nothing to import.")
    return "paste", stripped


def playable_page(template: Path, data: dict[str, Any]) -> str:
    """The single-file battle page for a friend, with ``data`` (the gym or trainer, avatars inside) embedded."""
    if not template.exists():
        raise SilverError("unavailable", "The playable page template is missing.", hint="Build the client: npm run build")
    html = template.read_text(encoding="utf-8")
    slot = DATA_TAG + PLACEHOLDER + "</script>"
    if slot not in html:
        raise SilverError("unavailable", "The playable page template has no data slot.")
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\!--")
    return html.replace(slot, DATA_TAG + blob + "</script>", 1)


def safe_filename(name: str, ext: str) -> str:
    base = re.sub(r"[^\w\- ]+", "", name, flags=re.UNICODE).strip().replace(" ", "-")[:60] or "silver"
    return f"{base}.{ext}"
