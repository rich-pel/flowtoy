#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
uniform sampler2D uPrev;
out vec4 o;

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }
float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  vec2 f=flow(v); float m=mot(v);
  vec2 wuv = v + f*0.12;
  vec3 cam  = vec3(texture(uColor,wuv+f*0.06).r,
                   texture(uColor,wuv        ).g,
                   texture(uColor,wuv-f*0.06).b);
  vec3 prev = texture(uPrev, v-f*0.025).rgb * 0.82;
  vec3 effectColor = cam*0.65 + prev*0.35 + vec3(0.0,0.4,1.0)*m*0.4;
  o = vec4(effectColor, 1.0);
}
