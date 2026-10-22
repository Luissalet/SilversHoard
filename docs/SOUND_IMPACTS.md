# Combat impact audio

The hit, super-effective, critical, resisted and protection cues use short original procedural PCM in `client/src/battle/impact-sound.js`. Dry noise contact, low-mid body and a rapidly decaying debris layer replace the former reward-like square-wave notes on strong hits. A critical/super-effective contact in classic combat plays its strongest impact once, without a second delayed heavy contact. Protection has a separate dry brace cue in classic and ordinary real-time combat.

Four deterministic variants per cue reduce identical repetition. The audio module creates each mono WebAudio buffer lazily at the device sample rate and retains at most twenty impact buffers. Sources use the existing effects bus, master/effects gains, compressor, voice cap, gap throttling, gesture unlock and hidden-tab policy. Impact pitch options remain bounded; music, cries and other outcome cues retain their existing controls. No new audio setting or external sample is required.

Individual PCM peaks stay below full scale, the onset begins immediately, DC is filtered out and the tail fades to zero. Most body energy is in low/mid frequencies, with short broadband contact instead of a sustained high note. The new profile is a subjective sound-design choice, not a claim that every attack has a bespoke recording or that it models a physical collision.

The app, freshly exported playable pages and native battle recordings share the same implementation. The portable file generates its buffers locally; no impact download or runtime package is added. Existing HTML needs re-export to receive the change. Battle rules, hit timing, input logs, saved audio mixes and user data are unchanged. Native synthesis and buffer/mixer routing are covered by engine tests; browser and recording QA exercise the real WebAudio path.

The same delivery fixes the portable demo presentation: cached PMD sheets/geometry/portraits now travel together, offline fighters use their PMD animators on either side, and a late action sheet keeps the loaded PMD idle pose. Export does not download absent species; those retain their prior static/labelled fallback.
