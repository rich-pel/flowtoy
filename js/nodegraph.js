// ── Node Graph Canvas UI ──────────────────────────────────────────────────────
// Interactive Canvas2D editor: pan/zoom, drag nodes, connect ports.

import {
  nodes, edges,
  NODE_DEFS, CATEGORY_STYLE,
  addNode, addEdge, removeEdge, getEdgeByInput,
  serialize, deserialize,
  getNodeInputs, getNodeOutputs,
} from './graph.js';

// ─── Visual constants ────────────────────────────────────────────────────────

const NODE_W    = 192;  // default node width
const NODE_MIN_W = 120; // minimum resize width
const HDR_H     = 28;   // title bar height
const THUMB_H   = 90;   // default thumbnail strip height (at NODE_W)
const PORT_H    = 22;   // height per port row
const PAD_B     = 10;   // bottom padding
const PORT_R    = 5.5;  // port dot radius
const NODE_R    = 7;    // node corner radius
const RESIZE_R  = 8;    // resize handle hit radius

function nodeW(node) { return node.w ?? NODE_W; }

function thumbH(node) {
  const w = nodeW(node);
  return Math.round(THUMB_H * w / NODE_W); // scale proportionally
}

function nodeHeight(node) {
  const def = NODE_DEFS[node.type];
  const ins = getNodeInputs(node);
  const outs = def.outputs;
  const rows = Math.max(ins.length, outs.length, 1);
  return HDR_H + thumbH(node) + rows * PORT_H + PAD_B;
}

// Port center in world coords
function outPortPos(node, portName) {
  const def = NODE_DEFS[node.type];
  if (!def.outputs.length) return null;
  const idx = portName ? def.outputs.indexOf(portName) : 0;
  if (idx < 0) return null;
  return { x: node.x + nodeW(node), y: node.y + HDR_H + thumbH(node) + idx * PORT_H + PORT_H / 2 };
}

function inPortPos(node, portName) {
  const ins = getNodeInputs(node);
  const idx = ins.indexOf(portName);
  if (idx < 0) return null;
  return { x: node.x, y: node.y + HDR_H + thumbH(node) + idx * PORT_H + PORT_H / 2 };
}

// ─── State ────────────────────────────────────────────────────────────────────

let cnv = null, ctx = null;
let panX = 0, panY = 0, zoom = 1.0;
let selSet = new Set();  // selected node ids (multi-select)
let hovId  = null; // hovered node id
let drag   = null; // { type:'node', id, startX, startY, origX, origY }
                   // { type:'pan',  startX, startY, origPanX, origPanY }
                   // { type:'marquee', startX, startY }
let connDrag = null; // { fromNode, fromPort, curX, curY }

// Callbacks – set by init()
let _onSelect    = null; // (id) → void
let _onDelete    = null; // (id) → void
let _onAdd       = null; // (type, wx, wy) → void
let _freeNodeRT  = null; // (node) → void  — called before deserialize in undo
let _ensureRT    = null; // (node) → void  — called after deserialize in undo
let _buildProg   = null; // (src) → prog   — compile custom shader for paste
let _savePreset  = null; // (name, selSet) → void — save selected nodes as preset

// Context menu (DOM)
let ctxMenu = null; // { el: DOM element }

// Undo history
let _undoStack = [];
const MAX_HIST = 30;

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSelectedId() { return selSet.size > 0 ? [...selSet][0] : null; }
export function setSelectedId(id) { selSet.clear(); if (id !== null) selSet.add(id); }
export function getSelectedIds() { return selSet; }
export function screenToWorld(cx, cy) { return toWorld(cx, cy); }
export function getCenterWorldPos() {
  if (!cnv) return { x: 200, y: 200 };
  return toWorld(cnv.offsetWidth / 2, cnv.offsetHeight / 2);
}

