// The page's own sound as one stream, for recording a replay (pages/Video.jsx): everything the Web Audio graph sends to the speakers
// (effects, cries) and every <audio> element that plays (the music), mixed in a recorder context. Installed only by the recorder.
import { getSettings } from "../audio.js";

let rctx = null;
let rdest = null;
const hooked = new WeakSet();

export function installTap() {
  if (rdest) return rdest.stream;
  const AC = window.AudioContext || window.webkitAudioContext;
  rctx = new AC();
  rdest = rctx.createMediaStreamDestination();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function tapConnect(target, ...rest) {
    const out = connect.call(this, target, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && target instanceof AudioDestinationNode && target.context !== rctx) {
      const c = target.context;
      if (!c.__silverTap) {
        c.__silverTap = c.createMediaStreamDestination();
        rctx.createMediaStreamSource(c.__silverTap.stream).connect(rdest);
      }
      connect.call(this, c.__silverTap);
    }
    return out;
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function tapPlay(...args) {
    const result = play.apply(this, args);
    const el = this;
    if (!hooked.has(el) && el.captureStream) {
      hooked.add(el);
      const hook = (tries = 0) => {
        try {
          const s = el.captureStream();
          if (!s.getAudioTracks().length) { if (tries < 25) setTimeout(() => hook(tries + 1), 200); return; }
          // the captured sound ignores the element's volume: apply the mixer's music level here
          const cfg = getSettings();
          const g = rctx.createGain();
          g.gain.value = cfg.mute ? 0 : cfg.master * cfg.music * 0.55;
          rctx.createMediaStreamSource(s).connect(g);
          g.connect(rdest);
        } catch { /* no sound from this element */ }
      };
      Promise.resolve(result).then(() => hook(), () => {});
    }
    return result;
  };
  rctx.resume?.();
  return rdest.stream;
}
