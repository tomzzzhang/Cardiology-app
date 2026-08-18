/**
 * The free cutter, drawn as an object you can see yourself grabbing.
 *
 * `contracts/viewer-core.md` asks for visible handles, and the reason is the
 * one directly above it in the same contract: "The active target is always
 * visible and is exactly one of heart/camera, free cut, or echo view. A drag
 * must never silently manipulate a different object." A drag that turns the
 * plane while nothing on screen looks like a plane is exactly that silence.
 *
 * So this draws the plane itself — a ring at `Q = C + sN` lying in the cut, and
 * a short stub along `N` showing which way it faces. It appears only while the
 * cutter is the selected target, which makes the selection legible without a
 * mode banner.
 *
 * It is an INSTRUMENT, not tissue: it is never clipped by the plane it
 * represents, and it carries no anatomical claim. Deliberately not a
 * drag-to-grab gizmo with ring handles — the drag is on the whole panel, which
 * is what makes it work on a phone without hidden hit targets. Ring handles
 * remain outstanding.
 */
import * as THREE from 'three';

const RING_COLOUR = 0xffc857;
const NORMAL_COLOUR = 0xffe6a8;
/** Ring radius as a fraction of the model's enclosing radius. */
const RING_SCALE = 0.92;
/** Length of the normal stub, as a fraction of the ring radius. */
const NORMAL_SCALE = 0.22;

export class PlaneHandle {
  readonly object = new THREE.Group();
  private readonly ring: THREE.LineLoop;
  private readonly stub: THREE.Line;
  private readonly radius: number;

  constructor(reach: number) {
    this.radius = Math.max(reach * RING_SCALE, 1);

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 96; i += 1) {
      const angle = (i / 96) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * this.radius, Math.sin(angle) * this.radius, 0));
    }
    this.ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      // Depth test off: the ring marks a plane cutting THROUGH the model, so
      // hiding the half of it behind the heart would hide the half that says
      // where the cut is going.
      new THREE.LineBasicMaterial({ color: RING_COLOUR, transparent: true, opacity: 0.75, depthTest: false }),
    );

    this.stub = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, this.radius * NORMAL_SCALE),
      ]),
      new THREE.LineBasicMaterial({ color: NORMAL_COLOUR, transparent: true, opacity: 0.9, depthTest: false }),
    );

    // Drawn last, over everything, because it is an instrument.
    this.object.renderOrder = 999;
    this.object.add(this.ring, this.stub);
    this.object.visible = false;
  }

  /** Place the handle on the plane `dot(N, X - C) = s`. */
  update(anchor: THREE.Vector3, normal: THREE.Vector3, flipped: boolean): void {
    this.object.position.copy(anchor);
    // The ring is built in the XY plane, so aligning +Z with N puts it in the
    // cut. The stub then points along N, or against it when the kept half-space
    // is reversed — which is the only visible difference a reversal makes.
    const facing = flipped ? normal.clone().negate() : normal;
    this.object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing.clone().normalize());
  }

  set visible(value: boolean) {
    this.object.visible = value;
  }

  dispose(): void {
    for (const line of [this.ring, this.stub]) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
  }
}
