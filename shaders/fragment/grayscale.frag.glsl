#version 300 es
precision highp float;

in vec2 v;
uniform sampler2D uColor;

out vec4 o;

void main() {
    vec3 color = texture(uColor, v).rgb;

    // Convert to grayscale (luminance formula)
    float gray = dot(color, vec3(0.299, 0.587, 0.114));

    o = vec4(vec3(gray), 1.0);
}