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

float lum(vec2 uv){ return dot(texture(uColor,uv).rgb,vec3(0.299,0.587,0.114)); }


void main(){
  vec2 f=flow(v); float m=mot(v);
  vec2 tx=vec2(dFdx(v.x),dFdy(v.y))*1.4;
  float gx=-lum(v+vec2(-tx.x,-tx.y))+lum(v+vec2(tx.x,-tx.y))
           -2.0*lum(v+vec2(-tx.x,0.0))+2.0*lum(v+vec2(tx.x,0.0))
           -lum(v+vec2(-tx.x,tx.y))+lum(v+vec2(tx.x,tx.y));
  float gy=-lum(v+vec2(-tx.x,-tx.y))-2.0*lum(v+vec2(0.0,-tx.y))-lum(v+vec2(tx.x,-tx.y))
           +lum(v+vec2(-tx.x,tx.y))+2.0*lum(v+vec2(0.0,tx.y))+lum(v+vec2(tx.x,tx.y));
  float edge=sqrt(gx*gx+gy*gy);
  vec3 col=hsv(atan(f.y,f.x)/6.2832+0.5+uTime*0.1, 0.85, 1.0);
  vec3 prev=texture(uPrev,v-f*0.025).rgb*0.83;
  vec3 effectColor=min(prev+col*(edge*2.0+m*2.8),vec3(1.0));
  o = vec4(effectColor, 1.0);
}