export function init(canvas, callbacks = {}) {
  cnv = canvas;
  ctx = canvas.getContext('2d', { alpha: false });
  _onSelect   = callbacks.onSelect   ?? null;
  _onDelete   = callbacks.onDelete   ?? null;
  _onAdd      = callbacks.onAdd      ?? null;
  _freeNodeRT = callbacks.freeNodeRT ?? null;
  _ensureRT   = callbacks.ensureRT   ?? null;
  _buildProg  = callbacks.buildProg  ?? null;
  _savePreset = callbacks.savePreset ?? null;

  canvas.addEventListener('mousedown',   _onMouseDown);
  canvas.addEventListener('mousemove',   _onMouseMove);
  canvas.addEventListener('mouseup',     _onMouseUp);
  canvas.addEventListener('wheel',       _onWheel,       { passive: false });
  canvas.addEventListener('contextmenu', _onContextMenu);

  document.addEventListener('keydown', _onKeyDown);
  document.addEventListener('mousedown', _dismissCtxMenu);

  // Set initial canvas size
  canvas.width  = canvas.offsetWidth  || 800;
  canvas.height = canvas.offsetHeight || 600;

  new ResizeObserver(() => {
    canvas.width  = canvas.offsetWidth  || 800;
    canvas.height = canvas.offsetHeight || 600;
  }).observe(canvas);

  // Self-sustaining render loop — throttled to ~30fps to reduce CPU load
  let _lastRender = 0;
  const loop = (ts) => {
    if (ts - _lastRender >= 33) { _lastRender = ts; render(); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function centerView() {
  if (!cnv) return;
  if (nodes.size === 0) { panX = 60; panY = 60; zoom = 1.0; return; }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const n of nodes.values()) {
    x0 = Math.min(x0, n.x);  x1 = Math.max(x1, n.x + nodeW(n));
    y0 = Math.min(y0, n.y);  y1 = Math.max(y1, n.y + nodeHeight(n));
  }
  const W = cnv.offsetWidth || 800, H = cnv.offsetHeight || 600;
  const margin = 60;
  zoom   = Math.min(1.4, Math.min((W - 2*margin) / (x1-x0+1), (H - 2*margin) / (y1-y0+1)));
  panX   = (W - (x1-x0) * zoom) / 2 - x0 * zoom;
  panY   = (H - (y1-y0) * zoom) / 2 - y0 * zoom;
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

function toWorld(cx, cy)  { return { x: (cx - panX) / zoom, y: (cy - panY) / zoom }; }
function toCanvas(wx, wy) { return { x: wx * zoom + panX,   y: wy * zoom + panY   }; }
function dist(x1, y1, x2, y2) { return Math.hypot(x2-x1, y2-y1); }

// ─── Hit testing ─────────────────────────────────────────────────────────────

function hitPort(wx, wy) {
  for (const [id, node] of nodes) {
    const ins = getNodeInputs(node);
    const def = NODE_DEFS[node.type];
    // Check output ports
    for (const pname of def.outputs) {
      const op = outPortPos(node, pname);
      if (op && dist(wx, wy, op.x, op.y) < PORT_R + 5) return { id, side:'out', port: pname };
    }
    for (const pname of ins) {
      const ip = inPortPos(node, pname);
      if (ip && dist(wx, wy, ip.x, ip.y) < PORT_R + 5) return { id, side:'in', port: pname };
    }
  }
  return null;
}

function hitNode(wx, wy) {
  // Draw order is insertion order; hit in reverse (top-most first)
  const ids = [...nodes.keys()].reverse();
  for (const id of ids) {
    const n = nodes.get(id);
    if (wx >= n.x && wx <= n.x + nodeW(n) && wy >= n.y && wy <= n.y + nodeHeight(n)) return id;
  }
  return null;
}

// Hit test for resize handle (bottom-right corner)
function hitResize(wx, wy) {
  const ids = [...nodes.keys()].reverse();
  for (const id of ids) {
    const n = nodes.get(id);
    const rx = n.x + nodeW(n);
    const ry = n.y + nodeHeight(n);
    if (dist(wx, wy, rx, ry) < RESIZE_R) return id;
  }
  return null;
}

// ─── Events ───────────────────────────────────────────────────────────────────

function _canvasPos(e) {
  const r = cnv.getBoundingClientRect();
  return { cx: e.clientX - r.left, cy: e.clientY - r.top };
}

function _onMouseDown(e) {
  if (ctxMenu) { _dismissCtxMenu(); return; }

  // Middle mouse or Alt+left → pan
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    drag = { type:'pan', startX: e.clientX, startY: e.clientY, origPanX: panX, origPanY: panY };
    cnv.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

  if (e.button !== 0) return;

  const { cx, cy } = _canvasPos(e);

  // Minimap click → pan to that world position
  if (_minimapClick(cx, cy)) return;

  const { x: wx, y: wy } = toWorld(cx, cy);

  // Port hit → start connection
  const ph = hitPort(wx, wy);
  if (ph) {
    if (ph.side === 'out') {
      _saveHistory();
      connDrag = { fromNode: ph.id, fromPort: ph.port, curX: wx, curY: wy };
    } else {
      // Disconnect existing edge from this input port and start re-routing it
      const existing = getEdgeByInput(ph.id, ph.port);
      if (existing) {
        _saveHistory();
        connDrag = { fromNode: existing.fromNode, fromPort: existing.fromPort, curX: wx, curY: wy };
        removeEdge(existing.id);
      }
    }
    return;
  }

  // Resize handle hit → start resize drag
  const rid = hitResize(wx, wy);
  if (rid !== null) {
    const n = nodes.get(rid);
    _select(rid);
    _saveHistory();
    drag = { type:'resize', id: rid, startX: wx, origW: nodeW(n) };
    cnv.style.cursor = 'ew-resize';
    return;
  }

  // Node hit → select + start drag
  const nid = hitNode(wx, wy);
  if (nid !== null) {
    if (e.shiftKey) {
      _select(nid, true); // additive toggle
    } else if (!selSet.has(nid)) {
      _select(nid);
    }
    const n = nodes.get(nid);
    _saveHistory(); // save PRE-drag state for undo
    // Save original positions for all selected nodes (group drag)
    const origins = new Map();
    for (const sid of selSet) {
      const sn = nodes.get(sid);
      if (sn) origins.set(sid, { x: sn.x, y: sn.y });
    }
    drag = { type:'node', id: nid, startX: wx, startY: wy, origX: n.x, origY: n.y, origins };
    // Bring to front: re-insert at end of Map
    nodes.delete(nid); nodes.set(nid, n);
    return;
  }

  // Empty → marquee or deselect
  if (!e.shiftKey) {
    _select(null);
  }
  drag = { type:'marquee', startX: wx, startY: wy };
}

function _onMouseMove(e) {
  const { cx, cy } = _canvasPos(e);
  const { x: wx, y: wy } = toWorld(cx, cy);

  if (drag?.type === 'pan') {
    panX = drag.origPanX + (e.clientX - drag.startX);
    panY = drag.origPanY + (e.clientY - drag.startY);
    return;
  }
  if (drag?.type === 'node') {
    const dx = wx - drag.startX;
    const dy = wy - drag.startY;
    // Move all selected nodes as a group
    if (drag.origins) {
      for (const [sid, orig] of drag.origins) {
        const sn = nodes.get(sid);
        if (sn) { sn.x = orig.x + dx; sn.y = orig.y + dy; }
      }
    } else {
      const n = nodes.get(drag.id);
      if (n) { n.x = drag.origX + dx; n.y = drag.origY + dy; }
    }
    return;
  }
  if (drag?.type === 'resize') {
    const n = nodes.get(drag.id);
    if (n) {
      n.w = Math.max(NODE_MIN_W, drag.origW + (wx - drag.startX));
      // Invalidate thumbnail so it redraws at new size
      n.thumb = null;
    }
    return;
  }
  if (drag?.type === 'marquee') {
    drag.curX = wx;
    drag.curY = wy;
    return;
  }
  if (connDrag) {
    connDrag.curX = wx;
    connDrag.curY = wy;
    return;
  }

  // Hover detection + resize cursor
  if (hitResize(wx, wy) !== null) {
    cnv.style.cursor = 'ew-resize';
  } else {
    cnv.style.cursor = '';
  }
  const ph = hitPort(wx, wy);
  hovId = ph ? ph.id : hitNode(wx, wy);
}

function _onMouseUp(e) {
  cnv.style.cursor = '';

  // Marquee selection: collect nodes inside rectangle
  if (drag?.type === 'marquee' && drag.curX !== undefined) {
    const x0 = Math.min(drag.startX, drag.curX);
    const x1 = Math.max(drag.startX, drag.curX);
    const y0 = Math.min(drag.startY, drag.curY);
    const y1 = Math.max(drag.startY, drag.curY);
    for (const [id, n] of nodes) {
      const nh = nodeHeight(n);
      if (n.x + nodeW(n) > x0 && n.x < x1 && n.y + nh > y0 && n.y < y1) {
        selSet.add(id);
      }
    }
    _onSelect?.(selSet.size > 0 ? [...selSet][0] : null);
  }
  drag = null;

  if (connDrag) {
    const { cx, cy } = _canvasPos(e);
    const { x: wx, y: wy } = toWorld(cx, cy);
    const ph = hitPort(wx, wy);
    if (ph && ph.side === 'in' && ph.id !== connDrag.fromNode) {
      if (addEdge(connDrag.fromNode, connDrag.fromPort, ph.id, ph.port)) {
        _saveHistory();
      }
    }
    connDrag = null;
  }
}

function _onWheel(e) {
  e.preventDefault();
  const { cx, cy } = _canvasPos(e);
  const factor   = e.deltaY < 0 ? 1.11 : 1 / 1.11;
  const newZoom  = Math.max(0.15, Math.min(5.0, zoom * factor));
  panX = cx - (cx - panX) * newZoom / zoom;
  panY = cy - (cy - panY) * newZoom / zoom;
  zoom = newZoom;
}

function _onContextMenu(e) {
  e.preventDefault();
  if (ctxMenu) { _dismissCtxMenu(); }

  const { cx, cy } = _canvasPos(e);
  const { x: wx, y: wy } = toWorld(cx, cy);
  const nid = hitNode(wx, wy);

  const items = nid !== null
    ? [
        { label: selSet.size > 1 ? `Delete ${selSet.size} Nodes` : 'Delete Node', icon: '✕', action: () => {
          if (selSet.size > 1) { for (const id of [...selSet]) _onDelete?.(id); }
          else _onDelete?.(nid);
          _select(null);
        }},
        { label: 'Duplicate',   icon: '⧉', action: () => { _dupNode(nid, wx + 30, wy + 30); } },
        { sep: true },
        { label: 'Disconnect All', icon: '⌀', action: () => { _disconnectNode(nid); _saveHistory(); } },
        ...( selSet.size > 1 ? [
          { sep: true },
          { label: 'Save as Preset', icon: '✳', action: () => {
            const name = prompt('Preset name:', 'My Preset');
            if (name?.trim()) _savePreset?.(name.trim(), selSet);
          }},
        ] : []),
      ]
    : [
        { label: 'SOURCES', header: true },
        { label: 'Camera',    action: () => _onAdd?.('source-cam', wx, wy) },
        { label: 'Buffer 5F', action: () => _onAdd?.('buffer', wx, wy) },
        { sep: true },
        { label: 'EFFECTS', header: true },
        { label: 'Add Effect Node', action: () => _onAdd?.('effect', wx, wy) },
        { sep: true },
        { label: 'OUTPUT', header: true },
        { label: 'Add Output Node', action: () => _onAdd?.('output', wx, wy) },
      ];

  _showCtxMenu(e.clientX, e.clientY, items);
}

function _onKeyDown(e) {
  // Don't intercept when user is typing in an input/textarea
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

  if ((e.key === 'Delete' || e.key === 'Backspace') && selSet.size > 0) {
    e.preventDefault();
    for (const id of [...selSet]) _onDelete?.(id);
    _select(null);
  }
  if (e.key === 'Escape') {
    connDrag = null;
    _dismissCtxMenu();
  }
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    e.preventDefault();
    _undo();
  }
  if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
      (e.key === 'z' && e.shiftKey && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    _redo();
  }
  // F key → fit/center view
  if (e.key === 'f' || e.key === 'F') centerView();
  // Copy / paste
  if (e.key === 'c' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _copy(); }
  if (e.key === 'v' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _paste(); }
  // Select all
  if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    selSet.clear();
    for (const id of nodes.keys()) selSet.add(id);
    _onSelect?.(selSet.size > 0 ? [...selSet][0] : null);
  }
}

// ─── Context Menu (DOM overlay) ───────────────────────────────────────────────

function _showCtxMenu(clientX, clientY, items) {
  const el = document.createElement('div');
  el.id = 'ng-ctx-menu';
  el.style.cssText = `
    position:fixed; left:${clientX+4}px; top:${clientY+4}px;
    background:#1a1a1e; border:1px solid rgba(255,255,255,0.12);
    border-radius:7px; padding:5px 0; min-width:160px;
    box-shadow:0 8px 32px rgba(0,0,0,0.7); z-index:9999;
    font:11px 'Courier New',monospace;
  `;

  for (const item of items) {
    if (item.sep) {
      const s = document.createElement('div');
      s.style.cssText = 'border-top:1px solid rgba(255,255,255,0.07); margin:4px 0;';
      el.appendChild(s);
    } else if (item.header) {
      const h = document.createElement('div');
      h.textContent = item.label;
      h.style.cssText = 'padding:5px 12px 3px; font-size:9px; letter-spacing:2px; color:rgba(255,255,255,0.28);';
      el.appendChild(h);
    } else {
      const btn = document.createElement('div');
      btn.style.cssText = 'padding:7px 14px; cursor:pointer; color:rgba(255,255,255,0.72); display:flex; gap:8px; align-items:center;';
      if (item.icon) {
        const ic = document.createElement('span');
        ic.textContent = item.icon;
        ic.style.cssText = 'color:rgba(255,255,255,0.35); font-size:10px; width:12px;';
        btn.appendChild(ic);
      }
      const lb = document.createElement('span');
      lb.textContent = item.label;
      btn.appendChild(lb);
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.07)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = ''; });
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _dismissCtxMenu();
        item.action?.();
      });
      el.appendChild(btn);
    }
  }

  // Clamp to viewport
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  if (r.right  > window.innerWidth  - 8) el.style.left = (clientX - r.width  - 4) + 'px';
  if (r.bottom > window.innerHeight - 8) el.style.top  = (clientY - r.height - 4) + 'px';

  ctxMenu = { el };
}

