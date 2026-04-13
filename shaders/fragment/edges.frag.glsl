#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
out vec4 o;

vec3 hsv(float h, float s, float b){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(vec3(h)+K.xyz)*6.0-K.www);
  return b*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),s);
}

// Sobel edge detection with directional coloring
// Input: color (camera or any image)
// Output: colored edges (hue = direction, brightness = edge strength)

float lum(vec2 uv) { return dot(texture(uColor, uv).rgb, vec3(0.299, 0.587, 0.114)); }


void main() {
  vec2 res = vec2(textureSize(uColor, 0));
  float tx = 1.0 / res.x, ty = 1.0 / res.y;

  float gx = -lum(v+vec2(-tx,-ty)) + lum(v+vec2(tx,-ty))
            - 2.0*lum(v+vec2(-tx,0.0)) + 2.0*lum(v+vec2(tx,0.0))
            - lum(v+vec2(-tx,ty)) + lum(v+vec2(tx,ty));
  float gy = -lum(v+vec2(-tx,-ty)) - 2.0*lum(v+vec2(0.0,-ty)) - lum(v+vec2(tx,-ty))
            + lum(v+vec2(-tx,ty)) + 2.0*lum(v+vec2(0.0,ty)) + lum(v+vec2(tx,ty));

  float mag = sqrt(gx*gx + gy*gy);
  float ang = atan(gy, gx) / 6.2832 + 0.5;
  vec3 effectColor = hsv(ang, 0.9, min(mag * 5.0, 1.0));
  o = vec4(effectColor, 1.0);
}
