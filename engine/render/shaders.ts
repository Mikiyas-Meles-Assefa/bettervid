// Shaders for image parts. A shader is a GLSL function of position and of what the scene hands it, with no clock, no
// randomness and no access to anything else, so a frame stays a pure function of time and a scene can carry one as data.
//
// A source defines `vec4 shade(vec2 uv)`, where uv runs 0 to 1 with y going down, and returns straight (not
// premultiplied) color. It can read u_time, u_size (pixels), u_params[8], and the colors u_a, u_b, u_c.

const HEADER = `precision highp float;
uniform float u_time;
uniform vec2 u_size;
uniform float u_params[8];
uniform vec3 u_a;
uniform vec3 u_b;
uniform vec3 u_c;
varying vec2 v_uv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;
const FOOTER = `
void main() { gl_FragColor = shade(v_uv); }`;

export const wrapShader = (source: string) => `${HEADER}#line 1\n${source}${FOOTER}`;

// Starting points, addressed by name. All colors come from the scene, so these work in every style.
export const SHADERS: Record<string, string> = {
  // Soft drifting cloud between two colors. params: scale, speed, contrast.
  cloud: `vec4 shade(vec2 uv) {
  vec2 p = uv * vec2(u_size.x / u_size.y, 1.0) * max(u_params[0], 0.1);
  float v = fbm(p + vec2(u_time * u_params[1], -u_time * u_params[1] * 0.6) + fbm(p + u_time * u_params[1] * 0.3));
  v = clamp((v - 0.5) * max(u_params[2], 0.1) + 0.5, 0.0, 1.0);
  return vec4(mix(u_a, u_b, v), 1.0);
}`,
  // Rays fanning from a point, fading to nothing. params: center x, center y, ray count, speed, reach.
  rays: `vec4 shade(vec2 uv) {
  vec2 d = (uv - vec2(u_params[0], u_params[1])) * vec2(u_size.x / u_size.y, 1.0);
  float angle = atan(d.y, d.x), reach = length(d) / max(u_params[4], 0.01);
  float beams = 0.5 + 0.5 * sin(angle * u_params[2] + u_time * u_params[3]) * sin(angle * u_params[2] * 0.37 - u_time * u_params[3] * 0.6);
  return vec4(u_a, clamp(beams * (1.0 - reach), 0.0, 1.0));
}`,
  // Fine points of light on nothing. params: density, twinkle speed, size.
  stars: `vec4 shade(vec2 uv) {
  vec2 p = uv * vec2(u_size.x / u_size.y, 1.0) * max(u_params[0], 1.0);
  vec2 cell = floor(p), f = fract(p) - 0.5;
  vec2 place = (vec2(hash(cell), hash(cell + 7.0)) - 0.5) * 0.7;
  float size = max(u_params[2], 0.01) * (0.4 + hash(cell + 3.0));
  float twinkle = 0.6 + 0.4 * sin(u_time * u_params[1] + hash(cell + 11.0) * 6.283);
  float light = smoothstep(size, 0.0, length(f - place)) * twinkle;
  return vec4(mix(u_a, u_b, hash(cell + 19.0)), light);
}`,
};
export const shaderSource = (name: string) => SHADERS[name] ?? name;
