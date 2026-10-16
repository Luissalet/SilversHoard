// The WebSocket of a Pokéathlon room (silvers_hoard/pokeathlon_rooms.py): JSON messages both ways, a reconnection with growing waits while
// the page is open (a dropped connection is not a leave: the room keeps the seat for a few seconds and the next "hello" says where things
// stand), and a ping now and then so that a quiet connection is not closed by whatever sits between the two computers.

const WAITS = [300, 600, 1200, 2000, 3000];

export class PkNet {
  /** url: the full ws:// or wss:// address; onMessage(msg); onStatus("connecting" | "open" | "retry" | "closed"). */
  constructor({ url, onMessage, onStatus = null, WebSocketImpl = null }) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.WS = WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
    this.ws = null;
    this.closed = false;
    this.tries = 0;
    this.queue = [];
    this.timer = 0;
    this.pinger = 0;
    this.status = "connecting";
  }

  _status(s) {
    this.status = s;
    if (this.onStatus) this.onStatus(s);
  }

  open() {
    if (this.closed || !this.WS) return;
    this._status(this.tries ? "retry" : "connecting");
    let ws;
    try { ws = new this.WS(this.url); } catch { this._again(); return; }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.tries = 0;
      this._status("open");
      for (const m of this.queue.splice(0)) this._raw(m);
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send({ k: "ping", t: Date.now() }, true), 12000);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let msg = null;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && typeof msg === "object") this.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pinger);
      // 4403 / 4404: the key is wrong or the room is gone: nothing to retry
      if (this.closed || (e && (e.code === 4403 || e.code === 4404))) {
        this.closed = true;
        this._status("closed");
        if (e && (e.code === 4403 || e.code === 4404)) this.onMessage({ k: "closed", why: e.code === 4404 ? "gone" : "forbidden" });
        return;
      }
      this._again();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  _again() {
    if (this.closed) return;
    this._status("retry");
    const wait = WAITS[Math.min(this.tries, WAITS.length - 1)];
    this.tries++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), wait);
  }

  _raw(msg) {
    try { this.ws.send(JSON.stringify(msg)); } catch { /* the close handler retries */ }
  }

  /** Send now when open; otherwise keep it for the next connection (unless `drop`: pings and frames are resent by the caller). */
  send(msg, drop = false) {
    if (this.ws && this.ws.readyState === 1) this._raw(msg);
    else if (!drop) this.queue.push(msg);
  }

  get isOpen() { return !!(this.ws && this.ws.readyState === 1); }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.pinger);
    if (this.ws) { try { this.ws.close(); } catch { /* gone */ } }
    this._status("closed");
  }
}

/** The ws:// address of a room: the host's page reaches it on the room server's port, a friend's page on its own origin. */
export function roomSocketUrl({ path, port = 0, loc = typeof location !== "undefined" ? location : null }) {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const host = port ? `${loc.hostname}:${port}` : loc.host;
  return `${proto}//${host}${path}`;
}