function _dismissCtxMenu(e) {
  if (!ctxMenu) return;
  if (e && e.target && ctxMenu.el.contains(e.target)) return;
  ctxMenu.el.remove();
  ctxMenu = null;
}

// ─── Node helpers ─────────────────────────────────────────────────────────────

function _select(id, additive = false) {
  if (additive && id !== null) {
    if (selSet.has(id)) selSet.delete(id);
    else selSet.add(id);
  } else {
    selSet.clear();
    if (id !== null) selSet.add(id);
  }
  // Fire callback with a single id for inspector (first selected or null)
  _onSelect?.(selSet.size > 0 ? [...selSet][0] : null);
}

function _dupNode(nid, nx, ny) {
  const src = nodes.get(nid);
  if (!src) return;
  _onAdd?.(src.type, nx, ny, { effectIdx: src.effectIdx, target: src.target, label: src.label + ' copy', customSrc: src.customSrc });
}

function _disconnectNode(nid) {
  for (const [eid, e] of edges)
    if (e.fromNode === nid || e.toNode === nid) edges.delete(eid);
}

// ─── Undo / Redo (simple stack: save state BEFORE each mutation) ──────────────────

function _saveHistory() {
  // push the state BEFORE the mutation (caller should call BEFORE mutating)
  _undoStack.push(serialize());
  if (_undoStack.length > MAX_HIST) _undoStack.shift();
}

