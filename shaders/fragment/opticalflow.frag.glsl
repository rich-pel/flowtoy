#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uPrevFrame;
out vec4 o;

// Optical flow (Lucas-Kanade)
// Input: color = current frame, prevFrame = previous frame (wire via Delay node)
// Output: rg = flow direction (0.5 = zero), b = motion intensity

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }


void main() {
  vec2 res = vec2(textureSize(uColor, 0));
  float tx = 1.0 / res.x, ty = 1.0 / res.y;

  // Current frame grayscale from color input
  float curGray = lum(texture(uColor, v).rgb);
  // Previous frame grayscale from vec2 input (via Delay node)
  float prevGray = lum(texture(uPrevFrame, v).rgb);

  // Spatial gradients (Sobel on current frame)
  float tl = lum(texture(uColor, v + vec2(-tx,-ty)).rgb);
  float tr = lum(texture(uColor, v + vec2( tx,-ty)).rgb);
  float ml = lum(texture(uColor, v + vec2(-tx, 0.0)).rgb);
  float mr = lum(texture(uColor, v + vec2( tx, 0.0)).rgb);
  float bl = lum(texture(uColor, v + vec2(-tx, ty)).rgb);
  float br = lum(texture(uColor, v + vec2( tx, ty)).rgb);

  float Ix = (-tl + tr - 2.0*ml + 2.0*mr - bl + br) / 8.0;

  float tm = lum(texture(uColor, v + vec2(0.0,-ty)).rgb);
  float bm = lum(texture(uColor, v + vec2(0.0, ty)).rgb);
  float Iy = (-tl - 2.0*tm - tr + bl + 2.0*bm + br) / 8.0;

  // Temporal gradient
  float It  = curGray - prevGray;

  // Lucas-Kanade solve
  float den  = Ix*Ix + Iy*Iy + 0.001;
  float grad = sqrt(Ix*Ix + Iy*Iy);
  float conf = clamp(grad * 20.0, 0.0, 1.0);
  float u = clamp(-It*Ix/den, -0.5, 0.5) * conf;
  float w = clamp(-It*Iy/den, -0.5, 0.5) * conf;

  // rg=flow(0.5=zero), b=motion intensity
  vec3 effectColor = vec3(u + 0.5, w + 0.5, min(abs(It) * 4.0, 1.0));
  o = vec4(effectColor, 1.0);
}
