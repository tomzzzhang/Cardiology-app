/**
 * Pass 1 — the scanline ray-cast, in polar space.
 *
 * Output is one texel per (scanline, depth): the envelope returned from that
 * sample, before any PSF convolution. The convolution is pass 2, because
 * `contracts/echo-renderer.md` asks for a SEPARABLE PSF and separability is the
 * whole point — a 2D kernel inline here would cost k^2 per sample instead of 2k.
 *
 * Per sample, the contract fixes the form exactly:
 *
 *   echo = scatterer_amplitude(seeded) x PSF(depth, lateral)
 *                                      x specular(beam . normal at boundaries)
 *        + boundary_reflection
 *
 * The specular term MULTIPLIES; only boundary_reflection is added. The PSF
 * factor is applied in pass 2 rather than here — convolving with the PSF *is*
 * multiplying by it, and doing it in the separable pass is what makes the
 * speckle Rayleigh-distributed rather than a per-sample scaling.
 */
export const SCAN_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUv;                  // x = normalised scanline (0..1), y = normalised depth (0..1)
out vec4 outColour;

uniform sampler3D uVolume;    // label ids, R channel, 0..1 (value/255)
uniform sampler2D uLut;       // 256x1: R echogenicity, G attenuation, B described flag
uniform mat4  uMeshToVolume;  // model space -> voxel space
uniform vec3  uVolumeSize;    // voxels per axis

uniform vec3  uOrigin;        // probe origin, model space
uniform vec3  uBeam;          // unit
uniform vec3  uLateral;       // unit, orthogonal to uBeam
uniform float uHalfAngle;     // radians
uniform float uDepthMm;
uniform float uAttenuationScale;
uniform float uAttenDbPerCm;

uniform float uScattererDensity;
uniform float uSpecular;
uniform float uBoundaryReflection;
uniform float uClutter;
uniform float uSeed;
uniform int   uSteps;
uniform int   uAttenSteps;   // samples used for the attenuation integral

/* ------------------------------------------------------------------ */
/* deterministic scatterers                                            */
/* ------------------------------------------------------------------ */

/*
 * The scatterer field is NOT shipped (schema v0 has no baked channel); it is
 * generated here from the pack's scatterer_seed, deterministically, so the same
 * pack renders identically on every device and across reloads.
 *
 * Integer hashing rather than the usual sin(dot(p, k)) trick: that trick's
 * precision collapses at large coordinates, which is exactly where a heart-sized
 * volume in millimetres lives, and the failure mode is visible banding.
 */
