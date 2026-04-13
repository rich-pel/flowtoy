// ── Shader loading, compilation, and hot-reload ──────────────────────────────

import { mkProg } from './engine.js';

// Shader source cache (for change detection)
const cache = {};

// Shared vertex shader source kept for individual re-compilation
let _vertSrc = '';

// Compiled programs — mutated in place on reload
export const P = { fx: [] };

// Folder-based shader manifest, populated by loadShaders().
// Each entry: { folder: string, label: string, shaders: string[] }
// Reflects the actual shaders/ directory structure returned by /api/shaders.
export let shaderManifest = null;

// Core utility shaders — engine internals referenced by renderer as P.cam, P.copy, P.blend.
// Discovered dynamically from the 'core' section of the manifest.
let UTIL_SHADERS = ['cam', 'copy', 'blend'];

// Effect shaders — populated entirely from /api/shaders manifest, never hardcoded.
export const EFFECT_NAMES = [];
const EFFECT_PATHS = {};

async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
  return r.text();
}

function syncFromManifest(manifest) {
  if (!Array.isArray(manifest)) return;

  // Discover core utility shader names from the 'core' section
  for (const section of manifest) {
    const folder = String(section?.folder || '');
    if (folder !== 'core') continue;
    const shaders = Array.isArray(section?.shaders) ? section.shaders : [];
    // Core shaders are whatever .frag.glsl files exist in shaders/core/
    UTIL_SHADERS = shaders.filter(n => typeof n === 'string' && n.length > 0);
  }

  // Discover effect shaders from all non-core sections
  for (const section of manifest) {
    const folder = String(section?.folder || '');
    if (folder === 'core') continue;
    const shaders = Array.isArray(section?.shaders) ? section.shaders : [];
    for (const name of shaders) {
      if (typeof name !== 'string' || name.length === 0) continue;
      EFFECT_PATHS[name] = `shaders/${folder}/${name}.frag.glsl`;
      if (!EFFECT_NAMES.includes(name)) EFFECT_NAMES.push(name);
    }
  }
}

// Load all shader source files
async function fetchAllSources() {
  const src = {};

  // Vertex shader (shared)
  src.vert = await fetchText('shaders/core/vert.glsl');

  // Utility fragment shaders (discovered from core folder)
  await Promise.all(UTIL_SHADERS.map(async name => {
    src[name] = await fetchText(`shaders/core/${name}.frag.glsl`);
  }));

  // Effect shaders (self-contained — no header/footer concatenation)
  await Promise.all(EFFECT_NAMES.map(async name => {
    try {
      const path = EFFECT_PATHS[name] || `shaders/fragment/${name}.frag.glsl`;
      src['fx_' + name] = await fetchText(path);
    } catch {
      src['fx_' + name] = null; // shader file not yet created
    }
  }));

  return src;
}

// Annotate a raw GL shader error with source-line context.
// Raw errors look like "ERROR: 0:6: 'would' : syntax error"
export function annotateShaderError(rawMsg, fragSrc, shaderName) {
  const lines = (fragSrc || '').split('\n');
  const parts = rawMsg.split('\n').filter(l => l.trim());
  const annotated = parts.map(part => {
    const m = part.match(/ERROR:\s*\d+:(\d+):(.*)/);
    if (!m) return part;
    const lineNo = parseInt(m[1], 10);
    const errDetail = m[2].trim();
    const srcLine = lines[lineNo - 1];
    let out = `Line ${lineNo}: ${errDetail}`;
    if (srcLine !== undefined) out += `\n  > ${srcLine.trimEnd()}`;
    return out;
  });
  const header = shaderName ? `[${shaderName}]` : '';
  return (header ? header + '\n' : '') + annotated.join('\n');
}

