import copy
import datetime
import json
import shutil
import subprocess

import pytest

from conftest import ROOT, needs_engine
from silvers_hoard.daily import DailyChallenge
from silvers_hoard.errors import SilverError
from silvers_hoard import sharing


@needs_engine
def test_same_calendar_day_has_same_rentals_opponents_and_rules_without_creating_entities(services):
    before = services.overview()['counts']
    daily = DailyChallenge(services)
    one = daily.spec('2026-10-18')
    assert DailyChallenge(services).spec('2026-10-18') == one
    assert daily.spec('2026-10-19')['key'] != one['key']
    assert len(one['rentals']) == 6 and len(one['opponents']) == 7
    assert all(len(o['team']) == 3 for o in one['opponents'])
    assert all(o['ai_level'] == 'normal' for o in one['opponents'])
    assert one['level_rules'] == {'level': 50}
    assert one['format'] == 'gen9customgame'
    for opponent in one['opponents']:
        assert services.validate_team(one['format'], opponent['team'], rules=one['rules'], level_rules=one['level_rules'])['ok']
    assert services.overview()['counts'] == before
    # A caller editing a returned draft must not poison tomorrow's/shared cached challenge.
    one['rentals'][0]['species'] = 'Magikarp'
    assert daily.spec('2026-10-18') == DailyChallenge(services).spec('2026-10-18')


@pytest.mark.parametrize('day', ['2026-02-30', '2026-1-2', '20261018', '18/10/2026'])
def test_only_real_iso_calendar_days_are_accepted(services, day):
    with pytest.raises(SilverError):
        DailyChallenge(services).spec(day)


def test_empty_date_means_today(services):
    assert DailyChallenge(services).spec()['day'] == datetime.date.today().isoformat()


def _forfeit(services, spec, rentals):
    opponent = spec['opponents'][0]
    battle = {'seed': spec['seed'] + '-0', 'format': spec['format'], 'level_rules': spec['level_rules'],
              'p1': {'name': 'Daily QA', 'sets': rentals},
              'p2': {'name': opponent['name'], 'sets': opponent['team'],
                     'ai': {'level': opponent['ai_level'], 'style': opponent['ai_style']}}, 'forfeit': True}
    run = subprocess.run([shutil.which('node'), str(ROOT / 'tests/turn_record.mjs')], input=json.dumps(battle),
                         text=True, capture_output=True, cwd=ROOT, check=True, timeout=180)
    replay = json.loads(run.stdout)
    return {'name': opponent['name'], 'won': False, 'turns': replay['turns'], 'input': replay['input'],
            'rng': replay['rng'], 'forfeit': 'p1'}


@needs_engine
def test_daily_result_replays_exact_rentals_and_seed_and_reuses_the_existing_local_board(services):
    daily = DailyChallenge(services)
    spec = daily.spec('2026-10-18')
    team = spec['rentals'][:3]
    result = {'kind': 'daily', 'daily': {k: spec[k] for k in ('version', 'day', 'key')},
              'challenger': 'Daily QA', 'team': team, 'stages': [_forfeit(services, spec, team)],
              'won': False, 'date': '2026-10-18T10:00:00Z', 'ai_version': services.ai_version(), 'v': 3}
    before = services.overview()['counts']
    for change in ('rentals', 'seed', 'completion'):
        bad = copy.deepcopy(result)
        if change == 'rentals':
            bad['team'][0]['moves'] = ['Fissure']
        elif change == 'seed':
            bad['stages'][0]['rng'] = 'another-day'
        else:
            bad['won'] = True
        with pytest.raises(SilverError):
            daily.import_result(bad)
        assert services.overview()['counts'] == before
    out = services.import_result(result)
    assert out['verified'] and out['verified_turns'] == 1 and not out['won']
    board = services.leaderboard(kind='daily', target_id=spec['id'])['boards']
    assert len(board) == 1 and len(board[0]['entries']) == 1
    assert board[0]['entries'][0]['challenger'] == 'Daily QA'
    assert board[0]['entries'][0]['battles_won'] == 0
    assert services.overview()['counts']['badges'] == before['badges']
    assert services.overview()['counts']['trainers'] == before['trainers']
    with pytest.raises(SilverError):
        services.import_result(result)
    assert len(services.store.friend_results(kind='daily')) == 1


@needs_engine
def test_daily_uses_the_normal_ui_agent_handlers_and_board_filter(call):
    one = call('daily_challenge', {'day': '2026-10-18'})
    assert one['day'] == '2026-10-18' and one['goal'] == 7 and len(one['rentals']) == 6
    assert len(one['opponents']) == 7 and one['boards'] == []
    assert call('leaderboard', {'kind': 'daily', 'target_id': one['id']})['boards'] == []
    assert call('daily_challenge', {'day': '2026-02-30'}, status=400)['error']


@needs_engine
def test_playable_daily_page_uses_each_canonical_opponents_ai_in_every_stage(services):
    spec = services.daily.spec('2026-10-18')
    exported = services.daily.export(spec['day'])
    html = services.export_file(exported['file']).read_text(encoding='utf-8')
    data = json.loads(html.split(sharing.DATA_TAG, 1)[1].split('</script>', 1)[0])
    gym = data['payload']['gym']
    stages = [*gym['trainers'], gym['leader']]
    assert data['daily']['key'] == spec['key']
    assert {opponent['ai_style'] for opponent in spec['opponents']} != {'balanced'}
    for playable, canonical in zip(stages, spec['opponents'], strict=True):
        assert playable['ai'] == {'level': canonical['ai_level'], 'style': canonical['ai_style']}
        assert playable['team'] == canonical['team']