uint hashInt(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

float hash3(vec3 p, float seed) {
  ivec3 i = ivec3(floor(p));
  uint h = hashInt(uint(i.x + 8192) ^ hashInt(uint(i.y + 8192) ^ hashInt(uint(i.z + 8192) ^ uint(seed))));
  return float(h & 0x00ffffffu) / float(0x01000000u);
}

/*
 * Sub-resolution scatterers: point targets at density uScattererDensity per mm,
 * with SIGNED, zero-mean amplitudes.
 *
 * The sign is the whole mechanism. Speckle is interference — the coherent sum
 * of many sub-resolution echoes that partly cancel. Convolving POSITIVE
 * amplitudes instead just averages them, and by the law of large numbers a
 * wide PSF over many positive cells converges to the local mean: smooth,
 * flat-looking tissue. That is exactly the "looks like CT" outcome the
 * contract's Stage 0 benchmark is there to catch, and an earlier revision of
 * this shader produced it.
 *
 * Signed Gaussian amplitudes convolved coherently, with the envelope taken
 * after the convolution (pass 2), give fully developed Rayleigh speckle.
 * Randomness lives in the scatterer field, never added to the image — which is
 * the contract's "never additive Gaussian noise" requirement.
 */
float scattererAmplitude(vec3 modelPoint, float seed) {
  vec3 cell = modelPoint * uScattererDensity;
  float u1 = max(hash3(cell, seed), 1e-6);
  float u2 = hash3(cell, seed + 31.0);
  // Box-Muller: zero-mean, unit-variance, and signed.
  return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
}

/* ------------------------------------------------------------------ */
/* volume sampling                                                     */
/* ------------------------------------------------------------------ */

vec3 toTexture(vec3 modelPoint) {
  vec3 voxel = (uMeshToVolume * vec4(modelPoint, 1.0)).xyz;
  return voxel / uVolumeSize;
}

/** Label properties at a model-space point: R echogenicity, G attenuation, B described. */
vec3 properties(vec3 modelPoint) {
  /*
   * Coordinates are CLAMPED to the grid rather than early-returning zero
   * outside it. Returning zero made the grid's own bounding box an acoustic
   * interface: the gradient across that face was large, so the renderer drew a
   * flat bright line where rays left the volume — a straight edge across the
   * sector that is a container artefact, not anatomy.
   *
   * The voxeliser leaves a margin of background around the model, so clamping
   * samples background there, which is blood. Blood meeting blood is not an
   * interface, and the box stops existing acoustically.
   */
  vec3 uvw = clamp(toTexture(modelPoint), vec3(0.0), vec3(1.0));
  float label = texture(uVolume, uvw).r;
  vec3 entry = texture(uLut, vec2(label + 0.5 / 256.0, 0.5)).rgb;
  return vec3(entry.r, entry.g * uAttenuationScale, entry.b);
}

void main() {
  float u = vUv.x * 2.0 - 1.0;               // -1..1 across the fan
  float angle = u * uHalfAngle;
  vec3 direction = normalize(uBeam * cos(angle) + uLateral * sin(angle));

  float target = vUv.y * uDepthMm;           // depth of THIS texel
  float step = uDepthMm / float(uSteps);

  /*
   * The march computes ONE thing: the attenuation accumulated on the way to
   * this texel's depth. Nothing along the path contributes to the texel's
   * brightness.
   *
   * That separation is the physics, and getting it wrong is visible. An earlier
   * revision accumulated the boundary-reflection term along the ray and added
   * the running total to every sample, so each texel carried every interface
   * shallower than itself. Brightness then rose monotonically with depth until
   * the whole sector saturated to white — a uniform white fan, which is what
   * the first render produced. A texel is the echo returning FROM its own
   * depth: only structure AT that depth contributes, and the path integral
   * supplies attenuation alone.
   *
   * Marching per texel is O(depth) per texel and so O(depth^2) per scanline.
   * Deliberately accepted: frames are static in v1, a prefix sum along the ray
   * is not expressible in a fragment shader without another target, and the
   * measured cost sits well inside budget. If motion lands, restructure this
   * first.
   */
  /*
   * The attenuation integral is sampled with a FIXED, small number of steps
   * rather than at the texel spacing.
   *
   * Sampling it at full resolution is what made the first working version cost
   * ~370 ms a frame: every one of ~200k polar texels walked its own path at the
   * sample step, which is a quarter of a billion volume fetches per frame for a
   * quantity that is a smooth path integral. Attenuation has no high-frequency
   * content — it is a running sum of a slowly varying coefficient — so a coarse
   * quadrature is accurate to well under a decibel while costing an order of
   * magnitude less. The FINE step still applies to the sample at this texel's
   * own depth, which is where the detail actually lives.
   */
  float attenuationDb = 0.0;
  float attenStep = target / float(uAttenSteps);
  for (int i = 0; i < 128; i++) {
    if (i >= uAttenSteps) break;
    vec3 point = uOrigin + direction * ((float(i) + 0.5) * attenStep);
    // Beer-Lambert in decibels, round trip. Shadowing behind a strong
    // attenuator and distal dropout both fall out of this rather than being
    // drawn on. The factor of two is the return path, which is why TGC must
    // compensate twice the one-way loss to flatten the image.
    attenuationDb += 2.0 * properties(point).g * uAttenDbPerCm * (attenStep * 0.1);
  }
  float transmit = pow(10.0, -attenuationDb / 20.0);

  /* --- what is actually AT this depth ------------------------------------ */

  vec3 here = uOrigin + direction * target;
  vec3 props = properties(here);

  /*
   * Interface normal from the gradient of the echogenicity field, by central
   * differences at the step scale. Cheaper than a second volume and adequate
   * at this resolution.
   */
  float h = max(step, 0.5) * 1.5;
  vec3 gradient = vec3(
    properties(here + vec3(h, 0.0, 0.0)).r - properties(here - vec3(h, 0.0, 0.0)).r,
    properties(here + vec3(0.0, h, 0.0)).r - properties(here - vec3(0.0, h, 0.0)).r,
    properties(here + vec3(0.0, 0.0, h)).r - properties(here - vec3(0.0, 0.0, h)).r
  );
  float gradientLength = length(gradient);

  float specular = 1.0;
  float boundary = 0.0;
  if (gradientLength > 1e-4) {
    float incidence = abs(dot(direction, gradient / gradientLength));
    // Specular MULTIPLIES — the contract fixes this form. A leaflet face-on is
    // bright and the same leaflet edge-on nearly disappears.
    specular = mix(1.0, 0.25 + 1.75 * pow(incidence, 2.0), uSpecular);
    // Only the boundary reflection is ADDED, and only where the interface is.
    boundary = uBoundaryReflection * gradientLength * pow(incidence, 3.0);
  }

  float amplitude = scattererAmplitude(here, uSeed);
  // Signed RF, not an envelope. The envelope is formed after the PSF pass.
  float echo = (props.r * amplitude * specular + boundary) * transmit;

  // Subtle near-field clutter — reverberation just under the transducer face.
  float nearField = exp(-target / (uDepthMm * 0.05));
  echo += uClutter * nearField * (hash3(vec3(vUv * 512.0, 7.0), uSeed + 11.0) * 2.0 - 1.0);

  outColour = vec4(echo, transmit, props.b, 1.0);
}
`;