function _undo() {
  if (!_undoStack.length) return;
  const snap = _undoStack.pop();
  // Free all current node RTs before overwriting node map
  for (const node of nodes.values()) _freeNodeRT?.(node);
  deserialize(snap);
  // Re-allocate RTs for restored nodes
  for (const node of nodes.values()) _ensureRT?.(node);
  selSet.clear();
  _onSelect?.(null);
}

function _redo() { /* redo not implemented — undo is simple stack only */ }

// ─── Clipboard (copy / paste selected nodes + internal edges) ─────────────────

let _clipboard = null; // { nodes: [...], edges: [...] }

function _copy() {
  if (selSet.size === 0) return;
  const cnodes = [];
  for (const id of selSet) {
    const n = nodes.get(id);
    if (!n) continue;
    cnodes.push({
      id: n.id, type: n.type, x: n.x, y: n.y,
      label: n.label, effectIdx: n.effectIdx, target: n.target,
      customSrc: n.customSrc, inputs: n.inputs,
    });
  }
  // Collect edges where both endpoints are in the selection
  const cedges = [];
  for (const e of edges.values()) {
    if (selSet.has(e.fromNode) && selSet.has(e.toNode)) {
      cedges.push({ ...e });
    }
  }
  _clipboard = { nodes: cnodes, edges: cedges };
}

