/**
 * The anatomy viewer — viewer-core's cutting slice.
 *
 * Loads the pack's glTF, poses it by `meshes.canonical_pose`, frames the camera
 * to the model bounds, orbits around the interaction pivot `C`, opens the model
 * along the free anatomical cutter `{N, s}` with solid stencil caps, and draws
 * the probe from the same `ImagingFrame` the echo panel rasterises.
 *
 * What is deliberately NOT here, because `contracts/viewer-core.md` specifies
 * more than this slice delivers and a half-built control is worse than none:
 * explicit target selection between heart/cut/echo, the plane ROTATION gizmos,
 * and the "align free cut to echo view" bridge. The cutter's depth control ships
 * here because caps without a way to move the plane teach nothing; its rotation
 * and the selection model are the next unit.
 *
 * Orbit is implemented here rather than pulled from `OrbitControls` so the
 * pivot is unambiguously `C` and the wheel's meaning stays fixed: the contract
 * says wheel without a modifier ALWAYS zooms, and the cutter's modifier-wheel
 * depth control below has to coexist with that.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Pack } from '../schema/packV0.ts';
import { frameAt, type ImagingFrame } from '../echo/probeFrame.ts';
import { ProbeIndicator } from './wedge.ts';
import { StencilCaps, type CapSource } from './caps.ts';
import { applyBeamDim, setBeamFrame } from './beamDim.ts';
import {
  dragOrientation,
  echoOrientation,
  glideStep,
  orbitPose,
  orientationFromYawPitch,
  shortestTarget,
} from './orbit.ts';
import {
  alignedToPlane,
  clippingPlane,
  enclosingRadius,
  initialCutPlane,
  planeAnchor,
  rotatedNormal,
  type CutPlaneState,
} from './cutPlane.ts';
import { PlaneHandle } from './planeHandle.ts';

interface PackViewerProps {
  pack: Pack;
  gltfUrl: string;
  /** Scrub position of the selected view's sweep, 0..1. Drives the probe. */
  scrub: number;
  viewIndex?: number;
  hidden?: ReadonlySet<string>;
  /**
   * Lets the echo-view target scrub. Optional: without it that target still
   * selects, and says that it cannot be moved from here — which is the truth
   * under `contracts/viewer-core.md`, where a vetted wedge is driven only by
   * the view rail and the sweep scrubber.
   */
  onScrubChange?: (scrub: number) => void;
}

/**
 * What a drag moves. Exactly one, always visible.
 *
 * `contracts/viewer-core.md`: "The active target is always visible and is
 * exactly one of heart/camera, free cut, or echo view. A drag must never
 * silently manipulate a different object."
 */
export type DragTarget = 'camera' | 'cut' | 'echo';

/**
 * Distinct hues for the named structures; anything unnamed stays neutral grey.
 *
 * Each valve ring is hued toward the chamber it guards, so the pairing is
 * readable without labels: mitral toward the left-heart reds and golds, aortic
 * toward the aorta's violet, tricuspid and pulmonary toward the right-heart
 * greens and teals. They are lighter than the walls because a fibrous annulus
 * is the brightest thing in the neighbourhood on the echo side too.
 */
export const PALETTE: Record<string, number> = {
  'lv-myocardium': 0xd94f4f,
  'rv-myocardium': 0x4f8fd9,
  'la-myocardium': 0xe0a33c,
  'ra-myocardium': 0x5fb87a,
  'aortic-wall': 0xc45ec4,
  'pulmonary-artery-wall': 0x46b8b0,
  'mitral-valve-ring': 0xf2d98a,
  'tricuspid-valve-ring': 0x9fe0b4,
  'aortic-valve-ring': 0xe7a8e7,
  'pulmonary-valve-ring': 0x8fdcd6,
};

const BLOOD_POOL_COLOUR = 0x8fbcd8;
const UNNAMED_COLOUR = 0x8a8f96;

/** One source of colour for the surface and for its cut face — they must agree. */
function structureColour(id: string, isBloodPool: boolean): number {
  if (isBloodPool) return BLOOD_POOL_COLOUR;
  return PALETTE[id] ?? UNNAMED_COLOUR;
}

