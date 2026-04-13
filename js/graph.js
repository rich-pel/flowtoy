// ── Shader node graph — data model ───────────────────────────────────────────
// Nodes and edges only. No GL code here; renderer.js owns RT allocation.

// ─── Node type definitions ──────────────────────────────────────────────────

export const NODE_DEFS = {
  'source-cam':     { category: 'source', label: 'CAMERA',    outputs: ['out'], inputs: [] },
  'source-audio':   { category: 'source', label: 'AUDIO',     outputs: ['out'], inputs: [] },
  'buffer':         { category: 'buffer', label: 'BUFFER 5F',  outputs: ['out','p1','p2','p3','p4'], inputs: ['in'] },
  'effect':         { category: 'effect', label: 'EFFECT',    outputs: ['out'], inputs: [] },
  'output':         { category: 'output', label: 'OUTPUT',    outputs: [],      inputs: ['in'] },
};

// Returns the effective input port list for a node.
// If the node has a custom `inputs` array (set by shader detection), use that;
// otherwise fall back to NODE_DEFS.
export function getNodeInputs(node) {
  return node?.inputs ?? NODE_DEFS[node?.type]?.inputs ?? [];
}

// Returns the effective output port list for a node.
export function getNodeOutputs(node) {
  return NODE_DEFS[node?.type]?.outputs ?? [];
}

// Colors used by both graph.js and nodegraph.js
export const CATEGORY_STYLE = {
  source: { header: '#0a3a28', accent: '#00ffbb', dot: '#00ffbb' },
  buffer: { header: '#1a2a3a', accent: '#66ccff', dot: '#66ccff' },
  effect: { header: '#0d1e45', accent: '#4d88ff', dot: '#4d88ff' },
  output: { header: '#3d1e08', accent: '#ff9933', dot: '#ff9933' },
};



// ─── State ──────────────────────────────────────────────────────────────────

let _nextNodeId = 1;
let _nextEdgeId = 1;

export const nodes = new Map(); // id → Node
export const edges = new Map(); // id → Edge

// ─── Node CRUD ───────────────────────────────────────────────────────────────

export function addNode(type, x, y, opts = {}) {
  const id = _nextNodeId++;
  const def = NODE_DEFS[type];
  const node = {
    id,
    type,
    x, y,
    label:     opts.label     ?? def.label,
    effectIdx: opts.effectIdx ?? 0,
    effectName: opts.effectName ?? null,
    customSrc: opts.customSrc ?? null,
    inputs:    opts.inputs    ?? null, // per-node input ports (null = use NODE_DEFS default)
    params:    opts.params     ?? {},    // { uniformName: value } for custom shader params
    thumbRes:  opts.thumbRes   ?? null,   // output node thumbnail resolution [w,h] or null
    w:         opts.w          ?? null,   // custom width (null = NODE_W default)
    prog:      null,    // custom compiled program (if customSrc set)
    outTex:    null,    // resolved each frame by renderer
    outTexs:   {},      // multi-output: { portName: tex } for buffer nodes
    rt:        [null, null],  // ping-pong render targets (set by renderer)
    rtIdx:     0,
    dirty:     true,
    thumb:     null,    // { canvas, ctx } for live thumbnail
  };
  nodes.set(id, node);
  return node;
}

export function removeNode(id) {
  for (const [eid, e] of edges)
    if (e.fromNode === id || e.toNode === id) edges.delete(eid);
  nodes.delete(id);
}

// ─── Edge CRUD ───────────────────────────────────────────────────────────────

export function addEdge(fromNode, fromPort, toNode, toPort) {
  // Validate: both nodes exist, different nodes
  if (fromNode === toNode) return null;
  if (!nodes.has(fromNode) || !nodes.has(toNode)) return null;
  // Prevent cycle
  if (_wouldCycle(fromNode, toNode)) return null;
  // Remove existing edge into same input port (each input accepts 1 edge)
  for (const [eid, e] of edges)
    if (e.toNode === toNode && e.toPort === toPort) { edges.delete(eid); break; }
  const id = _nextEdgeId++;
  const edge = { id, fromNode, fromPort, toNode, toPort };
  edges.set(id, edge);
  return edge;
}

export function removeEdge(id) { edges.delete(id); }

export function getEdgeByInput(toNode, toPort) {
  for (const e of edges.values())
    if (e.toNode === toNode && e.toPort === toPort) return e;
  return null;
}

// ─── Graph algorithms ─────────────────────────────────────────────────────────

