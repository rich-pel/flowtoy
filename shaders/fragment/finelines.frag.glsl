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


void main(){
  // Very fine single-pixel Laplacian lines, tinted by flow direction
  vec2  tx = vec2(dFdx(v.x), dFdy(v.y));
  vec2  f  = flow(v);

  // Laplacian of luminance for sharper, thinner lines than Sobel
  float c  = dot(texture(uColor, v               ).rgb, vec3(0.299,0.587,0.114));
  float n  = dot(texture(uColor, v + vec2(0, tx.y)).rgb, vec3(0.299,0.587,0.114));
  float s  = dot(texture(uColor, v - vec2(0, tx.y)).rgb, vec3(0.299,0.587,0.114));
  float e  = dot(texture(uColor, v + vec2(tx.x,0)).rgb, vec3(0.299,0.587,0.114));
  float w  = dot(texture(uColor, v - vec2(tx.x,0)).rgb, vec3(0.299,0.587,0.114));
  float laplacian = abs(n + s + e + w - 4.0 * c);

  float edge = clamp(laplacian * 8.0, 0.0, 1.0);

  // Thin lines colored by flow direction; black elsewhere
  float hue  = fract(atan(f.y, f.x) / 6.28318 + 0.5 + uTime * 0.04);
  vec3 col   = hsv(hue, 0.95, 1.0);
  vec3 effectColor = col * edge;
  o = vec4(effectColor, 1.0);
}
