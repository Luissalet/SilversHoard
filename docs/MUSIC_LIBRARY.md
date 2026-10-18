# Music library

Open **Music** in the sidebar. **Add MP3s** accepts several files; dropping files on the page imports the same batch. Originals are kept byte-for-byte under `data/music/`, with a content-derived ID. Importing identical audio again reuses its entry. Titles initially use filenames and can be renamed. Invalid MP3 content is rejected without changing the library.

The library includes personal songs and the existing Showdown/PokéRogue catalog. Remote songs retain their existing download/cache and credit behavior. Personal MP3s work without internet. Search filters the current library or playlist.

Create a named playlist, select it as the destination in the library, and add songs with **Add to playlist**. Playlists retain order and repeated songs. Open a playlist to rename it, move its songs up/down or remove an occurrence. Deleting a playlist keeps its songs. A queue can also be saved under a new playlist name.

**Play**, **Queue** and **Play list** build the listening queue. The dock remains mounted while navigating ordinary app pages; it has pause/resume, previous/next, seeking, volume, shuffle and repeat off/all/one. Queue reordering preserves the current occurrence and playback position. Queue, index and modes are saved on the local service; reloading restores them paused, from the beginning of the selected song. Playback requires an open browser tab. Shuffle chooses a different occurrence at each advance; it does not reorder the saved list. Volume follows the existing master/music/mute mixer. Starting battle music pauses library playback; pressing Play on the dock takes over from battle music.

**Use in battles** selects a song in the existing battle mixer. The mixer also exposes **Add MP3s** and **Music library**. On an ordinary battle page, the chosen song and channel levels are saved with that battle and applied again on playback and recording. Outside a battle, the mixer remains a browser preference. Portable HTML does not embed personal MP3s, queues or playlists.

Archiving a personal song retains its file and allows restoring it from **Archived**. Archiving removes that song from playlists and the queue; restoring it does not reconstruct those memberships. No battle database, saved replay or imported original is rewritten.

## Shared UI, REST and MCP operations

`POST /api/ui/call` and the agent/MCP catalog use the same handlers:

| Tool | Arguments |
| --- | --- |
| `music_library` | None; personal entries including archived songs, playlists and saved queue. |
| `music_import` | `path` to an MP3, or `filename` plus `base64`; optional `title`. |
| `music_track_update` | `id`, optional `title`, optional `archived`. |
| `music_playlist_save` | `name`, ordered `tracks`; optional existing `id` replaces that playlist. |
| `music_playlist_delete` | Playlist `id`; audio entries remain. |
| `music_queue_set` | `tracks`, `index`, `repeat` (`off`, `all`, `one`), `shuffle`. Persists the queue; a tool cannot force a closed browser to play. |

`POST /api/music/upload` transports one multipart `file` into the same importer. The UI processes a batch file by file, reports individual failures and retains successful imports. `GET /api/music/<track-id>` serves both existing catalog tracks and personal MP3s, including normal byte-range seeking. Personal filenames are never used as serving paths.

`MusicLibrary` stores metadata atomically in `data/music/library.json` under the service's in-process lock. MCP forwards to that same running service. An unreadable JSON document is preserved and reported as an error. No new dependency or schema migration is required.

Each ordinary battle now saves its chosen track and channel levels through `battle_audio_set` and returns them in `battle_get.audio`. The speaker controls apply immediately and save with visible status. Battle MP4 export uses that saved mix unless an explicit `audio` override is supplied; the recorder installs the mix before loading the replay. The existing personal MP3 is referenced by its library ID. Portable HTML still does not embed personal audio.
