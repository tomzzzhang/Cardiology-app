/**
 * Pass 3 — post-processing and scan conversion.
 *
 * Polar -> Cartesian, plus TGC, log compression, the dynamic-range window, and
 * the sector mask. Runs per output pixel and maps BACKWARDS (screen -> polar),
 * which is what makes it a resampling rather than a splat: every output pixel
 * gets exactly one well-defined source coordinate and the sector has no holes.
 *
 * Pediatric display conventions live here, from `views[i].probe.display` — the
 * subcostal and apical families render vertex-DOWN, which is the opposite of
 * most adult labs (`docs/view_canon.md`). "Vertex" is the sector's own vertex,
 * the point the transducer occupies: vertex-down puts it at the BOTTOM of the
 * panel with the fan opening upward.
 */
export const DISPLAY_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColour;

uniform sampler2D uPolar;
uniform float uHalfAngle;
uniform float uDepthMm;
uniform float uTgcDb;
uniform float uGain;
uniform float uGamma;
uniform float uDynamicRangeDb;
uniform float uReject;
uniform int   uVertexDown;
uniform int   uFlipLr;
uniform float uAspect;       // output width / height

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uAspect;
  if (uFlipLr == 1) p.x = -p.x;

  /*
   * vUv.y is 0 at the BOTTOM of the panel, so the sector vertex placed at
   * p = (0, -1) below sits at the bottom and the fan opens upward. That is the
   * vertex-DOWN presentation, which docs/view_canon.md makes the paediatric
   * default for the subcostal and apical families -- the transducer mark at the
   * bottom of the image, unlike most adult labs. Vertex-UP mirrors it, so
   * vertex-UP is the case that flips.
   *
   * This condition was inverted, and the deployed apical four-chamber rendered
   * vertex-UP while its pack correctly declared vertex "down". The renderer was
   * at fault, not the authored view: the flag was being honoured backwards.
   */
  if (uVertexDown == 0) p.y = -p.y;

  // The vertex sits below the visible area so the sector fills the panel.
  vec2 fromApex = vec2(p.x, p.y + 1.0);
  float radius = length(fromApex);
  float angle = atan(fromApex.x, fromApex.y);

  if (abs(angle) > uHalfAngle || radius > 2.0 || radius < 0.02) {
    outColour = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float u = (angle / uHalfAngle) * 0.5 + 0.5;
  float v = radius / 2.0;
  float echoSample = texture(uPolar, vec2(u, v)).r;

  // TGC: linear in dB with depth, exactly as tgcGain() in acoustics.ts.
  float tgc = pow(10.0, (uTgcDb * v) / 20.0);
  float envelope = echoSample * tgc * uGain;

  // ONE logarithmic mapping onto the displayed dynamic range: full scale white,
  // uDynamicRangeDb below it black, linear in decibels between. Must stay
  // identical to compress() in acoustics.ts — a test asserts they agree.
  float brightness = 0.0;
  if (envelope > uReject) {
    float db = 20.0 * log(max(envelope, 1e-6)) / log(10.0);
    brightness = pow(clamp(1.0 + db / uDynamicRangeDb, 0.0, 1.0), uGamma);
  }

  // Feather the sector edge so the mask does not alias into a hard staircase.
  float edge = smoothstep(uHalfAngle, uHalfAngle - 0.02, abs(angle));
  brightness *= edge * smoothstep(2.0, 1.98, radius);

  outColour = vec4(vec3(brightness), 1.0);
}
`;

/** Shared vertex shader: a full-screen triangle, no attribute buffers needed. */
export const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`;
