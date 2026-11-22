"""Check frozen background outputs with synthetic input pixels and history."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path

import pytest
from PIL import Image
from silvers_hoard.pmd_portraits import PmdPortraits

from portrait_fixtures import audit_directory, png_bytes

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'synthetic-reference'
# Captured from separately reviewed native40 proposal artifacts, never from the renderer.
PROTOTYPE_RGBA_SHA256 = {'Crying': '7a3b65eb453646a9e801c2a32a90800adcc334ce4f41bf4df89ade61dde7cd29', 'Shouting': '54e184628a3be8c024e28598cf2257c5e389fdf918e17216ef802689d5909266', 'Determined': '3efcd1c8fd06f182ed0fa491f49508b56798fe53610f8211cfbef5e3172cff9a', 'Inspired': '8915797b8c55db50173e18bba88fedd4ec0941280a266d4c646c2cc4e74f349f', 'Dizzy': '6090974a231cb33e1628b4b0fffc708263c0a7434bff5dd00d5e954cf04c6de0'}
# Literal eleven artifacts before field-role repair; protects mode/encoding as well as pixels.
KEEPER_PNG_SHA256 = {'Normal': 'a15425fbcf812b88946bc4cf5a7cfed5a26aa0c75f7f1d55a5c6f2fd504081f1', 'Happy': 'b6c845848c26efc9e6a270b517f0e6e0af4bc574a795237babdb225e517c9990', 'Pain': '7636ae12a0123f50dd17562ad7687361a9ddec03e59fd2202f94b1d8226987b8', 'Angry': 'ee7471a5df34b4d26fea43aa5c7442fea45a20e5780286db434462da3886ff92', 'Worried': '2062a039d57ec80c22e5f6eecfa6b1b01310766f944b95e946033b524189450c', 'Sad': '2062a039d57ec80c22e5f6eecfa6b1b01310766f944b95e946033b524189450c', 'Teary-Eyed': 'f43cd641f54120b4854d4b92c3c8d0847de28c42d35f8425609b5914c7f1dd9b', 'Joyous': '2fd8ed22dc16eec8666a30c10e36f6c7e38a47a712a57b455e8d32b2a7bbc875', 'Surprised': '162fe0681293b829ed86f6a976273e190192e51b6dd3aafdfe83dcf11c473133', 'Sigh': '69ba8f8cea834f171b2493fcf6a6d7ca6cd395a8a72074f7ace4a64fa4e70146', 'Stunned': '200528d4c8a9ffa265afdb52bb8cd67ff6dc27e44da6ad499995c99fad87b711'}
# Only the independently recorded exterior pixels from the reference art are
# needed by the builder. Everything else in these images is a synthetic fill.
OBSERVATIONS = {
    'Crying': {(39, 0): (111, 127, 183), (39, 39): (159, 215, 239)},
    'Shouting': {(39, 0): (135, 199, 255), (39, 39): (135, 199, 255),
                 (39, 35): (191, 247, 199), (39, 2): (191, 223, 223)},
    'Determined': {(39, 0): (231, 143, 183), (39, 39): (247, 111, 143), (28, 0): (255, 167, 207)},
    'Inspired': {(39, 0): (255, 255, 175), (39, 39): (255, 223, 127)},
    'Dizzy': {(39, 0): (151, 207, 207), (39, 20): (183, 215, 191), (39, 39): (151, 207, 207)},
}
OUTPUT_POINTS = {
    'Crying': [(39, 39)],
    'Determined': [(39, 39)],
    'Inspired': [(39, 39)],
    'Dizzy': [(39, 39)],
    'Shouting': [(39, 0), (39, 39), (39, 35)],
}


def load_builder():
    spec = importlib.util.spec_from_file_location('background_fields_builder', ROOT / 'scripts/build_portrait_backgrounds.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def active_path(output, emotion):
    manifest = json.loads((output / 'manifest.json').read_text('utf8'))
    return output / manifest['templates'][emotion]['file']


@pytest.fixture
def published(tmp_path):
    root = tmp_path / 'published'
    folder = root / '0001'
    folder.mkdir(parents=True)
    for emotion in KEEPER_PNG_SHA256.keys() | PROTOTYPE_RGBA_SHA256.keys():
        image = Image.new('RGBA', (40, 40), (15, 25, 35, 255))
        for xy, rgb in OBSERVATIONS.get(emotion, {}).items():
            image.putpixel(xy, (*rgb, 255))
        image.save(folder / f'{emotion}.png')
    return root


@pytest.fixture
def generated(tmp_path, published):
    builder = load_builder()
    output = tmp_path / 'backgrounds'
    builder.build(published, output, SOURCE)
    historical_pngs = {}
    legacy = {'version': 1, 'source': SOURCE, 'templates': {}}
    for emotion in KEEPER_PNG_SHA256.keys() | PROTOTYPE_RGBA_SHA256.keys():
        # Keepers are pinned separately by their original PNG hashes. An older
        # field needs only distinct bytes to exercise the history contract.
        if emotion in KEEPER_PNG_SHA256:
            raw = (output / f'{emotion}.png').read_bytes()
        else:
            raw = png_bytes(Image.new('RGB', (40, 40), (30, 20, 10)))
            active_path(output, emotion).unlink()
        historical_pngs[emotion] = raw
        (output / f'{emotion}.png').write_bytes(raw)
        published_raw = (published / '0001' / f'{emotion}.png').read_bytes()
        legacy['templates'][emotion] = {
            'file': f'{emotion}.png', 'sha256': hashlib.sha256(raw).hexdigest(),
            'references': [{'file': f'0001/{emotion}.png', 'sha256': hashlib.sha256(published_raw).hexdigest()}],
            'external_metadata': {'historical': True},
        }
    legacy_raw = json.dumps(legacy, indent=2).encode('utf8')
    (output / 'manifest.json').write_bytes(legacy_raw)
    builder.build(published, output, SOURCE)
    return builder, published, output, historical_pngs, legacy_raw


def test_preserves_recorded_exterior_points(generated):
    _, _, output, _, _ = generated
    for emotion, points in OUTPUT_POINTS.items():
        with Image.open(active_path(output, emotion)) as result:
            for xy in points:
                assert result.getpixel(xy) == (*OBSERVATIONS[emotion][xy], 255)


def test_real_published_exterior_points(tmp_path):
    root = audit_directory(
        "SILVER_TEST_PORTRAIT_ROOT", ("manifest.json",), "Published portrait exterior audit",
    )
    library = PmdPortraits(root)
    published = tmp_path / "published"
    folder = published / "0001"
    folder.mkdir(parents=True)
    for emotion in KEEPER_PNG_SHA256.keys() | PROTOTYPE_RGBA_SHA256.keys():
        name = library.resolve("Bulbasaur", [emotion])
        assert name is not None, emotion
        (folder / f"{emotion}.png").write_bytes(library.image_bytes(name))

    output = tmp_path / "backgrounds"
    load_builder().build(published, output, SOURCE)
    for emotion, points in OUTPUT_POINTS.items():
        with Image.open(folder / f"{emotion}.png") as original, Image.open(active_path(output, emotion)) as result:
            for xy in points:
                expected = (*OBSERVATIONS[emotion][xy], 255)
                assert original.convert("RGBA").getpixel(xy) == expected, (emotion, xy)
                assert result.convert("RGBA").getpixel(xy) == expected, (emotion, xy)


def test_full_native_fields_and_eleven_literal_keepers(generated):
    _, _, output, historical_pngs, _ = generated
    for emotion, expected in PROTOTYPE_RGBA_SHA256.items():
        path = active_path(output, emotion)
        assert path.name == f"{emotion}-v2-{hashlib.sha256(path.read_bytes()).hexdigest()[:12]}.png"
        with Image.open(active_path(output, emotion)) as image:
            assert image.size == (40,40) and image.mode == 'RGBA'
            assert image.getchannel('A').getextrema() == (255,255)
            assert hashlib.sha256(image.tobytes()).hexdigest() == expected
    for emotion, expected in KEEPER_PNG_SHA256.items():
        assert active_path(output, emotion).name == f'{emotion}.png'
        raw = active_path(output, emotion).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == expected
        assert raw == historical_pngs[emotion]
        with Image.open(io.BytesIO(raw)) as image:
            assert image.size == (40,40) and image.mode == 'RGB'
            assert image.convert('RGBA').getchannel('A').getextrema() == (255,255)


def test_role_metadata_and_complete_keeper_objects_survive_rebuild(generated):
    builder, published, output, _, _ = generated
    path = output / 'manifest.json'
    before = json.loads(path.read_text('utf8'))
    assert before['version'] == 2
    for emotion in PROTOTYPE_RGBA_SHA256:
        entry = before['templates'][emotion]
        assert entry['field_stops'] and entry['motif_colors']
        for sample in entry['positive_reference_samples']:
            raw = (published / sample['file']).read_bytes()
            assert hashlib.sha256(raw).hexdigest() == sample['sha256']
            assert Image.open(io.BytesIO(raw)).convert('RGB').getpixel(tuple(sample['xy'])) == tuple(sample['RGB'])
        assert entry['authorship']['new_licence_inferred'] is False
    for emotion in KEEPER_PNG_SHA256:
        before['templates'][emotion]['review_note'] = {'literal':'external keeper metadata', 'flags':[False,True]}
    path.write_text(json.dumps(before), encoding='utf8')
    builder.build(published, output, SOURCE)
    after = json.loads(path.read_text('utf8'))
    for emotion in KEEPER_PNG_SHA256:
        assert after['templates'][emotion] == before['templates'][emotion]


def test_changed_reference_fails_before_outputs(tmp_path, published):
    builder = load_builder()
    path = published / '0001' / 'Shouting.png'
    with Image.open(path) as original:
        image = original.copy()
    image.putpixel((39, 39), (191, 247, 199, 255))
    image.save(path)
    output = tmp_path / 'must-not-exist'
    with pytest.raises(ValueError, match='Published exterior sample changed'):
        builder.build(published, output, SOURCE)
    assert not output.exists()


def test_sixteen_historical_pngs_and_previous_manifest_remain_exact(generated):
    builder, published, output, historical_pngs, legacy_raw = generated
    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text('utf8'))
    assert len(manifest['previous_manifests']) == 1
    previous = manifest['previous_manifests'][0]
    assert previous['sha256'] == hashlib.sha256(legacy_raw).hexdigest()
    assert (output / previous['file']).read_bytes() == legacy_raw
    for emotion, raw in historical_pngs.items():
        assert (output / f'{emotion}.png').read_bytes() == raw
    first = manifest_path.read_bytes()
    builder.build(published, output, SOURCE)
    assert manifest_path.read_bytes() == first
    assert (output / previous['file']).read_bytes() == legacy_raw
    for emotion, raw in historical_pngs.items():
        assert (output / f'{emotion}.png').read_bytes() == raw


def test_existing_content_addressed_png_is_never_overwritten(generated):
    builder, published, output, historical_pngs, _ = generated
    target = active_path(output, 'Shouting')
    tampered = target.read_bytes() + b'deliberate test corruption'
    target.write_bytes(tampered)
    manifest_before = (output / 'manifest.json').read_bytes()
    with pytest.raises(ValueError, match='Existing background input changed'):
        builder.build(published, output, SOURCE)
    assert target.read_bytes() == tampered
    assert (output / 'manifest.json').read_bytes() == manifest_before
    for emotion, raw in historical_pngs.items():
        assert (output / f'{emotion}.png').read_bytes() == raw


def test_referenced_history_manifest_changed_fails_before_writes(generated):
    builder, published, output, _, _ = generated
    manifest = json.loads((output / 'manifest.json').read_text('utf8'))
    target = output / manifest['previous_manifests'][0]['file']
    target.write_bytes(target.read_bytes() + b'deliberate history corruption')
    before = {p.name:p.read_bytes() for p in output.iterdir()}
    with pytest.raises(ValueError, match='Existing background history changed'):
        builder.build(published, output, SOURCE)
    assert {p.name:p.read_bytes() for p in output.iterdir()} == before


def test_inactive_historical_png_changed_fails_before_writes(generated):
    builder, published, output, _, _ = generated
    assert active_path(output, 'Shouting').name != 'Shouting.png'
    target = output / 'Shouting.png'
    target.write_bytes(target.read_bytes() + b'deliberate inactive PNG corruption')
    before = {p.name:p.read_bytes() for p in output.iterdir()}
    with pytest.raises(ValueError, match='Existing background input changed'):
        builder.build(published, output, SOURCE)
    assert {p.name:p.read_bytes() for p in output.iterdir()} == before
