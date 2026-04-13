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


void main(){
  // Flow vector field: grid cells colored by local flow direction+magnitude
  float gs = 18.0;
  vec2  cell  = floor(v * gs) / gs;
  vec2  bctr  = cell + 0.5 / gs;

  vec2  f = (texture(uFlow, bctr).rg - 0.5) * 2.0;
  float mag = length(f);

  // Cell-local UV for drawing arrow shape
  vec2 lv = (v - bctr) * gs;  // -0.5 to +0.5 range

  // Arrow: project local pos onto flow direction
  float flen = max(mag, 0.001);
  vec2  fd   = f / flen;
  vec2  perp = vec2(-fd.y, fd.x);
  float along = dot(lv, fd);
  float side  = abs(dot(lv, perp));

  // Arrowhead + shaft mask
  float shaft = step(side, 0.062) * step(abs(along), 0.35);
  float head  = step(side, 0.13 * (0.45 - along)) * step(along, 0.45);
  float arrow = clamp(shaft + head, 0.0, 1.0) * smoothstep(0.02, 0.08, mag);

  // Cell background dim camera, arrow brightly colored by direction
  float hue = fract(atan(f.y, f.x) / 6.28318 + 0.5);
  vec3 arrowCol = hsv(hue, 0.95, 1.0);
  vec3 cam  = texture(uColor, v).rgb * 0.18;

  vec3 effectColor = cam + arrowCol * arrow;
  o = vec4(effectColor, 1.0);
}
