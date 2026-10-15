"""A saved mass battle in the existing single-file browser player."""
from .hoard_link.ids import new_id
from .sharing import playable_page


def export_page(services, id_):
    battle = services.mass.get(id_)
    template = services.config.engine_dir.parent / "silvers_hoard" / "static" / "play" / "play.html"
    data = {"kind": "mass", "schema": 1, "battle": battle,
            "sprite_server": services.settings.get("sprite_server"),
            "sprite_set": services.settings.get("sprite_set", "gen5ani")}
    html = playable_page(template, data)
    filename = f"{new_id('mass-page')}.html"
    path = services.config.exports_dir / filename
    content = html.encode("utf-8")
    path.write_bytes(content)
    return {"file": filename, "url": f"/api/exports/{filename}", "bytes": len(content),
            "battle_id": id_, "hash": battle["hash"]}
