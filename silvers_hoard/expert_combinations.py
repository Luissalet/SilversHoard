"""Match saved expert choices to two public, completed actions; never simulate a turn."""
from __future__ import annotations

import json
import re
from collections import defaultdict

IDENT = re.compile(r'^(p[12])([ab]): (.*)$')
FAILURES = {'-miss', '-fail', '-immune', '-notarget', '-nothing'}
GUARDS = {'move: Protect', 'move: Detect', 'move: Wide Guard', 'move: Quick Guard', 'move: Crafty Shield', 'move: Mat Block'}


def _id(value):
    return re.sub('[^a-z0-9]', '', str(value or '').casefold())


def _lines(battle):
    if battle.get('status') != 'live':
        return str(battle.get('log_text') or '').splitlines()
    raw = battle.get('snapshot')
    if not raw:
        return []
    try:
        snapshot = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError):
        return []
    source = snapshot.get('log') or []
    # Mirror viewLines' one output line per private/public split, choosing public text.
    result = []
    index = 0
    while index < len(source):
        line = source[index]
        if str(line).startswith('|split|'):
            if index + 2 >= len(source):
                break
            result.append(source[index + 2]); index += 3
        else:
            result.append(line); index += 1
    return result


def derive(battle):
    """Only exact stored move names on both original slots qualify; ambiguous turns are omitted."""
    if (battle.get('mode') or 'classic') != 'classic':
        return []
    lines = _lines(battle)
    if '|gametype|doubles' not in lines:
        return []
    plans = defaultdict(dict)
    for note in (battle.get('summary') or {}).get('ai_notes') or []:
        if note.get('kind') != 'turn' or note.get('level') != 'expert' or note.get('partner') or note.get('error'):
            continue
        slots = sorted(note.get('slots') or [], key=lambda slot: slot.get('slot', -1))
        if [slot.get('slot') for slot in slots] != [0, 1]:
            continue
        if any((slot.get('picked') or {}).get('kind') not in ('attack', 'status', 'gimmick') or not (slot.get('picked') or {}).get('name') for slot in slots):
            continue
        signature = (note.get('choice') or '', tuple((_id(slot.get('mon')), _id(slot['picked']['name'])) for slot in slots))
        plans[(note.get('turn'), note.get('side'))][signature] = slots
    if not plans:
        return []

    active = {}; initial = {}; actions = defaultdict(list); invalid = set(); turn = 0; last_actor = ''
    found = []

    def finish(end_index):
        for side in ('p1', 'p2'):
            candidates = plans.get((turn, side)) or {}
            if len(candidates) != 1:
                continue
            slots = next(iter(candidates.values()))
            pair = []
            for slot in slots:
                key = side + ('a' if slot['slot'] == 0 else 'b')
                entries = actions.get(key) or []
                start = initial.get(key)
                if key in invalid or len(entries) != 1 or not start:
                    break
                event = entries[0]
                if event['actor'] != start['actor'] or _id(start['species']) != _id(slot.get('mon')) or _id(event['move']) != _id(slot['picked']['name']):
                    break
                pair.append(event)
            if len(pair) == 2:
                found.append({'turn': turn, 'side': side, 'actions': pair, 'end_index': end_index})

    for index, line in enumerate(lines):
        parts = str(line).split('|')
        if len(parts) < 2:
            continue
        command = parts[1]
        if command in ('turn', 'win', 'tie'):
            finish(index)
            turn = int(parts[2]) if command == 'turn' and len(parts) > 2 and parts[2].isdigit() else 0
            initial = {key: dict(value) for key, value in active.items()}
            actions = defaultdict(list); invalid = set(); last_actor = ''
            continue
        match = IDENT.match(parts[2]) if len(parts) > 2 else None
        key = match[1] + match[2] if match else ''
        if command in ('switch', 'drag', 'replace') and match and len(parts) > 3:
            if turn and not actions.get(key):
                invalid.add(key)
            active[key] = {'actor': match[3], 'species': parts[3].split(',')[0]}
        elif command in ('detailschange', '-formechange') and key in active and len(parts) > 3:
            active[key]['species'] = parts[3].split(',')[0]
        elif command == 'swap' and match:
            invalid.update((match[1] + 'a', match[1] + 'b'))
        elif command == 'move' and match and len(parts) > 3:
            actions[key].append({'slot': ord(match[2]) - ord('a'), 'actor': match[3], 'species': (initial.get(key) or {}).get('species') or '', 'move': parts[3], 'line_index': index})
            last_actor = key
            if any('[from]' in extra or '[notarget]' in extra for extra in parts[4:]):
                invalid.add(key)
        elif command in FAILURES or command == '-activate' and len(parts) > 3 and parts[3] in GUARDS:
            if last_actor:
                invalid.add(last_actor)
            if command == '-miss' and key:
                invalid.add(key)
        elif command == 'cant' and key:
            invalid.add(key)
    return found
