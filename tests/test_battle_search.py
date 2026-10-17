from copy import deepcopy

from silvers_hoard.battle_search import search


def classic(id_='old', **changes):
    return {'id': id_, 'status': 'ended', 'kind': 'watch', 'mode': 'classic', 'format': 'gen9customgame',
            'p1': {'name': 'Ágata', 'trainer_id': 'a'}, 'p2': {'name': 'Luis', 'trainer_id': 'b'},
            'winner_side': 'p1', 'log_text': '\n'.join(['|start', '|switch|p1a: Bolt|Pikachu, L50|100/100',
            '|switch|p2a: Fish|Magikarp, L50|100/100', '|turn|1', '|move|p2a: Fish|Splash|p2a: Fish',
            '|turn|2', '|move|p1a: Bolt|Thunderbolt|p2a: Fish', '|win|Ágata']), **changes}


class Store:
    def __init__(self, rows): self.rows = rows
    def battles(self, **kwargs):
        assert kwargs == {'status': 'ended', 'kind': '', 'limit': -1, 'light': False}
        return self.rows


def find(rows, **filters):
    return search(Store(rows), lambda row: {'id': row['id']}, **filters)


def test_combined_filters_refer_to_the_same_actor_and_its_move_turn():
    source = [classic()]; before = deepcopy(source)
    result = find(source, species='pika', move='thunderbolt', trainer='agata', format='gen9customgame', result='won')
    assert result['total'] == 1
    assert result['battles'][0]['matches'] == [{'side': 'p1', 'species': 'Pikachu', 'move': 'Thunderbolt', 'turn': 2}]
    assert find(source, species='Magikarp', move='Thunderbolt')['total'] == 0
    assert find(source, trainer='Luis', move='Thunderbolt')['total'] == 0
    assert find(source, trainer='Luis', result='lost', move='Splash')['total'] == 1
    assert source == before


def test_metadata_only_queries_open_the_replay_start_and_result_has_an_explicit_side():
    result = find([classic()], result='p1')
    assert result['battles'][0]['matches'] == [{'turn': 0}]
    assert find([classic()], result='p2')['total'] == 0
    assert find([classic()], result='tie')['total'] == 0
    assert find([classic()], result='won')['total'] == 0  # requires a trainer perspective


def test_switches_doubles_and_forms_do_not_confuse_nicknames_with_species():
    battle = classic(); battle['log_text'] = '\n'.join(['|start', '|switch|p1a: Thunderbolt|Ditto|100/100',
        '|switch|p1b: Mouse|Pikachu|100/100', '|turn|1', '|move|p1b: Mouse|Thunderbolt|p2a: Fish',
        '|turn|2', '|switch|p1b: Fox|Zoroark|100/100', '|move|p1a: Thunderbolt|Transform|p1b: Fox', '|tie'])
    assert find([battle], species='Pikachu', move='Thunderbolt')['battles'][0]['matches'][0]['turn'] == 1
    assert find([battle], species='Ditto', move='Thunderbolt')['total'] == 0
    assert find([battle], species='Zoroark')['battles'][0]['matches'][0]['turn'] == 2


def rt():
    battle = classic('rt'); battle['mode'] = 'realtime'
    battle['p1'] = {'name': 'A', 'trainer_id': 'a', 'sets': [{'species': 'Cloyster', 'name': 'Shell used again'}]}
    battle['p2'] = {'name': 'B', 'trainer_id': 'b', 'sets': [{'species': 'Snorlax'}]}
    battle['replay'] = {'time_limit': 10, 'version': 11, 'tick': 300, 'inputs': []}
    battle['log_text'] = '\n'.join(['|rt|A vs B|format', '[0.0] A sent out Shell used again',
        '[0.0] B sent out Snorlax', '[1.0] A\'s Shell used again used Icicle Spear', '[10.0] A won (time)'])
    return battle


def test_rt_reads_recorded_events_without_replaying_and_seeks_just_before_rounded_time():
    result = find([rt()], species='Cloyster', move='iciclespear')
    assert result['battles'][0]['matches'] == [{'side': 'p1', 'species': 'Cloyster', 'move': 'Icicle Spear', 'tick': 28, 'seconds': 1.0}]
    assert find([rt()], species='Snorlax', move='iciclespear')['total'] == 0


def test_ambiguous_rt_actor_is_not_assigned_to_the_wrong_trainer_or_species():
    battle = rt()
    battle['p1']['name'] = battle['p2']['name'] = 'Same'
    battle['p2']['sets'] = [{'species': 'Snorlax', 'name': 'Shell used again'}]
    battle['log_text'] = '|rt|Same vs Same|format\n[1.0] Same\'s Shell used again used Rest'
    result = find([battle], move='Rest', species='Cloyster')
    assert result['total'] == 0 and result['coverage']['ambiguous_events'] == 1


def test_all_saved_replays_are_searched_and_output_pagination_is_honest():
    rows = [classic(str(i)) for i in range(85)]
    rows += [{**classic('legacy'), 'log_text': ''}, {**classic('live'), 'status': 'live'}]
    result = find(rows, move='Thunderbolt', offset=80, limit=3)
    assert result['total'] == 85 and result['next_offset'] == 83
    assert [b['battle']['id'] for b in result['battles']] == ['80', '81', '82']
    assert result['coverage']['without_replay'] == 1
    assert find(rows, move='Not a move')['battles'] == []


def test_native_tool_uses_saved_rows_and_preserves_them(call, services):
    row = classic()
    row.pop('id')
    row['turns'] = 2
    battle_id = services.store.add_battle(row)
    before = services.store.battle(battle_id)
    settings = services.settings.snapshot()
    result = call('battles_search', {'species':'Pikachu', 'move':'Thunderbolt', 'trainer':'agata', 'result':'won'})
    assert result['total'] == 1 and result['battles'][0]['battle']['id'] == battle_id
    assert result['battles'][0]['matches'][0]['turn'] == 2
    assert 'log_text' not in result['battles'][0]['battle']
    assert services.store.battle(battle_id) == before and services.settings.snapshot() == settings
    call('battles_search', {'mode':'bogus'}, status=400)


def test_every_matching_turn_remains_accessible_even_in_a_long_replay():
    battle = classic()
    battle['log_text'] = '|start\n|switch|p1a: Bolt|Pikachu|100/100\n' + '\n'.join(
        f'|turn|{turn}\n|move|p1a: Bolt|Thunderbolt|p2a: Fish' for turn in range(1,19)) + '\n|win|Ágata'
    result = find([battle], move='Thunderbolt')['battles'][0]
    assert result['match_count'] == len(result['matches']) == 18
    assert result['matches'][-1]['turn'] == 18
