# Music capture after interrupted playback

The recorder marks a media element as captured only after its audio stream is
connected to the recording mix. A rejected `play()` promise, a stream without
audio tracks or a capture exception leaves the element eligible for a later
playback attempt. Concurrent successful attempts check the same marker before
attaching, so they do not mix the same music twice. Existing effects routing,
music gain, deferred-track retries and ordinary playback remain unchanged.

This fixes a reproducible missing-music case: interrupt the first `play()` with
`pause()`, then successfully play the same element. Previously the first call
marked it captured before its promise settled, leaving the retry audible to the
player but absent from the recording stream.

`engine/test/video-tap.test.mjs` exercises rejected playback, capture exceptions,
concurrent plays, deferred tracks, repeated installation and effects routing.
An isolated Chromium test also loads the actual old and corrected modules,
performs the interruption and records the resulting stream. The old graph had
zero measured signal and a header-only 110-byte WebM; the corrected recording
has music identifiable against the source track. A header-only recording is not
described as decoded silent PCM.

Normal `battle_video` MCP exports of the same ten-second, attack-free saved
battle identify the background track before and after this change. This is an
intermittent retry defect, not a claim that every previous video lacked music.
The saved battle, result, tick and inputs are unchanged. AAC metadata or an HTTP
206 response alone does not prove that music is in a clip. Separate unexplained
silences should be reproduced independently rather than attributed to this
race without evidence.

The page's existing recording lifecycle is unchanged. See the platform
references for [media playback promises](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)
and [media-element stream capture](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream).
