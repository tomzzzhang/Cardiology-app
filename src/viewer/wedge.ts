/**
 * The probe: the transducer body and the finite sector it images, drawn in the
 * 3D scene from the pose the echo panel is rendering.
 *
 * `contracts/viewer-core.md` calls for "a separate translucent sector-wedge
 * probe indicator driven by the same vetted probe pose and fan params as the
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

/* The transducer, in pack units (mm). A paediatric phased-array probe — small
 * enough not to swamp a neonatal heart, large enough to read as hardware rather
 * than as a stray marker.
 *
 * Built as the shape a probe actually is rather than as a box: a flat acoustic
 * lens at the aperture, a short taper, a barrel to hold, a domed end and a
 * cable stub. The silhouette is what tells a learner which end is imaging, and
 * a box has no ends. Local +z runs BACK from the aperture along the beam. */
const LENS_WIDTH = 20;
const LENS_THICKNESS = 7;
const LENS_LENGTH = 4;
const NECK_LENGTH = 7;
const GRIP_RADIUS = 8;
const GRIP_LENGTH = 14;
const CABLE_RADIUS = 2.4;
/** How far back the whole probe extends. The arrow is drawn clear of this. */
export const PROBE_LENGTH = 33;
/** Line thickness for the sector outline, as a fraction of fan depth. */
const OUTLINE_SCALE = 0.005;

const SECTOR_COLOUR = 0x49b0ff;
const OUTLINE_COLOUR = 0x8fd2ff;
const BODY_COLOUR = 0x2b3440;
const LENS_COLOUR = 0x4b5666;

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
function buildProbeBody(): THREE.Group {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({
    color: BODY_COLOUR, roughness: 0.6, metalness: 0.1,
  });
  const lensFace = new THREE.MeshStandardMaterial({
    color: LENS_COLOUR, roughness: 0.35, metalness: 0.05,
  });

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = z;
    group.add(mesh);
    return mesh;
  };

  add(new THREE.BoxGeometry(LENS_WIDTH, LENS_THICKNESS, LENS_LENGTH), lensFace, LENS_LENGTH / 2);

  // Cylinders are built about +y, so every barrel is turned onto +z once here.
  const upright = (mesh: THREE.Mesh) => {
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };
  upright(add(
    new THREE.CylinderGeometry(GRIP_RADIUS, LENS_WIDTH / 2.4, NECK_LENGTH, 20),
    shell,
    LENS_LENGTH + NECK_LENGTH / 2,
  ));
  upright(add(
    new THREE.CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, GRIP_LENGTH, 20),
    shell,
    LENS_LENGTH + NECK_LENGTH + GRIP_LENGTH / 2,
  ));
  const dome = add(
    new THREE.SphereGeometry(GRIP_RADIUS, 20, 12),
    shell,
    LENS_LENGTH + NECK_LENGTH + GRIP_LENGTH,
  );
  dome.scale.z = 0.7;
  upright(add(
    new THREE.CylinderGeometry(CABLE_RADIUS, CABLE_RADIUS, 8, 12),
    shell,
    PROBE_LENGTH - 3,
  ));

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
