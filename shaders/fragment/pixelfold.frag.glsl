#version 300 es
precision highp float;
in vec2 v;
uniform sampler2D uColor;
uniform sampler2D uFlow;
out vec4 o;

vec2 flow(vec2 uv){ return (texture(uFlow,uv).rg - 0.5)*2.0; }
float mot(vec2 uv){ return texture(uFlow,uv).b; }


void main(){
  // Screen pixels are attracted toward moving foreground (fold / converge effect)
  float m = mot(v);
  vec2  f = flow(v);

  // Estimate foreground centroid as weighted average offset from flow
  // Simple approximation: warp UV toward high-motion regions using flow integral
  vec2 attract = f * 0.18 * smoothstep(0.05, 0.5, m);

  // Multiple warp passes (physically: fold step)
  vec2 uv1 = v + attract;
  vec2 uv2 = v + attract * 0.5 + flow(uv1) * 0.08;
  vec2 src  = clamp(uv2, 0.0, 1.0);

  vec3 folded = texture(uColor, src).rgb;
  vec3 cam    = texture(uColor, v).rgb;

  // Blend: static pixels see original; folded pixels warp in
  float str = smoothstep(0.0, 0.45, length(attract));
  vec3 effectColor = mix(cam, folded, str);
  o = vec4(effectColor, 1.0);
}
