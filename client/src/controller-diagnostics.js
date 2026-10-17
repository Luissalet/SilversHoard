// Local-only samples and a bounded session. No browser objects, storage, network or game actions.
const analog = (value, min, max) => Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value)) * 1000) / 1000 : 0;

export function samplePads(pads) {
  return Array.from(pads || []).filter(p => p && p.connected !== false).map(p => ({
    index: p.index, id: String(p.id || ""), mapping: String(p.mapping || ""),
    axes: Array.from(p.axes || [], n => analog(n, -1, 1)),
    buttons: Array.from(p.buttons || [], b => ({pressed: !!b?.pressed, touched: !!b?.touched, value: analog(b?.value, 0, 1)})),
  }));
}

export class ControllerSession {
  constructor(mode, layout, startedAt = new Date().toISOString(), limit = 2048) {
    this.startedAt = startedAt;
    this.limit = limit;
    this.entries = [];
    this.full = false;
    this.lastInputs = "";
    this.mode(mode, layout, 0);
  }
  event(kind, data, ms) {
    if (this.entries.length >= this.limit) { this.full = true; return false; }
    this.entries.push({ms: Math.max(0, Math.round(ms)), kind, ...data});
    return true;
  }
  mode(mode, layout, ms) {
    this.currentMode = mode; this.currentLayout = layout;
    this.event('mode', {mode, layout}, ms);
  }
  observe(pads, ms) {
    const signature = JSON.stringify(pads);
    if (signature === this.lastInputs) return false;
    this.lastInputs = signature;
    return this.event('inputs', {mode: this.currentMode, layout: this.currentLayout, pads: JSON.parse(signature)}, ms);
  }
  export() {
    return JSON.parse(JSON.stringify({kind:'silver-controller-session',v:1,synthetic:false,started_at:this.startedAt,
      limit:this.limit,truncated:this.full,entries:this.entries}));
  }
}