function _wouldCycle(from, to) {
  // Can we reach `from` starting from `to` following existing edges?
  // Buffer nodes break temporal cycles (they output previous frame data).
  const visited = new Set();
  const queue = [to];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === from) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    // Don't follow edges beyond buffer nodes — they break cycles
    const curNode = nodes.get(cur);
    if (curNode?.type === 'buffer') continue;
    for (const e of edges.values())
      if (e.fromNode === cur) queue.push(e.toNode);
  }
  return false;
}

export function topoSort() {
  // Kahn's algorithm
  // Buffer nodes' incoming edges are ignored for dependency ordering
  // because they output previous-frame data (temporal delay).
  const inDeg = new Map([...nodes.keys()].map(id => [id, 0]));
  for (const e of edges.values()) {
    const tn = nodes.get(e.toNode);
    if (tn?.type === 'buffer') continue; // buffer breaks dependency
    inDeg.set(e.toNode, (inDeg.get(e.toNode) ?? 0) + 1);
  }
  const queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const result = [];
  while (queue.length) {
    const id = queue.shift();
    result.push(id);
    for (const e of edges.values()) {
      if (e.fromNode !== id) continue;
      const tn = nodes.get(e.toNode);
      if (tn?.type === 'buffer') continue;
      const d = (inDeg.get(e.toNode) ?? 1) - 1;
      inDeg.set(e.toNode, d);
      if (d === 0) queue.push(e.toNode);
    }
  }
  // Append any buffer nodes not yet included (they might form self-feedback loops)
  for (const id of nodes.keys()) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

// Get the texture of the node connected to a given input port, or null.
export function getInputTex(nodeId, port) {
  for (const e of edges.values())
    if (e.toNode === nodeId && e.toPort === port) {
      const src = nodes.get(e.fromNode);
      // Multi-output nodes store textures in outTexs map
      if (src?.outTexs?.[e.fromPort]) return src.outTexs[e.fromPort];
      if (src?.outTex) return src.outTex;
    }
  return null;
}

export function getOutputNode() {
  for (const n of nodes.values()) if (n.type === 'output') return n;
  return null;
}

// ─── Save / Load ─────────────────────────────────────────────────────────────

export function serialize() {
  const ns = [...nodes.values()].map(n => ({
    id: n.id, type: n.type, x: n.x, y: n.y,
    label: n.label, effectIdx: n.effectIdx, effectName: n.effectName ?? null,
    customSrc: n.customSrc,
    inputs: n.inputs,
    params: n.params,
    w: n.w,
    thumbRes: n.thumbRes,
  }));
  const es = [...edges.values()];
  return JSON.stringify({ nodes: ns, edges: es, nextNodeId: _nextNodeId, nextEdgeId: _nextEdgeId });
}

export function deserialize(json) {
  try {
    const d = JSON.parse(json);
    nodes.clear();
    edges.clear();
    // Skip nodes whose type no longer exists (e.g. removed source-flow etc.)
    const validIds = new Set();
    for (const n of d.nodes) {
      if (!NODE_DEFS[n.type]) continue;
      nodes.set(n.id, { ...n, effectName: n.effectName ?? null, thumbRes: n.thumbRes ?? null, params: n.params ?? {}, prog: null, outTex: null, outTexs: {}, rt: [null, null], rtIdx: 0, dirty: true, thumb: null });
      validIds.add(n.id);
    }
    for (const e of d.edges) {
      if (!validIds.has(e.fromNode) || !validIds.has(e.toNode)) continue;
      // Skip edges from ports that no longer exist on the source node
      const fromDef = NODE_DEFS[nodes.get(e.fromNode)?.type];
      if (fromDef && !fromDef.outputs.includes(e.fromPort)) continue;
      // For effect nodes, skip port validation — inputs are dynamic (detected
      // from shader source after shaders are loaded). For other node types,
      // validate that the target port exists.
      const toNode = nodes.get(e.toNode);
      if (toNode && toNode.type !== 'effect') {
        if (!getNodeInputs(toNode).includes(e.toPort)) continue;
      }
      edges.set(e.id, e);
    }
    _nextNodeId = d.nextNodeId ?? (Math.max(1, ...[...nodes.keys()]) + 1);
    _nextEdgeId = d.nextEdgeId ?? (Math.max(1, ...[...edges.keys()]) + 1);
    return true;
  } catch (err) {
    console.error('[graph] deserialize failed:', err);
    return false;
  }
}

// ─── Default starter graph ────────────────────────────────────────────────────

export function buildDefaultGraph() {
  nodes.clear();
  edges.clear();
  _nextNodeId = 1;
  _nextEdgeId = 1;

  const cam    = addNode('source-cam',  80,  120);
  const out    = addNode('output',      580, 120);

  addEdge(cam.id,    'out', out.id, 'in');
}
