"""Printable reports from saved engine summaries and their original logs; no simulation."""
from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone
from html import escape

from .errors import SilverError

TEXT = {
    'es': {
        'title': 'Periódico del combate', 'wins': '{name} gana el combate', 'tie': 'El combate termina en empate',
        'unknown_result': 'Combate terminado: resultado no disponible', 'print': 'Imprimir / guardar PDF',
        'damage': 'Daño registrado', 'pokemon': 'Pokémon', 'trainer': 'Entrenador', 'kos': 'K. O.',
        'moves': 'Usos de movimientos', 'mvp': 'MVP por daño registrado', 'no_mvp': 'Sin MVP: no hay daño positivo atribuible en el resumen guardado.',
        'rule': 'MVP: mayor daño registrado; los K. O. desempatan. Si persiste el empate, se muestran todos.',
        'classic': 'Daño: porcentaje acumulado de barras de PS rivales, según el resumen del motor calculado del registro omnisciente. Puede superar el 100 % tras curaciones o varios rivales. La atribución es la del resumen guardado, no una nueva simulación.',
        'realtime': 'Daño: PS infligidos guardados en el resumen del motor. No equivale al porcentaje de barras usado en los combates por turnos. No se mezclan las dos unidades.',
        'partial': 'Registro incompleto o sin final reconocible. Las cifras son las conservadas en el resumen; no se afirma que cubran todo el combate.',
        'complete': 'El registro conserva el inicio y el final del combate.',
        'empty': 'Este combate no conserva un resumen individual. No se han inventado cifras.',
        'source': 'Fuentes y método', 'log': 'Registro original', 'missing_log': 'No hay registro guardado.',
        'source_help': 'Cifras: resumen individual que el motor guardó al terminar. El registro original se reproduce sin traducir ni modificar. Los nombres se conservan como se guardaron. «—» indica un dato ausente.',
        'turns': 'Turnos guardados', 'seconds': 'Duración guardada (s)', 'format': 'Formato', 'date': 'Fecha guardada',
    },
    'en': {
        'title': 'Battle newspaper', 'wins': '{name} wins the battle', 'tie': 'The battle ends in a draw',
        'unknown_result': 'Finished battle: result unavailable', 'print': 'Print / save PDF',
        'damage': 'Recorded damage', 'pokemon': 'Pokémon', 'trainer': 'Trainer', 'kos': 'KOs',
        'moves': 'Move uses', 'mvp': 'MVP by recorded damage', 'no_mvp': 'No MVP: the saved summary has no attributable positive damage.',
        'rule': 'MVP: highest recorded damage, with KOs breaking ties. Remaining ties show every joint MVP.',
        'classic': 'Damage: cumulative percentage of opposing HP bars, from the engine summary calculated from the omniscient log. It can exceed 100% after healing or multiple opponents. Attribution follows the saved summary, without another simulation.',
        'realtime': 'Damage: HP dealt, saved in the engine summary. This differs from the HP-bar percentage used for turn-based battles. The two units are never combined.',
        'partial': 'Incomplete log or no recognized ending. Figures are those retained in the summary; complete battle coverage is not claimed.',
        'complete': 'The log retains the battle opening and ending.',
        'empty': 'This battle has no saved individual summary. No figures have been invented.',
        'source': 'Sources and method', 'log': 'Original log', 'missing_log': 'No saved log.',
        'source_help': 'Figures: the individual summary saved by the engine at the end. The original log is reproduced without translation or changes. Names remain as saved. “—” means a missing value.',
        'turns': 'Saved turns', 'seconds': 'Saved duration (s)', 'format': 'Format', 'date': 'Saved date',
    },
}


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def compute(battle):
    if battle.get('status') != 'ended':
        raise SilverError('conflict', 'The newspaper needs a finished battle.')
    realtime = battle.get('mode') == 'realtime'
    summary = battle.get('summary') or {}
    lines = str(battle.get('log_text') or '').splitlines()
    names = {side: str((battle.get(side) or {}).get('name') or (summary.get('sides', {}).get(side) or {}).get('name') or side) for side in ('p1', 'p2')}
    if realtime:
        opening = any(line.startswith('|rt|') for line in lines)
        ending = any(line.startswith('[') and ('] Tie (' in line or any('] ' + name + ' won (' in line for name in names.values())) and line.endswith(')') for line in lines)
    else:
        opening = any(line == '|start' or line.startswith('|start|') for line in lines)
        ending = any(line == '|tie' or line.startswith(('|win|', '|tie|')) for line in lines)
    rows = []
    for side in ('p1', 'p2'):
        for index, mon in enumerate((summary.get('sides', {}).get(side) or {}).get('pokemon') or []):
            damage = _number(mon.get('dealt' if realtime else 'damage'))
            rows.append({'side': side, 'index': index, 'trainer': names[side], 'name': str(mon.get('name') or mon.get('species') or '—'),
                         'species': str(mon.get('species') or ''), 'damage': round(damage * (1 if realtime else 100), 2) if damage is not None else None,
                         'kos': _number(mon.get('kos')), 'moves': _number(mon.get('moves'))})
    eligible = [row for row in rows if row['damage'] is not None and row['damage'] > 0]
    best = max(((row['damage'], row['kos'] or 0) for row in eligible), default=None)
    mvps = [row for row in eligible if (row['damage'], row['kos'] or 0) == best]
    date = battle.get('ended_at') or battle.get('updated_at') or battle.get('created_at') or ''
    if isinstance(date, (int, float)):
        date = datetime.fromtimestamp(date, timezone.utc).isoformat(timespec='seconds')
    tied = any(line == '|tie' or line.startswith('|tie|') for line in lines) if not realtime else any('] Tie (' in line and line.endswith(')') for line in lines)
    return {'id': battle['id'], 'mode': 'realtime' if realtime else 'classic', 'format': battle.get('format') or '',
            'date': date, 'names': names, 'tied': tied,
            'winner_side': battle.get('winner_side') or '', 'winner_name': battle.get('winner_name') or '',
            'turns': _number(battle.get('turns')), 'seconds': _number(summary.get('seconds')),
            'rows': rows, 'mvps': mvps, 'unit': 'HP' if realtime else '% HP bars', 'log_complete': opening and ending,
            'log_sha256': hashlib.sha256(str(battle.get('log_text') or '').encode('utf-8')).hexdigest(), 'log_lines': len(lines)}


