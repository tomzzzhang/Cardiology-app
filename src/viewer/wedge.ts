/**
 * The probe wedge: the translucent sector drawn in the 3D scene, showing where
 * the echo panel is imaging.
 *
 * `contracts/viewer-core.md` calls for "a separate translucent sector-wedge
 * probe indicator driven by the same vetted probe pose and fan params as the
 * echo panel (one-to-one match)". The one-to-one match is not achieved by
 * carefully keeping two things in step — it is achieved by there being one
 * thing. This module takes the SAME `ImagingFrame` the renderer rasterises and
 * builds geometry from it. Neither side owns a copy of the fan.
 *
 * This is deliberately not the free anatomical cutter, which is a different
 * object on a different data path and never appears here.
 */
import * as THREE from 'three';
import type { ImagingFrame } from '../echo/probeFrame.ts';

/** Radial segments across the fan. Enough that the arc does not read as facets. */
const ARC_SEGMENTS = 48;

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
  const apex = new THREE.Vector3(...frame.origin);
  const beam = new THREE.Vector3(...frame.beam);
  const lateral = new THREE.Vector3(...frame.lateral);

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
  const apex = new THREE.Vector3(...frame.origin);
  const beam = new THREE.Vector3(...frame.beam);
  const lateral = new THREE.Vector3(...frame.lateral);

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
 * A wedge that can be re-pointed as a sweep scrubs.
 *
 * Geometry is rebuilt rather than transformed: the fan's depth and angle are
 * free to differ per view, so there is no single rigid motion that carries one
 * frame's sector onto another's.
 */
export class ProbeWedge {
  readonly object = new THREE.Group();
  private surface: THREE.Mesh;
  private outline: THREE.Line;

  constructor(frame: ImagingFrame) {
    this.surface = new THREE.Mesh(
      wedgeGeometry(frame),
      new THREE.MeshBasicMaterial({
        color: 0x49b0ff,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.outline = new THREE.Line(
      wedgeOutline(frame),
      new THREE.LineBasicMaterial({ color: 0x8fd2ff, transparent: true, opacity: 0.9 }),
    );
    this.object.add(this.surface, this.outline);
    this.object.renderOrder = 2;
  }

  update(frame: ImagingFrame): void {
    this.surface.geometry.dispose();
    this.outline.geometry.dispose();
    this.surface.geometry = wedgeGeometry(frame);
    this.outline.geometry = wedgeOutline(frame);
  }

  dispose(): void {
    this.surface.geometry.dispose();
    this.outline.geometry.dispose();
    (this.surface.material as THREE.Material).dispose();
    (this.outline.material as THREE.Material).dispose();
  }
}
