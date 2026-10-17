"""A finished real-time replay retains its terminal event through the shared API."""
import copy

import pytest

from conftest import needs_engine

pytestmark = needs_engine


@pytest.mark.parametrize('side,tick', [('p1', 0), ('p1', 212), ('p2', 1), ('p2', 212)])
def test_saved_forfeit_is_exposed_at_exact_tick_without_rewriting_legacy(call, services, side, tick):
    team = [{'species': 'Snorlax', 'moves': ['Splash']}]
    match = call('battle_start', {'mode': 'realtime', 'p1': {'team': team, 'human': True},
                                  'p2': {'team': team, 'human': True}})
    assert match['rt']['forfeit'] == ''
    result = call('battle_rt_finish', {'id': match['id'], 'inputs': [], 'tick': tick, 'forfeit': side})
    assert result['status'] == 'ended' and result['summary']['reason'] == 'forfeit'
    assert result['rt']['tick'] == tick
    assert result['rt']['forfeit'] == side
    assert result['winner_side'] == ('p2' if side == 'p1' else 'p1')
    # Saved older rows and imported friend results have only summary + inputs/tick.
    before = copy.deepcopy(services.store.battle(match['id']))
    assert 'forfeit' not in before['replay']
    again = call('battle_get', {'id': match['id']})
    assert again['rt']['forfeit'] == side and again['rt']['tick'] == tick
    assert services.store.battle(match['id']) == before
