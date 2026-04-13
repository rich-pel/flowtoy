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
float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  float m   = mot(v);
  float raw = mot(v);
  vec2  f   = flow(v);

  // Heat rises: sample the heat that was just below, pulling it upward.
  // Also drift sideways with horizontal flow.
  vec2 src = v - vec2(f.x * 0.012, 0.013);
  vec3 prev = texture(uPrev, clamp(src, 0.0, 1.0)).rgb * 0.948;

  // Ignite where motion exists — yellow core→orange→red tip
  float ignite  = smoothstep(0.15, 0.65, m + raw * 0.35);
  // hue 0=red, 0.11=orange/yellow; brighter = hotter / more yellow
  float hue     = mix(0.0, 0.11, ignite);
  vec3  fireCol = hsv(hue, 1.0, ignite * 2.2);

  vec3 effectColor = clamp(prev + fireCol * 0.38, 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
