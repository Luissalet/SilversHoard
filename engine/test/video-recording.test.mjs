import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// Execute the actual capture helper without mounting React or opening a desktop browser.
const source = readFileSync(new URL('../../client/src/pages/Video.jsx', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function toBase64'), source.indexOf('export default function Video'));
const flush = () => new Promise(resolve => setImmediate(resolve));

function capture({denied = false, resize = false} = {}) {
  const tracks = [{stop() { this.stopped = true; }}];
  const audio = {getAudioTracks: () => [{kind: 'audio'}]};
  const tab = {getVideoTracks: () => tracks, getTracks: () => tracks};
  const callbacks = [], chunks = [], errors = [], completed = [];
  let frame, recorder, geometry;
  const preview = {muted: false, srcObject: null, requestVideoFrameCallback(cb) { frame = cb; },
    async play() {}, pause() { this.paused = true; }};
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) { this.stream = stream; this.options = options; recorder = this; }
    start() { this.started = true; }
  }
  const make = new Function('installTap', 'unlock', 'navigator', 'MediaStream', 'MediaRecorder', 'document', 'window', 'performance', 'setTimeout',
    `${helper}\nreturn startRecording;`);
  const startRecording = make(() => audio, () => {}, {mediaDevices: {getDisplayMedia: async () => {
    if (denied) throw new Error('capture denied');
    return tab;
  }}}, class { constructor(items) { this.tracks = items; } }, Recorder,
  {createElement: () => preview}, {__videoChunk: data => chunks.push(data), __videoDone: info => completed.push(info), __videoError: e => errors.push(e),
    ...(resize ? {__videoCaptureReady: () => new Promise(resolve => { geometry = resolve; })} : {})},
  {now: () => 2000}, cb => { callbacks.push(cb); return callbacks.length; });
  const run = {current: {t0: 1000}};
  let starts = 0;
  startRecording(run, () => starts++);
  return {run, tracks, preview, callbacks, chunks, errors, completed, get recorder() { return recorder; }, get starts() { return starts; },
    deliverFrame() { frame(); }, resizeDone() { geometry(); }};
}

test('native geometry adjustment completes before the MediaRecorder is created', async () => {
  const c = capture({resize: true});
  await flush();
  assert.equal(c.recorder, undefined);
  assert.equal(c.starts, 0);
  c.resizeDone();
  await flush();
  assert.equal(c.recorder.started, true);
  assert.equal(c.callbacks.length, 0, 'the delivered-frame handshake still follows geometry adjustment');
  c.deliverFrame();
  await flush();
  c.callbacks[0]();
  assert.equal(c.starts, 1);
});

test('capture waits for its first delivered picture before starting the replay', async () => {
  const c = capture();
  await flush();
  assert.equal(c.recorder.started, true);
  assert.equal(c.callbacks.length, 0, 'the old fixed delay started even when capture had no frame');
  assert.equal(c.starts, 0);
  c.deliverFrame();
  await flush();
  assert.equal(c.callbacks.length, 1);
  assert.equal(c.preview.srcObject, null);
  assert.equal(c.preview.paused, true);
  c.callbacks[0]();
  assert.equal(c.starts, 1);
});

test('real-time capture prefers VP8 and still hands off video chunks and audio', async () => {
  const c = capture();
  await flush();
  assert.equal(c.recorder.options.mimeType, 'video/webm;codecs=vp8,opus');
  assert.equal(c.recorder.stream.tracks.length, 2);
  c.deliverFrame();
  await flush();
  c.recorder.ondataavailable({data: new Blob([new Uint8Array([1, 2, 3])])});
  c.recorder.onstop();
  await flush();
  assert.deepEqual(c.chunks, ['AQID']);
  assert.deepEqual(c.completed, [{seconds: 1, sound: true}]);
  assert.equal(c.tracks[0].stopped, true);
});

test('capture failure is reported without advancing the battle', async () => {
  const c = capture({denied: true});
  await flush();
  assert.deepEqual(c.errors, ['capture denied']);
  assert.equal(c.starts, 0);
  assert.equal(c.callbacks.length, 0);
});
