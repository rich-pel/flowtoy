#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uMotion;
uniform float uTime;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}

float mot(vec2 uv){ return texture(uMotion,uv).b; }


void main(){
  // Bewegungsmelder (motion alarm): calm camera normally,
  // full tinted alert flash when motion crosses threshold
  float m   = mot(v);
  float raw = mot(v);
  float overall = smoothstep(0.25, 0.75, m + raw * 0.35);

  // Screen-wide average of motion (approximated by center samples)
  float glob =  (mot(vec2(0.5, 0.5))
               + mot(vec2(0.3, 0.4))
               + mot(vec2(0.7, 0.6))) / 3.0;
  float alarm = smoothstep(0.18, 0.55, glob);

  // Alert color cycles red → amber when active
  float hue  = 0.04 - alarm * 0.04;   // 0=red, small shift = warm amber
  float flash = 0.5 + 0.5 * sin(uTime * (6.0 + alarm * 12.0));
  vec3 alertCol = hsv(hue, 1.0, alarm * flash * 0.9);

  // Scanline effect during alert
  float scanline = 0.85 + 0.15 * sin(v.y * 120.0 + uTime * 8.0);

  vec3 cam = texture(uColor, v).rgb;
  vec3 effectColor = mix(cam, cam * 0.25 + alertCol, alarm * 0.85) * scanline;
  o = vec4(effectColor, 1.0);
}
