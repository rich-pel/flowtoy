#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uFlow;
out vec4 o;


void main(){
  vec4  fl  = texture(uFlow, v);
  vec2  f   = (fl.rg - 0.5) * 2.0;
  vec3 effectColor = vec3(f.x * 0.5 + 0.5, f.y * 0.5 + 0.5, fl.b);
  o = vec4(effectColor, 1.0);
}
