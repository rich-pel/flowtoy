#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
out vec4 o;

// Delay (1-frame buffer)
// Copies input to internal buffer; renderer outputs the PREVIOUS frame.
// Wire: Source → Delay → downstream flow/color input for temporal comparison.
// @output prev

void main() {
  vec3 effectColor = texture(uColor, v).rgb;
  o = vec4(effectColor, 1.0);
}
