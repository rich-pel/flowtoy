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
  vec2  f   = flow(v);
  float m   = mot(v);
  float raw = mot(v);

  // Smear previous paint stroke along flow (long brush stroke persistence)
  vec2 brush = v - f * 0.06;
  vec3 prev  = texture(uPrev, clamp(brush, 0.0, 1.0)).rgb * 0.993;

  // New stroke: camera posterized to flat paint patches
  vec3  cam = texture(uColor, v).rgb;
  float lum = dot(cam, vec3(0.299, 0.587, 0.114));
  lum = floor(lum * 5.0 + 0.5) / 5.0;   // posterize to 5 levels

  float hue    = fract(atan(f.y, f.x) / 6.28318 + 0.5 + uTime * 0.025);
  vec3  stroke = hsv(hue, 0.6, lum);

  // Stamp new paint only where there's motion and flow movement
  float press = smoothstep(0.04, 0.45, m + raw * 0.25) * smoothstep(0.0, 0.15, length(f));
  vec3 effectColor = mix(prev, stroke, press);
  o = vec4(effectColor, 1.0);
}
