#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
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
  // Persistent segmentation: builds a silhouette mask over many frames
  float m   = mot(v);
  float raw = mot(v);

  // Accumulate towards white where foreground, slowly decay elsewhere
  float prev = texture(uPrev, v).r;
  float inc  = smoothstep(0.1, 0.5, m + raw * 0.3);
  float mask = clamp(prev * 0.985 + inc * 0.08, 0.0, 1.0);

  // Silhouette: colorized by motion direction
  vec2  f   = flow(v);
  float hue = fract(atan(f.y, f.x) / 6.28318 + 0.5 + uTime * 0.04);
  vec3  silCol = hsv(hue, 0.8, 1.0);

  // Camera shows through at edge, solid color in body
  vec3  cam  = texture(uColor, v).rgb;
  float edge = abs(mask - 0.5) < 0.12 ? 1.0 : 0.0; // thin outline at boundary
  vec3 effectColor = mix(cam * 0.12, silCol * mask, mask) + silCol * edge * 0.6;
  o = vec4(effectColor, 1.0);
}