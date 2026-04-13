#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
uniform float uTime;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}

float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  float bs   = 28.0;
  vec2  blk  = floor(v * bs) / bs;
  vec2  bctr = blk + 0.5 / bs;

  float m = mot(bctr);
  vec2  f = (texture(uFlow, bctr).rg - 0.5) * 2.0;

  // Each tile gets its own cycling hue based on grid position + time + flow
  float hue  = fract(blk.x * 3.71 + blk.y * 5.33 + uTime * 0.17 + length(f) * 0.4);
  float bri  = 0.22 + m * 0.78;
  float beat = 0.6 + 0.4 * sin(uTime * 5.8 + (blk.x + blk.y) * 8.0);

  vec3 cam  = texture(uColor, v).rgb;
  vec3 tile = hsv(hue, 0.95, bri * beat);

  // Static areas show dim camera, moving tiles flash to full color
  vec3 effectColor = mix(cam * 0.3, tile, 0.5 + m * 0.5);
  o = vec4(effectColor, 1.0);
}