function _paste() {
  if (!_clipboard || _clipboard.nodes.length === 0) return;
  _saveHistory();

  // Build ID mapping: old id → new node
  const idMap = new Map();
  const offset = 40;
  const newIds = new Set();

  for (const cn of _clipboard.nodes) {
    const nn = addNode(cn.type, cn.x + offset, cn.y + offset, {
      effectIdx: cn.effectIdx, target: cn.target,
      customSrc: cn.customSrc,
      inputs: cn.inputs ? [...cn.inputs] : undefined,
      label: cn.label,
    });
    nn.label = cn.label; // addNode may override label
    if (cn.customSrc) {
      try { nn.prog = _buildProg?.(cn.customSrc); } catch {}
    }
    _ensureRT?.(nn);
    idMap.set(cn.id, nn.id);
    newIds.add(nn.id);
  }

  // Recreate internal edges with remapped IDs
  for (const ce of _clipboard.edges) {
    const from = idMap.get(ce.fromNode);
    const to   = idMap.get(ce.toNode);
    if (from !== undefined && to !== undefined) {
      addEdge(from, ce.fromPort, to, ce.toPort);
    }
  }

  // Select newly pasted nodes
  selSet.clear();
  for (const id of newIds) selSet.add(id);
  _onSelect?.(selSet.size > 0 ? [...selSet][0] : null);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export function render() {
  if (!cnv || !ctx) return;
  const W = cnv.width, H = cnv.height;

  // Background
  ctx.fillStyle = '#0f0f11';
  ctx.fillRect(0, 0, W, H);

  // Dot grid
  _drawGrid(W, H);

  // Graph space
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  _drawEdges();
  if (connDrag) _drawConnDrag();
  for (const n of nodes.values()) _drawNode(n);

  // Marquee selection rectangle
  if (drag?.type === 'marquee' && drag.curX !== undefined) {
    ctx.save();
    const x = Math.min(drag.startX, drag.curX);
    const y = Math.min(drag.startY, drag.curY);
    const w = Math.abs(drag.curX - drag.startX);
    const h = Math.abs(drag.curY - drag.startY);
    ctx.fillStyle   = 'rgba(0,255,187,0.06)';
    ctx.strokeStyle = 'rgba(0,255,187,0.4)';
    ctx.lineWidth   = 1 / zoom;
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  ctx.restore();

  // ── Minimap ──────────────────────────────────────────────────────────────
  if (nodes.size > 0) _drawMinimap(W, H);
}

const MMAP_W = 140, MMAP_H = 90, MMAP_PAD = 10;

function _drawMinimap(W, H) {
  // World bounds of all nodes
  let wx0 = Infinity, wx1 = -Infinity, wy0 = Infinity, wy1 = -Infinity;
  for (const n of nodes.values()) {
    wx0 = Math.min(wx0, n.x);  wx1 = Math.max(wx1, n.x + nodeW(n));
    wy0 = Math.min(wy0, n.y);  wy1 = Math.max(wy1, n.y + nodeHeight(n));
  }
  const worldW = wx1 - wx0 + 40, worldH = wy1 - wy0 + 40;
  const s = Math.min(MMAP_W / worldW, MMAP_H / worldH);

  const mx = MMAP_PAD, my = H - MMAP_H - MMAP_PAD;

  // Background
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#111115';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(mx, my, MMAP_W, MMAP_H, 5);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  // Draw nodes as small rectangles
  for (const n of nodes.values()) {
    const rx = mx + (n.x - wx0 + 20) * s;
    const ry = my + (n.y - wy0 + 20) * s;
    const rw = Math.max(nodeW(n) * s, 3);
    const rh = Math.max(nodeHeight(n) * s, 2);
    const cs = CATEGORY_STYLE[NODE_DEFS[n.type].category];
    ctx.fillStyle = selSet.has(n.id) ? cs.accent : cs.header;
    ctx.fillRect(rx, ry, rw, rh);
  }

  // Viewport indicator
  const vx0 = mx + ((0 - panX) / zoom - wx0 + 20) * s;
  const vy0 = my + ((0 - panY) / zoom - wy0 + 20) * s;
  const vw  = (W / zoom) * s;
  const vh  = (H / zoom) * s;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.max(mx, vx0), Math.max(my, vy0),
    Math.min(vw, MMAP_W), Math.min(vh, MMAP_H)
  );

  ctx.restore();
}

function _minimapClick(cx, cy) {
  if (nodes.size === 0) return false;
  const W = cnv.width, H = cnv.height;
  const mx = MMAP_PAD, my = H - MMAP_H - MMAP_PAD;
  if (cx < mx || cx > mx + MMAP_W || cy < my || cy > my + MMAP_H) return false;

  // Recompute world bounds (same as _drawMinimap)
  let wx0 = Infinity, wx1 = -Infinity, wy0 = Infinity, wy1 = -Infinity;
  for (const n of nodes.values()) {
    wx0 = Math.min(wx0, n.x);  wx1 = Math.max(wx1, n.x + nodeW(n));
    wy0 = Math.min(wy0, n.y);  wy1 = Math.max(wy1, n.y + nodeHeight(n));
  }
  const worldW = wx1 - wx0 + 40, worldH = wy1 - wy0 + 40;
  const s = Math.min(MMAP_W / worldW, MMAP_H / worldH);

  // Map click position to world coordinates
  const worldX = (cx - mx) / s + wx0 - 20;
  const worldY = (cy - my) / s + wy0 - 20;

  // Center viewport on that world position
  panX = W / 2 - worldX * zoom;
  panY = H / 2 - worldY * zoom;
  return true;
}

function _drawGrid(W, H) {
  const gs  = 24 * zoom;
  const ox  = ((panX % gs) + gs) % gs;
  const oy  = ((panY % gs) + gs) % gs;
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = ox; x < W; x += gs)
    for (let y = oy; y < H; y += gs) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
}

