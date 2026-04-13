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

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }
float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  // Flow-based bloom aura: angle → hue, magnitude → brightness + glow ring
  vec2  f   = flow(v);
  float raw = mot(v);
  float mag = length(f);

  // Sinusoidal rainbow — softer than pure HSV
  float hue  = fract(atan(f.y, f.x) / 6.28318 + 0.5 + uTime * 0.07);
  float sat  = smoothstep(0.02, 0.18, mag);
  float val  = smoothstep(0.0, 1.0, mag) * 0.5; // match ShaderToy: mag*0.5*smoothstep(0,1,mag)
  vec3  col  = hsv(hue, sat, val);

  // Radial glow: sample ring of neighbors, accumulate luminance
  float glow = 0.0;
  for (int i = 0; i < 6; i++) {
    float a = 6.28318 * float(i) / 6.0;
    float r = 0.02 + 0.015 * sin(uTime * 2.0 + float(i));
    glow += length(flow(v + vec2(cos(a), sin(a)) * r));
  }
  glow /= 6.0;
  float hg = fract(hue + 0.08);
  col += hsv(hg, 0.7, smoothstep(0.0, 0.3, glow) * 0.55);

  vec3 cam = texture(uColor, v).rgb * 0.08;
  vec3 effectColor = clamp(cam + col, 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
