/**
 * The probe: the transducer body and the finite sector it images, drawn in the
 * 3D scene from the pose the echo panel is rendering.
 *
 * `contracts/viewer-core.md` calls for "a separate translucent sector-wedge
 * probe indicator driven by the same saved probe pose and fan params as the
 * echo panel (one-to-one match)". The one-to-one match is not achieved by
 * carefully keeping two things in step — it is achieved by there being one
 * thing. This module takes the SAME `ImagingFrame` the renderer rasterises and
 * builds geometry from it. Neither side owns a copy of the fan.
 *
 * The sector is FINITE, and that is a claim about the instrument rather than a
 * rendering shortcut: a sector image ends at `fan.depth_cm` because that is
 * where the scanner stopped listening. The free anatomical cutter's plane, by
 * contrast, is infinite. The two objects look similar and mean opposite things,
 * which is why they are on separate data paths and never merge
 * (`contracts/README.md`).
 */
import * as THREE from 'three';
import type { ImagingFrame } from '../echo/probeFrame.ts';

/** Radial segments across the fan. Enough that the arc does not read as facets. */
const ARC_SEGMENTS = 48;

/* The transducer, in pack units (mm). Local +z runs BACK from the aperture
 * along the beam, so every number below is a distance from the lens face.
 *
 * The silhouette is what tells a learner which end is imaging, so the shape is
 * built as a probe rather than as a box: a box has no ends.
 *
 * *(Supersedes "a paediatric phased-array probe, small enough not to swamp a
 * neonatal heart", 2026-08-22.)* That sizing was chosen when the scene was a
 * heart alone and the probe's only job was to not dominate it. The substrate is
 * an ADULT population-average heart inside a registered adult chest, and the
 * views are authored for adult transthoracic imaging, so the probe is now sized
 * as one. It is comparable in length to the heart is wide, which is what those
 * two objects actually are.
 */
/*
 * Proportions taken from an adult phased-array transthoracic probe of the class
 * these views are authored for — GE M5Sc / Philips S5-1 and their equivalents.
 *
 * The previous model was 33 mm end to end with a 16 mm barrel. That is not a
 * probe, it is a thimble: roughly a third of the real length, and small enough
 * that against a true chest it read as a marker sitting on the skin rather than
 * as an instrument someone is holding. Now that there IS a true chest to hold
 * it against, the size is checkable, so it is worth getting right.
 *
 * Measured reference, and what each number is:
 *
 * * **footprint** about 21 x 15 mm. A phased array images through a small
 *   aperture so it can sit BETWEEN ribs — that is the whole point of the
 *   format, and a footprint drawn too large would make the intercostal windows
 *   these views depend on look impossible.
 * * **handle** about 30 x 22 mm, slightly waisted where it is gripped.
 * * **housing** about 108 mm from lens face to the cable gland, with a strain
 *   relief and a cable stub beyond it.
 *
 * The cross-section is ELLIPTICAL, not round: a real probe is flattened in the
 * elevation direction, and the wide axis is the array's long axis, which is the
 * fan's lateral axis. That flattening is what lets the silhouette say which way
 * the imaging plane lies without any marker on it.
 */
const LENS_HALF_WIDTH = 10.5;
/** Elevation squash: cross-sections are this fraction as deep as they are wide. */
const ELEVATION_RATIO = 0.70;
/** How far back the housing runs, lens face to cable gland. */
const HOUSING_LENGTH = 108;
/** How far back the whole probe extends, cable stub included. */
export const PROBE_LENGTH = 126;
/** Line thickness for the sector outline, as a fraction of fan depth. */
const OUTLINE_SCALE = 0.005;

const SECTOR_COLOUR = 0x49b0ff;
const OUTLINE_COLOUR = 0x8fd2ff;
/*
 * Off-white, like the hardware. Clinical probes are light grey to near-white —
 * the housing is a pale moulded polymer and the lens is a slightly darker, more
 * reflective rubber. The old dark slate read as a black wand and, against pale
 * ribs and skin, as a hole in the scene.
 */
const BODY_COLOUR = 0xe9e7e2;
const LENS_COLOUR = 0xbfb9b0;
const STRAIN_RELIEF_COLOUR = 0x9aa0a6;

function vectors(frame: ImagingFrame) {
  return {
    apex: new THREE.Vector3(...frame.origin),
    beam: new THREE.Vector3(...frame.beam),
    lateral: new THREE.Vector3(...frame.lateral),
    normal: new THREE.Vector3(...frame.normal),
  };
}

/**
 * Triangle-fan geometry for the sector, in model space.
 *
 * The sector is built in the frame's own basis — apex at `origin`, swept from
 * `-halfAngle` to `+halfAngle` about the elevation normal — so it is planar by
 * construction. Building it in world space and rotating afterwards would
 * reintroduce exactly the drift this module exists to prevent.
 */