function _drawEdges() {
  for (const e of edges.values()) {
    const fn = nodes.get(e.fromNode), tn = nodes.get(e.toNode);
    if (!fn || !tn) continue;
    const op = outPortPos(fn, e.fromPort), ip = inPortPos(tn, e.toPort);
    if (!op || !ip) continue;

    const fromCat = NODE_DEFS[fn.type]?.category ?? 'effect';
    const c1 = CATEGORY_STYLE[fromCat]?.accent ?? '#888';
    const toCat = NODE_DEFS[tn.type]?.category ?? 'effect';
    const c2 = CATEGORY_STYLE[toCat]?.accent ?? '#888';
    _bezier(op.x, op.y, ip.x, ip.y, c1, c2, 2);
  }
}

function _drawConnDrag() {
  const fn = nodes.get(connDrag.fromNode);
  if (!fn) return;
  const op = outPortPos(fn, connDrag.fromPort);
  if (!op) return;
  ctx.save();
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  _bezier(op.x, op.y, connDrag.curX, connDrag.curY, '#00ffbb', null);
  ctx.setLineDash([]);
  ctx.restore();
}

function _bezier(x1, y1, x2, y2, col1, col2, lw = 2) {
  const dx = Math.max(Math.abs(x2 - x1) * 0.55, 50);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);

  if (col2 && col2 !== col1) {
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, col1);
    grad.addColorStop(1, col2);
    ctx.strokeStyle = grad;
  } else {
    ctx.strokeStyle = col1;
  }
  ctx.lineWidth = lw / zoom;
  ctx.stroke();
}

