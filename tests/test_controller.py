"""The read-only guide shares actual mode mappings, never samples or configures hardware."""
def test_controller_guide_covers_each_mode_without_collecting_hardware(call):
    guide = call('controller_guide')
    assert {m['id'] for m in guide['modes']} == {'realtime', 'mass', 'maps', 'pokeathlon', 'roulette'}
    assert guide['hardware_access'] == 'browser_only'
    assert guide['log_limit'] == 2048
    assert guide['port'] == 5230
    assert '-LocalPort 5230' in guide['firewall_command']
    assert '-Profile Private' in guide['firewall_command'] and '-RemoteAddress LocalSubnet' in guide['firewall_command']
    assert guide['firewall_executed'] is False

def test_guide_uses_configured_port_and_returns_independent_data(call, services):
    services.config.port = 63915
    first = call('controller_guide')
    assert first['port'] == 63915 and '-LocalPort 63915' in first['firewall_command']
    first['modes'].clear()
    assert len(call('controller_guide')['modes']) == 5

def test_reading_controller_guide_preserves_settings_and_library(call, services):
    before = services.settings.snapshot()
    trainers = call('trainers_list', {})
    call('controller_guide')
    assert services.settings.snapshot() == before and call('trainers_list', {}) == trainers
