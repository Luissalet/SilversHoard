# Battle frame formats

The battle, real-time and mass-battle screens offer **Horizontal · 16:9** and
**Vertical · 9:16** presentation. Switching presentation keeps the mounted
player, its current tick and controls. The original horizontal presentation is
the default. The export dialog has its own explicit format, speed and size
selection, and **Preview frame** opens the same page used by the recorder.
Selecting vertical initially selects 1080p; 720p remains available.

| Size | Horizontal | Vertical |
| --- | --- | --- |
| 720p | 1280 × 720 | 720 × 1280 |
| 1080p | 1920 × 1080 | 1080 × 1920 |

`battle_video` and `mass_video` accept `aspect="landscape"` (default) or
`aspect="portrait"` through UI, REST and MCP. The existing recorder opens the
selected replay with the matching aspect query, sizes the actual browser
content area, captures sound and returns dimensions plus `aspect` in its result.
Repeated exports have independent filenames: both formats of the same saved
battle remain downloadable.

## Real-time orientation

The real-time renderer draws the unchanged world to a private canvas and turns
that picture a quarter-turn counterclockwise for portrait. The first side is
below the second. Trainers, Pokémon, HP bars and audience sprites receive the
opposite rotation around their ground anchors so they remain upright. Walking
and supplied overworld animation rows use the rotated facing vector. Available
trainer back poses are retained; static Pokémon fallbacks use a back sprite for
the lower side when available. Artwork without directional poses remains upright
static artwork. Intro panels, callouts and impact silhouettes render in screen
coordinates. The court, obstacles, projectiles and effects share one camera.

This changes no simulator coordinates, rules, seed, AI, damage or replay input.
Only new human keyboard/gamepad movement is converted from screen axes to world
axes before its normal input log is recorded. Saved replay inputs are consumed
unchanged in both formats. The first implementation does not rotate the separate
mass-battle world; it adapts its surrounding portrait composition.

Portrait export recomposes the classic field, trainer names, health cards and
log. Real-time HUDs occupy opposite corners of the complete rotated court,
leaving its centre clear; its height fits the remaining frame, including doubles.
The VS introduction owns that space while it plays. Intro/result text and art stay upright.
Margins above and below the content leave room for social video overlays;
platform overlay positions can vary. Live controls and replay controls remain
available in ordinary battle views; the recording page retains its existing
control-free presentation.

Verification must include actual media dimensions, frames and audio, an export
of the same replay in both formats, classic doubles, live portrait input and a
saved real-time forfeit. The renderer regression compares each simulator field,
events, final summary and subsequent seeded random values while changing formats.
