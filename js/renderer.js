// ── Render loop and pipeline ─────────────────────────────────────────────────

import { gl, canvas, camTex, blackTex, mkRT, delRT, clearRT, mkHistoryRT, delHistoryRT, clearHistoryRT, draw, I } from './engine.js';
import { P, buildEffectProg, EFFECT_NAMES, detectTemporal, detectOutputPrev, getEffectBody } from './shaders.js';
import { nodes, topoSort, getInputTex, getNodeInputs, getOutputNode } from './graph.js';

// ── State ────────────────────────────────────────────────────────────────────

let W = 0, H = 0;
let camRT;

// Thumbnail async readback (PIXEL_PACK_BUFFER — no GPU stall)
const THUMB_W  = 160, THUMB_H = 90;

let t0 = 0, frameN = 0;
let ready = false, inited = false;
let _videoW = 0, _videoH = 0;

// Audio reactivity state
let audioAnalyser = null, audioData = null, audioTex = null;
let audioRgba = null;

// Performance tracking
let _fps = 0, _fpsSmooth = 60, _lastFrameTime = 0;
const fpsEl = document.getElementById('fps-counter');

// Optional profiler (disabled by default). Enable with: localStorage.flowtoy-profiler='1'
let _perfEnabled = localStorage.getItem('flowtoy-profiler') === '1';
let _perfLogger = null; // (level, message) => void
let _perfLastLog = 0;
let _perfLogEveryMs = 700;
const _perf = {
  frames: 0,
  frameMs: 0,
  cameraMs: 0,
  graphMs: 0,
  thumbMs: 0,
  thumbBlitMs: 0,
  thumbReadMs: 0,
  thumbCpuMs: 0,
  thumbReads: 0,
};

export function setPerfLogger(fn) { _perfLogger = fn; }
export function setPerfEnabled(enabled) {
  _perfEnabled = !!enabled;
  localStorage.setItem('flowtoy-profiler', _perfEnabled ? '1' : '0');
  _perfLastLog = 0;
  if (_perfLogger) {
    if (_perfEnabled) {
      const state = ready ? 'live' : 'waiting-for-frames (start camera)';
      _perfLogger('info', `[perf] enabled (${state})`);
    } else {
      _perfLogger('info', '[perf] disabled');
    }
  }
}

export function setPerfLogIntervalMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 100) return;
  _perfLogEveryMs = n;
}

// ── Resize ───────────────────────────────────────────────────────────────────

function resize() {
  // Free node RTs
  for (const node of nodes.values()) {
    if (_isSourceType(node.type)) continue;
    delRT(node.rt[0]);
    delRT(node.rt[1]);
    node.rt[0] = null;
    node.rt[1] = null;
    delHistoryRT(node.history);
    node.history = null;
    // Free buffer ring
    if (node._bufferRing) {
      for (const rt of node._bufferRing) delRT(rt);
      node._bufferRing = null;
    }
  }

  // Free shared pipeline RTs
  delRT(camRT);

  // Pipeline resolution tracks camera resolution.
  W = canvas.width  = _videoW || 1280;
  H = canvas.height = _videoH || 720;

  camRT = mkRT(W, H);

  // Allocate RTs for non-source nodes
  for (const node of nodes.values()) {
    if (_isSourceType(node.type)) continue;
    if (_isBufferType(node.type)) {
      // Allocate buffer ring
      node._bufferRing = [];
      for (let i = 0; i < BUFFER_DEPTH; i++) node._bufferRing.push(mkRT(W, H));
      node._bufferIdx = 0;
      continue;
    }
    node.rt[0] = mkRT(W, H);
    node.rt[1] = mkRT(W, H);
  }

  inited = false;
}

function _isSourceType(type) {
  return type.startsWith('source-');
}

function _isBufferType(type) {
  return type === 'buffer';
}

const BUFFER_DEPTH = 5; // number of frames stored by buffer node

// ── Ensure node has a render target (lazy allocation for nodes added later) ──

