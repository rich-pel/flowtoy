#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uFlow;
uniform sampler2D uPrev;
uniform float uTime;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }
float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  vec2  f   = flow(v);
  float m   = mot(v);
  float raw = mot(v);

  // Sparks travel along flow with slight downward gravity, fade out
  vec2 src  = v - f * 0.07 + vec2(0.0, 0.003);
  vec3 prev = texture(uPrev, clamp(src, 0.0, 1.0)).rgb * 0.905;

  // Hash-seeded discrete spark emitters at motion edges
  vec2  cell = floor(v * 180.0);
  float r    = fract(sin(dot(cell, vec2(127.1, 311.7)) + uTime * 1.7) * 43758.5453);
  float emit = step(0.87, r) * smoothstep(0.25, 0.85, m + raw * 0.4);

  float hue   = fract(atan(f.y, f.x) / 6.28318 + 0.5 + uTime * 0.12);
  vec3  spark = hsv(hue, 0.6, emit * 3.5);

  vec3 effectColor = clamp(prev + spark, 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
