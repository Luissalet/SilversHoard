from copy import deepcopy
import json

import pytest

from silvers_hoard.expert_combinations import derive
from silvers_hoard.config import Settings
from conftest import needs_engine


def battle():
    return {'status': 'ended', 'mode': 'classic', 'summary': {'ai_notes': [
        {'turn': 1, 'side': 'p1', 'kind': 'turn', 'level': 'expert', 'choice': 'move 1 1, move 1 -1',
         'slots': [{'slot': 0, 'mon': 'Pikachu', 'picked': {'kind': 'attack', 'name': 'Thunderbolt'}},
                   {'slot': 1, 'mon': 'Clefairy', 'picked': {'kind': 'status', 'name': 'Helping Hand'}}]}]},
        'log_text': '\n'.join(['|gametype|doubles', '|start',
            '|switch|p1a: Mouse|Pikachu, L50|100/100', '|switch|p1b: Fairy|Clefairy, L50|100/100',
            '|switch|p2a: Fish|Magikarp, L50|100/100', '|switch|p2b: Wall|Shuckle, L50|100/100',
            '|turn|1', '|move|p1b: Fairy|Helping Hand|p1a: Mouse', '|-singleturn|p1a: Mouse|Helping Hand',
            '|move|p2a: Fish|Splash|p2a: Fish', '|-nothing',
            '|move|p1a: Mouse|Thunderbolt|p2a: Fish', '|-damage|p2a: Fish|20/100', '|turn|2'])}


def test_pair_matches_both_actual_slots_and_waits_until_the_turn_boundary():
    b = battle(); before = deepcopy(b)
    result = derive(b)
    assert len(result) == 1
    pair = result[0]
    assert pair['turn'] == 1 and pair['side'] == 'p1' and pair['end_index'] == 13
    assert [(a['slot'], a['actor'], a['move']) for a in pair['actions']] == [(0, 'Mouse', 'Thunderbolt'), (1, 'Fairy', 'Helping Hand')]
    assert [a['line_index'] for a in pair['actions']] == [11, 7]
    assert b == before
    b['log_text'] = '\n'.join(b['log_text'].splitlines()[:-1])
    assert derive(b) == []  # pending turn has no resolved-pair label yet


@pytest.mark.parametrize('change', ['partner', 'normal', 'single', 'wrong_side', 'wrong_move', 'wrong_mon', 'switch'])
def test_trace_alone_wrong_seat_or_different_action_never_proves_a_pair(change):
    b = battle(); note = b['summary']['ai_notes'][0]
    if change == 'partner': note['partner'] = True
    if change == 'normal': note['level'] = 'normal'
    if change == 'single': b['log_text'] = b['log_text'].replace('|gametype|doubles', '|gametype|singles')
    if change == 'wrong_side': note['side'] = 'p2'
    if change == 'wrong_move': note['slots'][0]['picked']['name'] = 'Thunder'
    if change == 'wrong_mon': note['slots'][0]['mon'] = 'Raichu'
    if change == 'switch': note['slots'][1]['picked'] = {'kind': 'switch', 'species': 'Ditto'}
    assert derive(b) == []


@pytest.mark.parametrize('replacement', [
    '|cant|p1b: Fairy|slp',
    '|faint|p1b: Fairy',
    '|switch|p1b: Ditto|Ditto|100/100',
    '|move|p1a: Mouse|Helping Hand|p1a: Mouse',
])
def test_missing_or_impeded_second_actor_is_not_a_completed_pair(replacement):
    b = battle(); b['log_text'] = b['log_text'].replace('|move|p1b: Fairy|Helping Hand|p1a: Mouse', replacement)
    assert derive(b) == []


@pytest.mark.parametrize('failure', ['|-miss|p1a: Mouse|p2a: Fish', '|-fail|p2a: Fish', '|-immune|p2a: Fish', '|-activate|p2a: Fish|move: Protect'])
def test_failed_or_missed_action_does_not_get_an_effective_pair_label(failure):
    b = battle(); b['log_text'] = b['log_text'].replace('|-damage|p2a: Fish|20/100', failure)
    assert derive(b) == []


def test_repeated_called_moves_and_conflicting_traces_are_omitted_not_guessed():
    b = battle(); b['log_text'] = b['log_text'].replace('|turn|2', '|move|p1a: Mouse|Thunderbolt|p2a: Fish\n|turn|2')
    assert derive(b) == []
    b = battle(); note = deepcopy(b['summary']['ai_notes'][0]); note['slots'][0]['picked']['name'] = 'Thunder'
    b['summary']['ai_notes'].append(note)
    assert derive(b) == []


def test_duplicate_identical_notes_do_not_duplicate_labels_and_final_win_closes_turn():
    b = battle(); b['summary']['ai_notes'] *= 2
    b['log_text'] = b['log_text'].replace('|turn|2', '|win|A')
    assert len(derive(b)) == 1
    assert derive(b)[0]['end_index'] == 13


