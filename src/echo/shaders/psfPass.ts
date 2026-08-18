/**
 * Pass 2 — separable PSF convolution over the polar image.
 *
 * The point spread function is what turns a field of independent point
 * scatterers into speckle with the right texture. It is applied here, on the
 * polar image, because that is the space the PSF is separable in: axially along
 * the beam, laterally across scanlines. Convolving after scan conversion would
 * smear it along screen axes, which are not the beam axes anywhere except the
 * centre line.
 *
 * Run twice with `uAxis` flipped. Both passes read the previous target, so the
 * cost is 2k samples per texel rather than k^2.
 */
export const PSF_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColour;

uniform sampler2D uSource;
uniform vec2  uTexel;        // 1 / resolution of the polar image
uniform vec2  uAxis;         // (1,0) lateral pass, (0,1) axial pass
uniform float uSigma;        // in texels at the focus
uniform float uDefocus;      // widening per unit normalised depth away from focus
uniform float uFocusDepth;   // normalised 0..1
uniform int   uRadius;
uniform int   uEnvelope;   // 1 on the final pass: form the envelope

void main() {
  /*
   * The lateral PSF widens away from the focus; the axial one barely does. That
   * asymmetry is the reason a real sector image is sharp at the focal depth and
   * smeared at the edges of the sector, and it is priority 2's "lateral-wall
   * dropout" in its geometric form.
   */
  float depth = vUv.y;
  float widen = 1.0 + uDefocus * abs(depth - uFocusDepth) * 100.0 * uAxis.x;
  float sigma = max(uSigma * widen, 0.35);

  float sum = 0.0;
  float weightSum = 0.0;
  float weightSquares = 0.0;
  for (int i = -64; i <= 64; i++) {
    if (i < -uRadius || i > uRadius) continue;
    float offset = float(i);
    float weight = exp(-0.5 * (offset * offset) / (sigma * sigma));
    vec2 at = vUv + uAxis * uTexel * offset;
    // Clamp rather than wrap: the fan edge is an edge, not a neighbour.
    at = clamp(at, vec2(0.0), vec2(1.0));
    float value = texture(uSource, at).r;
    // Coherent while convolving; squared only on the envelope pass (below).
    sum += (uEnvelope == 1 ? value * value : value) * weight;
    weightSum += weight;
    weightSquares += weight * weight;
  }

  /*
   * The lateral pass is COHERENT: it sums signed RF, so neighbouring scatterers
   * interfere rather than merely averaging. That interference IS the speckle.
   *
   * The final pass forms the envelope as an RMS over the axial window rather
   * than by rectifying with abs(). A real-valued RF signal passes through zero
   * between every pair of half-cycles, so abs() leaves hard black nulls
   * scattered through the tissue — the image comes out lacy, with holes a
   * scanner does not show. A scanner displays the magnitude of the ANALYTIC
   * signal, which has no such zeros. sqrt(mean(RF^2)) over a short axial window
   * estimates that magnitude directly, keeps Rayleigh speckle statistics, and
   * costs one multiply.
   *
   * The two passes normalise DIFFERENTLY, and that is the point.
   *
   * The envelope pass averages squares, so it divides by sum(w): a mean.
   *
   * The coherent pass divides by sqrt(sum(w^2)), which is the normalisation
   * that leaves a white-noise input with the variance it arrived with. Dividing
   * by sum(w) instead — an average — is what an earlier revision did, and it
   * attenuates independent scatterers by roughly 1/sqrt(2*sigma*sqrt(pi)):
   * about 9 dB at this resolution, and a DIFFERENT number at any other polar
   * resolution or PSF width. So the rendered brightness of a tissue depended on
   * the renderer's internal sampling rather than on the echogenicity the pack
   * authored, and every attempt to fix the resulting darkness by raising gain
   * moved the whole image, interfaces included.
   */
  float value = uEnvelope == 1
    ? sum / max(weightSum, 1e-6)
    : sum / max(sqrt(weightSquares), 1e-6);
  vec4 centre = texture(uSource, vUv);
  outColour = vec4(uEnvelope == 1 ? sqrt(max(value, 0.0)) : value, centre.g, centre.b, 1.0);
}
`;
