#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uBase;
uniform sampler2D uEffect;
uniform sampler2D uMask;
uniform float uMaskLow;
uniform float uMaskHigh;
out vec4 o;

// @param MaskLow 0.0 1.0 0.2
// @param MaskHigh 0.0 1.0 0.8

void main() {
  vec3 baseCol = texture(uBase, v).rgb;
  vec3 fxCol = texture(uEffect, v).rgb;
  float mask = texture(uMask, v).r;
  float m = smoothstep(uMaskLow, max(uMaskLow + 0.001, uMaskHigh), mask);
  o = vec4(mix(baseCol, fxCol, m), 1.0);
}
