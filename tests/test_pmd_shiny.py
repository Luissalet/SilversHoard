import io
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from PIL import Image

from silvers_hoard.errors import SilverError
from silvers_hoard.pmd import PmdSprites
from silvers_hoard.pmd_shiny import PIXEL, palette_pair, recolor, reference_pair


def png(pixels, size=None):
    image = Image.new('RGBA', size or (len(pixels), 1))
    image.putdata(pixels)
    out = io.BytesIO()
    image.save(out, 'PNG')
    return out.getvalue()


BLUE = (20, 100, 200, 255)
PURPLE = (180, 80, 180, 255)
ORANGE = (200, 150, 40, 255)
CLEAR = (10, 20, 30, 0)
NORMAL = png([BLUE, ORANGE, CLEAR, (0, 0, 0, 255)])
SHINY = png([PURPLE, ORANGE, CLEAR, (0, 0, 0, 255)])
XML = b'<AnimData><ShadowSize>2</ShadowSize><Anims><Anim><Name>Idle</Name><FrameWidth>2</FrameWidth><FrameHeight>2</FrameHeight><Duration>7</Duration><Duration>11</Duration><HitFrame>1</HitFrame></Anim><Anim><Name>Walk</Name><CopyOf>Idle</CopyOf></Anim><Anim><Name>Attack</Name><CopyOf>Idle</CopyOf></Anim></Anims></AnimData>'


def fixture_pmd(tmp_path, *, native=False, references=True):
    calls = []
    sheet = png(([BLUE, ORANGE, CLEAR, (0, 0, 0, 255)] * 16), (4, 16))
    def http(url):
        calls.append(url)
        if url.endswith('/tracker.json'):
            body = json.dumps({'0248': {'subgroups': {'0001': {'name': 'Mega', 'sprite_files': {'Idle': False}}}}}).encode()
        elif url == 'https://pokeapi.co/api/v2/pokemon-species/248' and references:
            body = json.dumps({'name': 'tyranitar', 'varieties': [{'pokemon': {'name': 'tyranitar-mega', 'url': 'https://pokeapi.co/api/v2/pokemon/10049/'}}]}).encode()
        elif url == f'{PIXEL}/10049.png' and references:
            body = NORMAL
        elif url == f'{PIXEL}/shiny/10049.png' and references:
            body = SHINY
        elif '/sprite/0248/0001/0001/' in url:
            if not native:
                return 404, b'', 'text/plain'
            body = XML if url.endswith('.xml') else png([PURPLE, ORANGE, CLEAR, (0, 0, 0, 255)] * 16, (4, 16))
        elif '/sprite/0248/0001/' in url:
            body = XML if url.endswith('.xml') else sheet
        else:
            return 404, b'', 'text/plain'
        return 200, body, 'image/png'
    return PmdSprites(tmp_path, {'pmd_sprites': True, 'sprite_downloads': True, 'pmd_server': 'https://pmd.test'}, http), calls


def test_palette_transfer_preserves_alpha_outlines_accents_and_shading():
    palette = palette_pair(NORMAL, SHINY)
    source = png([BLUE, (10, 90, 190, 123), ORANGE, CLEAR, (0, 0, 0, 255)])
    output = Image.open(io.BytesIO(recolor(source, palette))).convert('RGBA')
    assert list(output.getdata()) == [PURPLE, (170, 70, 170, 123), ORANGE, CLEAR, (0, 0, 0, 255)]
    assert output.size == (5, 1)


def test_unaligned_reference_is_not_used_as_a_palette():
    assert not palette_pair(NORMAL, png([BLUE]))
    assert not palette_pair(NORMAL, png([CLEAR] * 4))


def test_missing_shiny_keeps_exact_form_all_animations_and_original_bytes(tmp_path):
    pmd, calls = fixture_pmd(tmp_path)
    original = pmd.meta(248, form='Mega')
    originals = {a: pmd.sheet(original['key'], a).read_bytes() for a in original['a']}
    shiny = pmd.meta(248, form='Mega', shiny=True)
    assert shiny['key'] == '0248-0001-0001-recolor1'
    assert shiny['a'] == original['a'] and shiny['s'] == original['s']
    assert shiny['source']['pmd'] == original['key'] and shiny['source']['palette']['form_exact']
    for animation, raw in originals.items():
        derived = Image.open(pmd.sheet(shiny['key'], animation)).convert('RGBA')
        source = Image.open(io.BytesIO(raw)).convert('RGBA')
        assert derived.size == source.size
        assert derived.getchannel('A').tobytes() == source.getchannel('A').tobytes()
        assert derived.getpixel((0, 0)) == PURPLE
        assert pmd.sheet(original['key'], animation).read_bytes() == raw
    assert calls.count('https://pokeapi.co/api/v2/pokemon-species/248') == 1


