#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}


void main(){
  // Sobel edge detection on camera — edges colored by gradient direction
  vec2 tx = vec2(dFdx(v.x), dFdy(v.y)) * 1.5;
  float tl = length(texture(uColor, v + tx*vec2(-1, 1)).rgb);
  float t  = length(texture(uColor, v + tx*vec2( 0, 1)).rgb);
  float tr = length(texture(uColor, v + tx*vec2( 1, 1)).rgb);
  float l  = length(texture(uColor, v + tx*vec2(-1, 0)).rgb);
  float r  = length(texture(uColor, v + tx*vec2( 1, 0)).rgb);
  float bl = length(texture(uColor, v + tx*vec2(-1,-1)).rgb);
  float b  = length(texture(uColor, v + tx*vec2( 0,-1)).rgb);
  float br = length(texture(uColor, v + tx*vec2( 1,-1)).rgb);

  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float edge = sqrt(gx*gx + gy*gy);

  float ang = atan(gy, gx) / 6.28318 + 0.5;
  vec3 effectColor = hsv(ang, 1.0, clamp(edge * 2.0, 0.0, 1.0));
  o = vec4(effectColor, 1.0);
}