interface ViewerApi {
  setFrame: (frame: ImagingFrame) => void;
  setHidden: (hidden: ReadonlySet<string>) => void;
  setCut: (cut: { enabled: boolean; offset: number; flipped: boolean }) => void;
  setTarget: (target: DragTarget) => void;
  setBeamDim: (strength: number) => void;
  resetCamera: () => void;
  matchEchoOrientation: (frame: ImagingFrame) => void;
  /** The one permitted bridge. Returns the copied `s` for the slider. */
  alignCutToEchoPlane: (frame: ImagingFrame) => number;
  resetCutPlane: () => void;
}

export default function PackViewer({
  pack, gltfUrl, scrub, viewIndex = 0, hidden, onScrubChange,
}: PackViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const apiRef = useRef<ViewerApi | null>(null);

  const seeded = pack.interaction?.free_cut;
  const [cutEnabled, setCutEnabled] = useState(seeded !== undefined);
  const [cutOffset, setCutOffset] = useState(seeded?.offset ?? 0);
  const [cutFlipped, setCutFlipped] = useState(false);
  /** UI-2: mark the imaged tissue by dimming what the beam misses. */
  const [beamDim, setBeamDim] = useState(true);
  /** Slider bound, from model bounds; 0 until the model reports its size. */
  const [cutLimit, setCutLimit] = useState(0);
  /** What a drag moves. Always exactly one, and always on screen. */
  const [target, setTarget] = useState<DragTarget>('camera');
  /*
   * Which vetted view the free cutter was last aligned TO, or null.
   *
   * This is a note about provenance, not a link. `contracts/README.md`: the
   * bridge is one-way and copy-only, and "subsequent free movement breaks the
   * association and never modifies the saved view". So the only thing stored is
   * the name, and the only thing that happens when the association breaks is
   * that the name stops being shown — nothing anywhere is written back.
   */
  const [alignedTo, setAlignedTo] = useState<string | null>(null);

  const onScrubRef = useRef(onScrubChange);
  onScrubRef.current = onScrubChange;

  /*
   * The scrub position is read through a ref inside the load effect, not listed
   * as a dependency. Depending on it would tear down the renderer and re-fetch
   * a five-megabyte glTF on every tick of the scrubber; the probe is updated
   * instead by the effect below, which is what the scrubber should cost.
   */
  const scrubRef = useRef(scrub);
  scrubRef.current = scrub;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      /*
       * `preserveDrawingBuffer` because this viewer draws ON DEMAND rather than
       * every frame. Without it the drawing buffer is cleared once composited,
       * so anything reading the canvas back afterwards — the visual suite, a
       * screenshot, a future export — gets a blank image even though the scene
       * is on screen.
       *
       * `stencil` is REQUIRED, not incidental: three.js has defaulted it to
       * false since r163, and without it every stencil cap silently renders
       * empty and the cut looks hollow with nothing in the console to say why.
       */
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        stencil: true,
      });
    } catch (cause) {
      // A hospital desktop with acceleration disabled is a first-class target.
      // Report inside the viewer region; never take the surrounding shell down.
      console.warn('anatomy viewer unavailable: WebGL context creation failed.', cause);
      setStatus('unavailable');
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Per-material clipping: the cutter applies to anatomy and to the stencil
    // pass, and must NOT apply to the probe, which is an instrument rather than
    // tissue and does not stop existing because a plane crossed it.
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f14);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2028, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(1, 1.4, 1);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 5000);
    const controller = new AbortController();
    let frameHandle = 0;
    let disposed = false;

    const byStructure = new Map<string, THREE.Object3D>();
    const dimUniforms: ReturnType<typeof applyBeamDim>[] = [];
    let probe: ProbeIndicator | null = null;
    let caps: StencilCaps | null = null;
    let handle: PlaneHandle | null = null;
    let bounds = new THREE.Box3();
    /** Enclosing radius about `C`: frames the camera and bounds the slider. */
    let reach = 0;
    let framed = false;

    /* --- the free anatomical cutter --------------------------------------- */
    const cut: CutPlaneState = initialCutPlane(pack.interaction?.free_cut);
    /*
     * ONE plane object, mutated in place. Materials hold a reference to this
     * array, so replacing the plane would mean walking every material on every
     * slider tick; mutating it means the next draw simply sees the new value.
     * This is the "the slider, the wheel, the readout and reset are views of one
     * `s`" requirement made structural rather than maintained by hand.
     */
    const planes: THREE.Plane[] = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)];
    let cutActive = false;

    /* --- orbit state, pivoting on C -------------------------------------- */
    let pivot = new THREE.Vector3();
    let radius = 400;
    /*
     * The camera's orientation is held whole rather than as yaw and pitch. Two
     * angles cannot express a roll, and "match echo orientation" has to be able
     * to set an arbitrary basis; rebuilding from angles is also what created
     * the pole that pitch used to be clamped away from. See `orbit.ts`.
     */
    const REST = orientationFromYawPitch(0.9, 0.35);
    let orientation = REST.clone();

    const applyCamera = () => {
      const pose = orbitPose(orientation, radius);
      camera.position.copy(pivot).add(pose.offset);
      camera.up.copy(pose.up);
      camera.lookAt(pivot);
    };

    /* --- camera animation ------------------------------------------------- */
    /* The curve, the duration and the shortest-path choice live in `orbit.ts`,
     * where they can be tested; this is only the clock and the flag. */
    let glide: { from: THREE.Quaternion; to: THREE.Quaternion; start: number } | null = null;

    const stepGlide = (now: number) => {
      if (!glide) return false;
      const step = glideStep(glide.from, glide.to, now - glide.start);
      orientation.copy(step.orientation);
      applyCamera();
      if (step.done) {
        glide = null;
        delete host.dataset.cameraGlide;
        return false;
      }
      return true;
    };

    const glideTo = (target: THREE.Quaternion) => {
      glide = {
        from: orientation.clone(),
        to: shortestTarget(orientation, target),
        start: performance.now(),
      };
      // Announced on the host so a caller can tell a move is in flight.
      host.dataset.cameraGlide = 'true';
      schedule();
    };

    /**
     * Distance at which the model bounds fill the viewport.
     *
     * Both field of view angles are considered and the tighter one wins: with a
     * wide short viewport the horizontal angle is the binding constraint, and
     * framing on the vertical alone crops the heart left and right.
     *
     * The enclosing radius is measured about the PIVOT, not about the bounds
     * centre. The camera looks at `C`, so a sphere centred anywhere else is not
     * the sphere being framed: fitting the bounds sphere and then aiming
     * elsewhere spends the difference between the two centres on empty margin,
     * which is why the first version of this drew a small heart in a large
     * panel. `enclosingRadius` is exactly that radius and also bounds the depth
     * slider, so the two controls agree on how big the model is.
     */
    const framingRadius = () => {
      if (reach === 0) return radius;
      const vertical = (camera.fov * Math.PI) / 180;
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      return (reach / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
    };

    const draw = () => {
      renderer.autoClear = true;
      renderer.render(scene, camera);
      if (caps?.enabled) {
        // The caps passes add to the image the anatomy pass just produced.
        renderer.autoClear = false;
        caps.render(renderer, camera);
        renderer.autoClear = true;
      }
    };

    /*
     * One scheduler for both cases. The viewer draws ON DEMAND — a static scene
     * has no reason to burn a frame every 16 ms — so an animation is expressed
     * as "this draw wants another one after it" rather than as a second loop
     * that would have to be started, stopped and reconciled with this one.
     */
    const schedule = () => {
      if (disposed || frameHandle !== 0) return;
      frameHandle = requestAnimationFrame((now) => {
        frameHandle = 0;
        const again = stepGlide(now);
        draw();
        if (again) schedule();
      });
    };

    /*
     * The association with a vetted view is a claim, and free movement retracts
     * it. Nothing is written back — there is nothing to write back to — the
     * label simply stops being shown. Guarded by a local flag so a drag does
     * not push React state on every pointer sample.
     */
    let aligned = false;
    const breakAlignment = () => {
      if (!aligned) return;
      aligned = false;
      setAlignedTo(null);
    };

    const applyCut = () => {
      planes[0].copy(clippingPlane(cut, pivot));
      caps?.setPlane(planeAnchor(cut, pivot), cut.normal);
      handle?.update(planeAnchor(cut, pivot), cut.normal, cut.flipped);
      if (caps) caps.enabled = cutActive;
      for (const object of byStructure.values()) {
        if (!(object instanceof THREE.Mesh)) continue;
        const material = object.material as THREE.Material;
        const next = cutActive ? planes : [];
        // three.js recompiles when clipping switches between "some" and "none",
        // so only touch the material when the count actually changes.
        if ((material.clippingPlanes?.length ?? 0) !== next.length) {
          material.clippingPlanes = next;
          material.needsUpdate = true;
        }
      }
    };

    /* --- input ------------------------------------------------------------ */
    /*
     * One drag, three possible subjects, and the subject is never inferred.
     * `contracts/viewer-core.md`: "A drag must never silently manipulate a
     * different object." So the gesture reads `dragTarget`, which the learner
     * sets explicitly and can see, and nothing here guesses from what is under
     * the pointer.
     */
    let dragTarget: DragTarget = 'camera';
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    /*
     * The state a rotation gesture freezes at pointerdown.
     *
     * The contract requires the pivot to be frozen for the duration so the
     * plane cannot drift from a continuously recomputed one. The START NORMAL
     * is frozen for a related reason: the rotation is applied to it from the
     * drag's total offset, so the same gesture lands in the same place whatever
     * rate the pointer was sampled at, and dragging back to where you started
     * returns the plane to where it started. Accumulating small rotations onto
     * the live normal does neither.
     */
    let gesture: {
      normal: THREE.Vector3;
      right: THREE.Vector3;
      up: THREE.Vector3;
      scrub: number;
      startX: number;
      startY: number;
    } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      // The learner's hand outranks an animation in flight.
      glide = null;
      delete host.dataset.cameraGlide;
      lastX = event.clientX;
      lastY = event.clientY;
      gesture = {
        normal: cut.normal.clone(),
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
        scrub: scrubRef.current,
        startX: event.clientX,
        startY: event.clientY,
      };
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || !gesture) return;
      const totalX = event.clientX - gesture.startX;
      const totalY = event.clientY - gesture.startY;

      if (dragTarget === 'cut') {
        /*
         * Turn `N` about the frozen pivot, holding `s`. The cut only moves when
         * the cutter is the selected target — never as a side effect of
         * orbiting, which is the whole point of having a target.
         */
        cut.normal.copy(rotatedNormal(
          gesture.normal, gesture.right, gesture.up, totalX, totalY, 0.006,
        ));
        applyCut();
        // Free movement breaks the association with the vetted view. It does
        // not touch the view; it stops CLAIMING to be it.
        breakAlignment();
      } else if (dragTarget === 'echo') {
        /*
         * The only motion a vetted wedge is allowed in learner mode is along
         * its own sweep, so that is the only thing this drag can do. It writes
         * the same scrub value the slider owns — one value, two controls — and
         * it cannot reposition the probe, because there is no code path from
         * here to `views[].probe`.
         */
        const next = Math.min(1, Math.max(0, gesture.scrub + totalX / 400));
        onScrubRef.current?.(next);
      } else {
        // No clamp anywhere: the model turns all the way over. See `orbit.ts`.
        orientation = dragOrientation(
          orientation, event.clientX - lastX, event.clientY - lastY,
        );
        applyCamera();
      }

      lastX = event.clientX;
      lastY = event.clientY;
      schedule();
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      gesture = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      /*
       * Wheel WITHOUT a modifier always zooms — contracts/viewer-core.md, no
       * exceptions. Shift-wheel translates the cutter along `N`, and only when
       * the cutter is actually on; otherwise the modifier falls through to zoom
       * rather than silently doing nothing.
       */
      if (event.shiftKey && cutActive) {
        const step = reach * 0.02;
        onCutOffset(Math.max(-reach, Math.min(reach, cut.offset - Math.sign(event.deltaY) * step)));
        // Moving the cutter freely retracts any claim to be a vetted plane.
        breakAlignment();
        return;
      }
      radius = Math.max(40, Math.min(3000, radius * (1 + Math.sign(event.deltaY) * 0.1)));
      applyCamera();
      schedule();
    };

    /*
     * The wheel writes back through React state rather than mutating `cut`
     * directly, so the slider and the readout move with it. One `s`, three
     * controls, no reconciliation step.
     */
    let onCutOffset: (value: number) => void = () => {};

    const element = renderer.domElement;
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      // Frame once, when the model and a real viewport size are both known.
      if (!framed && !bounds.isEmpty()) {
        radius = framingRadius();
        framed = true;
        applyCamera();
      }
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    /* --- load ------------------------------------------------------------- */
    new GLTFLoader().load(
      gltfUrl,
      (gltf) => {
        if (controller.signal.aborted || disposed) return;

        const pose = pack.meshes.canonical_pose;
        gltf.scene.position.set(...(pose.position as [number, number, number]));
        gltf.scene.rotation.set(
          ...(pose.rotation_euler_xyz_deg.map((d) => (d * Math.PI) / 180) as [number, number, number]),
        );
        gltf.scene.scale.setScalar(pose.scale);
        gltf.scene.updateMatrixWorld(true);

        const bloodPool = new Set(
          pack.meshes.structures.filter((s) => s.blood_pool).map((s) => s.id),
        );
        const capSources: CapSource[] = [];

        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          byStructure.set(object.name, object);
          const isPool = bloodPool.has(object.name);
          const named = PALETTE[object.name] !== undefined;
          const colour = structureColour(object.name, isPool);
          object.material = new THREE.MeshStandardMaterial({
            // Blood pool reads as lumen, not tissue: translucent and cool, so a
            // cast-shaped pack cannot be mistaken for a wall-shaped one.
            color: colour,
            roughness: 0.55,
            metalness: 0.05,
            transparent: isPool || !named,
            opacity: isPool ? 0.45 : named ? 1 : 0.85,
            side: THREE.DoubleSide,
          });
          dimUniforms.push(applyBeamDim(object.material));
          capSources.push({
            id: object.name,
            geometry: object.geometry,
            matrix: object.matrixWorld.clone(),
            color: new THREE.Color(colour),
          });
        });
        scene.add(gltf.scene);

        bounds = new THREE.Box3().setFromObject(gltf.scene);
        const centre = bounds.getCenter(new THREE.Vector3());
        /*
         * `C` is interaction.pivot when supplied, else the model-bounds
         * centroid — and the pack states it in MODEL space, so it is carried
         * through `canonical_pose` before anything in world space uses it. The
         * pose is identity in today's packs, which is exactly why doing this
         * wrong here would go unnoticed until the first posed pack.
         */
        pivot = pack.interaction?.pivot
          ? new THREE.Vector3(...(pack.interaction.pivot as [number, number, number]))
              .applyMatrix4(gltf.scene.matrixWorld)
          : centre;
        reach = enclosingRadius(gltf.scene, pivot);
        radius = framingRadius();

        // The cap quad only has to cover the model's cross-section from any
        // angle; the bounding-sphere diameter is the smallest size that always
        // does. The clipping itself remains infinite — this is just a mesh.
        const span = bounds.getBoundingSphere(new THREE.Sphere()).radius * 2.2;
        caps = new StencilCaps(capSources, span);
        caps.setClippingPlanes(planes);
        dimUniforms.push(caps.beamUniforms);

        // The cutter, drawn as something you can see yourself grabbing. Shown
        // only while it is the selected target, which makes the selection
        // legible without a mode banner.
        handle = new PlaneHandle(reach);
        scene.add(handle.object);

        const view = pack.views[viewIndex];
        if (view) {
          const frame = frameAt(view.probe, view.sweep, scrubRef.current);
          probe = new ProbeIndicator(frame);
          scene.add(probe.object);
          for (const uniforms of dimUniforms) setBeamFrame(uniforms, frame);
        }

        setCutLimit(reach);
        applyCut();
        applyCamera();
        resize();
        host.dataset.viewerReady = 'true';
        setStatus('ready');
      },
      undefined,
      (cause) => {
        if (controller.signal.aborted) return;
        console.warn('anatomy viewer: glTF load failed.', cause);
        setStatus('unavailable');
      },
    );

    apiRef.current = {
      setFrame: (frame) => {
        probe?.update(frame);
        // One frame drives the probe geometry AND the highlight, for the same
        // reason the wedge and the echo share it: they cannot be allowed to
        // disagree about where the beam is.
        for (const uniforms of dimUniforms) setBeamFrame(uniforms, frame);
        schedule();
      },
      setHidden: (next) => {
        for (const [id, object] of byStructure) {
          object.visible = !next.has(id);
          caps?.setVisible(id, !next.has(id));
        }
        schedule();
      },
      setCut: (next) => {
        cutActive = next.enabled;
        cut.offset = next.offset;
        cut.flipped = next.flipped;
        if (handle) handle.visible = dragTarget === 'cut' && cutActive;
        applyCut();
        schedule();
      },
      setTarget: (next) => {
        dragTarget = next;
        if (handle) handle.visible = next === 'cut' && cutActive;
        schedule();
      },
      /*
       * THE ONE PERMITTED BRIDGE, and it runs in one direction only.
       *
       * Geometry is read out of the ImagingFrame and written into the cutter.
       * There is no path back: this function cannot see `views[]`, the pack, or
       * anything that could be saved, and it returns `s` purely so the slider
       * and readout can follow the value they are views of.
       */
      alignCutToEchoPlane: (frame) => {
        const copied = alignedToPlane(
          new THREE.Vector3(...frame.normal), new THREE.Vector3(...frame.origin), pivot,
        );
        cut.normal.copy(copied.normal);
        cut.offset = copied.offset;
        aligned = true;
        applyCut();
        schedule();
        return copied.offset;
      },
      resetCutPlane: () => {
        cut.normal.copy(initialCutPlane(pack.interaction?.free_cut).normal);
        breakAlignment();
        applyCut();
        schedule();
      },
      setBeamDim: (strength) => {
        for (const uniforms of dimUniforms) uniforms.uBeamDim.value = strength;
        schedule();
      },
      resetCamera: () => {
        radius = framingRadius();
        glideTo(REST);
      },
      /*
       * CAMERA ONLY, and structurally so: `echoOrientation` takes an
       * ImagingFrame and returns a rotation. It cannot reach the wedge, the
       * view or the pack, and nothing here writes to any of them — the free
       * cutter's `{N, s}` and the vetted `views[]` are both untouched.
       */
      matchEchoOrientation: (frame) => glideTo(echoOrientation(frame)),
    };
    onCutOffset = (value) => setCutOffset(value);

    return () => {
      disposed = true;
      controller.abort();
      apiRef.current = null;
      if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
      observer.disconnect();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('wheel', onWheel);
      probe?.dispose();
      caps?.dispose();
      handle?.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      delete host.dataset.viewerReady;
      delete host.dataset.cameraGlide;
    };
  }, [gltfUrl, pack, viewIndex]);

  // The probe follows the scrubber: same frame the echo renders, by construction.
  useEffect(() => {
    const view = pack.views[viewIndex];
    if (!view) return;
    apiRef.current?.setFrame(frameAt(view.probe, view.sweep, scrub));
  }, [scrub, pack, viewIndex, status]);

  useEffect(() => {
    apiRef.current?.setHidden(hidden ?? new Set());
  }, [hidden, status]);

  useEffect(() => {
    apiRef.current?.setCut({ enabled: cutEnabled, offset: cutOffset, flipped: cutFlipped });
  }, [cutEnabled, cutOffset, cutFlipped, status]);

  useEffect(() => {
    apiRef.current?.setBeamDim(beamDim ? 1 : 0);
  }, [beamDim, status]);

  useEffect(() => {
    apiRef.current?.setTarget(target);
  }, [target, status]);

  return (
    <div className="anatomy-panel">
      <div
        className="anatomy"
        ref={hostRef}
        data-testid="anatomy-viewer"
        data-status={status}
        role={status === 'ready' ? 'img' : undefined}
        aria-label={status === 'ready' ? `${pack.meta.display_name}, 3D anatomy` : undefined}
      >
        {status === 'unavailable' && (
          <p className="viewer__message" data-testid="anatomy-unavailable">
            The 3D anatomy view needs WebGL, which this browser did not provide. The rest of the
            page still works.
          </p>
        )}
      </div>

      {status === 'ready' && (
        <>
        {/*
          * The active target, always on screen and always exactly one.
          * `contracts/viewer-core.md` requires both — a drag must never
          * silently manipulate a different object, and the only way a learner
          * can know which object a drag will move is to be shown it.
          */}
        <div className="targets" role="radiogroup" aria-label="What dragging moves" data-testid="drag-target">
          {([
            ['camera', 'Heart', 'Drag turns the model'],
            ['cut', 'Cut', 'Drag turns the cut plane, holding its depth'],
            ['echo', 'Echo view', 'Drag scrubs the sweep — the only motion a vetted view has'],
          ] as [DragTarget, string, string][]).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={target === value}
              className={target === value ? 'targets__button targets__button--on' : 'targets__button'}
              onClick={() => setTarget(value)}
              title={hint}
              data-testid={`target-${value}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="cutter" data-testid="cutter-controls">
          <label className="cutter__toggle">
            <input
              type="checkbox"
              checked={cutEnabled}
              onChange={(event) => setCutEnabled(event.target.checked)}
              data-testid="cut-enabled"
            />
            Cut
          </label>

          <input
            className="cutter__slider"
            type="range"
            min={-cutLimit}
            max={cutLimit}
            step={cutLimit / 400 || 0.1}
            value={cutOffset}
            disabled={!cutEnabled}
            onChange={(event) => setCutOffset(Number(event.target.value))}
            aria-label="Cut depth along the plane normal"
            data-testid="cut-offset"
          />

          {/* The readout is the same `s` the slider and shift-wheel write. */}
          <output className="cutter__readout" data-testid="cut-readout">
            {cutOffset.toFixed(1)} {pack.meshes.units}
          </output>

          <label className="cutter__toggle">
            <input
              type="checkbox"
              checked={beamDim}
              onChange={(event) => setBeamDim(event.target.checked)}
              data-testid="beam-dim"
            />
            Beam
          </label>

          <button
            type="button"
            onClick={() => setCutFlipped((value) => !value)}
            disabled={!cutEnabled}
            data-testid="cut-flip"
          >
            Reverse
          </button>

          {/*
            * CAMERA ONLY. It turns the model to face the echo's imaging plane
            * and does not touch the wedge, the selected view, or anything in
            * the pack — the free cutter keeps its `{N, s}` and `views[]` is not
            * written to at all. `contracts/README.md`: the two objects may
            * coincide visually and never merge.
            */}
          <button
            type="button"
            onClick={() => {
              const view = pack.views[viewIndex];
              if (view) apiRef.current?.matchEchoOrientation(frameAt(view.probe, view.sweep, scrub));
            }}
            title="Turn the model to face the echo's imaging plane. Camera only."
            data-testid="match-echo"
          >
            Match echo
          </button>

          <button
            type="button"
            onClick={() => {
              setCutOffset(pack.interaction?.free_cut?.offset ?? 0);
              setCutFlipped(false);
              apiRef.current?.resetCutPlane();
              apiRef.current?.resetCamera();
            }}
            data-testid="cut-reset"
          >
            Reset
          </button>
        </div>

        <div className="bridge" data-testid="align-bridge">
          {/*
            * One-way and copy-only. It reads the selected view's plane into the
            * free cutter; it can never write in the other direction, and moving
            * the cutter afterwards retracts the label rather than editing the
            * view. `contracts/README.md`.
            */}
          <button
            type="button"
            disabled={!cutEnabled}
            onClick={() => {
              const view = pack.views[viewIndex];
              if (!view) return;
              const copied = apiRef.current?.alignCutToEchoPlane(
                frameAt(view.probe, view.sweep, scrub),
              );
              if (copied !== undefined) {
                setCutOffset(copied);
                setCutFlipped(false);
                setAlignedTo(view.name);
              }
            }}
            title="Copy this view's imaging plane into the free cutter. One-way: the view is never modified."
            data-testid="align-cut"
          >
            Align cut to echo view
          </button>
          <span className="bridge__state" data-testid="align-state">
            {alignedTo === null
              ? 'Free cut — not aligned to any view'
              : `Copied from ${alignedTo}. Moving the cut breaks the link; the view is unchanged.`}
          </span>
        </div>
        </>
      )}
    </div>
  );
}
