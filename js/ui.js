// ── Inspector panel + HUD overlay ───────────────────────────────────────────

import { nodes, NODE_DEFS, CATEGORY_STYLE, getNodeInputs } from './graph.js';
import { EFFECT_NAMES, getEffectBody, buildEffectProg, detectInputs, detectBuiltinInputs, detectParams } from './shaders.js';
import { gl } from './engine.js';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const nodeName      = document.getElementById('node-name');
const nodeEffect    = document.getElementById('node-effect');
const shaderEditor  = document.getElementById('shader-editor');
const editorError   = document.getElementById('editor-error');
const applyBtn      = document.getElementById('apply-btn');
const resetBtn      = document.getElementById('reset-btn');
const saveFxBtn     = document.getElementById('save-fx-btn');
const rowEffect     = document.getElementById('row-effect');
const rowSourceInfo = document.getElementById('row-source-info');
const rowPorts      = document.getElementById('row-ports');
const portTypesWrap = document.getElementById('port-types-wrap');
const rowParams     = document.getElementById('row-params');
const sourceLabel   = document.getElementById('source-stage-label');
const inspHdr       = document.getElementById('inspector-hdr');
const consoleOutput = document.getElementById('console-output');
const consoleErrBadge = document.getElementById('console-err-badge');
const rowOutputRes  = document.getElementById('row-output-res');
const outResW       = document.getElementById('out-res-w');
const outResH       = document.getElementById('out-res-h');

const SOURCE_STAGE_NAMES = {
  'source-cam':     'CAMERA',
  'source-audio':   'AUDIO FFT',
};

// ── Current selected node id ─────────────────────────────────────────────────

let _selId = null;

// Rebuild effect dropdown from current EFFECT_NAMES
function _populateEffectDropdown() {
  nodeEffect.innerHTML = '';
  for (let i = 0; i < EFFECT_NAMES.length; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = EFFECT_NAMES[i].toUpperCase();
    nodeEffect.appendChild(opt);
  }
}

function _highlightResPreset(res) {
  for (const btn of document.querySelectorAll('.res-preset')) {
    const bw = parseInt(btn.dataset.w, 10);
    const bh = parseInt(btn.dataset.h, 10);
    const match = (!res && bw === 0) || (res && res[0] === bw && res[1] === bh);
    btn.classList.toggle('active', match);
  }
}

// ── Populate inspector for selected node ─────────────────────────────────────

export function populateInspector(nodeId) {
  _selId = nodeId;
  const node = nodeId !== null ? nodes.get(nodeId) : null;

  if (!node) {
    // Nothing selected
    nodeName.value   = '';
    nodeName.placeholder = 'no node selected';
    nodeName.disabled = true;
    rowEffect.style.display     = 'none';
    rowParams.style.display     = 'none';
    rowSourceInfo.style.display = 'none';
    rowOutputRes.style.display  = 'none';
    shaderEditor.value   = '';
    shaderEditor.disabled = true;
    applyBtn.disabled    = true;
    resetBtn.disabled    = true;
    saveFxBtn.disabled   = true;
    editorError.textContent = '';
    return;
  }

  const def    = NODE_DEFS[node.type];
  const cat    = def.category;
  const cs     = CATEGORY_STYLE[cat];

  // Header accent color
  inspHdr.style.borderBottom = `2px solid ${cs.accent}44`;

  // Name
  nodeName.disabled = false;
  nodeName.value    = node.label;

  editorError.textContent = '';

  if (cat === 'source' || cat === 'buffer') {
    rowEffect.style.display     = 'none';
    rowSourceInfo.style.display = '';
    rowPorts.style.display      = 'none';
    rowOutputRes.style.display  = 'none';
    sourceLabel.textContent     = SOURCE_STAGE_NAMES[node.type] ?? node.label;
    shaderEditor.value   = '';
    shaderEditor.disabled = true;
    applyBtn.disabled    = true;
    resetBtn.disabled    = true;
    saveFxBtn.disabled   = true;

  } else if (cat === 'output') {
    rowEffect.style.display     = 'none';
    rowSourceInfo.style.display = 'none';
    rowPorts.style.display      = 'none';
    rowOutputRes.style.display  = '';
    shaderEditor.value   = '';
    shaderEditor.disabled = true;
    applyBtn.disabled    = true;
    resetBtn.disabled    = true;
    saveFxBtn.disabled   = true;
    // Populate thumbnail resolution fields
    const res = node.thumbRes;
    outResW.value = res ? res[0] : '';
    outResH.value = res ? res[1] : '';
    outResW.placeholder = '160';
    outResH.placeholder = '90';
    _highlightResPreset(res);

  } else if (cat === 'effect') {
    rowEffect.style.display     = '';
    rowSourceInfo.style.display = 'none';
    rowPorts.style.display      = '';
    rowOutputRes.style.display  = 'none';
    _buildPortList(node);
    _buildParams(node);
    _populateEffectDropdown();
    nodeEffect.disabled  = false;
    nodeEffect.value     = node.effectIdx;
    shaderEditor.disabled = false;
    applyBtn.disabled    = false;
    resetBtn.disabled    = false;
    saveFxBtn.disabled   = false;
    shaderEditor.value   = node.customSrc !== null ? node.customSrc : getEffectBody(node.effectIdx);
  }
}

