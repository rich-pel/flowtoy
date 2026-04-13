#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uMotion;
out vec4 o;

float mot(vec2 uv){ return texture(uMotion,uv).b; }


void main(){
  float m  = mot(v);
  float fg = smoothstep(0.1, 0.48, m);

  // Pixelated + soft-blurred background (virtual background blur)
  float ps    = 12.0;
  vec2  pUV   = (floor(v * ps) + 0.5) / ps;
  vec2  step1 = vec2(1.0 / ps, 0.0);
  vec2  step2 = vec2(0.0, 1.0 / ps);
  vec3  blurred = (
    texture(uColor, pUV         ).rgb * 2.0 +
    texture(uColor, pUV + step1 ).rgb +
    texture(uColor, pUV - step1 ).rgb +
    texture(uColor, pUV + step2 ).rgb +
    texture(uColor, pUV - step2 ).rgb
  ) / 6.0;

  // Cool blue-grey tint for background
  blurred = mix(blurred, blurred * vec3(0.68, 0.78, 1.12), 0.6);

  // Sharp camera for foreground moving person
  vec3 cam = texture(uColor, v).rgb;
  vec3 effectColor = mix(blurred, cam, fg);
  o = vec4(effectColor, 1.0);
}
