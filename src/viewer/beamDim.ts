/**
 * Dim the anatomy the beam does not cross.
 *
 * This is the treatment settled in the design pass and recorded as UI-2: show
 * which tissue the echo panel is actually looking at by attenuating everything
 * else, rather than by tinting the wedge. Tinting the wedge colours the space
 * between the probe and the tissue, which is the one part of the picture that
 * carries no information; attenuating the anatomy marks the tissue itself.
 *
 * Implemented as a fragment-level test against the imaging frame rather than a
 * per-structure bounding-volume test. A bounding test would call a whole
 * chamber "crossed" when the beam clips one corner of it, which is precisely
 * the judgement the learner is trying to make. Per fragment, the highlighted
 * region IS the imaged slab.
 *
 * The slab has a real half-thickness because an echo plane does: a sector is an
 * elevation-focused slice several millimetres thick, not a mathematical plane.
 * Using zero thickness would highlight nothing at all.
 */
import * as THREE from 'three';
import type { ImagingFrame } from '../echo/probeFrame.ts';

/**
 * Half-thickness of the highlighted slab, in pack units (mm).
 *
 * Elevation slice thickness on a paediatric phased array is roughly 3-6 mm at
 * the focus and worse elsewhere. 5 mm sits inside that and, importantly, is
 * thick enough that the highlight survives being viewed edge-on.
 */
export const SLAB_HALF_MM = 5;

/*
 * How far a non-crossed fragment is pushed down and toward grey — as TWO
 * independent numbers, which is the point.
 *
 * The panel has to do two things at once: mark the imaged slab, and stay a
 * labelled anatomy viewer while doing it. Those pull in opposite directions
 * only if the dim is treated as one knob. Split, they do not:
 *
 * * **luminance** carries the marking. A darker surround is what makes the
 *   bright band read as the imaged tissue, and lightness is the channel the eye
 *   segments a scene by.
 * * **saturation** carries the labelling, and it survives being cut hard.
 *   Structures stay tellable apart by hue long after the hue has stopped being
 *   vivid, because "tellable apart" is a difference, not an intensity.
 *
 * So saturation is cut much harder than luminance, and luminance is pushed
 * exactly as far as the labelling will bear. Measured on the shipped palette in
 * CIE Lab (`tests/unit/beamDim.test.ts`), at these values the closest pair in
 * the palette — the gold left atrium against the green right atrium — is still
 * 11.8 units apart outside the beam, well above the ~10 at which two colours
 * stop reading as different, while the in/out contrast rises to 49.8 from the
 * 41.0 the previous single-knob setting managed.
 *
 * UI-2 in the planning folder's `ui_design_questions.md` is closed on these.
 */
export const DIM_LUMINANCE = 0.6;
export const DIM_SATURATION = 0.28;

/**
 * The shader's dim, in TypeScript, on 0-255 sRGB.
 *
 * A duplicate of two lines of GLSL, and worth it: this is the pair of numbers
 * that decides whether the model stays readable while the highlight is on, and
 * a claim about that has to be measurable rather than remembered. The shader
 * applies it to the shaded fragment AFTER the colour-space conversion, so sRGB
 * is the space to reason in and this is the same arithmetic on the same values.
 */
export function dimmedColour(rgb: readonly [number, number, number]): [number, number, number] {
  const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return rgb.map((channel) =>
    Math.min(255, Math.max(0, (luma + DIM_SATURATION * (channel - luma)) * DIM_LUMINANCE)),
  ) as [number, number, number];
}

interface DimUniforms {
  uBeamOrigin: { value: THREE.Vector3 };
  uBeamAxis: { value: THREE.Vector3 };
  uBeamLateral: { value: THREE.Vector3 };
  uBeamNormal: { value: THREE.Vector3 };
  uBeamHalfAngle: { value: number };
  uBeamDepth: { value: number };
  uBeamSlab: { value: number };
  uBeamDim: { value: number };
}

/**
 * Patch a material so fragments outside the imaged slab render attenuated.
 *
 * The returned handle updates the frame; the material itself is left otherwise
 * untouched, so lighting, clipping and transparency all behave as before.
 * `uBeamDim` at 0 disables the effect without recompiling anything.
 */
export function applyBeamDim(material: THREE.Material): DimUniforms {
  const uniforms: DimUniforms = {
    uBeamOrigin: { value: new THREE.Vector3() },
    uBeamAxis: { value: new THREE.Vector3(0, 0, -1) },
    uBeamLateral: { value: new THREE.Vector3(1, 0, 0) },
    uBeamNormal: { value: new THREE.Vector3(0, 1, 0) },
    uBeamHalfAngle: { value: 0.6 },
    uBeamDepth: { value: 100 },
    uBeamSlab: { value: SLAB_HALF_MM },
    uBeamDim: { value: 0 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBeamWorld;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvBeamWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBeamWorld;
uniform vec3  uBeamOrigin;
uniform vec3  uBeamAxis;
uniform vec3  uBeamLateral;
uniform vec3  uBeamNormal;
uniform float uBeamHalfAngle;
uniform float uBeamDepth;
uniform float uBeamSlab;
uniform float uBeamDim;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
if ( uBeamDim > 0.0 ) {
  vec3 d = vBeamWorld - uBeamOrigin;
  float elevation = abs( dot( d, uBeamNormal ) );
  vec3 inPlane = d - uBeamNormal * dot( d, uBeamNormal );
  float along = dot( inPlane, uBeamAxis );
  float lateral = dot( inPlane, uBeamLateral );
  float range = length( inPlane );
  float angle = atan( lateral, along );

  // Soft edges on every bound. A hard step aliases badly along the sector
  // edges, where the boundary is nearly parallel to the surface it crosses.
  float inSlab  = 1.0 - smoothstep( uBeamSlab * 0.6, uBeamSlab, elevation );
  float inRange = 1.0 - smoothstep( uBeamDepth * 0.97, uBeamDepth, range );
  float inFan   = 1.0 - smoothstep( uBeamHalfAngle * 0.94, uBeamHalfAngle, abs( angle ) );
  float ahead   = step( 0.0, along );
  float crossed = inSlab * inRange * inFan * ahead;

  float luma = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Saturation first, then luminance: two independent channels, in that order.
  vec3 dimmed = mix( vec3( luma ), gl_FragColor.rgb, ${DIM_SATURATION.toFixed(2)} ) * ${DIM_LUMINANCE.toFixed(2)};
  gl_FragColor.rgb = mix( mix( gl_FragColor.rgb, dimmed, uBeamDim ), gl_FragColor.rgb, crossed );
}`,
      );
  };
  material.needsUpdate = true;
  return uniforms;
}

/** Point a patched material's uniforms at the current imaging frame. */
export function setBeamFrame(uniforms: DimUniforms, frame: ImagingFrame): void {
  uniforms.uBeamOrigin.value.set(...frame.origin);
  uniforms.uBeamAxis.value.set(...frame.beam);
  uniforms.uBeamLateral.value.set(...frame.lateral);
  uniforms.uBeamNormal.value.set(...frame.normal);
  uniforms.uBeamHalfAngle.value = frame.halfAngleRad;
  uniforms.uBeamDepth.value = frame.depthMm;
}
