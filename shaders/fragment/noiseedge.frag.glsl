#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform float uTime;
out vec4 o;


void main(){
  // Edges with per-sample jitter → sketchy/hand-drawn pencil look
  float t   = uTime;
  vec2  tx  = vec2(dFdx(v.x), dFdy(v.y));

  // Pseudo-random per-pixel jitter based on position + time
  vec2 seed  = v * 531.0 + t * 0.3;
  vec2 jitter = vec2(
    fract(sin(dot(seed,            vec2(127.1, 311.7)))*43758.5) - 0.5,
    fract(sin(dot(seed + vec2(1.), vec2(269.5, 183.3)))*43758.5) - 0.5
  ) * tx * 5.5;

  float lum = dot(texture(uColor, v + jitter).rgb, vec3(0.299,0.587,0.114));

  vec2 ts = tx * 1.5;
  float gx = dot(texture(uColor, v+ts*vec2( 1, 0)+jitter*0.5).rgb - texture(uColor, v+ts*vec2(-1,0)+jitter*0.5).rgb, vec3(0.299,0.587,0.114));
  float gy = dot(texture(uColor, v+ts*vec2( 0, 1)+jitter*0.5).rgb - texture(uColor, v+ts*vec2(0,-1)+jitter*0.5).rgb, vec3(0.299,0.587,0.114));
  float edge = clamp(sqrt(gx*gx + gy*gy) * 3.5, 0.0, 1.0);

  // Aged-paper background + dark pencil lines
  vec3 paper = vec3(0.93, 0.89, 0.78);
  vec3 line  = vec3(0.12, 0.09, 0.05);
  vec3 effectColor = mix(paper, line, edge);
  o = vec4(effectColor, 1.0);
}