def test_native_shiny_is_preferred_and_never_recoloured(tmp_path):
    pmd, calls = fixture_pmd(tmp_path, native=True)
    shiny = pmd.meta(248, form='Mega', shiny=True)
    assert shiny['key'] == '0248-0001-0001'
    assert 'source' not in shiny
    assert not any('pokeapi.co' in url or url.startswith(PIXEL) for url in calls)


def test_cached_derived_is_reused_offline_and_native_can_replace_it(tmp_path):
    pmd, calls = fixture_pmd(tmp_path)
    first = pmd.meta(248, form='Mega', shiny=True)
    pmd.settings.update(pmd_sprites=False, sprite_downloads=False)
    calls.clear()
    assert pmd.meta(248, form='Mega', shiny=True) == first
    assert calls == []
    (tmp_path / '0248-0001-0001.404').unlink()
    online, _ = fixture_pmd(tmp_path, native=True)
    assert online.meta(248, form='Mega', shiny=True)['key'] == '0248-0001-0001'


def test_derivation_is_atomic_between_concurrent_requests(tmp_path):
    pmd, calls = fixture_pmd(tmp_path)
    with ThreadPoolExecutor(max_workers=3) as pool:
        result = list(pool.map(lambda _: pmd.meta(248, form='Mega', shiny=True), range(3)))
    assert result[0] == result[1] == result[2]
    assert calls.count(f'{PIXEL}/shiny/10049.png') == 1


def test_missing_reference_never_silently_returns_nonshiny_pmd(tmp_path):
    pmd, _ = fixture_pmd(tmp_path, references=False)
    with pytest.raises(SilverError):
        pmd.meta(248, form='Mega', shiny=True)
    assert not (tmp_path / '0248-0001-0001-recolor1/meta.json').exists()


def test_changed_original_regenerates_but_corrupt_cache_does_not_break_battle(tmp_path):
    pmd, _ = fixture_pmd(tmp_path)
    first = pmd.meta(248, form='Mega', shiny=True)
    path = pmd.sheet('0248-0001', 'Idle')
    path.write_bytes(png([ORANGE] * 64, (4, 16)))
    updated = pmd.meta(248, form='Mega', shiny=True)
    assert updated['source']['sha256'] != first['source']['sha256']
    assert Image.open(pmd.sheet(updated['key'], 'Idle')).getpixel((0, 0)) == ORANGE
    (tmp_path / updated['key'] / 'meta.json').write_text('{')
    assert pmd.meta(248, form='Mega', shiny=True) == updated


def test_cosmetic_form_uses_species_palette_without_changing_shape(tmp_path):
    def get(url):
        if url.endswith('pokemon-species/248'):
            return json.dumps({'name': 'tyranitar', 'varieties': []}).encode()
        return {f'{PIXEL}/248.png': NORMAL, f'{PIXEL}/shiny/248.png': SHINY}.get(url)
    pair = reference_pair(tmp_path, 248, 'Altcolor', get, True)
    assert pair and not pair[2]['form_exact']
    assert pair[2]['urls'][0].endswith('/248.png')


def test_sheet_key_validation_still_rejects_path_traversal(tmp_path):
    pmd, _ = fixture_pmd(tmp_path)
    for key in ['../../secret', '0248-recolor1/../0248', '0248-0001-recolor2']:
        with pytest.raises(SilverError):
            pmd.sheet(key, 'Idle')


@pytest.mark.parametrize('damaged', [b'broken PNG', png([CLEAR] * 4)])
def test_invalid_cached_palette_recovers_online_or_falls_back_offline(tmp_path, damaged):
    pmd, _ = fixture_pmd(tmp_path)
    first = pmd.meta(248, form='Mega', shiny=True)
    (tmp_path / first['key'] / 'meta.json').unlink()
    path = tmp_path / 'shiny-reference/0248-mega/shiny.png'
    path.write_bytes(damaged)
    assert pmd.meta(248, form='Mega', shiny=True)['key'] == first['key']
    assert path.read_bytes() == SHINY
    (tmp_path / first['key'] / 'meta.json').unlink()
    path.write_bytes(damaged)
    pmd.settings.update(pmd_sprites=False, sprite_downloads=False)
    with pytest.raises(SilverError):
        pmd.meta(248, form='Mega', shiny=True)


def test_corrupt_original_sheet_uses_typed_fallback(tmp_path):
    pmd, _ = fixture_pmd(tmp_path)
    first = pmd.meta(248, form='Mega', shiny=True)
    pmd.sheet(first['source']['pmd'], 'Idle').write_bytes(b'broken PNG')
    with pytest.raises(SilverError):
        pmd.meta(248, form='Mega', shiny=True)