def test_live_snapshot_uses_public_split_lines_and_does_not_expose_hidden_fields():
    b = battle(); b['status'] = 'live'; lines = b.pop('log_text').splitlines()
    lines[12:13] = ['|split|p2', '|-damage|p2a: Fish|20/100', '|-damage|p2a: Fish|20/100']
    b['snapshot'] = json.dumps({'log': lines, 'secret': 'never expose this'})
    result = derive(b)
    assert len(result) == 1 and result[0]['end_index'] == 13
    assert 'secret' not in json.dumps(result)
    b['snapshot'] = ''
    assert derive(b) == []


def test_realtime_and_old_replays_without_notes_do_not_invent_combinations():
    b = battle(); b['mode'] = 'realtime'
    assert derive(b) == []
    b = battle(); b['summary'] = {}
    assert derive(b) == []


@needs_engine
def test_real_expert_doubles_live_snapshot_and_finished_log_agree(call, services):
    b = call('battle_start', {
        'format': 'gen4doublescustomgame', 'seed': 'expert-pair736-live',
        'p1': {'name': 'Pair736 Human', 'human': True, 'team': [
            {'species': 'Magikarp', 'name': 'Fish A', 'level': 100, 'moves': ['Splash']},
            {'species': 'Magikarp', 'name': 'Fish B', 'level': 100, 'moves': ['Splash']}]},
        'p2': {'name': 'Pair736 Expert', 'ai_level': 'expert', 'team': [
            {'species': 'Pikachu', 'level': 50, 'moves': ['Thunderbolt']},
            {'species': 'Clefairy', 'level': 50, 'moves': ['Helping Hand']}]},
    })
    if b['requests']['p1'].get('teamPreview'):
        b = call('battle_choose', {'id': b['id'], 'side': 'p1', 'choice': 'team 12'})
    b = call('battle_choose', {'id': b['id'], 'side': 'p1', 'choice': 'move 1, move 1'})
    assert b['status'] == 'live'
    source = services.store.battle(b['id']); before = deepcopy(source)
    pairs = derive(source)
    assert len(pairs) == 1, (source['summary'], json.loads(source['snapshot']).keys())
    assert pairs[0]['side'] == 'p2' and pairs[0]['turn'] == 1
    assert {a['move'] for a in pairs[0]['actions']} == {'Thunderbolt', 'Helping Hand'}
    assert services.store.battle(b['id']) == before
    call('battle_forfeit', {'id': b['id'], 'side': 'p1'})
    assert derive(services.store.battle(b['id'])) == pairs


@needs_engine
def test_real_expert_choice_with_one_actor_knocked_out_has_no_pair(call, services):
    b = call('battle_start', {
        'format': 'gen4doublescustomgame', 'seed': 'expert-pair736-blocked',
        'p1': {'name': 'Pair736 Fast', 'human': True, 'team': [
            {'species': 'Mewtwo', 'name': 'Fast A', 'level': 100, 'moves': ['Psychic']},
            {'species': 'Mewtwo', 'name': 'Fast B', 'level': 100, 'moves': ['Psychic']}]},
        'p2': {'name': 'Pair736 Slow', 'ai_level': 'expert', 'team': [
            {'species': 'Pikachu', 'level': 1, 'moves': ['Thunderbolt']},
            {'species': 'Clefairy', 'level': 1, 'moves': ['Helping Hand']}]},
    })
    if b['requests']['p1'].get('teamPreview'):
        b = call('battle_choose', {'id': b['id'], 'side': 'p1', 'choice': 'team 12'})
    b = call('battle_choose', {'id': b['id'], 'side': 'p1', 'choice': 'move 1 1, move 1 2'})
    assert b['status'] == 'ended'
    source = services.store.battle(b['id'])
    notes = [n for n in source['summary']['ai_notes'] if n.get('kind') == 'turn' and n['side'] == 'p2']
    assert notes and len(notes[0]['slots']) == 2
    assert len([line for line in source['log_text'].splitlines() if line.startswith('|move|p2')]) == 1
    assert derive(source) == []


def test_normal_handlers_share_pairs_and_toggle_persists_without_editing_battle(call, services):
    row = {**battle(), 'kind': 'play', 'format': 'gen4doublescustomgame', 'turns': 2,
           'p1': {'name': 'Expert'}, 'p2': {'name': 'Rival'}}
    id_ = services.store.add_battle(row)
    before = services.store.battle(id_)
    settings = services.settings.snapshot()
    result = call('battle_explain', {'id': id_, 'advice': False})
    assert result['combinations_enabled'] is True and len(result['combinations']) == 1
    assert 'Recorded expert pair: Mouse: Thunderbolt + Fairy: Helping Hand.' in result['text'][0]
    assert call('battle_get', {'id': id_})['expert_combinations'] == result['combinations']
    assert result['notes'] == row['summary']['ai_notes']
    assert call('battle_explain', {'id': id_, 'side': 'p2', 'advice': False})['combinations'] == []
    call('settings_set', {'expert_combinations': False})
    assert Settings(services.settings.path).get('expert_combinations') is False
    assert call('battle_explain', {'id': id_, 'advice': False})['combinations'] == []
    assert call('battle_get', {'id': id_})['expert_combinations'] == []
    call('settings_set', {'expert_combinations': True})
    assert call('battle_get', {'id': id_})['expert_combinations'] == result['combinations']
    assert services.settings.snapshot() == settings and services.store.battle(id_) == before
