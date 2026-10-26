import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location(
    "portrait_alias_builder", Path(__file__).parents[1] / "scripts/build_pmd_portraits.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


@pytest.mark.parametrize("form,label,num", [
    ("Original", "Original Cap", 25),
    ("Hoenn", "Hoenn Cap", 25),
    ("Sinnoh", "Sinnoh Cap", 25),
    ("Unova", "Unova Cap", 25),
    ("Kalos", "Kalos Cap", 25),
    ("Alola", "Alola Cap", 25),
    ("Partner", "Partner Cap", 25),
    ("World", "World Cap", 25),
    ("Three-Segment", "Three", 982),
])
def test_exact_named_portrait_alias_resolves_both_variants_without_changing_roster(form, label, num):
    base = "Pikachu" if num == 25 else "Dudunsparce"
    mon = {"id": (base + form).lower().replace("-", ""), "num": num, "base": base, "form": form}
    shiny = {"name": "Shiny", "portrait_files": {"Normal": True},
             "portrait_credit": {"primary": "shiny artist"}}
    group = {"name": label, "portrait_files": {"Normal": True},
             "portrait_credit": {"primary": "normal artist"}, "subgroups": {"0001": shiny}}
    tracker = {f"{num:04}": {"name": base, "subgroups": {"0017": group}}}
    before = copy.deepcopy(tracker)
    plan = builder.portrait_inventory([mon], tracker)
    row = plan["entries"][0]
    assert row["folder"] == f"{num:04}/0017"
    assert row["shiny_folder"] == f"{num:04}/0017/0001"
    assert row["id"] == mon["id"] and row["form"] == form
    assert plan["folders"][row["folder"]]["credit"] == {"primary": "normal artist"}
    assert plan["folders"][row["shiny_folder"]]["credit"] == {"primary": "shiny artist"}
    assert tracker == before and mon["form"] == form


def test_alias_does_not_substitute_a_different_cap_or_plain_species():
    roster = [{"id": "pikachuoriginal", "num": 25, "base": "Pikachu", "form": "Original"}]
    tracker = {"0025": {"name": "Pikachu", "portrait_files": {"Normal": True},
                        "subgroups": {"0001": {"name": "Hoenn Cap", "portrait_files": {"Normal": True}}}}}
    row = builder.portrait_inventory(roster, tracker)["entries"][0]
    assert row["folder"] is None and row["shiny_folder"] is None


def test_meowstic_mega_keeps_both_roster_genders_and_existing_shared_exterior():
    roster = [{"id": "meowsticmmega", "num": 678, "base": "Meowstic", "form": "M-Mega"},
              {"id": "meowsticfmega", "num": 678, "base": "Meowstic", "form": "F-Mega"}]
    tracker = {"0678": {"name": "Meowstic", "subgroups": {"0001": {
        "name": "Mega", "portrait_files": {"Normal": False}, "subgroups": {
            "0001": {"name": "Shiny", "portrait_files": {"Normal": False}}}}}}}
    male, female = builder.portrait_inventory(roster, tracker)["entries"]
    assert (male["folder"], male["shiny_folder"]) == ("0678/0001", "0678/0001/0001")
    assert (male["id"], male["form"]) == ("meowsticmmega", "M-Mega")
    assert (female["id"], female["form"]) == ("meowsticfmega", "F-Mega")
    assert female["folder"] is None and female["shiny_folder"] is None
    assert female["equivalent"] == "meowsticmmega" and female["display_scale"] == 1


def test_ice_rider_uses_its_own_portrait_and_does_not_invent_shiny_or_shadow():
    roster = [{"id": "calyrexice", "num": 898, "base": "Calyrex", "form": "Ice"},
              {"id": "calyrexshadow", "num": 898, "base": "Calyrex", "form": "Shadow"}]
    tracker = {"0898": {"name": "Calyrex", "portrait_files": {"Normal": True},
                        "subgroups": {"0001": {"name": "Ice_Rider", "portrait_files": {"Normal": True}}}}}
    ice, shadow = builder.portrait_inventory(roster, tracker)["entries"]
    assert ice["folder"] == "0898/0001" and ice["shiny_folder"] is None
    assert ice["form"] == "Ice" and "equivalent" not in ice
    assert shadow["folder"] is None and shadow["shiny_folder"] is None


def flower_frames(tmp_path):
    from PIL import Image

    stage = tmp_path / "stage"
    plan = {"source": "reviewed-test-pin", "entries": [], "folders": {},
            "visible_frame_equivalences": []}
    expected = {}
    for number, species in enumerate(("flabebe", "floette")):
        row = {"id": species, "folder": species, "shiny_folder": species + "/shiny"}
        plan["entries"].append(row)
        group = {"kind": "visible-frame-equivalence", "species": species,
                 "source_pin": "reviewed-test-pin", "targets": [], "source_sha256": {}}
        for shiny in (0, 1):
            folder = row["shiny_folder" if shiny else "folder"]
            plan["folders"][folder] = {"emotions": builder.EMOTIONS,
                                        "credit": {"primary": folder + " artist"},
                                        "artists": [folder + " artist"]}
            directory = stage / "published" / folder
            directory.mkdir(parents=True)
            hashes = {}
            for index, emotion in enumerate(builder.EMOTIONS):
                image = Image.new("RGBA", (40, 40), (40 + number * 70, 60 + shiny * 80, index * 10, 255))
                data = io.BytesIO(); image.save(data, format="PNG")
                raw = data.getvalue()
                (directory / (emotion + ".png")).write_bytes(raw)
                hashes[emotion] = hashlib.sha256(raw).hexdigest()
            group["source_sha256"][str(shiny)] = hashes
            expected[f"{species}|{shiny}"] = hashes
        for color in ("blue", "orange", "white", "yellow"):
            target = species + color
            group["targets"].append(target)
            plan["entries"].append({"id": target, "folder": None, "shiny_folder": None})
        plan["visible_frame_equivalences"].append(group)
    for target in ("florgesblue", "floetteeternal", "floettemega", "flabebepink"):
        plan["entries"].append({"id": target, "folder": None, "shiny_folder": None})
    return plan, stage, expected


def test_reviewed_flower_frames_fill_all_sixteen_forms_and_keep_source_credits(tmp_path):
    plan, stage, expected = flower_frames(tmp_path)
    output = tmp_path / "output"
    builder.compile_library(plan, stage, output, allow_missing=True)
    manifest = json.loads((output / "manifest.json").read_text("utf8"))
    for group in plan["visible_frame_equivalences"]:
        for target in group["targets"]:
            for shiny in (0, 1):
                key = f"{target}|{shiny}"
                assert manifest["entries"][key] == {
                    emotion: f"portraits/{sha}.png"
                    for emotion, sha in expected[f"{group['species']}|{shiny}"].items()}
                for emotion, file in manifest["entries"][key].items():
                    provenance = manifest["sources"][key + ":" + emotion]
                    folder = group["species"] + ("/shiny" if shiny else "")
                    assert provenance["kind"] == "visible-frame-equivalence"
                    assert provenance["species"] == group["species"]
                    assert provenance["source_sha256"] == manifest["files"][file]["sha256"]
                    assert provenance["folder"] == folder
                    assert provenance["credit"] == plan["folders"][folder]["credit"]
                    assert provenance["artists"] == plan["folders"][folder]["artists"]
    for target in ("florgesblue", "floetteeternal", "floettemega", "flabebepink"):
        assert manifest["entries"][target + "|0"] == manifest["entries"][target + "|1"] == {}
    assert len(manifest["files"]) == 64  # No duplicate or newly drawn PNGs.


def test_changed_flower_frame_does_not_inherit_old_visual_approval(tmp_path):
    plan, stage, _ = flower_frames(tmp_path)
    path = stage / "published/flabebe/Normal.png"
    from PIL import Image
    Image.new("RGBA", (40, 40), (255, 0, 0, 255)).save(path)
    output = tmp_path / "output"
    builder.compile_library(plan, stage, output, allow_missing=True)
    manifest = json.loads((output / "manifest.json").read_text("utf8"))
    assert "Normal" not in manifest["entries"]["flabebeblue|0"]
    assert "Normal" in manifest["entries"]["flabebeblue|1"]
    assert "Happy" in manifest["entries"]["flabebeblue|0"]


def test_a_forms_own_published_frame_wins_over_visible_equivalence(tmp_path):
    plan, stage, _ = flower_frames(tmp_path)
    own = stage / "published/flabebe-blue-own"
    own.mkdir()
    from PIL import Image
    Image.new("RGBA", (40, 40), (1, 2, 3, 255)).save(own / "Normal.png")
    next(row for row in plan["entries"] if row["id"] == "flabebeblue")["folder"] = "flabebe-blue-own"
    plan["folders"]["flabebe-blue-own"] = {"emotions": ["Normal"], "credit": {"primary": "own artist"}}
    output = tmp_path / "output"
    builder.compile_library(plan, stage, output, allow_missing=True)
    manifest = json.loads((output / "manifest.json").read_text("utf8"))
    sha = hashlib.sha256((own / "Normal.png").read_bytes()).hexdigest()
    assert manifest["entries"]["flabebeblue|0"]["Normal"] == f"portraits/{sha}.png"
    assert "flabebeblue|0:Normal" not in manifest["sources"]
    assert "Happy" in manifest["entries"]["flabebeblue|0"]
