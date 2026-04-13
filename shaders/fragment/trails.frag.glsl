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
  vec2 f=flow(v); float m=mot(v); float mag=length(f);
  vec3 cam  = texture(uColor,v).rgb;
  vec3 prev = texture(uPrev, v - f*0.04).rgb * 0.91;
  vec3 col  = hsv(atan(f.y,f.x)/6.2832+0.5 + uTime*0.05, 0.9, 1.0);
  vec3 effectColor = min(cam*0.12 + prev + col*m*mag*4.0, vec3(1.0));
  o = vec4(effectColor, 1.0);
}
