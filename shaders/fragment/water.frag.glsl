#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
uniform float uTime;
out vec4 o;

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }
float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  vec2  f = flow(v);
  float m = mot(v);

  // Ripple displacement: standing wave modulated by flow
  float t = uTime;
  vec2 rip = vec2(
    sin(v.y * 20.0 + t * 2.2 + f.x * 10.0) * 0.0065,
    cos(v.x * 18.0 + t * 1.8 + f.y * 10.0) * 0.0065
  ) * (0.5 + m * 1.5);

  // Chromatic separation for refractive caustic look
  float r = texture(uColor, v + rip + vec2( 0.004,  0.001)).r;
  float g = texture(uColor, v + rip                       ).g;
  float b = texture(uColor, v + rip - vec2( 0.004, -0.001)).b;

  // Deep water tint — cool blue-green
  vec3  cam  = vec3(r, g, b);
  vec3  tint = vec3(0.08, 0.52, 0.9);
  float depth = 0.32 + m * 0.38;

  vec3 effectColor = mix(cam, cam * tint * 1.25, depth);
  o = vec4(effectColor, 1.0);
}
