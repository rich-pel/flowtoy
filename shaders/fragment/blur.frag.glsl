#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uPrev;
out vec4 o;

// Gaussian blur (combined horizontal + vertical)
// Input: color (any image)
// Output: blurred version


void main() {
  vec2 res = vec2(textureSize(uColor, 0));
  float dx = 2.5 / res.x, dy = 2.5 / res.y;

  // Horizontal weights
  vec4 h = 0.0625 * texture(uColor, v + vec2(-2.0*dx, 0.0))
         + 0.25   * texture(uColor, v + vec2(-dx, 0.0))
         + 0.375  * texture(uColor, v)
         + 0.25   * texture(uColor, v + vec2(dx, 0.0))
         + 0.0625 * texture(uColor, v + vec2(2.0*dx, 0.0));

  // Store horizontal result in uPrev trick — can't do 2-pass in one shader.
  // Instead: do a separable 5-tap in both directions (9-tap cross kernel).
  vec4 vl = 0.0625 * texture(uColor, v + vec2(0.0, -2.0*dy))
          + 0.25   * texture(uColor, v + vec2(0.0, -dy))
          + 0.375  * texture(uColor, v)
          + 0.25   * texture(uColor, v + vec2(0.0, dy))
          + 0.0625 * texture(uColor, v + vec2(0.0, 2.0*dy));

  // Average the two 1D blurs (approximation of 2D Gaussian)
  vec3 effectColor = mix(h.rgb, vl.rgb, 0.5);
  o = vec4(effectColor, 1.0);
}
