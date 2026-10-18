"""Presentation-only battle mix, shared by UI, REST and MCP."""

from pydantic import BaseModel, Field


class AudioSettings(BaseModel):
    master: float = Field(0.8, ge=0, le=1, allow_inf_nan=False)
    music: float = Field(0.5, ge=0, le=1, allow_inf_nan=False)
    sfx: float = Field(0.8, ge=0, le=1, allow_inf_nan=False)
    cries: float = Field(0.8, ge=0, le=1, allow_inf_nan=False)
    mute: bool = False
    music_track: str = Field("auto", max_length=80, description="auto, none, a built-in track ID or a personal local-<sha256> ID.")


def validate_audio(sounds, audio: dict) -> dict:
    from .errors import SilverError
    from .music_library import BUILTIN_IDS, LOCAL_ID

    mix = AudioSettings.model_validate(audio).model_dump()
    track = mix["music_track"]
    if LOCAL_ID.fullmatch(track):
        sounds.library.path(track)  # A missing personal song must not silently become generic music.
    elif track not in BUILTIN_IDS | {"auto", "none"}:
        raise SilverError("invalid", "Unknown battle music track.")
    return mix
