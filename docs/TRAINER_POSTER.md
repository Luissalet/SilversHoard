# Trainer PNG posters

Open a trainer and choose **PNG poster**, then **Create PNG**. The completed job
shows a preview and a download. `trainer_poster {id, lang: "en" | "es"}` is the
same operation through REST and MCP; follow its job with `job_get`.

The PNG includes the current portrait, every saved team member (nickname, species,
level and shiny marker), and the trainer's earned badges. It uses the existing
badge renderer, including uploaded badge pictures, and the first frame of cached
Pokémon sprites. Missing pictures retain their names and produce a warning.
No moves, EVs, IVs, generation prompts or trainer notes are included.

The existing style-reference picker is available in the dialog. Selected
references influence the accent palette only: no artwork is generated and the
trainer, portrait, team and badges are unchanged. A job captures its trainer,
earned badges, reference selection and recorded artwork metadata when requested.
The picture and its `SilverPoster` PNG text metadata preserve the available
artwork categories, credits and origins. Unknown artists are stated explicitly;
an uploaded style reference currently has a library file identity, not an artist
record. Pokémon copyright and sprite-source attribution are included.

Rendering runs locally with the same Playwright and installed Chrome/Edge used
by battle videos; it does not need FFmpeg, a GPU or an image model. The image is
1080 pixels wide and grows vertically to include all members, badges and credits.
Each export has a job-specific filename, so repeated exports keep earlier PNGs.
This is a share image, not an importable trainer or team backup; use the existing
trainer export for those purposes.
