#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uGreen;
uniform sampler2D uBlue;
uniform float uTime;
out vec4 o;

void main() {
  float r = texture(uColor, v).r;
  float g = texture(uGreen, v).g;
  float b = texture(uBlue,  v).b;
  o = vec4(r, g, b, 1.0);
}
