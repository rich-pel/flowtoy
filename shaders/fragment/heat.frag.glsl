#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
uniform sampler2D uPrev;
out vec4 o;

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }
float mot(vec2 uv){ return texture(uFlow,uv).b; }

vec3 heat(float t){
  t=clamp(t,0.0,1.0);
  return vec3(smoothstep(0.45,0.9,t),
              smoothstep(0.0,0.5,t)-smoothstep(0.65,1.0,t),
              smoothstep(0.0,0.3,t)*(1.0-smoothstep(0.3,0.65,t)));
}


void main(){
  vec2 f=flow(v); float m=mot(v);
  vec3 cam=texture(uColor,v).rgb;
  float gry=dot(cam,vec3(0.299,0.587,0.114));
  float h=clamp(m*5.0+length(f)*1.5,0.0,1.0);
  vec3 prev=texture(uPrev,v-f*0.025).rgb*0.87;
  vec3 effectColor=max(mix(vec3(gry*0.12),heat(h),h),prev);
  o = vec4(effectColor, 1.0);
}
