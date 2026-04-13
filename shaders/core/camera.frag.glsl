#version 300 es
precision highp float;
in vec2 v; uniform sampler2D uT; out vec4 o;
void main() { o = texture(uT, vec2(1.0 - v.x, v.y)); }
