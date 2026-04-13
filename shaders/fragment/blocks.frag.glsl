#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
uniform float uTime;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}

float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  float bs   = 30.0;
  vec2  blk  = floor(v * bs) / bs;
  vec2  bctr = blk + 0.5 / bs;

  vec2  f = (texture(uFlow, bctr).rg - 0.5) * 2.0;
  float m = mot(bctr);

  // Displace whole block by its tracked flow vector
  float str   = smoothstep(0.07, 0.45, m);
  vec2  disp  = f * 0.16 * str;
  vec2  srcUV = clamp(blk - disp + (v - blk), 0.0, 1.0);

  vec3 shifted = texture(uColor, srcUV).rgb;
  vec3 cam     = texture(uColor, v).rgb;

  // Colorize moved blocks by their flow direction
  float hue = fract(atan(f.y, f.x) / 6.28318 + 0.5 + uTime * 0.04);
  vec3  hi  = mix(shifted, shifted * hsv(hue, 0.9, 1.15), str * 0.65);

  // Thin grid lines at block boundaries for moved blocks
  vec2  edge = step(vec2(0.92), fract(v * bs));
  float grid = max(edge.x, edge.y) * 0.28 * str;

  vec3 effectColor = clamp(hi * (1.0 - grid) + vec3(grid) * hsv(hue, 0.5, 0.8), 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
