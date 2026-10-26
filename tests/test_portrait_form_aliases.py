import copy
import importlib.util
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
