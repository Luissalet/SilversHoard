# Particles while paused

The shared realtime/classic Vfx painter advances its procedural effects only when `dt > 0`. Repeated rendering of a paused projectile or charge no longer adds particles that cannot expire. Existing particle positions and ages remain frozen; resuming advances emission and decay normally.

Zero-time public snapshots still reach supplied sprite effects, and explicit event bursts remain available when reconstructing a replay frame. The simulation, damage, engine RNG, input handling and audio are unchanged. This does not promise identical pixels across paused draws: some procedural drawing still uses visual jitter. Mass combat uses supplied effects directly and is unaffected by this procedural-particle fix.

Regression checks cover 120 paused projectile frames, charge drawing, resume/expiry, supplied snapshots and explicit bursts. The original deterministic reproduction accumulated 120 particles over 120 zero-time updates.
