from conftest import needs_engine
from silvers_hoard.agent_tools import TOOLS_BY_NAME

pytestmark = needs_engine


def test_native_generator_and_prefix_grader_are_read_only_and_do_not_fetch(call, services, monkeypatch):
    def deny(*args, **kwargs):
        raise AssertionError('Type game must stay offline')
    monkeypatch.setattr(services.sprites, '_http_get', deny, raising=False)
    services.trainer_create(name='Type student', team=[{'species':'Mew','moves':['Psychic']}])
    db = services.store.db
    tables = [r['name'] for r in db.query("SELECT name FROM sqlite_master WHERE type='table'")]
    before = {name: db.query(f'SELECT * FROM "{name}"') for name in tables}
    args = {'gen': 1, 'mode': 'dual', 'seed': 'native-types'}
    deck = call('type_challenge', args)
    assert len(deck['questions']) == 10
    assert deck == call('type_challenge', deck['spec'])
    assert all('Fairy' not in q['options'] and 'Dark' not in q['options'] and 'Steel' not in q['options'] for q in deck['questions'])
    answers = [q['options'][0] for q in deck['questions']]
    prefix = call('type_challenge_score', {**deck['spec'], 'answers': answers[:3]})
    full = call('type_challenge_score', {**deck['spec'], 'answers': answers})
    assert full['complete'] and full['answered'] == full['total'] == 10
    assert prefix['feedback'] == full['feedback'][:3]
    assert {name: db.query(f'SELECT * FROM "{name}"') for name in tables} == before
    for name in ('type_challenge', 'type_challenge_score'):
        assert not TOOLS_BY_NAME[name].capped


def test_type_game_validation_and_empty_prefix(call):
    assert call('type_challenge_score', {})['answered'] == 0
    for args in ({'gen': 0}, {'gen': True}, {'mode': 'other'}, {'seed': ' '}, {'version': 2}):
        call('type_challenge', args, status=400)
    call('type_challenge_score', {'answers': ['Stellar']}, status=400)
    call('type_challenge_score', {'answers': ['Fire'] * 11}, status=400)
