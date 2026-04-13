#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uFlow;
uniform sampler2D uPrev;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }


void main(){
  // Hash-seeded particles advected by the flow field every frame
  // Each particle lives at a grid seed, is displaced by accumulated flow
  float gs   = 80.0;            // particle density
  vec2  cell = floor(v * gs);
  vec2  seed = cell / gs;

  // Per-particle random offset → particle "birth" UV
  float r1 = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  float r2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
  float r3 = fract(sin(dot(cell, vec2( 91.1, 247.9))) * 43758.5453);

  // Sample flow at particle position and at neighbors for smoothness
  vec2 f = flow(seed);

  // Previous particle position
  vec2 prev_seed = seed - f * 0.045;
  vec3 prev = texture(uPrev, clamp(prev_seed, 0.0, 1.0)).rgb * 0.958;

  // Spawn new dot at seed position, size inverse proportional to speed
  float dist = length(v - seed - 0.5/gs);
  float ptcl = smoothstep(0.0042, 0.0010, dist);

  float mag = length(f);
  float hue = fract(atan(f.y, f.x) / 6.28318 + 0.5 + r3 * 0.15);
  float bri = smoothstep(0.0, 0.35, mag);
  vec3  col = hsv(hue, 0.9, bri) * ptcl;

  vec3 effectColor = clamp(prev + col, 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
