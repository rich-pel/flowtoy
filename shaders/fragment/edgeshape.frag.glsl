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
  // Max-neighbor dilation: expand bright edges into thick shapes/silhouette
  vec2 tx  = vec2(dFdx(v.x), dFdy(v.y)) * 1.8;
  float m  = mot(v);

  // Dilation radius grows with motion
  float rad = 3.0 + m * 5.0;
  vec3 maxi = vec3(0.0);
  for (int i = -3; i <= 3; i++) {
    for (int j = -3; j <= 3; j++) {
      if (float(i*i + j*j) > rad * rad) continue;
      vec3 s = texture(uColor, v + tx * vec2(float(i), float(j))).rgb;
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      float gx = dot(texture(uColor, v+tx*vec2(float(i)+1.,float(j))).rgb -
                     texture(uColor, v+tx*vec2(float(i)-1.,float(j))).rgb, vec3(0.3,0.6,0.1));
      float gy = dot(texture(uColor, v+tx*vec2(float(i),float(j)+1.)).rgb -
                     texture(uColor, v+tx*vec2(float(i),float(j)-1.)).rgb, vec3(0.3,0.6,0.1));
      float e = sqrt(gx*gx + gy*gy);
      maxi = max(maxi, vec3(e));
    }
  }

  float hue = fract(uTime * 0.07 + m * 0.4);
  vec3 col  = hsv(hue, 0.85, 1.0);
  vec3 effectColor = col * clamp(maxi * 3.5, 0.0, 1.0);
  o = vec4(effectColor, 1.0);
}
