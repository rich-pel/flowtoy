// ── Entry point ──────────────────────────────────────────────────────────────

import { loadShaders, reloadShaders, EFFECT_NAMES, shaderManifest, buildEffectProg, detectInputs, detectBuiltinInputs, annotateShaderError } from './shaders.js';

// Resolve effectIdx from effectName for all effect nodes (handles EFFECT_NAMES reordering)
function resolveEffectIndices() {
  for (const node of nodes.values()) {
    if (node.type !== 'effect' || node.customSrc) continue;
    if (node.effectName) {
      const idx = EFFECT_NAMES.indexOf(node.effectName);
      if (idx >= 0) {
        node.effectIdx = idx;
      }
    }
    // Backfill effectName from effectIdx if missing (legacy saves)
    if (!node.effectName && EFFECT_NAMES[node.effectIdx]) {
      node.effectName = EFFECT_NAMES[node.effectIdx];
    }
  }
}

// Ensure all effect nodes have their inputs set (handles old saves + initial load)
function detectAllNodePorts() {
  for (const node of nodes.values()) {
    if (node.type !== 'effect') continue;
    if (node.customSrc) {
      node.inputs = detectInputs(node.customSrc);
    } else {
      node.inputs = detectBuiltinInputs(node.effectIdx);
    }
  }
}
import { initInspector, populateInspector, showErr, logConsole, clearConsole } from './ui.js';
import { start, initAudio, ensureNodeRT, freeNodeRT, setPerfLogger, setPerfEnabled } from './renderer.js';
import { gl } from './engine.js';
import {
  nodes, edges,
  addNode, removeNode, addEdge,
  serialize, deserialize, buildDefaultGraph,
  NODE_DEFS,
} from './graph.js';
import * as ng from './nodegraph.js';

const PRESETS_KEY = 'flowtoy-presets';

let _remoteLogSink = null;
function appLog(level, message) {
  logConsole(level, message);
  _remoteLogSink?.(level, message);
}

// ── Presets (saved node groups) ──────────────────────────────────────────────

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch { return []; }
}

function savePreset(name, selectedIds) {
  // Serialize selected nodes + internal edges
  const selNodes = [];
  for (const id of selectedIds) {
    const n = nodes.get(id);
    if (!n) continue;
    selNodes.push({
      id: n.id, type: n.type, x: n.x, y: n.y,
      label: n.label, effectIdx: n.effectIdx, target: n.target,
      customSrc: n.customSrc, inputs: n.inputs,
    });
  }
  const selEdges = [];
  for (const e of edges.values()) {
    if (selectedIds.has(e.fromNode) && selectedIds.has(e.toNode)) {
      selEdges.push({ ...e });
    }
  }
  const presets = loadPresets();
  presets.push({ name, nodes: selNodes, edges: selEdges });
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  buildPalette(); // refresh palette
}

// ── Video source ─────────────────────────────────────────────────────────────

const video = document.createElement('video');
video.playsInline = true; video.autoplay = true; video.muted = true;

let cameraActive = false;

function startCamera() {
  if (cameraActive) return;
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  }).then(stream => {
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      start(video);
      cameraActive = true;
      document.getElementById('start-btn').classList.add('live');
      document.getElementById('start-btn').textContent = '● LIVE';
    };
  }).catch(err => showErr('Camera error: ' + err.message));
}

// ── Node Graph callbacks ──────────────────────────────────────────────────────

function onNodeSelect(id) {
  populateInspector(id);
}

function onNodeDelete(id) {
  const node = nodes.get(id);
  if (node) {
    if (node.prog) { /* gl.deleteProgram handled by ui */ }
    freeNodeRT(node);
  }
  removeNode(id);
  // Rebuild palette selection indicator if needed
}

function onNodeAdd(type, wx, wy, opts = {}) {
  const node = addNode(type, wx, wy, opts);
  if (type === 'effect') {
    if (opts.customSrc) {
      node.customSrc = opts.customSrc;
      node.label = opts.label ?? 'CUSTOM';
      node.inputs = detectInputs(opts.customSrc);
      try { node.prog = buildEffectProg(opts.customSrc); } catch {}
    } else {
      node.effectName = EFFECT_NAMES[node.effectIdx] ?? null;
      node.label = opts.label ?? EFFECT_NAMES[node.effectIdx]?.toUpperCase() ?? 'EFFECT';
      node.inputs = detectBuiltinInputs(node.effectIdx);
    }
  }
  ensureNodeRT(node);
  ng.setSelectedId(node.id);
  populateInspector(node.id);
  return node;
}

