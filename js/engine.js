// ── WebGL2 engine core ────────────────────────────────────────────────────────

const canvas = document.getElementById('c');
export const gl = canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 not supported');

// ── Shader compiler ──────────────────────────────────────────────────────────

export function mkProg(vSrc, fSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER,   vSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  p.u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const inf = gl.getActiveUniform(p, i);
    p.u[inf.name] = gl.getUniformLocation(p, inf.name);
  }
  return p;
}

// ── Fullscreen quad VAO ──────────────────────────────────────────────────────

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const vbuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

// ── Render target helpers ────────────────────────────────────────────────────

export function mkRT(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export function delRT(rt) {
  if (!rt) return;
  gl.deleteTexture(rt.tex);
  gl.deleteFramebuffer(rt.fbo);
}

export function clearRT(rt) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
  gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
}

// ── History ring buffer (sampler2DArray for the one buffer node) ──────────────────

export function mkHistoryRT(w, h, depth) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbos = [];
  for (let i = 0; i < depth; i++) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, i);
    fbos.push(fbo);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbos, w, h, depth, _array: true };
}

export function delHistoryRT(hrt) {
  if (!hrt) return;
  gl.deleteTexture(hrt.tex);
  for (const fbo of hrt.fbos) gl.deleteFramebuffer(fbo);
}

export function clearHistoryRT(hrt) {
  for (let i = 0; i < hrt.depth; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, hrt.fbos[i]);
    gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

// ── Draw helpers ─────────────────────────────────────────────────────────────

// Tag integers so draw() calls uniform1i instead of uniform1f
export const I = v => ({ _i: v });

export function draw(prog, fbo, w, h, texs, unis) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo || null);
  gl.viewport(0, 0, w, h);
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
  let unit = 0;
  if (texs) for (const [k, tex] of Object.entries(texs)) {
    const loc = prog.u[k]; if (loc == null) continue;
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (tex && tex._array) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex.tex);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    gl.uniform1i(loc, unit++);
  }
  if (unis) for (const [k, val] of Object.entries(unis)) {
    const loc = prog.u[k]; if (loc == null) continue;
    if (val && val._i !== undefined)              gl.uniform1i(loc, val._i);
    else if (typeof val === 'number')             gl.uniform1f(loc, val);
    else if (val.length === 2)                    gl.uniform2fv(loc, val);
    else /* Float32Array or longer array */       gl.uniform4fv(loc, val);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

export function blit(prog, tex, x, y, w, h) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(x, y, w, h);
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.u['uT'], 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

// ── Camera texture ───────────────────────────────────────────────────────────

export const camTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, camTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

export { canvas };

// ── Default textures ─────────────────────────────────────────────────────────
// 1×1 black — used for unconnected input ports (no implicit camera leak)
export const blackTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, blackTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
