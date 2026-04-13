#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uFlow;
uniform sampler2D uPrev;
uniform float uThreshold;
uniform float uSoftness;
uniform float uPersistence;
out vec4 o;

// @param Threshold 0.0 1.0 0.18
// @param Softness 0.001 0.25 0.05
// @param Persistence 0.0 1.0 0.55

void main() {
  float motion = texture(uFlow, v).b;
  float lo = max(0.0, uThreshold - uSoftness);
  float hi = min(1.0, uThreshold + uSoftness);
  float rawMask = smoothstep(lo, hi, motion);

  // Optional temporal hold from previous mask frame.
  float prevMask = texture(uPrev, v).r;
  float heldMask = max(rawMask, prevMask * 0.97);
  float mask = mix(rawMask, heldMask, uPersistence);

  o = vec4(vec3(mask), 1.0);
}