export function ensureNodeRT(node) {
  if (_isSourceType(node.type)) return;
  if (W === 0 || H === 0) return;
  if (_isBufferType(node.type)) {
    // Buffer nodes need a ring of BUFFER_DEPTH render targets
    if (!node._bufferRing) {
      node._bufferRing = [];
      for (let i = 0; i < BUFFER_DEPTH; i++) node._bufferRing.push(mkRT(W, H));
      node._bufferIdx = 0;
      // Clear all
      for (const rt of node._bufferRing) clearRT(rt);
    }
    return;
  }
  if (!node.rt[0]) { node.rt[0] = mkRT(W, H); node.rt[1] = mkRT(W, H); }
  // Allocate history ring buffer if @temporal
  const src = node.customSrc || getEffectBody(node.effectIdx);
  if (src) {
    const depth = detectTemporal(src);
    if (depth > 0 && !node.history) {
      node.history = mkHistoryRT(W, H, depth);
      node.historyIdx = 0;
    }
  }
}

// ── Free node render target (called when node deleted) ───────────────────────

export function freeNodeRT(node) {
  delRT(node.rt[0]); delRT(node.rt[1]);
  node.rt[0] = null; node.rt[1] = null;
  delHistoryRT(node.history); node.history = null;
  if (node._thumbRT) { delRT(node._thumbRT); node._thumbRT = null; }
  if (node._ar) {
    if (node._ar.sync) gl.deleteSync(node._ar.sync);
    gl.deleteBuffer(node._ar.pbo);
    node._ar = null;
  }
  if (node._bufferRing) {
    for (const rt of node._bufferRing) delRT(rt);
    node._bufferRing = null;
  }
}

// ── Async thumbnail readback (PIXEL_PACK_BUFFER) ─────────────────────────────
// Each node has _ar = { pbo, sync, pending, buf, w, h }.
// Frame N : blit → issue async readPixels into PBO → fence sync.
// Frame N+1: clientWaitSync(timeout=0) → if signaled, getBufferSubData → update canvas.
// No GPU stall; 1-frame display lag (imperceptible at 30+ fps).

function updateNodeThumbnail(node) {
  if (!node?.outTex) return null;

  const tw = node.thumbRes?.[0] ?? THUMB_W;
  const th = node.thumbRes?.[1] ?? THUMB_H;
  const t0p = performance.now();

  // Ensure per-node thumb RT
  if (!node._thumbRT || node._thumbRT.w !== tw || node._thumbRT.h !== th) {
    if (node._thumbRT) delRT(node._thumbRT);
    node._thumbRT = mkRT(tw, th);
    node._thumbRT.w = tw;
    node._thumbRT.h = th;
  }

  // Blit current frame into thumb RT
  const blitT0 = performance.now();
  draw(P.copy, node._thumbRT.fbo, tw, th, { uT: node.outTex });
  const blitMs = performance.now() - blitT0;

  // Init async readback state
  if (!node._ar) {
    node._ar = { pbo: gl.createBuffer(), sync: null, pending: false, buf: null, w: 0, h: 0 };
  }
  const ar = node._ar;

  // Phase A: collect previous frame's readback if ready
  let readMs = 0, cpuMs = 0;
  if (ar.pending && ar.sync) {
    const readT0 = performance.now();
    const status = gl.clientWaitSync(ar.sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0); // poll, no wait
    if (status !== gl.TIMEOUT_EXPIRED && status !== gl.WAIT_FAILED) {
      gl.deleteSync(ar.sync);
      ar.sync = null;
      ar.pending = false;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, ar.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, ar.buf);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      readMs = performance.now() - readT0;
      const cpuT0 = performance.now();
      _writeThumbCanvas(node, ar.buf, ar.w, ar.h);
      cpuMs = performance.now() - cpuT0;
    }
  }

  // Phase B: issue new async readback only if previous one completed
  if (!ar.pending) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, node._thumbRT.fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, ar.pbo);
    if (ar.w !== tw || ar.h !== th) {
      gl.bufferData(gl.PIXEL_PACK_BUFFER, tw * th * 4, gl.STREAM_READ);
      ar.buf = new Uint8Array(tw * th * 4);
      ar.w = tw;
      ar.h = th;
    }
    gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    ar.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    ar.pending = true;
  }

  const totalMs = performance.now() - t0p;
  return { totalMs, blitMs, readMs, cpuMs };
}

