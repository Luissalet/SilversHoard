"""Output dimensions shared by the normal battle and mass-battle recorders."""
from .errors import SilverError


def video_dimensions(size: str = "720p", aspect: str = "landscape") -> tuple[int, int]:
    if size not in ("720p", "1080p"):
        raise SilverError("invalid", "size is one of 720p, 1080p")
    if aspect not in ("landscape", "portrait"):
        raise SilverError("invalid", "aspect is one of landscape, portrait")
    width, height = (1920, 1080) if size == "1080p" else (1280, 720)
    return (height, width) if aspect == "portrait" else (width, height)
