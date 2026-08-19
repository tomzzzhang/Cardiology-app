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
/**
 * Half-length of the depth arrow along `N`, as a fraction of the short
 * half-extent.
 *
 * It is the control that moves the plane through the model, so it has to read
 * as a shaft you can take hold of rather than as a tick marking a direction.
 */
const NORMAL_SCALE = 0.55;
/**
 * Edge thickness, in CSS pixels.
 *
 * Real geometry rather than `linewidth`, which WebGL ignores: a
 * `LineBasicMaterial` is one pixel wide whatever it is asked for, and a
 * hairline rectangle reads as a construction guide rather than as the sheet of
 * glass the cutter is supposed to be.
 */
const EDGE_PX = 1.8;

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

  private readonly frame: THREE.Group;
  /**
   * The depth arrow: a double-headed shaft along `N` through the anchor.
   *
   * Dragging it slides the plane along its own normal, which is the motion the
   * depth slider used to own. A slider is a fine control for a number and a
   * poor one for a plane: it lives outside the picture, so the learner has to
   * look away from the thing they are moving, and its travel means nothing in
   * the scene. The arrow is in the picture and moves at 1:1 with the hand.
   */
  private readonly depth: THREE.Group;
  private readonly depthShaft: THREE.Mesh;
  private readonly depthHeads: [THREE.Mesh, THREE.Mesh];
  private readonly stubLength: number;
  private readonly handles = new Map<HandleId, THREE.Mesh>();
  private readonly halfLong: number;
  private readonly halfShort: number;
  private handlesOn = true;
  /** Drawn radius of a handle, in world units — set by `setScreenScale`. */
  private handleRadius = 1;

  constructor(reach: number) {
    this.halfLong = Math.max(reach * HALF_LONG, 1);
    this.halfShort = Math.max(reach * HALF_SHORT, 1);

    // Depth test off on both: the rectangle marks a plane cutting THROUGH the
    // model, so hiding the half behind the heart would hide the half that says
    // where the cut is going.
    this.frame = new THREE.Group();
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: RECT_COLOUR, transparent: true, opacity: 0.75, depthTest: false,
    });
    // Four unit-section bars, scaled to thickness by `setScreenScale`. Built as
    // boxes rather than as one closed tube so the corners stay square: a
    // rectangle with rounded corners reads as a lozenge.
    for (const edge of [
      { x: 0, y: this.halfShort, along: 'x' as const },
      { x: 0, y: -this.halfShort, along: 'x' as const },
      { x: this.halfLong, y: 0, along: 'y' as const },
      { x: -this.halfLong, y: 0, along: 'y' as const },
    ]) {
      const length = edge.along === 'x' ? this.halfLong * 2 : this.halfShort * 2;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), edgeMaterial);
      bar.userData.along = edge.along;
      bar.userData.length = length;
      bar.position.set(edge.x, edge.y, 0);
      this.frame.add(bar);
    }

    this.stubLength = this.halfShort * NORMAL_SCALE;
    const depthMaterial = new THREE.MeshBasicMaterial({
      color: NORMAL_COLOUR, transparent: true, opacity: 0, depthTest: false,
    });
    this.depthShaft = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), depthMaterial);
    this.depthHeads = [
      new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 10), depthMaterial),
      new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 10), depthMaterial),
    ];
    // Cones are built about +y; the arrow runs along the plane's normal, which
    // is local +z, and the two heads point opposite ways along it.
    this.depthHeads[0].rotation.x = Math.PI / 2;
    this.depthHeads[1].rotation.x = -Math.PI / 2;
    this.depth = new THREE.Group();
    this.depth.add(this.depthShaft, ...this.depthHeads);

    this.object.add(this.frame, this.depth);

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
    void flipped;

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

    // Edges keep a constant weight on screen rather than in the model, so the
    // rectangle does not become a slab when the camera comes close.
    const thickness = Math.max(unitsPerPixel * EDGE_PX, 1e-4);
    for (const bar of this.frame.children) {
      const along = bar.userData.along as 'x' | 'y';
      const length = bar.userData.length as number;
      bar.scale.set(
        along === 'x' ? length : thickness,
        along === 'y' ? length : thickness,
        thickness,
      );
    }
    this.depthShaft.scale.set(thickness, thickness, this.stubLength * 2);
    const head = Math.max(thickness * 3, 1e-4);
    for (const [index, cone] of this.depthHeads.entries()) {
      cone.scale.set(head, head, head);
      cone.position.z = (index === 0 ? 1 : -1) * this.stubLength;
    }
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

  /**
   * The depth arrow's two ends in world space, for hit-testing the drag.
   *
   * A segment rather than two points: the whole shaft is grabbable, and a
   * learner aiming at the middle of an arrow should not have to find an end.
   */
  depthEnds(): { from: THREE.Vector3; to: THREE.Vector3 } {
    this.object.updateMatrixWorld(true);
    return {
      from: this.object.localToWorld(new THREE.Vector3(0, 0, -this.stubLength)),
      to: this.object.localToWorld(new THREE.Vector3(0, 0, this.stubLength)),
    };
  }

  /** How visible the depth arrow is, and whether the pointer is on it. */
  setDepthReveal(reveal: number, hovered: boolean): void {
    const material = this.depthShaft.material as THREE.MeshBasicMaterial;
    const amount = this.handlesOn ? reveal : 0;
    material.opacity = amount;
    material.color.setHex(hovered ? HANDLE_HOVER_COLOUR : NORMAL_COLOUR);
    this.depth.visible = amount > 0.01;
  }

  /** Echo-synced mode: the plane is not the learner's, so the handles go away. */
  set handlesEnabled(value: boolean) {
    this.handlesOn = value;
    if (!value) {
      this.depth.visible = false;
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
    for (const cone of this.depthHeads) cone.geometry.dispose();
    for (const object of [this.depthShaft, ...this.handles.values()]) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
    // The four edge bars share one material, so it is disposed once.
    let edgeMaterial: THREE.Material | null = null;
    for (const bar of this.frame.children) {
      if (!(bar instanceof THREE.Mesh)) continue;
      bar.geometry.dispose();
      edgeMaterial = bar.material as THREE.Material;
    }
    edgeMaterial?.dispose();
  }
}