export function wedgeGeometry(frame: ImagingFrame): THREE.BufferGeometry {
  const positions: number[] = [];
  const { apex, beam, lateral } = vectors(frame);

  const edge = (index: number) => {
    const t = index / ARC_SEGMENTS;
    const angle = (t * 2 - 1) * frame.halfAngleRad;
    return beam
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(lateral, Math.sin(angle))
      .multiplyScalar(frame.depthMm)
      .add(apex);
  };

  for (let i = 0; i < ARC_SEGMENTS; i += 1) {
    const a = edge(i);
    const b = edge(i + 1);
    positions.push(apex.x, apex.y, apex.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Outline of the sector: the two straight edges and the far arc.
 *
 * Built as a TUBE rather than as a line, because WebGL ignores `linewidth` on
 * every desktop driver — a `LineBasicMaterial` is one pixel wide whatever it is
 * asked for. The imaging plane is the object the whole screen is about, and a
 * hairline reads as a construction guide rather than as the edge of a plane.
 * The radius is a fraction of fan depth, so it holds its weight across views
 * whose sectors differ by centimetres.
 */
export function wedgeOutline(frame: ImagingFrame): THREE.BufferGeometry {
  const { apex, beam, lateral } = vectors(frame);

  const points: THREE.Vector3[] = [apex];
  for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
    const angle = ((i / ARC_SEGMENTS) * 2 - 1) * frame.halfAngleRad;
    points.push(
      beam
        .clone()
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(lateral, Math.sin(angle))
        .multiplyScalar(frame.depthMm)
        .add(apex),
    );
  }
  points.push(apex);
  return new THREE.TubeGeometry(
    polyline(points),
    points.length,
    Math.max(frame.depthMm * OUTLINE_SCALE, 0.2),
    6,
    false,
  );
}

/**
 * A curve that goes exactly through its points, with sharp corners.
 *
 * Not a spline. A `CatmullRomCurve3` through this outline rounds the two corners
 * at the vertex into a loop and bows the straight edges outward — it turns a
 * sector into a teardrop. The arc is already sampled densely enough that a
 * polyline reads as smooth where it should be smooth, and stays sharp where the
 * sector really is sharp.
 */
function polyline(points: readonly THREE.Vector3[]): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i += 1) {
    if (points[i].distanceToSquared(points[i + 1]) < 1e-12) continue;
    path.add(new THREE.LineCurve3(points[i].clone(), points[i + 1].clone()));
  }
  return path;
}

/**
 * Rigid placement of the transducer: aperture face ON the sector's apex, the
 * body running back along the beam, width along the lateral axis.
 *
 * The whole probe is one group placed by this matrix, so its parts are authored
 * in a local frame where the origin is the lens face and +z runs BACK from it.
 * That is the frame a probe is naturally described in, and it means the body
 * sits behind the aperture by construction rather than by an offset that has to
 * be kept in step with the body's length.
 */
function bodyMatrix(frame: ImagingFrame): THREE.Matrix4 {
  const { apex, beam, lateral, normal } = vectors(frame);
  return new THREE.Matrix4()
    .makeBasis(lateral, normal, beam.clone().negate())
    .setPosition(apex);
}

/**
 * The transducer, in its own local frame: origin on the lens face, +z back.
 *
 * Five parts, and each of them is doing a job rather than decorating:
 *
 * * the **lens** is flat, wide and thin, so the aperture reads as the face that
 *   images and the array's long axis reads as the fan's lateral axis;
 * * the **neck** tapers, which is what makes the lens end read as the near end
 *   at a glance rather than after tracing the geometry;
 * * the **grip** and its **domed end** give the silhouette a handle, so the
 *   probe reads as something held against the chest;
 * * the **cable** stub says which way is out of the patient.
 *
 * There is deliberately NO orientation marker on the body. `display.marker_side`
 * is still carried on the frame and still decides how the sector maps to the
 * displayed image; it simply is not drawn on the probe any more. That is a real
 * loss of information — the probe no longer says which of its sides becomes the
 * left of the echo panel — and it is recorded in `docs/observations.md` rather
 * than passed off as a simplification.
 */
/**
 * The housing silhouette, as `(distance back from the lens face, half-width)`.
 *
 * A revolved profile rather than a stack of primitives. The old model was four
 * cylinders and a sphere, and it read as four cylinders and a sphere: every
 * join was a visible step, and a probe is a single moulded object. Revolving
 * one curve gives continuous shoulders, which is most of what makes it look
 * like hardware.
 *
 * Read down the column and it is the shape in words: a small flat aperture, a
 * short nose that flares, a shoulder into the handle, the handle's slight
 * waist where fingers go, then the taper to the cable gland.
 */
const PROBE_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, LENS_HALF_WIDTH - 1.0],
  [1.4, LENS_HALF_WIDTH],
  [3.0, LENS_HALF_WIDTH + 0.3],
  // The SCAN HEAD holds its width for the first ~17 mm. A real one is a
  // distinct block that sits in an intercostal space, not the start of a cone —
  // the first pass flared straight from the lens into the handle and read as a
  // stylus. The shoulder below is what makes it a scan head.
  [10, 11.0],
  [17, 11.2],
  [21, 12.6],
  [27, 14.2],
  [34, 15.0],
  [48, 15.2],
  [62, 14.8],
  [76, 14.0],
  [88, 12.6],
  [96, 10.2],
  [HOUSING_LENGTH, 7.0],
];

