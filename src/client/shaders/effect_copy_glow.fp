#pragma WebGL

precision highp float;
precision highp int;

varying vec2 interp_texcoord;

uniform sampler2D inputTexture0;
void main()
{
  vec4 color = texture2D(inputTexture0, interp_texcoord);
  float mxv = max(color.x, max(color.y, color.z));
  float mnv = min(color.x, min(color.y, color.z));
  if (mxv - mnv < 0.5) {
    color.xyz = vec3(0.0);
  }
  gl_FragColor = color;
}
