"""Music handlers shared by the app, REST and MCP catalogue."""

import base64
import binascii

from pydantic import BaseModel, Field
from typing import Literal

from .errors import SilverError
from .hoard_link.agentkit import Empty, Tool, ann


class ImportArgs(BaseModel):
    path: str = Field("", description="Local .mp3 path, or provide filename and base64 instead.")
    filename: str = ""
    base64: str = ""
    title: str = Field("", max_length=300)


class TrackArgs(BaseModel):
    id: str
    title: str | None = Field(None, max_length=300)
    archived: bool | None = None


class PlaylistArgs(BaseModel):
    id: str = ""
    name: str = Field(..., min_length=1, max_length=300)
    tracks: list[str] = Field(default_factory=list, description="Ordered track IDs; duplicates are allowed.")


class PlaylistId(BaseModel):
    id: str


class QueueArgs(BaseModel):
    tracks: list[str]
    index: int = Field(0, ge=0)
    repeat: Literal["off", "all", "one"] = "off"
    shuffle: bool = False


def import_track(s, a):
    if a.path:
        return s.sounds.library.import_file(a.path, a.title)
    try:
        body = base64.b64decode(a.base64, validate=True)
    except (ValueError, binascii.Error):
        raise SilverError("invalid", "Invalid base64 MP3 content.") from None
    return s.sounds.library.import_bytes(a.filename, body, a.title)


TOOLS = [
    Tool("music_library", "Personal music, saved playlists and the queue. Música, canciones, listas y cola.", Empty, ann(read_only=True), lambda s, a: s.sounds.library.snapshot(), capped=False),
    Tool("music_import", "Import a personal MP3 from a local path or uploaded bytes. Añadir canción MP3.", ImportArgs, ann(), import_track),
    Tool("music_track_update", "Rename, archive or restore a personal song. Renombrar, quitar o restaurar canción.", TrackArgs, ann(), lambda s, a: s.sounds.library.update_track(a.id, a.title, a.archived), capped=False),
    Tool("music_playlist_save", "Create or replace an ordered playlist. Crear o editar playlist de canciones.", PlaylistArgs, ann(), lambda s, a: s.sounds.library.save_playlist(a.name, a.tracks, a.id)),
    Tool("music_playlist_delete", "Delete a playlist while keeping its songs. Borrar lista sin borrar canciones.", PlaylistId, ann(), lambda s, a: s.sounds.library.delete_playlist(a.id)),
    Tool("music_queue_set", "Save the listening queue, position, repeat and shuffle. Cola, orden y repetición.", QueueArgs, ann(), lambda s, a: s.sounds.library.set_queue(**a.model_dump()), capped=False),
]