// ── Palette ───────────────────────────────────────────────────────────────────

function buildPalette() {
  const list = document.getElementById('palette-list');
  const search = document.getElementById('palette-search');
  if (!list || !search) return;

  const sections = [
    {
      label: 'graph',
      items: [
        { type: 'source-cam', label: 'camera', cat: 'source', spawnable: true },
        { type: 'source-audio', label: 'audio', cat: 'source', spawnable: true },
        { type: 'buffer', label: 'buffer', cat: 'buffer', spawnable: true },
        { type: 'output', label: 'output', cat: 'output', spawnable: true },
      ],
    },
    ...(shaderManifest ?? [])
    .map(section => ({
      label: section?.label ?? section?.folder ?? 'shaders',
      items: (Array.isArray(section?.shaders) ? section.shaders : [])
        .map(name => {
          const idx = EFFECT_NAMES.indexOf(name);
          return {
            type: 'effect',
            effectIdx: idx,
            label: name,
            cat: idx >= 0 ? 'effect' : 'disabled',
            spawnable: idx >= 0,
          };
        }),
    }))
    .filter(section => section.items.length > 0),
  ];

  function render(filter = '') {
    list.innerHTML = '';
    const q = filter.trim().toLowerCase();
    let rendered = 0;

    for (const sec of sections) {
      const filtered = sec.items.filter(it => it.label.toLowerCase().includes(q));
      if (!filtered.length) continue;

      const secEl = document.createElement('div');
      secEl.className = 'palette-section';

      const hdr = document.createElement('div');
      hdr.className = 'palette-section-hdr';
      hdr.textContent = sec.label;
      secEl.appendChild(hdr);

      for (const item of filtered) {
        const row = document.createElement('div');
        row.className = `palette-item cat-${item.cat}`;
        if (!item.spawnable) row.classList.add('disabled');

        const dot = document.createElement('span');
        dot.className = 'palette-dot';
        const lbl = document.createElement('span');
        lbl.textContent = item.label;
        row.appendChild(dot);
        row.appendChild(lbl);

        row.title = item.spawnable
          ? `Click to add ${item.label} node`
          : `${item.label} is an internal shader and is not spawnable`;

        if (item.spawnable) {
          row.addEventListener('click', () => {
            const jitter = () => (Math.random() - 0.5) * 80;
            const center = ng.getCenterWorldPos();
            const opts = {};
            if (item.effectIdx !== undefined && item.effectIdx >= 0) {
              opts.effectIdx = item.effectIdx;
            }
            onNodeAdd(item.type, center.x + jitter(), center.y + jitter(), opts);
          });
        }

        secEl.appendChild(row);
        rendered += 1;
      }

      list.appendChild(secEl);
    }

    if (rendered === 0) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = sections.length
        ? 'No shaders match the current search.'
        : 'No shader folders were found from /api/shaders.';
      list.appendChild(empty);
    }
  }

  render(search.value);
  search.oninput = () => render(search.value);
}

// ── Resizable panels ──────────────────────────────────────────────────────────

