# Preparing music before recording

Battle MP4 export uses the existing Video page, mixer, audio tap and native recorder. It does not change battle simulation, saved inputs, results, replay ticks or the API/MCP arguments.

Two recording startup races are addressed:

- Creating the effects context reapplies mixer volumes. The music fade initially has volume zero even when the selected music level is positive. Treating that temporary fade value as a mute paused a pending `play()`, producing an `AbortError`; its retry could remain pending until another interaction. Only actual mixer silence or a held tab now pauses the element. Fade timing, selected tracks and the master/music levels are unchanged.
- The recorder previously started its picture while the requested music was still loading. It now awaits `music.ready()` before requesting capture. Classic recordings request their normal deterministic track at this preparation step; repeated requests at replay start retain the same element and position. Normal interactive playback starts as before.

Readiness settles on `canplay`, a media error or disposal, and removes its listeners. No selected track, mute and zero music/master levels proceed without waiting for a download. An unavailable song retains the existing effects-only fallback; this is not a guarantee that every remote audio source will be available. Mass recording also uses the shared preparation step for a track already requested by its screen.

## Verification

Five behavioral Node regressions exercise the initial fade during audio unlock, delayed readiness, already loaded media, unavailable/disposed tracks, silent preferences and hold/resume. The existing mixer-selection and audio-tap regressions remain applicable.

The capture-helper harness supplies the new audio dependency and checks that delayed music prevents a capture request, while the existing geometry, first-frame, encoder/chunk handoff and failure cases still run unchanged in intent.

Own native MCP/Chromium QA used one quiet real-time battle: 300 saved ticks, ten simulation seconds, a recorded forfeit, unchanged winner and both HP values. Three initial observed exports identified music, so the failure was not treated as a deterministic cold-cache problem. A controlled twenty-second delay of the normal music response produced an MP4 with effects but no identified music. Its browser trace showed the initial pause/AbortError and a paused element at time zero throughout the fight. With these changes and the identical delay, the same battle produced twelve coherent one-second matches against the original cached song; music was ready before capture began. All attempts and the negative result are retained in `research-inbox/silver-audio808`.

The delayed response and browser observation are private QA fixtures, removed from product sources before delivery. They do not introduce a production tracing option or new recording settings. Earlier unobserved silent MP4s are evidence of the symptom; their individual historical causes cannot be established from an AAC stream or a successful HTTP request alone.
