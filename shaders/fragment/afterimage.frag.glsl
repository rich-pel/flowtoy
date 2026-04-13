#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
uniform sampler2D uPrev;
uniform float uTime;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }
float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  // Post-movement afterimage: motion stamps a color ghost that lingers for seconds
  float m   = mot(v);
  float raw = mot(v);
  vec2  f   = flow(v);

  // Very slow decay — afterimage persists for several seconds
  vec3 prev = texture(uPrev, v + f * 0.004).rgb * 0.994;

  // New stamp only when actively moving
  float act = smoothstep(0.12, 0.6, m + raw * 0.28);

  // Each "stamp event" gets a unique hue based on time
  float hue   = fract(uTime * 0.11 + v.x * 0.3 + v.y * 0.2);
  vec3  stamp = hsv(hue, 0.78, act);

  // The stamp is the camera image tinted by the stamp hue
  vec3  cam   = texture(uColor, v).rgb;
  vec3  tinted = cam * hsv(hue, 0.55, 1.0) * 1.2;

  vec3 effectColor = clamp(prev + tinted * act * 0.38, 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