// ── Wire inspector events ─────────────────────────────────────────────────────

export function initInspector(onNodeChanged, onSaveFx) {
  // Console toggle (click header row)
  document.getElementById('console-hdr').addEventListener('click', e => {
    if (e.target.classList.contains('console-ctrl')) return; // button handles itself
    const panel = document.getElementById('console-panel');
    const btn   = document.getElementById('console-toggle-btn');
    panel.classList.toggle('collapsed');
    btn.textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
  });
  document.getElementById('console-toggle-btn').addEventListener('click', e => {
    e.stopPropagation();
    const panel = document.getElementById('console-panel');
    const btn   = document.getElementById('console-toggle-btn');
    panel.classList.toggle('collapsed');
    btn.textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
  });
  document.getElementById('console-clear-btn').addEventListener('click', e => {
    e.stopPropagation();
    clearConsole();
  });

  // Tab → spaces in shader editor
  shaderEditor.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = shaderEditor.selectionStart, end = shaderEditor.selectionEnd;
      shaderEditor.value = shaderEditor.value.substring(0, s) + '  ' + shaderEditor.value.substring(end);
      shaderEditor.selectionStart = shaderEditor.selectionEnd = s + 2;
    }
  });

  // Rename node
  nodeName.addEventListener('input', () => {
    const node = _selId !== null ? nodes.get(_selId) : null;
    if (!node) return;
    node.label = nodeName.value.trim() || NODE_DEFS[node.type].label;
    onNodeChanged?.(_selId);
  });

  // Effect change
  nodeEffect.addEventListener('change', () => {
    const node = _selId !== null ? nodes.get(_selId) : null;
    if (!node) return;
    if (node.prog) { gl.deleteProgram(node.prog); node.prog = null; }
    node.effectIdx = +nodeEffect.value;
    node.label     = EFFECT_NAMES[node.effectIdx].toUpperCase();
    node.customSrc = null;
    node.inputs    = detectBuiltinInputs(node.effectIdx);
    node.dirty     = true;
    // Update shader editor
    shaderEditor.value = getEffectBody(node.effectIdx);
    _buildPortList(node);
    onNodeChanged?.(_selId);
  });

  // Apply custom shader
  applyBtn.addEventListener('click', () => {
    const node = _selId !== null ? nodes.get(_selId) : null;
    if (!node) return;
    const src = shaderEditor.value;
    try {
      const prog = buildEffectProg(src);
      if (node.prog) gl.deleteProgram(node.prog);
      node.prog      = prog;
      node.customSrc = src;
      node.inputs    = detectInputs(src);
      node.dirty     = true;
      editorError.textContent = '';
      _buildPortList(node);
      _buildParams(node);
      onNodeChanged?.(_selId);
    } catch (err) {
      editorError.textContent = err.message;
    }
  });

  // Save custom shader to library
  saveFxBtn.addEventListener('click', () => {
    const node = _selId !== null ? nodes.get(_selId) : null;
    if (!node) return;
    const src = shaderEditor.value.trim();
    if (!src) return;
    const name = prompt('Save effect as:', node.label || 'MY EFFECT');
    if (!name?.trim()) return;
    onSaveFx?.(name.trim(), src);
  });

  // Reset to built-in shader
  resetBtn.addEventListener('click', () => {
    const node = _selId !== null ? nodes.get(_selId) : null;
    if (!node) return;
    if (node.prog) { gl.deleteProgram(node.prog); node.prog = null; }
    node.customSrc  = null;
    node.dirty      = true;
    shaderEditor.value = getEffectBody(node.effectIdx);
    editorError.textContent = '';
    _buildPortList(node); // refresh ports (custom overrides gone)
  });

  // Output thumbnail resolution inputs
  const _applyRes = () => {
    const node = _selId !== null ? nodes.get(_selId) : null;
    if (!node || NODE_DEFS[node.type].category !== 'output') return;
    const w = parseInt(outResW.value, 10) || 0;
    const h = parseInt(outResH.value, 10) || 0;
    node.thumbRes = (w && h) ? [w, h] : null;
    _highlightResPreset(node.thumbRes);
  };
  outResW.addEventListener('change', _applyRes);
  outResH.addEventListener('change', _applyRes);

  // Resolution preset buttons
  for (const btn of document.querySelectorAll('.res-preset')) {
    btn.addEventListener('click', () => {
      const w = parseInt(btn.dataset.w, 10);
      const h = parseInt(btn.dataset.h, 10);
      outResW.value = w || '';
      outResH.value = h || '';
      _applyRes();
    });
  }
}

