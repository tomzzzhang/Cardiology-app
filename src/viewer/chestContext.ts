/**
 * The registered reference chest: scene context, and nothing more than that.
 *
 * ## What this is
 *
 * BodyParts3D thoracic geometry — skin, ribs, sternum, thoracic spine, lungs,
 * diaphragm, clavicles — in body millimetres, which for that source is the body
 * frame itself. It is drawn around the registered heart so a learner can see
 * where a transducer would actually stand.
 *
 * It is a REFERENCE COMPOSITE: one adult male's chest around a population-average
 * heart, rigidly placed. Not a patient, not a matched pair, not ground truth.
 *
 * ## What it is emphatically NOT
 *
 * The heart is the subject and the chest is scenery, and every one of these is a
 * rule rather than an omission:
 *
 * * **not pickable, not isolatable.** Structure inspection is about the heart.
 *   A rib that answered "what am I looking at" would put chest parts into a
 *   list whose whole purpose is cardiac anatomy.
 * * **never beam-dimmed.** The dim marks which tissue the beam images. The beam
 *   does not image the reference chest — it images the pack's echo volume — so
 *   dimming the chest would state a relationship that does not exist.
 * * **never capped by the heart cutter.** A stencil cap says "this solid was cut
 *   here". The cutter is a tool for reading the heart, and a chest that capped
 *   would read as part of the specimen.
 * * **never labelled in Echo.** Echo labels come from the labelled volume.
 * * **never part of heart bounds, pivot, framing or probe clearance.** This one
 *   has teeth: `reach`, `framedReach` and the probe stand-off are all measured
 *   from heart geometry, and folding a rib cage into them would let the chest
 *   move the camera or decide how close a transducer may stand to tissue.
 *
 * ## Failure is not the heart's problem
 *
 * If the assets fail to load, the heart and the echo carry on exactly as they
 * did before there was a chest, and the caller is handed a reason to say out
 * loud. A context that half-loaded would be worse than none.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { ContextGroup } from '../schema/bodyContextV0.ts';

/** How each group is drawn by default. Provisional and freely reversible. */
export interface GroupStyle {
  color: number;
  opacity: number;
  /** Whether the group is on when the chest is first shown. */
  shown: boolean;
}

/**
 * Provisional presentation.
 *
 * The heart has to stay the most legible thing on screen, so the chest is drawn
 * cool, desaturated and mostly translucent: it reads as the room the heart is
 * in rather than as more anatomy competing with it. Bone is the most useful
 * landmark for a transducer position, so it is the most opaque; skin is a faint
 * envelope; lungs are barely there because their job is to show the acoustic
 * windows BETWEEN them.
 *
 * These are display choices, not clinical ones, and they are meant to be argued
 * with.
 */
export const GROUP_STYLE: Readonly<Record<ContextGroup, GroupStyle>> = Object.freeze({
  skin: { color: 0xc8a894, opacity: 0.06, shown: true },
  ribs: { color: 0xd6d2c8, opacity: 0.26, shown: true },
  sternum: { color: 0xd6d2c8, opacity: 0.26, shown: true },
  spine: { color: 0xccc8be, opacity: 0.24, shown: true },
  lungs: { color: 0xb4c8d8, opacity: 0.12, shown: true },
  diaphragm: { color: 0xbe9898, opacity: 0.16, shown: true },
  shoulder: { color: 0xd6d2c8, opacity: 0.22, shown: true },
});

/*
 * The numbers above were set by LOOKING, at the default framing.
 *
 * The first pass ran bone at 0.45 and skin at 0.10, which read well when the
 * whole chest was framed and washed straight over the heart at the framing the
 * app actually opens in — where the camera sits close and half the rib cage is
 * between the eye and the anatomy. Since the heart is the subject and the close
 * framing is the default, the close framing is what these are tuned for; the
 * chest gains contrast for free when it is framed as a whole, because there is
 * then less of it in front of anything.
 */

/** Which control switches which groups. */
export const GROUP_CONTROLS = Object.freeze({
  skin: ['skin'],
  skeleton: ['ribs', 'sternum', 'spine', 'shoulder'],
  lungs: ['lungs', 'diaphragm'],
} as Readonly<Record<'skin' | 'skeleton' | 'lungs', readonly ContextGroup[]>>);

