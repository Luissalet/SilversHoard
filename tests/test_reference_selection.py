from conftest import PNG_1PX


def test_style_selection_overrides_first_three_and_empty_stays_empty(services, call):
    info = services.avatar_style_set(add=[(f"style-{i}.png", PNG_1PX) for i in range(4)])
    files = [im["file"] for im in info["images"]]
    selected = [files[3], files[1]]
    result = call("avatar_style_set", {"selected": selected})
    assert result["used"] == selected
    assert call("avatar_style_get")["used"] == selected
    assert len(services.style_reference_paths(own_only=True)) == 1
    call("avatar_style_set", {"selected": []})
    assert services.style_reference_paths(own_only=True) == []
    assert services.style_reference_paths() == []
    call("avatar_style_set", {"selected": ["missing.png"]}, status=400)
    call("avatar_style_set", {"selected": [files[0], files[0]]}, status=400)
    assert call("avatar_style_get")["used"] == []


def test_removed_selected_reference_does_not_select_another_silently(services, call):
    info = services.avatar_style_set(add=[("style-a.png", PNG_1PX), ("style-b.png", PNG_1PX)])
    file = info["images"][0]["file"]
    call("avatar_style_set", {"selected": [file]})
    call("avatar_style_set", {"remove": [file]})
    assert call("avatar_style_get")["used"] == []
