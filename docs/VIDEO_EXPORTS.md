# Replay video exports

Each recording has its own file name: the readable battle title or names, the
battle suffix and a `video_` ULID. Recording the same battle again leaves the
earlier download and its job metadata intact. Simultaneous recordings also use
separate WebM capture files and MP4 output files.

Classic, real-time and mass battles share the same native recorder through UI,
REST and MCP. MP4 conversion, page sound capture, duration measurement and the
WebM fallback without ffmpeg are unchanged. Existing exports are not renamed.
