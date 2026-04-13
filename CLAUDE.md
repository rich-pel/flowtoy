# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DanceCam (branded "FlowToy") is a WebGL2 application that applies real-time visual effects to a webcam feed. The UI is a **custom Canvas2D shader node graph** — users wire source nodes → effect nodes → output nodes to build their own processing pipeline (e.g., Camera → Optical Flow → Trails → Output). No build system, bundler, or package manager — just ES modules served from files.
Pure GLSL Code writing with visual feedback for GLSL devs, understandable without hidden engiens or functions.


## Running

Use the dev server for shader hot-reload support:
```
python3 dev-server.py
# → http://localhost:8000

# Optional: write profiler/app logs to a file
python3 dev-server.py --log /tmp/flowtoy.log
```
Shaders auto-reload when their file is saved. The `/api/shader-mtime` endpoint lets the client poll for changes. The `/api/save-shader` endpoint (POST) writes shader source to disk when using the "Save" button in the inspector.
The `/api/shaders` endpoint returns the current `shaders/fragment/` folder structure so the node palette can mirror it directly.
Profiler logs can be toggled in-app with the topbar `PROF` button and are written to file via `/api/log` when `--log` is enabled.

## Project Structure

```
index.html              3-zone layout: topbar + palette | graph | inspector
css/style.css           Dark tool theme; CSS vars --left-w, --right-w
js/
  main.js               Entry point: camera, node callbacks, palette, resize, topbar
  engine.js             WebGL2 core: mkProg, draw, blit, mkRT/delRT, mkHistoryRT, camTex
  shaders.js            Fetches .glsl files, compiles programs, hot-reload polling
  graph.js              Node graph data model (no GL): nodes/edges Maps, topoSort
  nodegraph.js          Canvas2D interactive editor: pan/zoom, drag, connect, undo
  renderer.js           Graph-based render loop: topoSort → execute each node
  ui.js                 Inspector panel (node properties + shader editor)
shaders/                         Shader folder root
  core/                          Engine-internal shaders (not user-facing)
    vert.glsl                    Shared vertex shader (fullscreen quad)
    camera.frag.glsl             Mirrored camera output
    copy.frag.glsl               Texture copy/blit
    blend.frag.glsl              Blend two textures
  fragment/                      All effect fragment shaders (~40)
    trails.frag.glsl             Colour trails
    opticalflow.frag.glsl        Lucas-Kanade optical flow
    ...                          (discovered dynamically from /api/shaders)
test/
  shaders.test.js       Shader compilation tests
  shader-compile-test.html  Browser-based shader compile test
dev-server.py           Python HTTP server with /api/shader-mtime endpoint
```

## Node Graph

### Palette

The node palette is built from two sources only:

- Fixed graph node types: camera, audio, buffer, output, and blank custom shader.
- The actual filesystem structure under `shaders/fragment/`.

Rules:

- The palette must reflect `shaders/fragment/` directly.
- Root-level files in `shaders/fragment/` appear in one section.
- Subfolders under `shaders/fragment/` appear as their own sections.
- No extra manual categorization, tagging, or resorting beyond the folder structure.
- If a shader file exists in the folder but is not present in the manifest, it will not appear in the palette until the server is restarted.

### Node Types (`graph.js` → `NODE_DEFS`)

| Type | Category | Outputs | Inputs |
|------|----------|---------|--------|
| `source-cam` | source | `out` | — |
| `source-audio` | source | `out` | — |
| `effect` | effect | `out` | dynamic (from shader) |
| `output` | output | — | `in` |

Effect node inputs are **auto-detected** from the shader source: every `uniform sampler2D uXyz;` declaration creates an input port named `uXyz` (the raw GLSL uniform name). This means the node graph adapts to whatever the shader declares — port labels match the shader code exactly.

Common uniform names: `uColor` (camera/image), `uFlow` (optical flow vec2 data), `uMotion` (motion intensity), `uPrevFrame` (previous frame for temporal comparison).

All transport between nodes is `sampler2D`. There is no type system — any output can connect to any input. Wire colors follow the node category (source=green, effect=blue, output=orange).

### graph.js exports
`nodes`, `edges`, `NODE_DEFS`, `CATEGORY_STYLE`,
`addNode`, `removeNode`, `addEdge`, `removeEdge`, `getEdgeByInput`,
`topoSort`, `getInputTex`, `getOutputNode`, `getNodeInputs`,
`serialize`, `deserialize`, `buildDefaultGraph`

