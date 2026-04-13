#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
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
  vec3  cam = texture(uColor, v).rgb;

  // Posterize camera to flat color regions (comic/cell-shading look)
  float levels = 5.0;
  vec3  post   = floor(cam * levels + 0.5) / levels;

  // Edge detection with derivatives for comic outline
  vec2 tx   = vec2(dFdx(v.x), dFdy(v.y)) * 1.8;
  float lum = dot(cam, vec3(0.299, 0.587, 0.114));
  float lE  = dot(texture(uColor, v + vec2(tx.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float lN  = dot(texture(uColor, v + vec2(0.0, tx.y)).rgb, vec3(0.299, 0.587, 0.114));
  float edge = clamp(sqrt((lum-lE)*(lum-lE) + (lum-lN)*(lum-lN)) * 7.0, 0.0, 1.0);

  // Flow-based hue tint in motion regions
  float hue  = fract(atan(f.y, f.x) / 6.28318 + 0.5);
  vec3  tint = mix(post, post * hsv(hue, 0.78, 1.0), m * 0.6);

  vec3 effectColor = clamp(tint * (1.0 - edge * 0.88), 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