function _drawNode(node) {
  const def  = NODE_DEFS[node.type];
  const cs   = CATEGORY_STYLE[def.category];
  const nx = node.x, ny = node.y;
  const nw = nodeW(node), nh = nodeHeight(node);
  const th = thumbH(node);
  const sel = selSet.has(node.id);
  const hov = node.id === hovId && !sel;

  ctx.save();

  // Node body
  _roundRect(nx, ny, nw, nh, NODE_R);
  ctx.fillStyle = hov ? '#232328' : '#192024';
  ctx.fill();
  if (sel) {
    // Outer glow ring — two concentric strokes, no shadowBlur
    ctx.strokeStyle = cs.accent + '30';
    ctx.lineWidth   = 6 / zoom;
    ctx.stroke();
    ctx.strokeStyle = cs.accent;
    ctx.lineWidth   = 1.5 / zoom;
    ctx.stroke();
  } else if (hov) {
    ctx.strokeStyle  = 'rgba(255,255,255,0.12)';
    ctx.lineWidth    = 1 / zoom;
    ctx.stroke();
  }

  // Title bar
  _roundRectTop(nx, ny, nw, HDR_H, NODE_R);
  ctx.fillStyle = cs.header;
  ctx.fill();

  // Accent left stripe on title
  ctx.fillStyle = cs.accent;
  ctx.fillRect(nx, ny + NODE_R, 3, HDR_H - NODE_R);
  ctx.beginPath(); // round the top of the stripe
  ctx.arc(nx + 1.5, ny + NODE_R, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Title text
  ctx.fillStyle   = 'rgba(255,255,255,0.88)';
  ctx.font        = `bold 11px 'Courier New', monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign   = 'left';
  ctx.fillText(node.label, nx + 12, ny + HDR_H / 2);

  // Custom indicator on title
  if (node.customSrc) {
    ctx.fillStyle = cs.accent;
    ctx.font      = '8px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('✎', nx + nw - 8, ny + HDR_H / 2);
  }

  // Thumbnail area
  const ty = ny + HDR_H;
  ctx.fillStyle = '#0c0c0e';
  ctx.fillRect(nx + 1, ty, nw - 2, th);
  if (node.thumb?.canvas) {
    ctx.drawImage(node.thumb.canvas, nx + 1, ty, nw - 2, th);
  } else {
    // Subtle placeholder
    ctx.fillStyle  = 'rgba(255,255,255,0.028)';
    ctx.fillRect(nx + 1, ty, nw - 2, th);
    ctx.fillStyle  = cs.accent + '28';
    ctx.font       = '9px Courier New';
    ctx.textAlign  = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('· · ·', nx + nw / 2, ty + th / 2);
  }

  // Separator line below thumbnail
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(nx, ty + th, nw, 1);

  // Per-node draw time overlay
  if (node._drawMs != null) {
    ctx.font = '8px Courier New';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const ms = node._drawMs.toFixed(1) + 'ms';
    ctx.fillRect(nx + nw - 40, ty + 2, 38, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(ms, nx + nw - 4, ty + 3);
  }

  // Input ports
  ctx.textAlign = 'left';
  const ins = getNodeInputs(node);
  const pcol = cs.dot;
  for (let i = 0; i < ins.length; i++) {
    const pname = ins[i];
    const ip    = inPortPos(node, pname);
    const connected = !!getEdgeByInput(node.id, pname);

    // Port glow during active connection drag
    if (connDrag && connDrag.fromNode !== node.id) {
      ctx.save();
      ctx.shadowColor = pcol;
      ctx.shadowBlur  = 14;
      ctx.beginPath();
      ctx.arc(ip.x, ip.y, PORT_R + 4, 0, Math.PI * 2);
      ctx.strokeStyle = pcol + 'aa';
      ctx.lineWidth   = 1.5 / zoom;
      ctx.stroke();
      ctx.restore();
    }

    // Port dot
    ctx.beginPath();
    ctx.arc(ip.x, ip.y, PORT_R, 0, Math.PI * 2);
    ctx.fillStyle   = connected ? pcol : 'transparent';
    ctx.fill();
    ctx.strokeStyle = pcol;
    ctx.lineWidth   = 1.5 / zoom;
    ctx.stroke();

    // Port name label
    ctx.font         = `10px 'Courier New', monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'left';
    ctx.fillStyle    = 'rgba(255,255,255,' + (connected ? '0.65' : '0.35') + ')';
    ctx.fillText(pname, ip.x + PORT_R + 6, ip.y);
  }

  // Output ports
  if (def.outputs.length > 0) {
    for (const pname of def.outputs) {
      const op = outPortPos(node, pname);
      if (!op) continue;
      const outCol  = cs.dot;
      const hasOut = [...edges.values()].some(e => e.fromNode === node.id && e.fromPort === pname);
      ctx.beginPath();
      ctx.arc(op.x, op.y, PORT_R, 0, Math.PI * 2);
      ctx.fillStyle   = hasOut ? outCol : 'transparent';
      ctx.fill();
      ctx.strokeStyle = outCol;
      ctx.lineWidth   = 1.5 / zoom;
      ctx.stroke();

      // Port name label
      ctx.font         = `10px 'Courier New', monospace`;
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'right';
      ctx.fillStyle    = 'rgba(255,255,255,' + (hasOut ? '0.65' : '0.35') + ')';
      ctx.fillText(pname, op.x - PORT_R - 6, op.y);
    }
  }

  // Resize handle (bottom-right grip)
  const gx = nx + nw, gy = ny + nh;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1 / zoom;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(gx - i * 3, gy);
    ctx.lineTo(gx, gy - i * 3);
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Shape helpers ────────────────────────────────────────────────────────────

function _roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x,     y,     x + r,   y,         r);
  ctx.closePath();
}

function _roundRectTop(x, y, w, h, r) {
  // Rounded top corners only
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
