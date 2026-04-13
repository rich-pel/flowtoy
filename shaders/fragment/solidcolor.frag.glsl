#version 300 es
precision highp float;
in vec2 v;
out vec4 o;


void main(){
  // Solid color output — edit the RGB values below
  vec3 effectColor = vec3(1.0, 0.4, 0.1);
  o = vec4(effectColor, 1.0);
}
