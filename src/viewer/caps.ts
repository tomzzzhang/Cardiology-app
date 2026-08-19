/**
 * Solid cut faces, by stencil buffer, coloured per structure.
 *
 * `contracts/viewer-core.md`: "Cut faces render **solid**, via stencil-buffer
 * caps. A hollow cut is a bug, not a style." Clipping alone deletes fragments
 * and leaves the interior of a closed surface staring back at the camera, so
 * the cut reads as a hole rather than as tissue. This module fills it.
 *
 * ## The algorithm, and why it is per structure
 *
 * For one clipped solid, render its geometry with the clipping plane applied,
 * writing only stencil: back faces increment, front faces decrement, both with
 * the depth test off. Away from the cut every back face is matched by a front
 * face and the counter returns to zero. Where the plane has clipped the near
 * surface away the matching front face is missing, so the counter is non-zero
 * over exactly the cross-section. Drawing a plane-aligned quad masked to
 * `stencil != 0` paints that cross-section solid.
 *
 * The three.js `webgl_clipping_stencil` example does this once for a whole
 * scene, which is enough when every cap is the same colour. The requirement
 * here is that a cap is "coloured by the tissue tag the cap belongs to", so the
 * counting has to be restarted per structure: one clear, one stencil pass, one
 * quad, twenty-four times. The tags are disjoint tet groups, so at most one
 * structure's stencil is non-zero at any pixel and the coplanar quads never
 * compete.
 *
 * ## Costs and limits accepted here
 *
 * * ~24 extra draw calls per redraw. The viewer draws on demand, not per frame.
 * * A cap is only exactly right on watertight geometry. Decimation leaves a few
 *   dozen open edges on some structures of the Rodero pack; those show as small
 *   speckles on the cut face, local to the defect. Measured and recorded rather
 *   than hidden — the fix belongs in the pipeline's decimator, not here.
 */
import * as THREE from 'three';
import { applyBeamDim } from './beamDim.ts';

/** One structure's contribution: its geometry, its world placement, its colour. */
export interface CapSource {
  id: string;
  geometry: THREE.BufferGeometry;
  /** World matrix of the anatomy mesh, so the stencil pass sits exactly on it. */
  matrix: THREE.Matrix4;
  color: THREE.Color;
}

interface CapEntry {
  id: string;
  back: THREE.Mesh;
  front: THREE.Mesh;
  visible: boolean;
}

/**
 * Stencil materials.
 *
 * `colorWrite: false` — they exist to move the stencil counter, nothing else.
 * `depthTest: false` — every face along the ray must be counted, including the
 * ones behind nearer geometry; a depth test would drop them and leave the parity
 * wrong. `clippingPlanes` IS applied: the missing near surface is the whole
 * mechanism, and without clipping the counter balances everywhere and no cap is
 * ever drawn.
 */
function stencilMaterial(side: THREE.Side, op: THREE.StencilOp): THREE.Material {
  return new THREE.MeshBasicMaterial({
    side,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: op,
    stencilZFail: op,
    stencilZPass: op,
  });
}

export class StencilCaps {
  private readonly entries: CapEntry[] = [];
  private readonly backMaterial = stencilMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp);
  private readonly frontMaterial = stencilMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp);
  private readonly quad: THREE.Mesh;
  private readonly quadMaterial: THREE.MeshBasicMaterial;
  private readonly scene = new THREE.Scene();
  /**
   * The cut face obeys the beam highlight too.
   *
   * Without this the caps stay at full brightness while the surfaces around
   * them dim, and since the cut face is the surface a learner is actually
   * reading, the highlight lands everywhere except where it matters. With it,
   * the bright strip across the cut face is precisely where the echo plane
   * crosses the anatomical plane — which is the relationship the two panels
   * exist to show.
   */
  readonly beamUniforms: ReturnType<typeof applyBeamDim>;
  /** Set false while the cutter is off, so the viewer pays nothing for it. */
  enabled = false;

  /**
   * @param sources one entry per structure that can be cut
   * @param size    edge length of the cap quad, from model bounds
   */
  constructor(sources: readonly CapSource[], size: number) {
    this.quadMaterial = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      /*
       * Depth TESTED as well as written.
       *
       * An earlier revision disabled the test, on the reasoning that everything
       * surviving the clip lies behind the plane so nothing could legitimately
       * occlude the cap. That holds only while the camera is on the discarded
       * side. Orbit round to look at the cut from the side that was KEPT and the
       * whole remaining half of the heart is between the eye and the plane — and
       * an untested cap paints its palette colour straight over it, so the cut
       * faces show through solid tissue.
       *
       * The test costs nothing here: the quads are masked by disjoint stencils
       * so they never compete with each other, and the geometry that would
       * z-fight with them at the plane is exactly the geometry the clip removes.
       * The polygon offset covers the coincident case anyway, biasing the cap a
       * hair toward the camera so it wins where it should.
       */
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    this.beamUniforms = applyBeamDim(this.quadMaterial);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.quadMaterial);
    this.quad.renderOrder = 1;
    this.quad.matrixAutoUpdate = false;

    for (const source of sources) {
      const back = new THREE.Mesh(source.geometry, this.backMaterial);
      const front = new THREE.Mesh(source.geometry, this.frontMaterial);
      for (const mesh of [back, front]) {
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(source.matrix);
        mesh.renderOrder = 0;
        // The stencil pass covers the whole cross-section wherever it lands;
        // frustum culling by the source geometry's bounds is still correct and
        // saves the draw when a structure is off screen entirely.
        mesh.userData.capColor = source.color;
      }
      this.entries.push({ id: source.id, back, front, visible: true });
    }
  }

  /**
   * Point the cap quad at the current plane.
   *
   * @param anchor `Q = C + sN`, the plane's closest point to the pivot
   * @param normal `N`
   */
  setPlane(anchor: THREE.Vector3, normal: THREE.Vector3): void {
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal.clone().normalize(),
    );
    this.quad.matrix.compose(anchor, quaternion, new THREE.Vector3(1, 1, 1));
    this.quad.matrixWorld.copy(this.quad.matrix);
  }

  /** Hide a structure's cap alongside the structure itself. */
  setVisible(id: string, visible: boolean): void {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (entry) entry.visible = visible;
  }

  /** Apply the cutter to the stencil pass. Must match the anatomy's planes. */
  setClippingPlanes(planes: THREE.Plane[]): void {
    this.backMaterial.clippingPlanes = planes;
    this.frontMaterial.clippingPlanes = planes;
  }

  /**
   * Draw every cap. Call AFTER the anatomy pass, with `autoClear` off — the
   * colour and depth already in the buffer are the anatomy this cap belongs to.
   */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this.enabled) return;
    for (const entry of this.entries) {
      if (!entry.visible) continue;
      renderer.clearStencil();
      this.quadMaterial.color.copy(entry.back.userData.capColor as THREE.Color);
      this.scene.clear();
      this.scene.add(entry.back, entry.front, this.quad);
      renderer.render(this.scene, camera);
    }
    // Leave the scene empty so disposal does not walk stale references, and so
    // a later frame cannot render a structure that has since been removed.
    this.scene.clear();
  }

  dispose(): void {
    this.quad.geometry.dispose();
    this.quadMaterial.dispose();
    this.backMaterial.dispose();
    this.frontMaterial.dispose();
    this.entries.length = 0;
  }
}
