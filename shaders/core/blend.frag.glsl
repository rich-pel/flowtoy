#version 300 es
precision mediump float;
in vec2 v;
out vec4 fragColor;

uniform sampler2D uA;  // effect output
uniform sampler2D uB;  // original input (color)
uniform int uMode;     // 0=replace,1=add,2=multiply,3=screen,4=overlay

void main() {
  vec4 a = texture(uA, v);
  vec4 b = texture(uB, v);
  vec3 c;
  if      (uMode == 1) c = a.rgb + b.rgb;
  else if (uMode == 2) c = a.rgb * b.rgb;
  else if (uMode == 3) c = 1.0 - (1.0 - a.rgb) * (1.0 - b.rgb);
  else if (uMode == 4) {
    // Overlay: per-channel
    c = mix(2.0 * a.rgb * b.rgb,
            1.0 - 2.0 * (1.0 - a.rgb) * (1.0 - b.rgb),
            step(0.5, b.rgb));
  }
  else c = a.rgb; // replace
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
