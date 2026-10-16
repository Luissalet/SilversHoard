// The WebSocket client of a Pokéathlon room (client/src/pokeathlon/pknet.js): queued messages, reconnection, rooms that are gone.
import test from "node:test";
import assert from "node:assert/strict";
import { PkNet, roomSocketUrl } from "../../client/src/pokeathlon/pknet.js";

class FakeWS {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.all.push(this); }
  send(t) { this.sent.push(JSON.parse(t)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000 }); }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  recv(o) { if (this.onmessage) this.onmessage({ data: JSON.stringify(o) }); }
  drop(code = 1006) { this.readyState = 3; if (this.onclose) this.onclose({ code }); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("messages sent before the connection opens are delivered once it does; frames are not kept", () => {
  FakeWS.all = [];
  const got = [];
  const net = new PkNet({ url: "ws://x/a", onMessage: (m) => got.push(m), WebSocketImpl: FakeWS });
  net.open();
  net.send({ k: "ready", r: 0 });
  net.send({ k: "in", r: 0, from: 1, frames: [{}] }, true);
  const ws = FakeWS.all[0];
  ws.open();
  assert.deepEqual(ws.sent, [{ k: "ready", r: 0 }]);
  net.send({ k: "in", r: 0, from: 2, frames: [{}] }, true);
  assert.equal(ws.sent.length, 2);
  ws.recv({ k: "hello" });
  assert.deepEqual(got, [{ k: "hello" }]);
  net.close();
});

test("a dropped connection is opened again and the room's hello arrives on the new one", async () => {
  FakeWS.all = [];
  const states = [];
  const got = [];
  const net = new PkNet({ url: "ws://x/b", onMessage: (m) => got.push(m.k), onStatus: (s) => states.push(s), WebSocketImpl: FakeWS });
  net.open();
  FakeWS.all[0].open();
  FakeWS.all[0].drop();
  assert.equal(net.status, "retry");
  await wait(450);
  assert.equal(FakeWS.all.length, 2);
  FakeWS.all[1].open();
  FakeWS.all[1].recv({ k: "hello" });
  assert.deepEqual(got, ["hello"]);
  assert.equal(net.status, "open");
  net.close();
  assert.equal(net.status, "closed");
});

test("a key the room refuses or a room that is gone is not retried and is reported as closed", async () => {
  for (const [code, why] of [[4403, "forbidden"], [4404, "gone"]]) {
    FakeWS.all = [];
    const got = [];
    const net = new PkNet({ url: "ws://x/c", onMessage: (m) => got.push(m), WebSocketImpl: FakeWS });
    net.open();
    FakeWS.all[0].drop(code);
    await wait(400);
    assert.equal(FakeWS.all.length, 1);
    assert.deepEqual(got, [{ k: "closed", why }]);
  }
});

test("the address of a room's socket: the host's page on the room server's port, a friend's on its own origin", () => {
  assert.equal(roomSocketUrl({ path: "/api/pk/a/ws?k=1", port: 5265, loc: { protocol: "http:", hostname: "localhost", host: "localhost:5263" } }), "ws://localhost:5265/api/pk/a/ws?k=1");
  assert.equal(roomSocketUrl({ path: "/api/pk/a/ws?k=1", loc: { protocol: "https:", hostname: "x.example", host: "x.example:8443" } }), "wss://x.example:8443/api/pk/a/ws?k=1");
});
