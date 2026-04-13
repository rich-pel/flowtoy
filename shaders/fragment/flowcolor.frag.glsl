#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uFlow;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }


void main(){
  // Optical flow direction → hue, magnitude → brightness
  // Matches Lucas-Kanade HSV visualization from reference
  vec2 f   = flow(v);
  float mag = length(f);
  float ang = atan(f.y, f.x) / 6.28318 + 0.5;

  // Suppress noisy small values, scale down
  mag = mag * 0.5 * smoothstep(0.0, 1.0, mag);

  vec3 effectColor = hsv(ang, 1.0, mag);
  o = vec4(effectColor, 1.0);
}
