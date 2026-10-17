"""Read-only controller guide. Hardware is visible only to the browser using it."""
import json
from pathlib import Path


def guide(services):
    result = json.loads((Path(__file__).parent / 'presets' / 'controller_guide.json').read_text(encoding='utf-8'))
    port = services.config.port
    result.update(hardware_access='browser_only', port=port, firewall_executed=False,
                  firewall_command=f'New-NetFirewallRule -DisplayName "Silver TCP {port}" -Direction Inbound '
                  f'-Action Allow -Protocol TCP -LocalPort {port} -Profile Private -RemoteAddress LocalSubnet')
    return result
