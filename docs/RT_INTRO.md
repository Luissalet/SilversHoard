# Real-time VS pictures

The VS card chooses the trainer picture, then the lead Pokémon's portrait, then its static battle sprite. Its clock waits until each side has a usable picture, all of that side's pictures have failed, or the existing 1.5-second wait expires. A loaded alternative does not wait for a different picture still downloading. Paused video preparation observes image readiness without advancing the card or simulation.

The wait is bounded: slow or unavailable image servers can still leave the first frames empty. This change does not promise that every picture is downloaded before recording starts. No simulator timing, replay inputs or battle results change.

`engine/test/rt-intro-images.test.mjs` covers a pending alternative with a failed portrait, ready trainer/fallback with a pending portrait, timeout, complete failure and prepared video at zero elapsed time. The tests compare the simulation view before and after waiting. The existing real-time show tests also compare battle results with and without the show.
