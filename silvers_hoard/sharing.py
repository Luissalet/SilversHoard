"""Files and codes that travel between friends.

* ``.hoardtrainer`` / ``.hoardgym`` / ``.hoardleague``: JSON with everything needed to fight them (teams, AI, rules, avatars as
  pictures inside the file). Import them into another Silver's Hoard.
* Share codes (``SILVER1-...``): a trainer without its picture, compressed into text to paste in a chat.
* Playable pages: one HTML file with the battle engine inside; a friend opens it in any browser, picks or pastes a team and fights
  the gym or trainer. When they win (or lose) the page gives a result code (``SILVERWIN1-...``) to send back; importing it records
  the badge here.
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
MAX_CODE = 400_000
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
        return json.loads(zlib.decompress(_unb64(body)).decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - any decoding error means a damaged code
        raise SilverError("invalid", f"The code is damaged or incomplete: {exc}") from None


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
