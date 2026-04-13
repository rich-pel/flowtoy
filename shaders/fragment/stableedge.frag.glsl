#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uPrev;
out vec4 o;


void main(){
  // Temporally-blended Sobel — accumulates into uPrev to suppress flicker
  vec2 tx = vec2(dFdx(v.x), dFdy(v.y)) * 1.3;

  float tl = dot(texture(uColor, v + tx*vec2(-1, 1)).rgb, vec3(0.299,0.587,0.114));
  float t  = dot(texture(uColor, v + tx*vec2( 0, 1)).rgb, vec3(0.299,0.587,0.114));
  float tr = dot(texture(uColor, v + tx*vec2( 1, 1)).rgb, vec3(0.299,0.587,0.114));
  float l  = dot(texture(uColor, v + tx*vec2(-1, 0)).rgb, vec3(0.299,0.587,0.114));
  float r  = dot(texture(uColor, v + tx*vec2( 1, 0)).rgb, vec3(0.299,0.587,0.114));
  float bl = dot(texture(uColor, v + tx*vec2(-1,-1)).rgb, vec3(0.299,0.587,0.114));
  float b  = dot(texture(uColor, v + tx*vec2( 0,-1)).rgb, vec3(0.299,0.587,0.114));
  float br = dot(texture(uColor, v + tx*vec2( 1,-1)).rgb, vec3(0.299,0.587,0.114));

  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float edge = clamp(sqrt(gx*gx + gy*gy) * 2.5, 0.0, 1.0);

  // White edges blended temporally with previous frame for stability
  vec3 curr = vec3(edge);
  vec3 prev = texture(uPrev, v).rgb;
  vec3 effectColor = mix(prev, curr, 0.35);
  o = vec4(effectColor, 1.0);
}
