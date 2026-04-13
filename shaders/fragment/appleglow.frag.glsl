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
  vec2  f = flow(v);
  float m = mot(v);

  // Sample motion mask from 8 directions to build a wide soft aura ring
  const float TAU = 6.28318;
  float glow = 0.0;
  for (int i = 0; i < 8; i++) {
    float a   = TAU * float(i) / 8.0;
    float rad = 0.055 + 0.03 * sin(uTime * 1.2 + float(i) * 0.8);
    glow += mot(v + vec2(cos(a), sin(a)) * rad);
  }
  glow /= 8.0;

  // Iridescent hue rotates slowly and is offset by flow direction
  float hue  = fract(atan(f.y, f.x) / TAU + 0.5 + uTime * 0.06);
  vec3  aura = hsv(hue, 0.88, glow * 2.0);

  // Lens distortion: camera slightly warped by flow
  vec3 cam   = texture(uColor, v + f * 0.025).rgb;
  vec3 effectColor = cam * 0.55 + aura * (0.6 + m * 0.5);
  o = vec4(effectColor, 1.0);
}