### nodegraph.js interactions
- **Pan**: middle-mouse or Alt+drag
- **Zoom**: scroll wheel (0.15×–5×)
- **Connect**: drag from output port → input port; drag an existing input wire to re-route
- **Context menu**: right-click — add source/effect/output nodes, delete, duplicate, disconnect all
- **Keyboard**: `Delete`/`Backspace` delete selected node; `Escape` cancel; `Ctrl+Z` undo; `F` fit view

## Rendering Pipeline

Each frame (`renderer.js`):
1. **Camera upload** → mirrored colour (`camRT`)
2. **Audio upload** → FFT data into 256×1 RGBA texture (only when source-audio connected)
3. **Graph execution** → `topoSort()` → for each node:
   - **source**: assign pipeline texture (`camRT.tex` or `audioTex`)
   - **effect**: run effect shader into ping-pong RT; if `@output prev` annotation, output previous frame
   - **output**: record the connected input texture as `node.outTex`
4. **Output node** → records connected texture as `node.outTex` (graph output endpoint)
5. **Thumbnails** → round-robin `readPixels` into per-node `<canvas>` elements (output thumbnail can use custom `thumbRes`)

### Temporal History (Ring Buffer)
Effects can declare `// @temporal N` to get an N-frame history ring buffer (`sampler2DArray`). The renderer allocates a texture array and exposes `uHistory`, `uHistoryLen`, `uHistoryIdx` uniforms. Effects declaring `// @output prev` output their previous frame instead of current (delay-like behavior).

### renderer.js exports
`start(video)`, `ensureNodeRT(node)`, `freeNodeRT(node)`, `initAudio(stream)`

## Effect Shaders

Each effect shader is a **self-contained GLSL ES 3.0 fragment shader**. No header/footer concatenation — every shader declares its own `#version`, uniforms, and helper functions.

### Writing a New Effect

1. Create `shaders/fragment/myeffect.frag.glsl` — a complete fragment shader:
```glsl
#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;   // declares input port "uColor"
uniform sampler2D uPrev;    // not implicit ping-pong (not implemented), but output from frame buffer node (special node)
uniform float uTime;
out vec4 o;

void main() {
  vec3 cam = texture(uColor, v).rgb;
  vec3 prev = texture(uPrev, v).rgb;
  vec3 effectColor = mix(prev * 0.9, cam, 0.5);
  o = vec4(effectColor, 1.0);
}
```
2. Restart the dev server (or click COMPILE in the topbar) so the manifest picks up the new file.
3. Optionally add `// @param Name min max default` annotations for inspector sliders.

### Input Port Detection
`detectInputs(src)` scans for `uniform sampler2D uXyz;` declarations → creates port `uXyz`.
All `sampler2D` uniforms become wirable input ports.

### Annotations
```glsl
// @param Speed 0.1 5.0 1.0         → inspector slider, passed as uniform uSpeed
```

## Key Patterns

- **`draw(prog, fbo, w, h, texs, unis)`**: central dispatch — binds textures by uniform name, supports `sampler2DArray` via `._array` flag, use `I(val)` for integer uniforms
- **`mkRT(w, h)` / `delRT(rt)`**: render target lifecycle (texture + framebuffer pair, `RGBA8`)
- **`mkHistoryRT(w, h, depth)` / `delHistoryRT(hrt)`**: ring buffer (texture array + per-layer FBOs)
- **`P` object** (`js/shaders.js`): holds all compiled programs (`P.camera`, `P.copy`, `P.blend`, `P.fx[]`), mutated in-place on hot-reload. `P` slots match core shader filenames dynamically.
- **Ping-pong**: per-node effects (`node.rt[0/1]`, `node.rtIdx`)
- **Save/Load**: `serialize()` / `deserialize()` JSON to/from `localStorage('flowtoy-graph')`; auto-saved on page unload
- **Utility shaders** (`UTIL_SHADERS`): discovered dynamically from `shaders/core/` — used internally by renderer

## Bugs
- Moving the mouse weehl presses, hase some wierd beaviour, like moving the graph and zooming at the same time. 
- the text is quite smal, an the contrast is little. howeer i like the colorshemes, but some letters could be brighter. 

## Ideas
- 

## Future Impelentations
Comfotably shader writung. 
- error logs (check) 
- editor like highliting of the code
- when texture import is avaiadable, defaul tex2d could be the logo, instead of black

Input node for:
- texutre
- texture2d
- texture3d
- audio 

generate new shader
- llm interface to inprove shader
- generte one shader, all what is currently used in the graph. in one file, optimize the file, save as new shader. 

Recorings export as img or video

## Future future future implementations
Input nodes for:
- 3d meshes 
- vertex shaders
- ligthing
- animations
- input system
- event system
- physics
