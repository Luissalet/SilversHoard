from copy import deepcopy
import hashlib

import pytest

from silvers_hoard.battle_journal import compute, render
from silvers_hoard.errors import SilverError


def classic():
    return {'id': 'fixture', 'kind': 'watch', 'status': 'ended', 'mode': 'classic', 'format': 'gen9customgame', 'turns': 2,
            'created_at': 1700000000, 'winner_side': 'p1', 'winner_name': 'Ágata',
            'p1': {'name': 'Ágata'}, 'p2': {'name': 'Rival'},
            'log_text': '|start\n|switch|p1a: Bolt|Pikachu|300/300\n|turn|1\n|win|Ágata',
            'summary': {'sides': {'p1': {'pokemon': [{'name': 'Bolt', 'species': 'Pikachu', 'damage': 1.25, 'kos': 1, 'moves': 2}]},
                                  'p2': {'pokemon': [{'name': 'Fish', 'species': 'Magikarp', 'damage': 0, 'kos': 0, 'moves': 1}]}}}}


def test_saved_classic_damage_units_and_traceable_original_without_mutation():
    battle = classic(); before = deepcopy(battle)
    report = compute(battle)
    assert report['rows'][0]['damage'] == 125
    assert report['unit'] == '% HP bars' and report['log_complete']
    assert report['mvps'][0]['name'] == 'Bolt'
    assert report['log_sha256'] == hashlib.sha256(battle['log_text'].encode()).hexdigest()
    assert report['date'] == '2023-11-14T22:13:20+00:00'
    assert battle == before
    html = render(battle, report, 'es')
    assert '125 %' in html and 'barras de PS' in html and 'Ágata gana el combate' in html
    assert battle['log_text'] in html and '@media print' in html and 'window.print()' in html
    assert 'src=' not in html and '<link ' not in html


def test_realtime_uses_dealt_hp_never_normalized_damage_and_preserves_duration():
    battle = classic(); battle['mode'] = 'realtime'
    battle['log_text'] = '|rt|Ágata vs Rival\n[0.0] Ágata sent out Bolt\n[30.0] Ágata won (time)'
    battle['summary']['seconds'] = 30
    battle['summary']['sides']['p1']['pokemon'][0].update(dealt=87, damage=0.43)
    report = compute(battle)
    assert report['rows'][0]['damage'] == 87 and report['unit'] == 'HP'
    assert report['seconds'] == 30 and report['log_complete']
    assert report['rows'][1]['damage'] is None
    assert '87 PS' in render(battle, report, 'es')


def test_joint_mvps_and_ko_tiebreaker_do_not_choose_arbitrary_first_row():
    battle = classic(); mons = battle['summary']['sides']['p1']['pokemon']
    mons.append({**mons[0], 'name': 'Other'})
    assert len(compute(battle)['mvps']) == 2
    mons[1]['kos'] = 2
    assert [row['name'] for row in compute(battle)['mvps']] == ['Other']
    for mon in mons: mon['damage'] = 0
    assert compute(battle)['mvps'] == []


def test_missing_invalid_metrics_and_summary_never_become_zero_or_false_mvp():
    battle = classic()
    battle['summary']['sides']['p1']['pokemon'][0].update(damage=float('nan'), kos=-1, moves=True)
    row = compute(battle)['rows'][0]
    assert row['damage'] is row['kos'] is row['moves'] is None
    battle['summary'] = {}
    report = compute(battle)
    assert not report['rows'] and not report['mvps']
    assert 'No figures have been invented' in render(battle, report)


@pytest.mark.parametrize('log', ['', '|tier|Custom Game\n|start', '|win|Ágata'])
def test_partial_logs_are_explicit_and_preserve_saved_summary(log):
    battle = classic(); battle['log_text'] = log
    report = compute(battle)
    assert not report['log_complete'] and report['rows'][0]['damage'] == 125
    assert 'Incomplete log' in render(battle, report)


def test_unknown_outcome_is_not_reported_as_a_tie_and_tie_is_explicit():
    battle = classic(); battle['winner_side'] = ''; battle['winner_name'] = ''
    assert 'result unavailable' in render(battle, compute(battle))
    battle['log_text'] = '|start\n|tie'
    assert 'ends in a draw' in render(battle, compute(battle))


def test_names_and_original_log_are_escaped_as_text():
    battle = classic(); payload = '<script>alert("x")</script>'
    battle['p1']['name'] = payload
    battle['log_text'] += '\n' + payload
    battle['summary']['sides']['p1']['pokemon'][0]['name'] = payload
    html = render(battle, compute(battle))
    assert '<script' not in html and '&lt;script&gt;' in html


def test_live_battle_is_rejected():
    with pytest.raises(SilverError, match='finished battle'):
        compute({**classic(), 'status': 'live'})


def test_native_export_reuses_dispatcher_route_and_preserves_saved_rows(call, client, services):
    battle = classic(); battle.pop('id'); battle.pop('created_at')
    battle_id = services.store.add_battle(battle)
    before = services.store.battle(battle_id); settings = services.settings.snapshot()
    result = call('battle_journal', {'id': battle_id, 'lang': 'es'})
    html = client.get(result['url'] + '?download=false')
    assert html.status_code == 200 and 'text/html' in html.headers['content-type']
    assert '125 %' in html.text and len(html.content) == result['bytes']
    assert 'attachment' not in html.headers.get('content-disposition', '')
    assert call('battle_journal', {'id': battle_id, 'lang': 'es'})['file'] == result['file']
    assert services.store.battle(battle_id) == before and services.settings.snapshot() == settings
    call('battle_journal', {'id': battle_id, 'lang': 'xx'}, status=400)
    call('battle_journal', {'id': 'missing'}, status=404)
    services.store.update_battle(battle_id, {'status': 'live'})
    call('battle_journal', {'id': battle_id}, status=409)