export type ChestControl = keyof typeof GROUP_CONTROLS;

export interface ChestContext {
  /** Add this to the scene. Already in body space; no transform is applied. */
  readonly object: THREE.Group;
  /** Enclosing radius about a point, for the explicit Fit action only. */
  radiusAbout(point: THREE.Vector3): number;
  setVisible(on: boolean): void;
  setGroupVisible(control: ChestControl, on: boolean): void;
  setSkinOpacity(opacity: number): void;
  readonly groups: readonly ContextGroup[];
  dispose(): void;
}

/**
 * Load the chest glTF and build its display groups.
 *
 * Rejects rather than resolving to a partial chest: a caller that got half a
 * rib cage could not tell it was half.
 */
export async function loadChestContext(url: string): Promise<ChestContext> {
  const gltf = await new GLTFLoader().loadAsync(url);

  const meshes = new Map<ContextGroup, THREE.Mesh[]>();
  const materials: THREE.Material[] = [];
  const root = new THREE.Group();
  root.name = 'body-context-chest';
  /*
   * Drawn after the heart. The chest is mostly transparent and mostly outside
   * the heart, so ordering it last lets the heart's own depth writes reject the
   * far wall of the chest before it is blended — without this the skin shell
   * washes over the heart from in front.
   */
  root.renderOrder = 2;

  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const group = object.name as ContextGroup;
    const style = GROUP_STYLE[group];
    if (!style) return;

    const material = new THREE.MeshStandardMaterial({
      color: style.color,
      roughness: 0.85,
      metalness: 0,
      transparent: true,
      opacity: style.opacity,
      // Both sides, because the skin shell is cropped open at top and bottom and
      // the inside of the far wall is exactly what you look through.
      side: THREE.DoubleSide,
      // No depth WRITE: seven translucent shells that wrote depth would occlude
      // each other in load order rather than in space, and the heart inside
      // would disappear behind whichever one drew first.
      depthWrite: false,
    });
    materials.push(material);
    object.material = material;
    object.renderOrder = 2;
    /*
     * The chest is scenery. `raycast` is emptied rather than the mesh being
     * flagged for a caller to filter, because filtering is something a future
     * call site can forget: a mesh that cannot be hit cannot be picked,
     * isolated, hovered or click-labelled by any code path at all.
     */
    object.raycast = () => {};
    object.userData.bodyContext = true;

    const list = meshes.get(group) ?? [];
    list.push(object);
    meshes.set(group, list);
  });

  if (meshes.size === 0) {
    throw new Error('the chest asset contained no recognised display group');
  }

  root.add(gltf.scene);

  const setGroup = (group: ContextGroup, on: boolean) => {
    for (const mesh of meshes.get(group) ?? []) mesh.visible = on;
  };

  return {
    object: root,
    groups: [...meshes.keys()],
    radiusAbout(point) {
      let furthest = 0;
      const vertex = new THREE.Vector3();
      for (const list of meshes.values()) {
        for (const mesh of list) {
          if (!mesh.visible) continue;
          const position = mesh.geometry.getAttribute('position');
          if (!position) continue;
          // Every 16th vertex: this frames a camera, and a framing radius does
          // not need every vertex of 129,000 triangles to be within a
          // millimetre of right.
          for (let i = 0; i < position.count; i += 16) {
            vertex.fromBufferAttribute(position as THREE.BufferAttribute, i)
              .applyMatrix4(mesh.matrixWorld);
            furthest = Math.max(furthest, vertex.distanceTo(point));
          }
        }
      }
      return furthest;
    },
    setVisible(on) {
      root.visible = on;
    },
    setGroupVisible(control, on) {
      for (const group of GROUP_CONTROLS[control]) setGroup(group, on);
    },
    setSkinOpacity(opacity) {
      for (const mesh of meshes.get('skin') ?? []) {
        (mesh.material as THREE.MeshStandardMaterial).opacity = opacity;
      }
    },
    dispose() {
      for (const material of materials) material.dispose();
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      root.clear();
    },
  };
}
