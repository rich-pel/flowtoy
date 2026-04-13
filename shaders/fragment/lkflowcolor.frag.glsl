#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uPrevFrame;
uniform float uDenoiseFrames;
uniform float uWindowRadius;
uniform float uEigenMin;
uniform float uFlowScale;
out vec4 o;

// Single-pass Lucas-Kanade optical flow visualization.
// Reimplements the Shadertoy BufferA + BufferB + Image chain in one effect node.
// Wire uPrevFrame from Buffer.p1 (or Delay output) for temporal gradient.
//
// @param DenoiseFrames 0.0 12.0 2.0
// @param WindowRadius 1.0 8.0 5.0
// @param EigenMin 0.00001 0.02 0.001
// @param FlowScale 0.1 4.0 0.8

float lum(vec3 c) {
  return dot(c, vec3(0.3333333));
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float tr2(mat2 A) {
  return A[0][0] + A[1][1];
}

float det2(mat2 A) {
  return A[0][0] * A[1][1] - A[1][0] * A[0][1];
}

vec2 eigenValues(mat2 A) {
  float m = 0.5 * tr2(A);
  float p = det2(A);
  float disc = max(0.0, m * m - p);
  float s = sqrt(disc);
  return vec2(m + s, m - s);
}

void main() {
  vec2 res = vec2(textureSize(uColor, 0));
  vec2 texel = 1.0 / res;

  // Buffer A equivalent: dI/dx, dI/dy, dI/dt with temporal denoising.
  float curr = lum(texture(uColor, v).rgb);
  float prev = lum(texture(uPrevFrame, v).rgb);
  float denoiseMix = 1.0 / (1.0 + max(0.0, uDenoiseFrames));
  float currD = mix(prev, curr, denoiseMix);

  float N = lum(texture(uColor, v + vec2(0.0, 1.0) * texel).rgb);
  float E = lum(texture(uColor, v + vec2(1.0, 0.0) * texel).rgb);
  float S = lum(texture(uColor, v + vec2(0.0, -1.0) * texel).rgb);
  float W = lum(texture(uColor, v + vec2(-1.0, 0.0) * texel).rgb);

  float dIdxCenter = (E - W) * 0.5;
  float dIdyCenter = (N - S) * 0.5;
  float dIdtCenter = currD - prev;

  // Buffer B equivalent: Lucas-Kanade solve over Gaussian window.
  float r = max(1.0, floor(uWindowRadius + 0.5));
  mat2 ST = mat2(0.0);
  vec2 Atb = vec2(0.0);

  for (int iy = -8; iy <= 8; iy++) {
    for (int ix = -8; ix <= 8; ix++) {
      vec2 fi = vec2(float(ix), float(iy));
      if (abs(fi.x) > r || abs(fi.y) > r) continue;

      vec2 uv = v + fi * texel;
      float c = lum(texture(uColor, uv).rgb);
      float p = lum(texture(uPrevFrame, uv).rgb);
      float cD = mix(p, c, denoiseMix);

      float n = lum(texture(uColor, uv + vec2(0.0, 1.0) * texel).rgb);
      float e = lum(texture(uColor, uv + vec2(1.0, 0.0) * texel).rgb);
      float s = lum(texture(uColor, uv + vec2(0.0, -1.0) * texel).rgb);
      float w = lum(texture(uColor, uv + vec2(-1.0, 0.0) * texel).rgb);

      float dIdx = (e - w) * 0.5;
      float dIdy = (n - s) * 0.5;
      float dIdt = cD - p;

      float weight = exp(-dot(fi, fi) / 12.0);

      ST += mat2(
        weight * dIdx * dIdx,
        weight * dIdx * dIdy,
        weight * dIdx * dIdy,
        weight * dIdy * dIdy
      );
      Atb -= vec2(weight * dIdx * dIdt, weight * dIdy * dIdt);
    }
  }

  vec2 motion = vec2(0.0);
  float d = det2(ST);
  if (abs(d) > 1e-6) {
    motion = vec2(
      ( ST[1][1] * Atb.x - ST[0][1] * Atb.y) / d,
      (-ST[1][0] * Atb.x + ST[0][0] * Atb.y) / d
    );
  }

  vec2 eVals = eigenValues(ST);
  if (eVals.x < uEigenMin || eVals.y < uEigenMin) {
    motion = vec2(0.0);
  }

  motion *= uFlowScale;

  // Image pass equivalent: HSV visualization by angle + magnitude.
  float mag = length(motion);
  float ang = atan(motion.y, motion.x) / (2.0 * 3.14159265) + 0.5;
  mag = mag * 0.5 * smoothstep(0.0, 1.0, mag);

  // Slight center-weighting from local derivatives to suppress static noise.
  float localGrad = sqrt(dIdxCenter * dIdxCenter + dIdyCenter * dIdyCenter + dIdtCenter * dIdtCenter);
  mag *= smoothstep(0.005, 0.05, localGrad + 1e-4);

  vec3 col = hsv2rgb(vec3(ang, 1.0, clamp(mag, 0.0, 1.0)));
  o = vec4(col, 1.0);
}
