#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
uniform float uTime;
out vec4 o;

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }
float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  float m = mot(v);
  vec2  f = flow(v);

  // Swirl + zoom centered on screen, magnitude driven by motion
  vec2  ctr  = vec2(0.5);
  vec2  d    = v - ctr;

  float angle = m * 0.75 * sin(uTime * 1.6);
  float cs = cos(angle), ss = sin(angle);
  vec2  rot = vec2(cs * d.x - ss * d.y, ss * d.x + cs * d.y);

  float zoom  = 1.0 + m * 0.13 * sin(uTime * 2.5);
  vec2  warpUV = ctr + rot / zoom + f * 0.045;

  vec3 cam    = texture(uColor, v).rgb;
  vec3 warped = texture(uColor, clamp(warpUV, 0.0, 1.0)).rgb;

  vec3 effectColor = mix(cam, warped, smoothstep(0.04, 0.55, m));
  o = vec4(effectColor, 1.0);
}
