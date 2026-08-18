/**
 * The probe: the transducer body, its orientation marker, and the finite sector
 * it images, drawn in the 3D scene from the pose the echo panel is rendering.
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

/* Transducer body, in pack units (mm). A paediatric phased-array footprint —
 * small enough not to swamp a neonatal heart, large enough to read as hardware
 * rather than as a stray marker. */
const BODY_LENGTH = 26;
const BODY_WIDTH = 20;
const BODY_THICKNESS = 13;
/** Radius of the orientation marker on the probe's marker side. */
const MARKER_RADIUS = 3.4;

const SECTOR_COLOUR = 0x49b0ff;
const OUTLINE_COLOUR = 0x8fd2ff;
const BODY_COLOUR = 0x2b3440;
const MARKER_COLOUR = 0xffc857;

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

/** Outline of the sector: the two straight edges and the far arc. */
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
  return new THREE.BufferGeometry().setFromPoints(points);
}

/**
 * Rigid placement of the transducer body: aperture face on the sector's apex,
 * long axis back along the beam, width along the lateral axis.
 *
 * The body sits BEHIND the apex — the scan starts at the aperture, so a body
 * centred on the apex would bury half the transducer in the first two
 * centimetres of the image.
 */
function bodyMatrix(frame: ImagingFrame): THREE.Matrix4 {
  const { apex, beam, lateral, normal } = vectors(frame);
  const basis = new THREE.Matrix4().makeBasis(lateral, normal, beam.clone().negate());
  return basis.setPosition(apex.clone().addScaledVector(beam, -BODY_LENGTH / 2));
}

/**
 * Where the orientation marker sits.
 *
 * `display.marker_side` names the side of the DISPLAYED image the indicator
 * corresponds to, so on the probe it is the end of the aperture that maps to
 * that edge of the sector: `right` is `+lateral`, `left` is `-lateral`. That
 * mapping is a convention, and it is stated here so a later display-flag change
 * has one place to correct rather than a guess embedded in geometry.
 */
function markerPosition(frame: ImagingFrame): THREE.Vector3 {
  const { apex, beam, lateral } = vectors(frame);
  const side = frame.markerSide === 'right' ? 1 : -1;
  return apex
    .clone()
    .addScaledVector(beam, -BODY_LENGTH * 0.55)
    .addScaledVector(lateral, (side * BODY_WIDTH) / 2);
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
  private outline: THREE.Line;
  private body: THREE.Mesh;
  private marker: THREE.Mesh;

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
    this.outline = new THREE.Line(
      wedgeOutline(frame),
      new THREE.LineBasicMaterial({ color: OUTLINE_COLOUR, transparent: true, opacity: 0.9 }),
    );

    this.body = new THREE.Mesh(
      new THREE.BoxGeometry(BODY_WIDTH, BODY_THICKNESS, BODY_LENGTH),
      new THREE.MeshStandardMaterial({ color: BODY_COLOUR, roughness: 0.6, metalness: 0.1 }),
    );
    this.body.matrixAutoUpdate = false;

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(MARKER_RADIUS, 16, 12),
      new THREE.MeshStandardMaterial({
        color: MARKER_COLOUR,
        roughness: 0.4,
        emissive: MARKER_COLOUR,
        emissiveIntensity: 0.35,
      }),
    );
    this.marker.matrixAutoUpdate = false;

    this.object.add(this.surface, this.outline, this.body, this.marker);
    this.object.renderOrder = 2;
    this.place(frame);
  }

  private place(frame: ImagingFrame): void {
    this.body.matrix.copy(bodyMatrix(frame));
    this.marker.matrix.identity().setPosition(markerPosition(frame));
  }

  update(frame: ImagingFrame): void {
    this.surface.geometry.dispose();
    this.outline.geometry.dispose();
    this.surface.geometry = wedgeGeometry(frame);
    this.outline.geometry = wedgeOutline(frame);
    this.place(frame);
  }

  dispose(): void {
    for (const mesh of [this.surface, this.outline, this.body, this.marker]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