function _writeThumbCanvas(node, buf, tw, th) {
  if (!node.thumb || node.thumb.canvas.width !== tw || node.thumb.canvas.height !== th) {
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    node.thumb = { canvas: c, ctx: c.getContext('2d'), imageData: null };
  }
  if (!node.thumb.imageData || node.thumb.imageData.width !== tw || node.thumb.imageData.height !== th) {
    node.thumb.imageData = node.thumb.ctx.createImageData(tw, th);
  }
  const dst = node.thumb.imageData.data;
  for (let row = 0; row < th; row++) {
    const srcRow = th - 1 - row;
    dst.set(buf.subarray(srcRow * tw * 4, (srcRow + 1) * tw * 4), row * tw * 4);
  }
  node.thumb.ctx.putImageData(node.thumb.imageData, 0, 0);
}

// ── Frame ────────────────────────────────────────────────────────────────────

function frame(video) {
  requestAnimationFrame(() => frame(video));
  if (!ready || video.readyState < video.HAVE_CURRENT_DATA) return;

  const frameStart = performance.now();

  // FPS tracking
  const now = performance.now();
  if (_lastFrameTime) {
    _fps = 1000 / (now - _lastFrameTime);
    _fpsSmooth += (_fps - _fpsSmooth) * 0.1;
    if (frameN % 10 === 0 && fpsEl) fpsEl.textContent = `${Math.round(_fpsSmooth)} FPS`;
  }
  _lastFrameTime = now;

  const t  = (performance.now() - t0) / 1000;

  // Upload camera — flip Y so DOM image rows become WebGL-correct (bottom-up)
  const tCam0 = performance.now();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.bindTexture(gl.TEXTURE_2D, camTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  // Mirrored colour
  draw(P.camera, camRT.fbo, W, H, { uT: camTex });

  // Seed first frame
  if (!inited) {
    for (const node of nodes.values()) {
      if (!node.rt[0]) continue;
      clearRT(node.rt[0]); clearRT(node.rt[1]); node.rtIdx = 0;
    }
    inited = true;
  }

  // Pipeline texture map — source nodes resolve to these
  _uploadAudio();
  const cameraMs = performance.now() - tCam0;
  const pipeTex = {
    'source-cam':     camRT.tex,
    'source-audio':   audioTex ?? blackTex,
  };

  // ── Graph execution ───────────────────────────────────────────────────────
  const tGraph0 = performance.now();
  const order = topoSort();

  for (const id of order) {
    const node = nodes.get(id);
    if (!node) continue;

    if (_isSourceType(node.type)) {
      // Source: just assign the pipeline texture
      node.outTex = pipeTex[node.type] ?? null;
      continue;
    }

    if (node.type === 'output') {
      // Output node: get connected input (null if unconnected)
      node.outTex = getInputTex(id, 'in');
      continue;
    }

    if (node.type === 'buffer') {
      // Buffer node: outputs previous frames from ring buffer, then captures input
      if (!node._bufferRing) {
        node._bufferRing = [];
        for (let i = 0; i < BUFFER_DEPTH; i++) node._bufferRing.push(mkRT(W, H));
        node._bufferIdx = 0;
        for (const rt of node._bufferRing) clearRT(rt);
      }

      const idx = node._bufferIdx;
      // Output stored frames: out = current (most recent stored), p1..p4 = older
      // Ring buffer: idx points to the NEXT write slot, so (idx-1) is most recent
      node.outTexs = {};
      for (let i = 0; i < BUFFER_DEPTH; i++) {
        const ri = ((idx - 1 - i) % BUFFER_DEPTH + BUFFER_DEPTH) % BUFFER_DEPTH;
        const portName = i === 0 ? 'out' : `p${i}`;
        node.outTexs[portName] = node._bufferRing[ri].tex;
      }
      node.outTex = node.outTexs.out; // default for single-output compat

      // Capture current input into the ring buffer
      const inTex = getInputTex(id, 'in');
      if (inTex) {
        draw(P.copy, node._bufferRing[idx].fbo, W, H, { uT: inTex });
        node._bufferIdx = (idx + 1) % BUFFER_DEPTH;
      }
      continue;
    }

    if (node.type === 'effect') {
      // Lazy RT allocation
      const rw = W, rh = H;
      if (!node.rt[0]) { node.rt[0] = mkRT(rw, rh); node.rt[1] = mkRT(rw, rh); }

      if (node.dirty) {
        clearRT(node.rt[0]); clearRT(node.rt[1]);
        if (node.history) { clearHistoryRT(node.history); node.historyIdx = 0; }
        node.rtIdx = 0;
        node.dirty = false;
      }

      // Rebuild custom program if lost after deserialize / load
      if (!node.prog && node.customSrc) {
        try { node.prog = buildEffectProg(node.customSrc); }
        catch (e) { console.warn('[renderer] custom prog rebuild failed:', e); }
      }

      const prog = node.prog || P.fx[node.effectIdx ?? -1];
      if (!prog) continue;

      // Detect @temporal and @output prev from shader source
      const shaderSrc = node.customSrc || getEffectBody(node.effectIdx);
      const temporalDepth = shaderSrc ? detectTemporal(shaderSrc) : 0;
      const outputPrev = shaderSrc ? detectOutputPrev(shaderSrc) : false;

      // Lazy history ring buffer allocation
      if (temporalDepth > 0 && !node.history) {
        node.history = mkHistoryRT(rw, rh, temporalDepth);
        node.historyIdx = 0;
      }

      const _t0 = performance.now();
      const fc = node.rtIdx, fp = 1 - node.rtIdx;

      // Build texture bindings from the node's input ports.
      // All ports (including uPrev) are wirable — no implicit bindings.
      const texs  = {};
      const ports = getNodeInputs(node);
      for (const uName of ports) {
        texs[uName] = getInputTex(id, uName) ?? blackTex;
      }

      // Bind history ring buffer if available
      const unis = { uTime: t, ...(node.params || {}) };
      if (node.history) {
        texs.uHistory = node.history; // sampler2DArray — draw() handles ._array
        unis.uHistoryLen = I(node.history.depth);
        unis.uHistoryIdx = I(node.historyIdx);
      }

      draw(prog, node.rt[fc].fbo, rw, rh, texs, unis);

      node.rtIdx = 1 - node.rtIdx;

      // @output prev: output the previous frame (delay-like behavior)
      node.outTex = outputPrev ? node.rt[fp].tex : node.rt[fc].tex;

      // Copy current output into history ring buffer
      if (node.history) {
        draw(P.copy, node.history.fbos[node.historyIdx], rw, rh,
          { uT: node.rt[fc].tex });
        node.historyIdx = (node.historyIdx + 1) % node.history.depth;
      }

      node._drawMs = performance.now() - _t0;
      continue;
    }
  }
  const graphMs = performance.now() - tGraph0;

  // ── Thumbnails (async PBO — all nodes every frame, no GPU stall) ──────────
  let thumbMs = 0, thumbBlitMs = 0, thumbReadMs = 0, thumbCpuMs = 0, thumbReads = 0;
  for (const id of order) {
    const node = nodes.get(id);
    if (!node?.outTex) continue;
    const p = updateNodeThumbnail(node);
    if (p) {
      thumbMs      += p.totalMs;
      thumbBlitMs  += p.blitMs;
      thumbReadMs  += p.readMs;
      thumbCpuMs   += p.cpuMs;
      thumbReads   += 1;
    }
  }

  // Optional perf log stream
  if (_perfEnabled) {
    const frameMs = performance.now() - frameStart;
    _perf.frames += 1;
    _perf.frameMs += frameMs;
    _perf.cameraMs += cameraMs;
    _perf.graphMs += graphMs;
    _perf.thumbMs += thumbMs;
    _perf.thumbBlitMs += thumbBlitMs;
    _perf.thumbReadMs += thumbReadMs;
    _perf.thumbCpuMs += thumbCpuMs;
    _perf.thumbReads += thumbReads;

    if (frameStart - _perfLastLog >= _perfLogEveryMs && _perf.frames > 0) {
      const n = _perf.frames;
      const avgFrame = _perf.frameMs / n;
      const avgCam = _perf.cameraMs / n;
      const avgGraph = _perf.graphMs / n;
      const avgThumb = _perf.thumbMs / n;
      const avgThumbBlit = _perf.thumbBlitMs / n;
      const avgThumbRead = _perf.thumbReadMs / n;
      const avgThumbCpu = _perf.thumbCpuMs / n;
      const avgReads = _perf.thumbReads / n;

      let bottleneck = 'mixed';
      let hint = 'none';
      const maxStage = Math.max(avgCam, avgGraph, avgThumb);
      if (maxStage === avgThumb) {
        if (avgThumbRead > avgThumb * 0.6) {
          bottleneck = 'thumb-readback';
          hint = 'readPixels stall: reduce non-output thumb updates / thumb size';
        } else if (avgThumbCpu > avgThumb * 0.3) {
          bottleneck = 'thumb-cpu-copy';
          hint = 'CPU copy cost: lower thumb resolution or update rate for non-output nodes';
        } else {
          bottleneck = 'thumb-blit';
          hint = 'blit cost: reduce count of simultaneously active thumbnail updates';
        }
      } else if (maxStage === avgGraph) {
        bottleneck = 'graph';
        hint = 'shader passes dominate: simplify graph or reduce temporal/history effects';
      } else if (maxStage === avgCam) {
        bottleneck = 'camera-upload';
        hint = 'camera upload dominates: lower camera input resolution';
      }

      const msg = `[perf] fps=${_fpsSmooth.toFixed(1)} frame=${avgFrame.toFixed(2)}ms camera=${avgCam.toFixed(2)}ms graph=${avgGraph.toFixed(2)}ms thumbs=${avgThumb.toFixed(2)}ms (read=${avgThumbRead.toFixed(2)} cpu=${avgThumbCpu.toFixed(2)} blit=${avgThumbBlit.toFixed(2)}) nodes=${avgReads.toFixed(1)}/f bottleneck=${bottleneck} hint=${hint}`;
      if (_perfLogger) _perfLogger('info', msg);
      _perf.frames = 0;
      _perf.frameMs = 0;
      _perf.cameraMs = 0;
      _perf.graphMs = 0;
      _perf.thumbMs = 0;
      _perf.thumbBlitMs = 0;
      _perf.thumbReadMs = 0;
      _perf.thumbCpuMs = 0;
      _perf.thumbReads = 0;
      _perfLastLog = frameStart;
    }
  }

  ++frameN;
}

// ── Start ────────────────────────────────────────────────────────────────────

// ── Audio reactivity ─────────────────────────────────────────────────────────

export function initAudio(stream) {
  const actx = new AudioContext();
  const src  = actx.createMediaStreamSource(stream);
  audioAnalyser = actx.createAnalyser();
  audioAnalyser.fftSize = 512; // 256 frequency bins
  audioAnalyser.smoothingTimeConstant = 0.8;
  src.connect(audioAnalyser);
  audioData = new Uint8Array(256);
  audioRgba = new Uint8Array(256 * 4);

  // Create 256×1 RGBA texture for audio data
  audioTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, audioTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function _uploadAudio() {
  if (!audioAnalyser || !audioTex || !audioRgba) return;
  audioAnalyser.getByteFrequencyData(audioData);
  // Pack into RGBA: R=frequency, G=B=A=frequency (grayscale)
  for (let i = 0; i < 256; i++) {
    audioRgba[i * 4] = audioData[i];
    audioRgba[i * 4 + 1] = audioData[i];
    audioRgba[i * 4 + 2] = audioData[i];
    audioRgba[i * 4 + 3] = 255;
  }
  gl.bindTexture(gl.TEXTURE_2D, audioTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, audioRgba);
}

export function start(video) {
  t0 = performance.now();
  _videoW = video.videoWidth  || 1280;
  _videoH = video.videoHeight || 720;
  resize();
  ready = true;
  requestAnimationFrame(() => frame(video));
}
