const PREFIX = "SILVERDUEL1-";
const KINDS = { offer: "offer", answer: "answer" };
const MAX_CODE = 48000;

export function encodeSignal(id, description, settings) {
  const packet = { id, description, ...(settings ? { settings } : {}) };
  const bytes = new TextEncoder().encode(JSON.stringify(packet));
  const base = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  return PREFIX + base.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeSignal(value, kind, id) {
  const text = String(value || "").trim();
  const code = text.includes("#") ? text.split("#").at(-1) : text;
  if (code.length > MAX_CODE || !code.startsWith(PREFIX)) throw new Error("signal");
  let packet;
  try {
    const base = code.slice(PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
    packet = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base), (char) => char.charCodeAt(0))));
  } catch {
    throw new Error("signal");
  }
  if (!packet || !/^[0-9a-f-]{36}$/.test(packet.id) || (id && id !== packet.id)
      || packet.description?.type !== KINDS[kind] || typeof packet.description.sdp !== "string") throw new Error("signal");
  return packet;
}

export class DuelPeer {
  constructor({ onMessage, onState, localOnly = false }) {
    this.pc = new RTCPeerConnection({ iceServers: localOnly ? [] : [{ urls: "stun:stun.l.google.com:19302" }] });
    this.pc.ondatachannel = ({ channel }) => this.attach(channel);
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === "connected" && this.channel?.readyState === "open") onState("open");
      else if (["failed", "disconnected", "closed"].includes(state)) onState(state);
    };
    this.onMessage = onMessage;
    this.onState = onState;
  }

  attach(channel) {
    this.channel = channel;
    channel.onopen = () => this.onState("open");
    channel.onclose = () => this.onState("closed");
    channel.onmessage = ({ data }) => {
      if (typeof data !== "string" || data.length > 250000) return;
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (message && typeof message === "object") this.onMessage(message);
    };
  }

  async gather(description) {
    await this.pc.setLocalDescription(description);
    if (this.pc.iceGatheringState !== "complete") await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        this.pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => { if (this.pc.iceGatheringState === "complete") finish(); };
      const timeout = setTimeout(finish, 7000);
      this.pc.addEventListener("icegatheringstatechange", check);
      check();
    });
    return this.pc.localDescription.toJSON();
  }

  async offer() {
    this.attach(this.pc.createDataChannel("silver-duel"));
    return this.gather(await this.pc.createOffer());
  }

  async answer(offer) {
    await this.accept(offer);
    return this.gather(await this.pc.createAnswer());
  }

  accept(description) { return this.pc.setRemoteDescription(description); }

  send(message) {
    if (this.channel?.readyState !== "open") return false;
    try {
      this.channel.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close() { this.pc.close(); }
}