function initResize() {
  const root = document.documentElement;

  // Legacy key from removed bottom preview pane
  localStorage.removeItem('ng-preview-h');

  // Load saved sizes
  const savedLeft    = localStorage.getItem('ng-left-w');
  const savedRight   = localStorage.getItem('ng-right-w');
  if (savedLeft)    root.style.setProperty('--left-w',    savedLeft    + 'px');
  if (savedRight)   root.style.setProperty('--right-w',   savedRight   + 'px');

  function makeVResize(handleId, panelId, cssVar, saveKey) {
    const handle = document.getElementById(handleId);
    if (!handle) return;
    handle.addEventListener('mousedown', e => {
      const startX = e.clientX;
      const startW = document.getElementById(panelId).offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      const onMove = e => {
        const delta = handleId === 'left-resize' ? e.clientX - startX : startX - e.clientX;
        const newW  = Math.max(140, Math.min(520, startW + delta));
        root.style.setProperty(cssVar, newW + 'px');
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        localStorage.setItem(saveKey, parseInt(root.style.getPropertyValue(cssVar)));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      e.preventDefault();
    });
  }

  makeVResize('left-resize',  'panel-left',  '--left-w',  'ng-left-w');
  makeVResize('right-resize', 'panel-right', '--right-w', 'ng-right-w');
}

// ── Topbar actions ────────────────────────────────────────────────────────────

function initTopbar() {
  // Start-btn → camera
  document.getElementById('start-btn').addEventListener('click', startCamera);

  // Audio button
  document.getElementById('audio-btn').addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      initAudio(stream);
      const btn = document.getElementById('audio-btn');
      btn.textContent = '🎤 LIVE';
      btn.classList.add('live');
    } catch (e) {
      console.warn('Audio access denied:', e);
    }
  });

  // New graph
  document.getElementById('btn-new').addEventListener('click', () => {
    if (!confirm('Start a new graph? Unsaved changes will be lost.')) return;
    // Free existing node RTs BEFORE clearing the graph
    for (const n of nodes.values()) freeNodeRT(n);
    buildDefaultGraph();
    detectAllNodePorts();
    for (const n of nodes.values()) ensureNodeRT(n);
    ng.setSelectedId(null);
    ng.centerView();
    populateInspector(null);
  });

  // Save
  document.getElementById('btn-save').addEventListener('click', () => {
    try {
      localStorage.setItem('flowtoy-graph', serialize());
      _flashBtn('btn-save', 'SAVED ✓');
    } catch (e) {
      showErr('Save failed: ' + e.message);
    }
  });

  // Load
  document.getElementById('btn-load').addEventListener('click', () => {
    const saved = localStorage.getItem('flowtoy-graph');
    if (!saved) { alert('No saved graph found.'); return; }
    // Free existing node RTs first
    for (const n of nodes.values()) {
      freeNodeRT(n);
    }
    if (deserialize(saved)) {
      detectAllNodePorts();
      // Re-allocate RTs for all non-source nodes (renderer does this lazily)
      ng.setSelectedId(null);
      ng.centerView();
      populateInspector(null);
      _flashBtn('btn-load', 'LOADED ✓');
    } else {
      showErr('Failed to load graph.');
    }
  });

  // Fit / center view
  document.getElementById('btn-fit').addEventListener('click', () => {
    ng.centerView();
  });

  // Compile all — reload shader files + recompile every custom node program
  document.getElementById('btn-compile').addEventListener('click', compileGraph);

  // Profiler toggle (no browser console required)
  const profBtn = document.getElementById('btn-prof');
  if (profBtn) {
    const applyProfUi = (enabled) => {
      profBtn.textContent = enabled ? 'PROF ON' : 'PROF OFF';
      profBtn.classList.toggle('live', enabled);
    };
    const isEnabled = localStorage.getItem('flowtoy-profiler') === '1';
    setPerfEnabled(isEnabled);
    applyProfUi(isEnabled);

    profBtn.addEventListener('click', () => {
      const next = localStorage.getItem('flowtoy-profiler') !== '1';
      setPerfEnabled(next);
      applyProfUi(next);
      logConsole('info', `Profiler ${next ? 'enabled' : 'disabled'}`);
    });
  }
}

