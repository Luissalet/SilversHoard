// Real time between two computers (a live-battle room, silvers_hoard/pvp.py): both screens run the same simulator from the same seed
// in lockstep. Every tick each screen reads its own person's input and sends it to the room; a tick runs only when both inputs for it
// are in. An input runs `delay` ticks after it is read, so the round trip to the other computer is hidden behind it. The room keeps
// every frame, so a screen that reconnects (or reloads) catches up from the start. A spectator (seat 2) only listens: the room sends
// it both players' frames and its screen runs the battle from them, a few ticks behind the players.

/** An input (SeatInput.take) as a frame: [mx, my, use, dodge, sw, focus, plus, mega, ctl, tgt]. */
export function packFrame(q) {
  return [q.mx || 0, q.my || 0, q.use ?? -1, q.dodge ? 1 : 0, q.sw ?? -1, q.focus ? 1 : 0, q.plus ? 1 : 0, q.mega ? 1 : 0,
    q.ctl ?? null, q.tgt ?? null];
}

export function unpackFrame(f) {
  if (!f) return null;
  const [mx, my, use, dodge, sw, focus, plus, mega, ctl, tgt] = f;
  return { mx, my, use, dodge: !!dodge, sw, focus: !!focus, plus: !!plus, mega: !!mega, ...(ctl != null ? { ctl } : {}), ...(tgt != null ? { tgt } : {}) };
}

/** A short fingerprint of where the battle is: positions and HP of everything on the field. */
export function battleHash(b) {
  const parts = [b.t];
  for (const u of b.units || []) parts.push(Math.round((u.x || 0) * 100), Math.round((u.y || 0) * 100));
  for (const s of b.sides || []) for (const m of s.mons || []) parts.push(m.hp);
  let h = 2166136261;
  for (const ch of parts.join(",")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export class NetLink {
  /** url: the room's WebSocket; seat 0 (host), 1 (friend) or 2 (a spectator); on(event, data): "peer" (bool), "ff" (side), "desync" (tick), "closed",
   * "status" ("connecting" | "open" | "lost"). */
  constructor({ url, seat, delay = 4, on = () => {} }) {
    this.url = url;
    this.seat = seat;
    this.delay = delay;
    this.on = on;
    this.local = [];       // frames[tick - 1] of this screen's person
    this.remote = [];      // the other person's
    this.sent = 0;         // how many local frames the room has
    this.peer = false;
    this.ws = null;
    this.closed = false;
    this.tries = 0;
    this.hello = false;
    this.watch = seat === 2;
    this.both = [[], []];  // a spectator's copy of both players' frames
  }

  connect() {
    if (this.closed) return;
    this.on("status", "connecting");
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => { this.tries = 0; this.on("status", "open"); };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.k === "hello" && this.watch) {
        if (typeof m.delay === "number") this.delay = m.delay;
        [0, 1].forEach((s) => { const got = (m.frames && m.frames[s]) || []; if (got.length > this.both[s].length) this.both[s] = got.slice(); });
        this.peer = !!m.peer;
        this.hello = true;
        this.on("peer", this.peer);
      } else if (m.k === "in" && this.watch) {
        const s = m.seat === 1 ? 1 : 0;
        const from = m.from | 0;
        (m.frames || []).forEach((f, i) => { if (from + i === this.both[s].length + 1) this.both[s].push(f); });
      } else if (m.k === "hello") {
        if (typeof m.delay === "number") this.delay = m.delay;
        const mine = (m.frames && m.frames[this.seat]) || [];
        const theirs = (m.frames && m.frames[1 - this.seat]) || [];
        // a reloaded screen takes its own history back from the room; one that only lost the connection resends what the room lacks
        if (mine.length > this.local.length) this.local = mine.slice();
        this.sent = Math.min(mine.length, this.local.length);
        if (theirs.length > this.remote.length) this.remote = theirs.slice();
        this.peer = !!m.peer;
        this.hello = true;
        this.on("peer", this.peer);
        this.flush();
      } else if (m.k === "in") {
        const from = m.from | 0;
        (m.frames || []).forEach((f, i) => { if (from + i === this.remote.length + 1) this.remote.push(f); });
      } else if (m.k === "peer") {
        this.peer = !!m.on;
        this.on("peer", this.peer);
      } else if (m.k === "ff") this.on("ff", m.side);
      else if (m.k === "desync") this.on("desync", m.t);
      else if (m.k === "closed") { this.on("closed"); this.close(); }
      else if (m.k === "started") this.on("started", m.battle);
    };
    ws.onclose = () => { this.ws = null; this.hello = false; if (!this.closed) { this.on("status", "lost"); this.retry(); } };
    ws.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
  }

  retry() {
    if (this.closed) return;
    this.tries += 1;
    setTimeout(() => this.connect(), Math.min(5000, 300 * this.tries));
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1 && this.hello) {
      try { this.ws.send(JSON.stringify(msg)); return true; } catch { return false; }
    }
    return false;
  }

  /** This screen's input for the next tick it has not read yet. */
  push(frame) {
    if (this.watch) return;
    this.local.push(frame);
    this.flush();
  }

  flush() {
    if (this.watch || this.sent >= this.local.length) return;
    if (this.send({ k: "in", from: this.sent + 1, frames: this.local.slice(this.sent) })) this.sent = this.local.length;
  }

  /** Both inputs of tick t are in. */
  ready(t) { return this.watch ? t <= this.both[0].length && t <= this.both[1].length : t <= this.local.length && t <= this.remote.length; }

  frame(t) {
    if (this.watch) return [this.both[0][t - 1], this.both[1][t - 1]];
    return [this.seat === 0 ? this.local[t - 1] : this.remote[t - 1], this.seat === 0 ? this.remote[t - 1] : this.local[t - 1]];
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* gone */ }
  }
}
