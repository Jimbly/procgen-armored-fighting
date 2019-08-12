// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
#pragma WebGL

precision lowp float;

//uniform sampler2D tex0; // source

uniform vec4 color0;
uniform vec4 color1;

varying float interp_color;
// varying vec2 interp_texcoord;

void main(void) {
  gl_FragColor = mix(color0, color1, clamp(interp_color * 10.0 - 9.0, 0.0, 1.0));
}