function _flashBtn(id, text) {
  const btn = document.getElementById(id);
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// ── Compile graph ─────────────────────────────────────────────────────────────
// Reloads all .glsl files from disk, recompiles every custom node program,
// and logs results to the console panel.

async function compileGraph() {
  clearConsole();
  const btn = document.getElementById('btn-compile');
  btn.disabled = true;
  btn.classList.add('running');

  logConsole('info', 'Reloading pipeline shaders from disk…');

  // 1. Reload all .glsl files and recompile pipeline shaders
  try {
    const { changed, errors } = await reloadShaders();
    buildPalette();
    detectAllNodePorts();
    populateInspector(ng.getSelectedId());
    if (changed.length > 0) {
      logConsole('info', `${changed.length} file(s) changed and recompiled`);
    } else {
      logConsole('info', 'No shader files changed on disk');
    }
    for (const e of errors) {
      logConsole('error', e.message);
    }
    if (errors.length === 0 && changed.length > 0) {
      logConsole('ok', 'Pipeline shaders: all OK');
    }
  } catch (e) {
    logConsole('error', 'Shader reload failed: ' + e.message);
  }

  // 2. Recompile every custom-shader node in the current graph
  let nOk = 0, nFail = 0;
  for (const node of nodes.values()) {
    if (!node.customSrc) continue;
    try {
      if (node.prog) { gl.deleteProgram(node.prog); node.prog = null; }
      node.prog  = buildEffectProg(node.customSrc);
      node.dirty = true;
      nOk++;
      logConsole('ok', `"${node.label}" — compiled OK`);
    } catch (e) {
      nFail++;
      const msg = annotateShaderError(e.message, node.customSrc, node.label);
      logConsole('error', msg);
    }
  }

  if (nOk + nFail === 0) {
    logConsole('info', 'No custom shader nodes in graph');
  } else {
    const summary = `${nOk + nFail} custom node(s): ${nOk} OK${nFail ? ', ' + nFail + ' failed' : ''}`;
    logConsole(nFail > 0 ? 'warn' : 'ok', summary);
  }

  btn.disabled = false;
  btn.classList.remove('running');
}

// ── Auto-save on unload ───────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
  try { localStorage.setItem('flowtoy-graph', serialize()); } catch {}
});

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Wire camera button immediately (never blocked by shader errors)
  initTopbar();
  initResize();

  // Load or build graph
  const saved = localStorage.getItem('flowtoy-graph');
  if (saved) {
    deserialize(saved);
  }
  // Fall back to default if nothing loaded (e.g. all old node types were pruned)
  if (nodes.size === 0) {
    buildDefaultGraph();
  }

  // Set up inspector
  initInspector(
    () => { populateInspector(ng.getSelectedId()); },
    async (name, src) => {
      buildPalette();
      // Also save to file via dev server
      try {
        const fname = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const r = await fetch('/api/save-shader', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: fname, src }),
        });
        if (r.ok) {
          const d = await r.json();
          logConsole('ok', `Saved to ${d.path}`);
        } else {
          const d = await r.json().catch(() => ({}));
          logConsole('warn', `File save failed: ${d.error || r.statusText}`);
        }
      } catch {
        logConsole('info', 'Dev server not available — saved to library only');
      }
    },
  );

  // Optional runtime profiler hook
  const sendPerfLog = (level, message) => {
    const payload = JSON.stringify({
      kind: 'perf',
      level,
      message,
      ts: new Date().toISOString(),
    });
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/log', blob);
        return;
      }
    } catch {}
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  };

  setPerfLogger((level, msg) => {
    logConsole(level, msg);
    sendPerfLog(level, msg);
  });
  // Init node graph canvas
  ng.init(document.getElementById('graph-canvas'), {
    onSelect:    onNodeSelect,
    onDelete:    onNodeDelete,
    onAdd:       onNodeAdd,
    freeNodeRT:  (node) => freeNodeRT(node),
    ensureRT:    (node) => ensureNodeRT(node),
    buildProg:   (src) => buildEffectProg(src),
    savePreset:  (name, selSet) => savePreset(name, selSet),
  });

  // Center graph view after a tick (so canvas has gotten its size)
  requestAnimationFrame(() => ng.centerView());

  // Build a fallback palette immediately (rebuilt after shader load).
  buildPalette();

  // Load shaders
  try {
    const errors = await loadShaders();
    buildPalette();
    if (errors.length === 0) {
      logConsole('ok', 'All pipeline shaders compiled OK');
    } else {
      for (const e of errors) logConsole('error', e.message);
      logConsole('warn', `${errors.length} shader compile error(s) on startup`);
    }
  } catch (e) {
    buildPalette();
    showErr('Shader error: ' + e.message);
    logConsole('error', 'Fatal shader load error: ' + e.message);
    console.error('[shaders]', e);
    // Don't return — camera still works
  }

  // Resolve effect indices and detect dynamic inputs (needs shader bodies loaded)
  resolveEffectIndices();
  detectAllNodePorts();
}

init();
