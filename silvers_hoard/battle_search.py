"""Locate saved replay events without executing inputs or changing the original battle."""
from __future__ import annotations

import re
import unicodedata
from decimal import Decimal

SIDES = ('p1', 'p2')
IDENT = re.compile(r'^(p[12][a-z]?): ')
STAMP = re.compile(r'^\[(\d+(?:\.\d+)?)\] (.*)$')


def _norm(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value or '')).casefold() if c.isalnum())


def _contains(value, query):
    return not query or query in _norm(value)


def _classic(lines):
    active = {}
    turn = 0
    for line in lines:
        parts = line.split('|')
        if len(parts) < 3:
            continue
        command = parts[1]
        if command == 'turn':
            if parts[2].isdigit():
                turn = int(parts[2])
            continue
        match = IDENT.match(parts[2])
        if not match or len(parts) < 4:
            continue
        slot = match[1]
        event = {'side': slot[:2], 'turn': turn}
        if command in ('switch', 'drag', 'replace', 'detailschange', '-formechange'):
            species = parts[3].split(',')[0].strip()
            active[slot] = species
            if species:
                yield {**event, 'species': species}, False
        elif command == 'move' and parts[3].strip():
            yield {**event, 'species': active.get(slot, ''), 'move': parts[3].strip()}, False


def _realtime(battle, lines):
    aliases = {}
    names = {}
    summary = (battle.get('summary') or {}).get('sides') or {}
    for side in SIDES:
        seat = battle.get(side) or {}
        names[side] = str(seat.get('name') or (summary.get(side) or {}).get('name') or '')
        aliases[side] = {}
        for mon in [*(seat.get('sets') or seat.get('team') or []), *((summary.get(side) or {}).get('pokemon') or [])]:
            species = mon.get('species') or ''
            if species:
                aliases[side].setdefault(mon.get('name') or species, set()).add(species)
    for line in lines:
        stamp = STAMP.match(line)
        if not stamp:
            continue
        seconds, text = stamp.groups()
        position = {'tick': max(0, int(Decimal(seconds) * 30) - 2), 'seconds': float(seconds)}
        candidates = set()
        for side in SIDES:
            if not names[side]:
                continue
            for nick, species_set in aliases[side].items():
                # Match the complete known actor, so nicknames containing " used " stay intact.
                prefix = names[side] + "'s " + nick + ' used '
                if text.startswith(prefix) and text[len(prefix):]:
                    candidates.update((side, species, text[len(prefix):]) for species in species_set)
                if text == names[side] + ' sent out ' + nick:
                    candidates.update((side, species, '') for species in species_set)
        if len(candidates) == 1:
            side, species, move = next(iter(candidates))
            yield {'side': side, 'species': species, **({'move': move} if move else {}), **position}, False
        elif candidates:
            yield {}, True


def search(store, card, *, species='', move='', trainer='', format='', result='', kind='', mode='', offset=0, limit=20):
    """AND filters share an actor; won/lost refer to the trainer matching the name filter."""
    species, move, trainer, format = map(_norm, (species, move, trainer, format))
    found = []
    coverage = {'searched': 0, 'without_replay': 0, 'ambiguous_events': 0}
    for battle in store.battles(status='ended', kind=kind, limit=-1, light=False):
        battle_mode = battle.get('mode') or 'classic'
        if battle.get('status') != 'ended' or mode and battle_mode != mode or not _contains(battle.get('format'), format):
            continue
        selected = {side for side in SIDES if _contains((battle.get(side) or {}).get('name'), trainer)}
        winner = battle.get('winner_side') or ''
        if result in SIDES and winner != result or result == 'tie' and winner:
            continue
        if result in ('won', 'lost'):
            if not trainer or winner not in SIDES:
                continue
            selected &= {winner if result == 'won' else ('p2' if winner == 'p1' else 'p1')}
        if not selected:
            continue
        lines = str(battle.get('log_text') or '').splitlines()
        replay = battle.get('replay') or {}
        available = (any(line.startswith('|rt|') for line in lines) and isinstance(replay.get('tick'), int) and isinstance(replay.get('inputs'), list)) if battle_mode == 'realtime' else any(line == '|start' or line.startswith('|start|') for line in lines)
        if not available:
            coverage['without_replay'] += 1
            continue
        coverage['searched'] += 1
        matches = []
        if not species and not move:
            matches = [{'tick': 0, 'seconds': 0.0} if battle_mode == 'realtime' else {'turn': 0}]
        else:
            events = _realtime(battle, lines) if battle_mode == 'realtime' else _classic(lines)
            seen = set()
            for event, ambiguous in events:
                if ambiguous:
                    coverage['ambiguous_events'] += 1
                    continue
                if event['side'] not in selected or not _contains(event.get('species'), species) or not _contains(event.get('move'), move):
                    continue
                key = tuple(event.items())
                if key not in seen:
                    seen.add(key)
                    matches.append(event)
        if matches:
            found.append({'battle': card(battle), 'matches': matches, 'match_count': len(matches)})
    end = offset + limit
    return {'battles': found[offset:end], 'total': len(found), 'offset': offset,
            'next_offset': end if end < len(found) else None, 'coverage': coverage}