def render(battle, report, lang='en'):
    s = TEXT[lang]
    e = lambda value: escape(str(value), quote=True)
    winner = report['winner_side']
    headline = s['wins'].format(name=report['names'][winner]) if winner in report['names'] else s['tie'] if report['tied'] else s['unknown_result']
    fmt = lambda value: '—' if value is None else f'{value:g}'
    unit = 'PS' if lang == 'es' and report['mode'] == 'realtime' else 'HP' if report['mode'] == 'realtime' else '%'
    rows = ''.join(f"<tr><th scope='row'>{e(row['name'])}<small>{e(row['species']) if row['species'] != row['name'] else ''}</small></th><td>{e(row['trainer'])}</td><td>{fmt(row['damage'])}{' '+unit if row['damage'] is not None else ''}</td><td>{fmt(row['kos'])}</td><td>{fmt(row['moves'])}</td></tr>" for row in report['rows'])
    mvps = ' · '.join(e(row['name']) + ' (' + e(row['trainer']) + ')' for row in report['mvps'])
    table = f"<div class='table-wrap'><table><caption>{e(s['damage'])}</caption><thead><tr>{''.join('<th scope=col>'+e(s[key])+'</th>' for key in ('pokemon','trainer','damage','kos','moves'))}</tr></thead><tbody>{rows}</tbody></table></div>" if rows else f"<p>{e(s['empty'])}</p>"
    log = str(battle.get('log_text') or '')
    return f"""<!doctype html><html lang='{lang}'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>{e(s['title'])} · {e(report['id'])}</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f9f6f1;color:#241b1c;font:16px/1.55 'Source Sans 3',Segoe UI,sans-serif}}main{{max-width:960px;margin:auto;padding:40px 24px}}header{{border-bottom:2px solid #433536;padding-bottom:24px}}h1,h2{{font-family:Cinzel,Georgia,serif;line-height:1.15;overflow-wrap:anywhere}}h1{{font-size:clamp(30px,5vw,52px);margin:12px 0 20px}}h2{{font-size:23px;margin-top:32px}}p{{max-width:75ch}}.masthead{{font:700 22px Georgia,serif}}.meta,small{{color:#58494b}}small{{display:block;font-size:13px}}button{{border:1px solid #433536;border-radius:6px;padding:10px 16px;background:#b62436;color:#fff;font:inherit;font-weight:600;cursor:pointer}}button:focus-visible{{outline:3px solid #241b1c;outline-offset:3px}}.actions{{margin-bottom:28px}}.table-wrap{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}}caption{{text-align:left;font-weight:700;margin-bottom:10px}}th,td{{border-bottom:1px solid #b4a7a6;padding:10px 8px;text-align:left;overflow-wrap:anywhere}}th{{font-weight:650}}td:nth-child(n+3){{text-align:right;white-space:nowrap}}thead{{background:#ece4e0}}code,pre{{font:12px/1.5 Consolas,monospace;overflow-wrap:anywhere;white-space:pre-wrap;word-break:break-word}}.notice{{font-weight:600}}details{{margin-top:24px}}summary{{cursor:pointer;font-weight:650}}::selection{{background:#e2404f;color:#fff}}
@page{{size:A4;margin:15mm}}@media(max-width:520px){{main{{padding:24px 16px}}table{{font-size:13px;min-width:520px}}th,td{{padding:8px 6px}}th:first-child{{min-width:90px}}}}@media print{{body{{background:white;color:#111;font-size:10pt}}main{{max-width:none;padding:0}}.actions{{display:none}}h1{{font-size:28pt}}h2{{break-after:avoid}}thead{{display:table-header-group}}tr{{break-inside:avoid}}.table-wrap{{overflow:visible}}table{{table-layout:fixed;min-width:0}}td:nth-child(n+3){{white-space:normal}}details{{display:block}}details>pre{{display:block!important}}pre{{font-size:8pt}}header{{break-inside:avoid}}}}
</style></head><body><main><div class='actions'><button onclick='document.querySelector("details").open=true;window.print()'>{e(s['print'])}</button></div>
<header><div class='masthead'>Silver's Hoard · {e(s['title'])}</div><h1>{e(headline)}</h1><p class='meta'>{e(s['format'])}: {e(report['format'])} · {e(s['date'])}: {e(report['date'] or '—')}<br>{e(report['id'])} · {e(s['turns'])}: {fmt(report['turns'])}{(' · '+e(s['seconds'])+': '+fmt(report['seconds'])) if report['seconds'] is not None else ''}</p></header>
<section><h2>{e(s['mvp'])}</h2><p><strong>{mvps or e(s['no_mvp'])}</strong></p><p>{e(s['rule'])}</p></section>
<section>{table}<p>{e(s[report['mode']])}</p><p class='notice'>{e(s['complete'] if report['log_complete'] else s['partial'])}</p></section>
<section><h2>{e(s['source'])}</h2><p>{e(s['source_help'])}</p><p>SHA-256: <code>{report['log_sha256']}</code> · {report['log_lines']}</p><details><summary>{e(s['log'])}</summary><pre>{e(log or s['missing_log'])}</pre></details></section>
</main></body></html>"""


def export(services, id_, lang='en'):
    battle = services.store.battle(id_)
    report = compute(battle)
    html = render(battle, report, lang)
    digest = hashlib.sha256(html.encode('utf-8')).hexdigest()
    filename = f'battle-newspaper-{digest[:24]}.html'
    services.config.exports_dir.mkdir(parents=True, exist_ok=True)
    (services.config.exports_dir / filename).write_text(html, encoding='utf-8', newline='\n')
    return {'file': filename, 'url': f'/api/exports/{filename}', 'bytes': len(html.encode('utf-8')), 'report': report}
