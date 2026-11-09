import hashlib
import importlib.util
import io
import json
from pathlib import Path

import pytest
from PIL import Image

from silvers_hoard.pmd_portraits import PmdPortraits

spec = importlib.util.spec_from_file_location('portrait_pixels_builder', Path(__file__).parents[1] / 'scripts/build_pmd_portraits.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def fixture(tmp_path, reviewed=True, mirror=False):
    stage, output = tmp_path / 'stage', tmp_path / 'installed'
    folder = stage / 'published/1015';folder.mkdir(parents=True)
    image = Image.new('RGBA', (40, 40), (70, 160, 180, 255))
    image.putpixel((6, 27), (154, 133, 35, 255))
    image.putpixel((20, 22), (154, 133, 35, 255))  # Same eye pigment must remain.
    buffer = io.BytesIO();image.save(buffer, format='PNG');raw = buffer.getvalue()
    published = folder / 'Normal.png';published.write_bytes(raw)
    sha = hashlib.sha256(raw).hexdigest()
    happy = folder / 'Happy.png';happy.write_bytes(raw)
    (stage / 'published-receipts.json').write_text(json.dumps({f'1015/{e}.png': {'sha256': sha} for e in ('Normal', 'Happy')}))
    plan = {'source': 'https://example.invalid/pinned', 'entries': [
        {'id': 'munkidori', 'folder': '1015'}, {'id': 'anotherform', 'folder': '1015'}],
        'folders': {'1015': {'emotions': ['Normal', 'Happy'], 'credit': {'primary': 'Artist'}, 'artists': ['Artist']}}}
    atlas = tmp_path / 'atlas.png';atlas.write_bytes(raw)
    pixel = {'pixel': [6, 27], 'before': [154, 133, 35, 255], 'rgba': [180, 220, 200, 255]}
    record = {'file': atlas.name, 'sha256': sha, 'reviewed': reviewed, 'grid': [1, 1], 'trim': 0, 'cells': {},
              'published_pixel_patches': {'Normal': {'source_sha256': sha, 'pixels': [pixel]}}}
    if mirror:record['published_flips'] = {'Normal': sha}
    registry = tmp_path / 'registry.json';registry.write_text(json.dumps({'munkidori|0': record}))
    return plan, stage, output, registry, published, image, raw


@pytest.mark.parametrize('reviewed', [True, False])
@pytest.mark.parametrize('mirror', [True, False])
def test_only_reviewed_listed_pixels_change_and_rebuild_uses_retained_original(tmp_path, reviewed, mirror):
    plan, stage, output, registry, published, image, raw = fixture(tmp_path, reviewed, mirror)
    builder.compile_library(plan, stage, output, registry, allow_missing=True)
    library = PmdPortraits(output)
    expected = image.copy()
    if reviewed:
        expected.putpixel((6, 27), (180, 220, 200, 255))
        if mirror:expected = expected.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    result = library.image_bytes(library.resolve('munkidori', ['Normal']))
    assert Image.open(io.BytesIO(result)).convert('RGBA').tobytes() == expected.tobytes()
    assert library.image_bytes(library.resolve('anotherform', ['Normal'])) == raw
    assert library.image_bytes(library.resolve('munkidori', ['Happy'])) == raw
    assert library.image_bytes(f'portraits/{hashlib.sha256(raw).hexdigest()}.png') == raw
    assert published.read_bytes() == raw
    if reviewed:
        source = library.manifest['sources']['munkidori|0:Normal']
        assert source['operation'] == ('pixels+flip_x' if mirror else 'pixels')
        assert source['source_sha256'] == hashlib.sha256(raw).hexdigest()
        assert source['credit'] == {'primary': 'Artist'} and source['artists'] == ['Artist']
    published.unlink();(stage / 'published/1015/Happy.png').unlink()
    builder.compile_library(plan, stage, output, registry, allow_missing=True)
    assert PmdPortraits(output).image_bytes(PmdPortraits(output).resolve('munkidori', ['Normal'])) == result


@pytest.mark.parametrize('problem', ['source', 'pixel', 'negative_coordinate'])
def test_incorrect_source_or_pixel_cannot_replace_an_installed_library(tmp_path, problem):
    plan, stage, output, registry, _, _, _ = fixture(tmp_path)
    builder.compile_library(plan, stage, output, registry, allow_missing=True)
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    records = json.loads(registry.read_text());patch = records['munkidori|0']['published_pixel_patches']['Normal']
    if problem == 'source':patch['source_sha256'] = '0' * 64
    elif problem == 'pixel':patch['pixels'][0]['before'] = [0, 0, 0, 255]
    else:patch['pixels'][0]['pixel'] = [-1, 27]
    registry.write_text(json.dumps(records))
    with pytest.raises(ValueError, match={'source': 'pixel source changed', 'pixel': 'pixel state changed', 'negative_coordinate': 'outside the source'}[problem]):
        builder.compile_library(plan, stage, output, registry, allow_missing=True)
    assert {p.name: p.read_bytes() for p in output.iterdir()} == before