// Compile all programs from source map. Returns array of { name, message } errors.
function compileAll(src) {
  const errors = [];
  _vertSrc    = src.vert;

  for (const name of UTIL_SHADERS) {
    try {
      P[name] = mkProg(src.vert, src[name]);
    } catch (e) {
      errors.push({ name, message: annotateShaderError(e.message, src[name], name) });
    }
  }

  P.fx = EFFECT_NAMES.map((name, i) => {
    if (!src['fx_' + name]) return P.fx?.[i] ?? null;
    const frag = src['fx_' + name];
    try {
      return mkProg(src.vert, frag);
    } catch (e) {
      errors.push({ name: 'fx/' + name, message: annotateShaderError(e.message, frag, name + '.frag.glsl') });
      return P.fx?.[i] ?? null; // keep old program on compile error
    }
  });

  return errors;
}

// Returns the raw body source for a built-in effect (what the editor shows)
export function getEffectBody(idx) {
  return cache['fx_' + EFFECT_NAMES[idx]] ?? '';
}

// Compile a custom effect from full GLSL source
export function buildEffectProg(bodyGlsl) {
  return mkProg(_vertSrc, bodyGlsl);
}

// ── Detect input ports from shader source ────────────────────────────────────
// Scans for `uniform sampler2D uXxx;` declarations.
// Returns raw uniform names (uColor, uFlow, uPrev, etc.).
// All sampler2D uniforms become wirable input ports.

export function detectInputs(bodyGlsl) {
  const ports = [];
  const re = /uniform\s+sampler2D\s+(u[A-Z]\w*)\s*;/g;
  let m;
  while ((m = re.exec(bodyGlsl))) {
    const uName = m[1];
    if (!ports.includes(uName)) ports.push(uName);
  }
  return ports;
}

// Detect @temporal N annotation — returns N (number of history frames), or 0 if not temporal.
export function detectTemporal(bodyGlsl) {
  const m = /\/\/\s*@temporal\s+(\d+)/i.exec(bodyGlsl);
  return m ? parseInt(m[1], 10) : 0;
}

// Detect @output prev annotation — node outputs its previous frame instead of current.
export function detectOutputPrev(bodyGlsl) {
  return /\/\/\s*@output\s+prev\b/i.test(bodyGlsl);
}

// Detect inputs for a built-in effect by index
export function detectBuiltinInputs(idx) {
  const body = getEffectBody(idx);
  if (!body) return null; // shader file doesn't exist
  return detectInputs(body);
}

// Detect parameter annotations: // @param Name min max default
// Returns array of { name, uniform, min, max, default }
export function detectParams(bodyGlsl) {
  const params = [];
  const re = /\/\/\s*@param\s+(\w+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)/g;
  let m;
  while ((m = re.exec(bodyGlsl))) {
    params.push({
      name: m[1],
      uniform: 'u' + m[1],
      min: parseFloat(m[2]),
      max: parseFloat(m[3]),
      default: parseFloat(m[4]),
    });
  }
  return params;
}

// Initial load. Returns array of compile errors.
export async function loadShaders() {
  const manifest = await fetch('/api/shaders', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(d => (d?.sections && Array.isArray(d.sections)) ? d.sections : null)
    .catch(() => null);
  if (manifest) {
    shaderManifest = manifest;
    syncFromManifest(manifest);
  }
  const src = await fetchAllSources();
  Object.assign(cache, src);
  return compileAll(src);
}

// Hot-reload: re-fetch, recompile only changed shaders.
// Returns { changed: string[], errors: {name,message}[] }
export async function reloadShaders() {
  const manifest = await fetch('/api/shaders', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(d => (d?.sections && Array.isArray(d.sections)) ? d.sections : null)
    .catch(() => null);
  if (manifest) {
    shaderManifest = manifest;
    syncFromManifest(manifest);
  }

  const src = await fetchAllSources();
  const changed = [];

  for (const [key, val] of Object.entries(src)) {
    if (val !== cache[key]) changed.push(key);
  }

  let errors = [];
  if (changed.length > 0) {
    Object.assign(cache, src);
    errors = compileAll(src);
  }

  return { changed, errors };
}
