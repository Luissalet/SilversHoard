# Particles while paused

The shared realtime/classic/mass Vfx painter advances its procedural effects only when `dt > 0`. Repeated rendering of a paused projectile or charge no longer adds particles that cannot expire. Existing particle positions and ages remain frozen; resuming advances emission and decay normally.

Zero-time public snapshots still reach supplied sprite effects, and explicit event bursts remain available when reconstructing a replay frame. The simulation, damage, engine RNG, input handling and audio are unchanged. This does not promise identical pixels across paused draws: some procedural drawing still uses visual jitter. Mass combat also constructs this shared Vfx painter and passes its draw delta to it.

Six regression checks cover 120 paused projectile frames, charge drawing, Will-O-Wisp trails, mass wave spray, resume/expiry, supplied snapshots and explicit bursts. The original deterministic reproduction accumulated 120 particles over 120 zero-time updates. Independent review also reproduced 120 paused Will-O-Wisp particles and 480 mass-wave particles; their draw-time emissions now use the same clock guard.
