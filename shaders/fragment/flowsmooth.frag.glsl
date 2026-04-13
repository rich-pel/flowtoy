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


void main(){
  // Very smooth long-persistence flow without hard resets
  // Advect previous by flow every frame — never cleared, silky buildup
  vec2 f   = flow(v);
  float mag = length(f);

  // Walk back along flow to read previous frame
  vec2 prev_uv = v - f * 0.032;
  vec3 prev    = texture(uPrev, clamp(prev_uv, 0.0, 1.0)).rgb;

  // Very slow decay — almost no clearing
  prev *= 0.984;

  // Only inject new color where there is actual motion
  float hue = fract(atan(f.y, f.x) / 6.28318 + 0.5 + uTime * 0.03);
  float bri = smoothstep(0.01, 0.25, mag);
  vec3  ink = hsv(hue, 0.85, bri * 0.62);

  vec3 effectColor = clamp(prev + ink, 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