/** Strain relief and cable, which continue where the housing stops. */
const CABLE_PROFILE: readonly (readonly [number, number])[] = [
  [HOUSING_LENGTH, 6.4],
  [HOUSING_LENGTH + 6, 5.0],
  [HOUSING_LENGTH + 12, 4.2],
  [PROBE_LENGTH, 3.8],
];

/**
 * Revolve a profile about the probe's long axis and flatten it into the
 * elliptical cross-section a real probe has.
 *
 * `LatheGeometry` revolves about `+y`, so the result is rotated onto `+z` and
 * squashed in elevation. Both are baked into the GEOMETRY rather than set on
 * the mesh: a mesh scale would be composed as `T * R * S` and would therefore
 * squash the probe's LENGTH, since the lathe's own axis is still `y` at the
 * moment the scale applies.
 */
function revolved(profile: readonly (readonly [number, number])[]): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(
    profile.map(([z, radius]) => new THREE.Vector2(radius, z)),
    36,
  );
  geometry.rotateX(Math.PI / 2);
  geometry.scale(1, ELEVATION_RATIO, 1);
  geometry.computeVertexNormals();
  return geometry;
}

function buildProbeBody(): THREE.Group {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({
    color: BODY_COLOUR, roughness: 0.45, metalness: 0.02,
  });
  /*
   * The lens is a touch darker and markedly glossier than the housing. That is
   * how a real one reads: the housing is matte moulded polymer and the lens is
   * a rubber acoustic window, usually wet with gel. The contrast is what makes
   * the imaging face identifiable at a glance, which is the job the old
   * flat-box lens was doing and the only reason it is still a separate part.
   */
  const lensFace = new THREE.MeshStandardMaterial({
    color: LENS_COLOUR, roughness: 0.18, metalness: 0.04,
  });
  const strainRelief = new THREE.MeshStandardMaterial({
    color: STRAIN_RELIEF_COLOUR, roughness: 0.7, metalness: 0.02,
  });

  group.add(new THREE.Mesh(revolved(PROBE_PROFILE), shell));
  group.add(new THREE.Mesh(revolved(CABLE_PROFILE), strainRelief));

  /*
   * The acoustic window: a shallow dome across the aperture, not a flat disc.
   * A phased-array lens is curved in elevation to focus the slice, and the
   * curve is what catches the light and says "this face is the one imaging".
   */
  const lens = new THREE.SphereGeometry(LENS_HALF_WIDTH, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  lens.rotateX(Math.PI);
  lens.scale(1, ELEVATION_RATIO, 0.22);
  group.add(new THREE.Mesh(lens, lensFace));

  return group;
}

/**
 * The probe as one object: body, marker, sector, sector outline.
 *
 * Geometry for the sector is rebuilt rather than transformed as a sweep scrubs:
 * the fan's depth and angle are free to differ per view, so there is no single
 * rigid motion that carries one frame's sector onto another's. The body and
 * marker ARE rigid, so those move by matrix.
 */
export class ProbeIndicator {
  readonly object = new THREE.Group();
  private surface: THREE.Mesh;
  private outline: THREE.Mesh;
  private body: THREE.Group;

  constructor(frame: ImagingFrame) {
    this.surface = new THREE.Mesh(
      wedgeGeometry(frame),
      new THREE.MeshBasicMaterial({
        color: SECTOR_COLOUR,
        transparent: true,
        /*
         * Almost invisible, and that is the UI-2 finding rather than a taste
         * call. The rule settled in the design pass is that imaged tissue is
         * marked by DIMMING the anatomy the beam misses. Tested in 3D at
         * opacity 0.1, the sector fill lightened roughly a third of the panel
         * — competing with the dimming and putting a wash over the tissue
         * colours, which is the tinting the rule exists to avoid, only weaker.
         *
         * What the sector still has to do is read as a SURFACE, so the fan's
         * plane is legible when the camera is near edge-on to it. 0.035 is
         * enough for that and not enough to shift the background.
         */
        opacity: 0.035,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.outline = new THREE.Mesh(
      wedgeOutline(frame),
      new THREE.MeshBasicMaterial({ color: OUTLINE_COLOUR, transparent: true, opacity: 0.85 }),
    );

    this.body = buildProbeBody();
    this.body.matrixAutoUpdate = false;

    this.object.add(this.surface, this.outline, this.body);
    this.object.renderOrder = 2;
    this.place(frame);
  }

  private place(frame: ImagingFrame): void {
    this.body.matrix.copy(bodyMatrix(frame));
  }

  update(frame: ImagingFrame): void {
    this.surface.geometry.dispose();
    this.outline.geometry.dispose();
    this.surface.geometry = wedgeGeometry(frame);
    this.outline.geometry = wedgeOutline(frame);
    // The marker side is a display convention of the view, not of the sweep
    // position, so the body is built once and only ever moved.
    this.place(frame);
  }

  dispose(): void {
    for (const mesh of [this.surface, this.outline]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.body.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    });
  }
}