// ── Port list section ────────────────────────────────────────────────────────

function _buildPortList(node) {
  portTypesWrap.innerHTML = '';
  const def = NODE_DEFS[node.type];
  const cs  = CATEGORY_STYLE[def.category];
  const allPorts = [
    ...getNodeInputs(node).map(p  => ({ name: p, side: 'in'  })),
    ...def.outputs.map(p => ({ name: p, side: 'out' })),
  ];

  for (const { name, side } of allPorts) {
    const row = document.createElement('div');
    row.className = 'port-type-row';

    const dot = document.createElement('span');
    dot.className = 'port-type-dot';
    dot.style.background = cs.dot;

    const label = document.createElement('span');
    label.className = 'port-type-name';
    label.textContent = side === 'out' ? `${name} ▸` : `◂ ${name}`;

    row.appendChild(dot);
    row.appendChild(label);
    portTypesWrap.appendChild(row);
  }
}

function _buildParams(node) {
  rowParams.innerHTML = '';
  const src = node.customSrc ?? getEffectBody(node.effectIdx);
  if (!src) { rowParams.style.display = 'none'; return; }
  const params = detectParams(src);
  if (params.length === 0) { rowParams.style.display = 'none'; return; }

  rowParams.style.display = '';
  // Initialize missing param values to defaults
  if (!node.params) node.params = {};
  for (const p of params) {
    if (!(p.uniform in node.params)) node.params[p.uniform] = p.default;
  }

  for (const p of params) {
    const row = document.createElement('div');
    row.className = 'insp-row';

    const label = document.createElement('span');
    label.className = 'insp-label';
    label.textContent = p.name;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = p.min;
    slider.max = p.max;
    slider.step = (p.max - p.min) / 100;
    slider.value = node.params[p.uniform] ?? p.default;
    slider.style.flex = '1';

    const valLabel = document.createElement('span');
    valLabel.style.minWidth = '36px';
    valLabel.style.textAlign = 'right';
    valLabel.style.fontSize = '10px';
    valLabel.textContent = parseFloat(slider.value).toFixed(2);

    slider.addEventListener('input', () => {
      node.params[p.uniform] = parseFloat(slider.value);
      valLabel.textContent = parseFloat(slider.value).toFixed(2);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valLabel);
    rowParams.appendChild(row);
  }
}

// ── Console panel ─────────────────────────────────────────────────────────────

let _errCount = 0;

export function logConsole(level, message) {
  const t   = new Date();
  const ts  = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;

  const line  = document.createElement('div');
  line.className = 'con-line';

  const time = document.createElement('span');
  time.className = 'con-time';
  time.textContent = ts;

  const badge = document.createElement('span');
  badge.className = `con-badge ${level}`;
  badge.textContent = level.toUpperCase();

  const msg = document.createElement('span');
  msg.className = `con-msg ${level}`;
  msg.textContent = message;

  line.appendChild(time);
  line.appendChild(badge);
  line.appendChild(msg);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'con-copy';
  copyBtn.textContent = '⎘';
  copyBtn.title = 'Copy to clipboard';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(message).then(() => {
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '⎘'; }, 1200);
    });
  });
  line.appendChild(copyBtn);

  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;

  if (level === 'error' || level === 'warn') {
    _errCount++;
    consoleErrBadge.textContent = _errCount;
    consoleErrBadge.style.display = '';
    // Auto-expand if collapsed
    document.getElementById('console-panel').classList.remove('collapsed');
    document.getElementById('console-toggle-btn').textContent = '▾';
  }
}

export function clearConsole() {
  consoleOutput.innerHTML = '';
  _errCount = 0;
  consoleErrBadge.style.display = 'none';
}

// ── Error display ─────────────────────────────────────────────────────────────

export function showErr(msg) {
  const el = document.getElementById('err-msg');
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}
