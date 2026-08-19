/**
 * The free cutter, drawn as the thing you take hold of.
 *
 * A cross-section reads as a **rectangle**, so the cutter is drawn as one. The
 * shape is not cosmetic: a rectangle has an in-plane orientation a disk does
 * not, and in echo-synced mode that orientation is used — the long edge is
 * aligned to the sector's lateral axis, so the rectangle reads as the same
 * slice the echo panel is showing rather than as an arbitrarily rolled window
 * onto the same plane.
 *
 * The rectangle is sized from model bounds and is **only a helper**. The
 * mathematical cutter stays infinite (`contracts/viewer-core.md`), and nothing
 * here participates in the clipping decision — `clippingPlane()` never sees it.
 *
 * Four handles sit at the edge midpoints, one per edge direction. Dragging one
 * tips the plane about the perpendicular in-plane axis; dragging anywhere else
 * in the panel orbits the camera. That is the whole interaction model, and it
 * replaces the explicit Heart / Cut / Echo target selection: the object a drag
 * moves is decided by what is under the pointer, which is a thing the learner
 * can see, rather than by a mode they have to have set.
 *
 * Visibility follows the pointer class, from `pointerClass.ts`: revealed on
 * approach with a fine pointer, always visible with a coarse one. Handles are
 * neither drawn nor hittable in echo-synced mode, where the plane is not the
 * learner's to move.
 *
 * It is an INSTRUMENT, not tissue: never clipped by the plane it represents,
 * and carrying no anatomical claim.
 */
import * as THREE from 'three';
import { planeBasis } from './cutPlane.ts';

/** Which edge midpoint a handle sits at, named by the in-plane direction. */
export type HandleId = 'u+' | 'u-' | 'v+' | 'v-';

export const HANDLE_IDS: readonly HandleId[] = ['u+', 'u-', 'v+', 'v-'];

const RECT_COLOUR = 0xffc857;
const NORMAL_COLOUR = 0xffe6a8;
const HANDLE_COLOUR = 0xffc857;
const HANDLE_HOVER_COLOUR = 0xfff3d0;

/**
 * The rectangle's half-extents, as fractions of the model's enclosing radius.
 *
 * Long edge along `u`, and both are large enough that the rectangle is bigger
 * than any cross-section it can take: it is a sheet of glass passed through the
 * heart, not a window cut in one. A rectangle smaller than the cut reads as if
 * the cut stopped at its edge, which is the one thing it must not say — the
 * mathematical cutter is infinite.
 *
 * The 3:2 proportion is a judgement call, and so is stopping here rather than
 * larger: past about this the edge handles start leaving the panel at the
 * default framing. Logged in `docs/observations.md`.
 */
const HALF_LONG = 1.12;
const HALF_SHORT = 0.76;
/** Length of the normal stub, as a fraction of the short half-extent. */
const NORMAL_SCALE = 0.3;

/** In-plane direction a handle names, in the basis `{u, v}`. */
export function handleDirection(
  id: HandleId, u: THREE.Vector3, v: THREE.Vector3,
): THREE.Vector3 {
  switch (id) {
    case 'u+': return u.clone();
    case 'u-': return u.clone().negate();
    case 'v+': return v.clone();
    case 'v-': return v.clone().negate();
  }
}

export class CutPlaneGizmo {
  readonly object = new THREE.Group();
  /** World position of each handle, refreshed by `update`. Empty when disabled. */
  readonly handlePositions = new Map<HandleId, THREE.Vector3>();

  private readonly frame: THREE.LineLoop;
  private readonly stub: THREE.Line;
  private readonly handles = new Map<HandleId, THREE.Mesh>();
  private readonly halfLong: number;
  private readonly halfShort: number;
  private handlesOn = true;
  /** Drawn radius of a handle, in world units — set by `setScreenScale`. */
  private handleRadius = 1;

  constructor(reach: number) {
    this.halfLong = Math.max(reach * HALF_LONG, 1);
    this.halfShort = Math.max(reach * HALF_SHORT, 1);

    const corners = [
      new THREE.Vector3(-this.halfLong, -this.halfShort, 0),
      new THREE.Vector3(this.halfLong, -this.halfShort, 0),
      new THREE.Vector3(this.halfLong, this.halfShort, 0),
      new THREE.Vector3(-this.halfLong, this.halfShort, 0),
    ];
    this.frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(corners),
      // Depth test off: the rectangle marks a plane cutting THROUGH the model,
      // so hiding the half behind the heart would hide the half that says where
      // the cut is going.
      new THREE.LineBasicMaterial({
        color: RECT_COLOUR, transparent: true, opacity: 0.75, depthTest: false,
      }),
    );

