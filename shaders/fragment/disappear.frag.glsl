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
  float m   = mot(v);
  float raw = mot(v);
  vec2  f   = flow(v);

  // Previously seen pixels persist and follow flow slowly, fading to black
  vec3 prev = texture(uPrev, v + f * 0.012).rgb * 0.978;

  // Refresh only where motion detected — let the moving body stay visible
  vec3  cam = texture(uColor, v).rgb;
  float fg  = smoothstep(0.07, 0.42, m + raw * 0.25);

  vec3 effectColor = mix(prev, cam, fg);
  o = vec4(effectColor, 1.0);
}
