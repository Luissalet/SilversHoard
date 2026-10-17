import copy
import json

import pytest

from conftest import fake_http, needs_engine
from test_practice import finished
from silvers_hoard.config import Config
from silvers_hoard.errors import SilverError
from silvers_hoard.services import Services

pytestmark = needs_engine


def saved_pair(services):
    source = finished(services)
    exercises = [services.training.create(source['id'], turn=turn, title=f'Position {turn}',
                    goal='survive' if turn == 2 else 'win', target_turns=1 if turn == 2 else 0)
                 for turn in (1, 2)]
    return source, exercises


@pytest.mark.parametrize('theme', ['attrition', 'openings', 'doubles'])
def test_package_reconstructs_every_position_in_a_fresh_library_without_source(services, tmp_path, theme):
    source, exercises = saved_pair(services)
    before = copy.deepcopy(services.store.battle(source['id']))
    exported = services.training.export_pack([e['id'] for e in exercises], title='Dos posiciones Ñ', theme=theme)
    obj = json.loads(exported['code'])
    assert obj['kind'] == 'silvers-hoard/exercise-pack' and obj['schema'] == 1
    assert obj['title'] == 'Dos posiciones Ñ' and obj['theme'] == theme
    assert len(obj['exercises']) == 2 and source['id'] not in exported['code']
    assert all(e['id'] not in exported['code'] for e in exercises)
    assert exported['file'].endswith('.silverexercise')
    receiver = Services(Config(data_dir=tmp_path / 'receiver', background=False), http_get=fake_http)
    try:
        receiver.start()
        imported = receiver.training.import_pack(exported['code'])
        assert imported['title'] == obj['title'] and imported['theme'] == theme
        assert [e['turn'] for e in imported['exercises']] == [1, 2]
        assert len({e['pack']['id'] for e in imported['exercises']}) == 1
        for index, e in enumerate(imported['exercises']):
            assert e['pack']['index'] == index + 1 and e['pack']['total'] == 2
            battle = receiver.training.start(e['id'], adaptive=False, ai_level='easy')
            assert battle['kind'] == 'practice' and battle['turn'] == e['turn']
            played = receiver.battle_choose(battle['id'], 'p1', 'move 1')
            assert not played.get('errors')
            receiver.battle_forfeit(battle['id'], 'p1')
        receiver.engine.stop()
        for e in imported['exercises']:
            again = receiver.training.start(e['id'], adaptive=False, ai_level='easy')
            assert again['requests']['p1']
            receiver.battle_forfeit(again['id'], 'p1')
        assert not receiver.store.trainers() and not receiver.store.badges() and not receiver.store.hall()
        assert all(b['id'] != source['id'] for b in receiver.store.battles())
        assert [e['title'] for e in receiver.training.list()['exercises']] == ['Position 1', 'Position 2']
    finally:
        receiver.stop()
    assert services.store.battle(source['id']) == before


def test_invalid_second_position_leaves_no_partial_import(services):
    _, exercises = saved_pair(services)
    obj = json.loads(services.training.export_pack([e['id'] for e in exercises], theme='openings')['code'])
    obj['exercises'][1]['position']['turn'] = 999
    before = services.store.exercises()
    with pytest.raises(SilverError):
        services.training.import_pack(json.dumps(obj))
    assert services.store.exercises() == before


def test_database_failure_rolls_back_every_imported_exercise(services, monkeypatch):
    _, exercises = saved_pair(services)
    code = services.training.export_pack([e['id'] for e in exercises], theme='attrition')['code']
    before = services.store.exercises()
    add = services.store.add_exercise
    calls = 0
    def fail_second(values):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('Synthetic database failure')
        return add(values)
    monkeypatch.setattr(services.store, 'add_exercise', fail_second)
    with pytest.raises(RuntimeError, match='Synthetic database failure'):
        services.training.import_pack(code)
    assert services.store.exercises() == before


def test_export_keeps_individual_format_and_deduplicates_selection(services):
    _, exercises = saved_pair(services)
    first, second = exercises
    single = services.training.export(first['id'])
    pack = services.training.export_pack([first['id'], first['id'], second['id']], theme='doubles')
    assert len(json.loads(pack['code'])['exercises']) == 2
    imported = services.training.import_(single['code'])
    assert imported['title'] == first['title'] and 'pack' not in imported
    for ids, theme in (([], 'openings'), ([first['id']], 'invented')):
        with pytest.raises(SilverError):
            services.training.export_pack(ids, theme=theme)