    this.stub = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, this.halfShort * NORMAL_SCALE),
      ]),
      new THREE.LineBasicMaterial({
        color: NORMAL_COLOUR, transparent: true, opacity: 0.9, depthTest: false,
      }),
    );

    this.object.add(this.frame, this.stub);

    for (const id of HANDLE_IDS) {
      // A sphere so the handle is the same target from every camera angle; a
      // disc or a square in the cut plane disappears exactly when the plane is
      // seen edge-on, which is when a learner most wants to tip it.
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({
          color: HANDLE_COLOUR, transparent: true, opacity: 0, depthTest: false,
        }),
      );
      handle.visible = false;
      this.handles.set(id, handle);
      this.object.add(handle);
    }

    // Drawn last, over everything, because it is an instrument.
    this.object.renderOrder = 999;
    this.object.visible = false;
  }

  /**
   * Place the rectangle on `dot(N, X - C) = s` and refresh the handle positions.
   *
   * `preferredU` is the long edge's wanted direction — the sector's lateral
   * axis in echo-synced mode, or the axis carried across from the last pose in
   * free mode. It is projected onto the plane, never trusted.
   */
  update(
    anchor: THREE.Vector3, normal: THREE.Vector3, preferredU: THREE.Vector3, flipped: boolean,
  ): { u: THREE.Vector3; v: THREE.Vector3 } {
    const basis = planeBasis(normal, preferredU);
    this.object.position.copy(anchor);
    // The rectangle is built in XY, so mapping x -> u, y -> v and z -> N puts
    // it in the cut with its long edge along `u`.
    this.object.setRotationFromMatrix(
      new THREE.Matrix4().makeBasis(basis.u, basis.v, normal.clone().normalize()),
    );
    // The stub points along N, or against it when the kept half-space is
    // reversed — the only visible difference a reversal makes.
    this.stub.scale.z = flipped ? -1 : 1;

    this.handlePositions.clear();
    if (this.handlesOn) {
      // The handle positions are hit-tested against the pointer in the same
      // tick they are computed, before the renderer has refreshed the graph.
      this.object.updateMatrixWorld(true);
      const local: Record<HandleId, THREE.Vector3> = {
        'u+': new THREE.Vector3(this.halfLong, 0, 0),
        'u-': new THREE.Vector3(-this.halfLong, 0, 0),
        'v+': new THREE.Vector3(0, this.halfShort, 0),
        'v-': new THREE.Vector3(0, -this.halfShort, 0),
      };
      for (const id of HANDLE_IDS) {
        this.handles.get(id)!.position.copy(local[id]);
        this.handlePositions.set(
          id, this.object.localToWorld(local[id].clone()),
        );
      }
    }
    return basis;
  }

  /**
   * Draw each handle at exactly the size of its hit target.
   *
   * `unitsPerPixel` is world units per CSS pixel at the gizmo's distance. A
   * handle whose drawn size and grab radius disagree is a control that misses
   * when aimed at, so the one number decides both.
   */
  setScreenScale(unitsPerPixel: number, hitRadiusPx: number): void {
    this.handleRadius = Math.max(unitsPerPixel * hitRadiusPx, 1e-4);
    for (const handle of this.handles.values()) handle.scale.setScalar(this.handleRadius);
  }

  /**
   * Set how visible each handle is, and which one is under the pointer.
   *
   * The reveal values come from `pointerClass.revealFor`, so the fine/coarse
   * rule lives in one place and this only renders the result.
   */
  setHandleReveal(reveal: ReadonlyMap<HandleId, number>, hovered: HandleId | null): void {
    for (const id of HANDLE_IDS) {
      const handle = this.handles.get(id)!;
      const material = handle.material as THREE.MeshBasicMaterial;
      const amount = this.handlesOn ? (reveal.get(id) ?? 0) : 0;
      material.opacity = amount;
      material.color.setHex(id === hovered ? HANDLE_HOVER_COLOUR : HANDLE_COLOUR);
      handle.visible = amount > 0.01;
      // Set, never accumulated: a multiply here would compound on every
      // pointer sample and grow the handle without bound.
      handle.scale.setScalar(this.handleRadius * (id === hovered ? 1.15 : 1));
    }
  }

  /** Echo-synced mode: the plane is not the learner's, so the handles go away. */
  set handlesEnabled(value: boolean) {
    this.handlesOn = value;
    if (!value) {
      this.handlePositions.clear();
      for (const handle of this.handles.values()) {
        handle.visible = false;
        (handle.material as THREE.MeshBasicMaterial).opacity = 0;
      }
    }
  }

  get handlesEnabled(): boolean {
    return this.handlesOn;
  }

  set visible(value: boolean) {
    this.object.visible = value;
  }

  dispose(): void {
    for (const object of [this.frame, this.stub, ...this.handles.values()]) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  }
}