@pytest.mark.parametrize('bad', [[], {'kind':'silvers-hoard/exercise-pack','schema':2},
    {'kind':'silvers-hoard/exercise-pack','schema':1,'title':'Empty','theme':'openings','exercises':[]}])
def test_invalid_container_writes_nothing(services, bad):
    with pytest.raises(SilverError):
        services.training.import_pack(json.dumps(bad))
    assert not services.store.exercises()


@pytest.mark.parametrize('bom', [b'', b'\xef\xbb\xbf'])
def test_normal_tools_download_paste_upload_and_practice(services, call, client, bom):
    source, exercises = saved_pair(services)
    before = copy.deepcopy(services.store.battle(source['id']))
    exported = call('exercise_pack_export', {'ids':[e['id'] for e in exercises], 'title':'Paquete Ñ', 'theme':'openings'})
    response = client.get(exported['url'])
    assert response.status_code == 200 and response.content == exported['code'].encode('utf-8')
    pasted = call('import', {'content':exported['code']})
    assert pasted['kind'] == 'exercise_pack' and len(pasted['exercises']) == 2
    uploaded = client.post('/api/import/upload', files={'file':(exported['file'],bom + response.content,'application/json')})
    assert uploaded.status_code == 200
    result = uploaded.json()
    assert result['kind'] == 'exercise_pack' and result['title'] == 'Paquete Ñ'
    for index, e in enumerate(result['exercises'], 1):
        assert e['pack']['index'] == index
        battle = call('exercise_start', {'id':e['id'], 'adaptive':False, 'ai_level':'easy'})
        assert battle['practice']['exercise_id'] == e['id']
        services.battle_choose(battle['id'], 'p1', 'move 1')
        services.battle_forfeit(battle['id'], 'p1')
    assert services.store.battle(source['id']) == before
    assert not services.store.badges() and not services.store.hall()


def test_future_choices_attempts_and_old_pack_identity_do_not_travel(services):
    source, exercises = saved_pair(services)
    obj = json.loads(services.training.export_pack([exercises[0]['id']], theme='openings')['code'])
    obj['exercises'][0]['position']['input'] = services.store.battle(source['id'])['replay']['input']
    imported = services.training.import_pack(json.dumps(obj))['exercises'][0]
    battle = services.training.start(imported['id'], adaptive=False, ai_level='easy')
    services.battle_forfeit(battle['id'], 'p1')
    assert services.training.get(imported['id'])['attempts']
    exported = services.training.export_pack([imported['id']], theme='openings')
    entry = json.loads(exported['code'])['exercises'][0]
    assert 'pack' not in entry['position'] and imported['pack']['id'] not in exported['code']
    assert imported['id'] not in exported['code'] and battle['id'] not in exported['code']
    choices = [line.split(' ',1)[1] for line in entry['position']['input'] if line.startswith(('>p1 ', '>p2 '))]
    assert choices and all(choice.startswith('team ') for choice in choices)


def test_double_position_keeps_both_slots_after_pack_roundtrip(services):
    seat = {'paste':'Pikachu\n- Splash\n\nClefable\n- Splash', 'human':True}
    source = services.battle_start(p1={**seat,'name':'A'},p2={**seat,'name':'B'},format_='gen9doublescustomgame',seed='pack-doubles')
    for side in ('p1','p2'):
        services.battle_choose(source['id'],side,'team 12')
    for side in ('p1','p2'):
        services.battle_choose(source['id'],side,'move 1, move 1')
    services.battle_forfeit(source['id'],'p1')
    exercise = services.training.create(source['id'],turn=2,side='p2')
    code = services.training.export_pack([exercise['id']],theme='doubles')['code']
    imported = services.training.import_pack(code)['exercises'][0]
    battle = services.training.start(imported['id'],adaptive=False,ai_level='easy')
    assert battle['turn'] == 2 and battle['practice']['side'] == 'p2'
    assert len(battle['requests']['p2']['active']) == 2
    services.battle_choose(battle['id'],'p2','move 1, move 1')
    services.battle_forfeit(battle['id'],'p2')
    assert not services.store.badges() and not services.store.hall()
