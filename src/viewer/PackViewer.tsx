/**
 * The anatomy viewer — viewer-core's cutting slice.
 *
 * Loads the pack's glTF, poses it by `meshes.canonical_pose`, frames the camera
 * to the model bounds, orbits around the interaction pivot `C`, opens the model
 * along the free anatomical cutter `{N, s}` with solid stencil caps, and draws
 * the probe from the same `ImagingFrame` the echo panel rasterises.
 *
 * **Interaction is direct and positional, not modal.** There is no target
 * selector. What a drag moves is decided by what is under the pointer: a cut
 * handle tips the plane, the probe's arrow scrubs the sweep, anywhere else
 * orbits the camera. The affordances are visible objects in the scene, so the
 * learner reads the answer off the picture instead of setting a mode first.
 * This supersedes the explicit heart/cut/echo selection the contract asked for
 * before anything had been used; `contracts/viewer-core.md` now describes what
 * is here.
 *
 * The cutter has two named modes rather than a one-shot align action:
 * **Echo plane**, where it continuously follows the selected view's imaging
   * plane as the sweep scrubs, and **Free**, where it is the learner's. Switching to Free adopts
 * the current plane, so the transition is continuous.
 *
 * What flows where has not changed and is not a UI question: data goes
 * probe -> cutter and never back. The cutter cannot write `views[]`, the arrow
 * writes only `t`, and every reachable probe pose is `frameAt(probe, sweep, t)`
 * for some `t` in [0, 1].
 *
 * Orbit is implemented here rather than pulled from `OrbitControls` so the
 * pivot is unambiguously `C` and the wheel's meaning stays fixed: wheel without
 * a modifier ALWAYS zooms, in every mode, and the cutter's modifier-wheel depth
 * control below has to coexist with that.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Pack, ProbePose } from '../schema/packV0.ts';
import { frameAt, imagingFrame, poseAt, withApexFlip, type ImagingFrame } from '../echo/probeFrame.ts';
import {
  FAN_DEPTH_STEP_CM,
  NUDGE_DEG,
  STANDOFF_STEP_MM,
  movedAlongBeam,
  nudgedPose,
  standOffStepAllowed,
  steppedFanDepth,
  type ProbeAxis,
} from './freeProbe.ts';
import { ProbeIndicator } from './wedge.ts';
import { StencilCaps, capsAtCut, type CapSource } from './caps.ts';
import { axisVector } from '../schema/packV0.ts';
import { applyBeamDim, setBeamFrame } from './beamDim.ts';
import {
  AUTHORING_GLIDE_MS,
  GLIDE_MS,
  authoringGlideEasing,
  dragOrientation,
  echoOrientation,
  levelled,
  lockedDragOrientation,
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
  draggedOffset,
  planeAnchor,
  planeBasis,
  sampleSurface,
  tiltedNormal,
  type CutPlaneState,
} from './cutPlane.ts';
import { CutPlaneGizmo, HANDLE_IDS, handleDirection, type HandleId } from './planeHandle.ts';
import { SWEEP_HOME_T, atSweepHome, probeTravelPath, steppedT } from './probeControl.ts';
import { hitRadiusPx, isCoarsePointer, revealFor, watchPointerClass } from './pointerClass.ts';
import { projectToScreen, unitsPerPixel } from './screen.ts';
import { cineIntervalMs, nextCineState } from './cine.ts';
import { structureColour } from './palette.ts';
import { AUTHORING_ENABLED } from '../authoring/flag.ts';
import type { ViewAnchor } from '../authoring/anchor.ts';
import { seedsFromViews } from '../authoring/slots.ts';
import { echoDisplayHandoff, viewPoseTransitionStep } from './poseTransition.ts';
import AuthoringControls, {
  type AuthoringViewIdentity,
} from '../authoring/AuthoringControls.tsx';

/**
 * What the cut plane is, stated on screen at all times.
 *
 * `echo` is not an alignment that decays — it is a live relationship, held as
 * the sweep scrubs. `free` claims no relationship to the view at all. The
 * distinction is carried by the name being on screen continuously, which beats
 * teaching it by blanking the echo panel: the plane is directly draggable now,
 * and blanking on every stray drag would be hostile.
 */
export type CutterMode = 'echo' | 'free';

/** Top-level mode. Echo is the default; Explore has no probe at all. */
export type ViewerMode = 'echo' | 'explore';

interface PackViewerProps {
  pack: Pack;
  gltfUrl: string;
  /** Scrub position of the selected view's sweep, 0..1. Drives the probe. */
  scrub: number;
  viewIndex?: number;
  hidden?: ReadonlySet<string>;
  /** Echo mode shows the probe; Explore has none, so the cutter is always free. */
  mode?: ViewerMode;
  /**
   * The probe when it has been unlocked from the view's sweep track, or null.
   *
   * Owned by the shell so the wedge and the echo image are one pose, and typed
   * as a pose rather than as a flag because the pose IS the state: a toggle
   * plus a hidden rotation would let the two panels disagree about where the
   * probe is.
   */
  /**
   * Every keyframe's glTF URL, in order, when the pack carries motion.
   *
   * Frame 0 is `gltfUrl` — the schema requires it — so the scene is built from
   * `gltfUrl` exactly as it always was and the remaining frames are loaded
   * behind it. A pack with no motion passes nothing and pays nothing.
   */
  frameUrls?: readonly string[];
  freePose?: ProbePose | null;
  /**
   * The one path the probe control pad's fan buttons write through — the same
   * one the sweep slider uses. Without it the pad is not drawn, because an
   * affordance that cannot move anything is worse than no affordance.
   */
  onScrubChange?: (scrub: number) => void;
  /**
   * The only way a free probe pose leaves this component.
   *
   * Without it the unlock is not offered at all, for the same reason the arrow
   * is not drawn without `onScrubChange`: an affordance that cannot move
   * anything is worse than no affordance.
   */
  onFreePoseChange?: (pose: ProbePose | null) => void;
  /** Authoring-only presentation state, lifted so the echo can label and fade it honestly. */
  onViewTransitionChange?: (state: { active: boolean; echoOpacity: number }) => void;
  /** Exact saved authoring pose currently shown; null once the probe is changed by hand. */
  onAuthoringWorkingViewChange?: (view: AuthoringViewIdentity | null) => void;
  /**
   * A click on the model, with the structure under it — or null for empty space.
   *
   * DIRECT MANIPULATION, settled design decision 13. The list is the index and
   * the model is the surface: a learner who can see a coronary branch should be
   * able to say "only that" by pointing at it, not by finding its row among 86.
   * A sidebar-only control would be the one part of this app that acted at a
   * distance. A click without a drag was unused, so it is taken for this.
   *
   * Without the callback nothing is hit-tested and nothing is pre-highlighted,
   * for the same reason the probe arrow is not drawn without `onScrubChange`.
   */
  onStructureClick?: (id: string | null) => void;
  /**
   * UI-6, for ONE purpose: so "Match echo" matches what the panel is showing.
   *
   * The toggle flips the echo panel and never the 3D camera. But "Match echo"
   * is the control that reconciles the two, so it has to orient to the image on
   * screen rather than to the one the pack authored — otherwise the one button
   * whose job is agreement produces disagreement. Nothing else here reads it:
   * the wedge, the cut plane and the default camera are untouched.
   */
  apexFlipped?: boolean;
  /**
   * The structure the learner has isolated, for the panel's own header.
   *
   * The name rather than the id, because the header is prose and the shell
   * already holds the tree the name came from. Null means the whole model, and
   * the header falls back to naming the model.
   */
  isolatedLabel?: string | null;
}

/** Radians of plane rotation per pixel of handle drag. */
const HANDLE_RADIANS_PER_PIXEL = 0.006;

/**
 * How far the pointer may travel and still count as a CLICK rather than a drag.
 *
 * Four pixels: far enough that a hand resting on a mouse does not turn every
 * click into an orbit, and near enough that a deliberate orbit never isolates
 * something by accident. A touch screen needs the slack more than a mouse does
 * and gets the same number, because a finger that moves more than four pixels
 * was turning the heart.
 */
const CLICK_SLOP_PX = 4;

/** How much the structure under the pointer lifts, to say a click would take it. */
const HIGHLIGHT_EMISSIVE = 0x2a2a2a;



interface ViewerApi {
  setFrame: (frame: ImagingFrame) => void;
  setHidden: (hidden: ReadonlySet<string>) => void;
  setCut: (cut: { enabled: boolean; offset: number; flipped: boolean }) => void;
  setBeamDim: (strength: number) => void;
  setGhost: (on: boolean) => void;
  setPointerClass: (coarse: boolean) => void;
  /** Echo mode only: hold the model's measured long axis vertical under orbit. */
  setHorizonLock: (on: boolean) => void;
  /**
   * AUTHORING ONLY: which axis the horizon lock holds vertical.
   *
   * Null is the pack's declared `orientation.up`. A vector is a MODEL-space
   * axis — the long axis the apical four-chamber measured — which this carries
   * through `canonical_pose` like every other model-space quantity.
   */
  setLevelAxis: (axis: readonly [number, number, number] | null) => void;
  /** Distance from a world point to the nearest model surface, in pack units. */
  clearanceMm: (point: readonly [number, number, number]) => number;
  /** Whether the cutter should be reversed for the cut to open toward the camera. */
  cutShouldFaceCamera: () => boolean;
  setMode: (mode: ViewerMode) => void;
  /** Show one keyframe. Ignored until every frame has loaded. */
  setCineFrame: (index: number) => void;
  /** Returns the depth the slider should now show, in the new mode's terms. */
  setCutterMode: (mode: CutterMode) => number;
  resetCamera: () => void;
  matchEchoOrientation: (frame: ImagingFrame) => void;
  transitionAuthoringPose: (input: {
    source: ProbePose;
    target: ProbePose;
    centre: readonly [number, number, number];
    targetFrame: ImagingFrame;
  }) => void;
  resetCutPlane: () => void;
  /**
   * AUTHORING ONLY: the camera ray and the model's bounding sphere, in MODEL
   * space.
   *
   * Read-only, and it exists so `src/authoring/anchor.ts` never has to know
   * about three.js, the canonical pose, or which space anything is in — the
   * conversion happens here, where the matrix is. With the authoring flag off
   * this is the constant `() => null` and the implementation below folds out of
   * the bundle, so a learner build carries no path to it at all.
   */
  viewAnchor: () => ViewAnchor | null;
}

export default function PackViewer({
  pack, gltfUrl, scrub, viewIndex = 0, hidden, mode = 'echo', frameUrls,
  freePose = null, onScrubChange, onFreePoseChange, onStructureClick, apexFlipped = false,
  isolatedLabel = null, onViewTransitionChange, onAuthoringWorkingViewChange,
}: PackViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  /*
   * Held in a ref rather than in the scene effect's dependencies: rebuilding
   * the whole scene because the shell re-created a closure would drop the
   * camera, the cut plane and every loaded keyframe on the floor.
   */
  const onStructureClickRef = useRef(onStructureClick);
  onStructureClickRef.current = onStructureClick;
  /**
   * What the pointer is over, for the panel header.
   *
   * The header answers "what am I looking at", and under a fine pointer the
   * most useful answer is the thing about to be clicked. It is React state
   * rather than the dataset the scene publishes, because the header is React.
   */
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const setHoveredRef = useRef(setHoveredId);
  setHoveredRef.current = setHoveredId;
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const apiRef = useRef<ViewerApi | null>(null);

  const seeded = pack.interaction?.free_cut;
  const [cutEnabled, setCutEnabled] = useState(seeded !== undefined);
  /**
   * The cutter's signed depth value.
   *
   * Its meaning follows the cutter mode, and the readout says which: in Free it
   * is `s`, the signed distance from the pivot `C`; in Echo plane it is the
   * distance from the view's imaging plane along that plane's own normal, so
   * zero is coincident with the echo. Switching modes converts the number so
   * the PLANE does not move — the transition is continuous in the thing the
   * learner is looking at, not in the digits.
   */
  const [cutOffset, setCutOffset] = useState(seeded?.offset ?? 0);
  const [cutFlipped, setCutFlipped] = useState(false);
  /** UI-2: mark the imaged tissue by dimming what the beam misses. */
  const [beamDim, setBeamDim] = useState(true);
  /**
   * WHICH WAY IS UP, as an option rather than as the only behaviour.
   *
   * Echo mode only and OFF by default. Trackball orbit stays the default
   * everywhere and the only option in Explore, where free inspection is the
   * point and the turntable was removed because it could not reach every angle.
   * In Echo, which way is up is diagnostic rather than cosmetic, so the lock is
   * offered there — and it is the model's own long axis that is held vertical,
   * not world up, because those are the same thing only while the heart happens
   * to be upright.
   */
  const [horizonLock, setHorizonLock] = useState(false);
  /**
   * The cine axis: WHICH GEOMETRY is on screen, not where the probe is.
   *
   * A different axis from the sweep scrubber, and deliberately a different
   * control. The sweep moves one probe over one static heart; the cine moves
   * the heart itself and has nothing to do with any probe. Sharing a slider
   * between them would make one number mean two things, and would break the
   * moment a pack has both. Explore has no sweep, so in this build the two
   * never appear together — which is why the collision does not have to be
   * designed away yet.
   */
  const [cineFrame, setCineFrame] = useState(0);
  const [cinePlaying, setCinePlaying] = useState(false);
  const [cineReady, setCineReady] = useState(false);
  /**
   * Whether the half the cutter removes is drawn back as a ghost.
   *
   * On by default: a section read against the whole heart it came out of says
   * more than a section alone, and at 7% opacity the shell is faint enough not
   * to compete with the cut faces. Off, the cut is a clean section.
   */
  const [ghostCutaway, setGhostCutaway] = useState(true);
  /*
   * The model's reach is no longer needed in React — the depth slider it
   * bounded is gone, and the shift-wheel's clamp lives in the scene where the
   * number is measured. `setCutLimit` stays only as the signal that the model
   * has been measured.
   */
  /** Explore has no probe to sync to, so the cutter is forced free there. */
  const [cutterMode, setCutterModeState] = useState<CutterMode>(
    mode === 'explore' ? 'free' : 'echo',
  );
  const [coarsePointer, setCoarsePointer] = useState(isCoarsePointer);
  const [poseTransitioning, setPoseTransitioning] = useState(false);

  const onScrubRef = useRef(onScrubChange);
  onScrubRef.current = onScrubChange;
  const onFreePoseRef = useRef(onFreePoseChange);
  onFreePoseRef.current = onFreePoseChange;
  const onViewTransitionRef = useRef(onViewTransitionChange);
  onViewTransitionRef.current = onViewTransitionChange;
  const onAuthoringWorkingViewRef = useRef(onAuthoringWorkingViewChange);
  onAuthoringWorkingViewRef.current = onAuthoringWorkingViewChange;
  const freePoseRef = useRef(freePose);
  freePoseRef.current = freePose;
  const poseTransitioningRef = useRef(false);
  const holdRef = useRef<{ delay: number; repeat: number } | null>(null);
  /*
   * The scrub position is read through a ref inside the load effect, not listed
   * as a dependency. Depending on it would tear down the renderer and re-fetch
   * a five-megabyte glTF on every tick of the scrubber; the probe is updated
   * instead by the effect below, which is what the scrubber should cost.
   */
  const scrubRef = useRef(scrub);
  scrubRef.current = scrub;
  // App currently constructs a fresh Set during every free-pose frame. Key the
  // expensive scene walk on its contents, not on that incidental identity.
  const hiddenKey = [...(hidden ?? [])].sort().join('\u0000');

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
    /**
     * The ghost drawn for each structure, by structure id.
     *
     * A ghost SHARES its structure's `BufferGeometry` — that is the whole point
     * of it costing a draw call rather than a second copy of the mesh — but it
     * holds its own reference to it. Swapping a keyframe therefore has to reach
     * three places for one structure: the mesh, the ghost, and the stencil cap.
     */
    const ghostFor = new Map<string, THREE.Mesh>();
    /**
     * Geometry per keyframe, by structure id. Index 0 is the scene as built.
     *
     * Whole meshes, because the pack carries whole meshes: the schema has no
     * deformation field, since the source it was built for has no vertex
     * correspondence between frames to express one against.
     */
    const cineGeometry: Map<string, THREE.BufferGeometry>[] = [];
    const dimUniforms: ReturnType<typeof applyBeamDim>[] = [];
    let probe: ProbeIndicator | null = null;
    let caps: StencilCaps | null = null;
    let gizmo: CutPlaneGizmo | null = null;
    /** The half the cutter removes, put back as a faint shell. */
    const ghosts = new THREE.Group();
    let ghostOn = false;
    scene.add(ghosts);
    let bounds = new THREE.Box3();
    /**
     * The loaded glTF root, kept so model space can be recovered later.
     *
     * `meshes.canonical_pose` sits between model space and world space, and a
     * `ProbePose` is authored in MODEL space — so anything that reads the scene
     * and hands back a pose has to undo the pose matrix. Every shipped pack
     * poses by identity, which is exactly why doing it wrong here would go
     * unnoticed until the first posed pack.
     */
    let modelRoot: THREE.Object3D | null = null;
    /** Enclosing radius about `C`: frames the camera and bounds the slider. */
    let reach = 0;
    /**
     * A subsampled copy of the model's world-space vertices.
     *
     * The probe's stand-off is bounded by how close it is to TISSUE, which is
     * the physical quantity a stop should be expressed in — not by a distance
     * from the authored pose, which would let the probe sit inside the heart on
     * one view and nowhere near it on another.
     *
     * Subsampled because the bound is a clearance test, not a collision test: a
     * few thousand points spread over the surface put the nearest one within a
     * millimetre or so of the true nearest, which is finer than the 2 mm step
     * the buttons move in. The exact walk is 180k vertices and would run on
     * every repeat of a held button.
     */
    let surfacePoints: Float32Array<ArrayBuffer> = new Float32Array(0);
    /**
     * What the camera actually has to fit, which is not the same thing.
     *
     * `reach` is the model. In echo mode the probe sits OUTSIDE the model — on
     * the chest wall, by construction — and its scrub arrow sits further out
     * still, and both travel as the sweep runs. Framing on the model alone
     * leaves the transducer clipped at the panel edge and the arrow off the
     * panel entirely, which makes a control the learner cannot reach.
     */
    let framedReach = 0;
    let framed = false;
    let loaded = false;

    /* --- modes ------------------------------------------------------------ */
    let viewerMode: ViewerMode = mode;
    let cutter: CutterMode = mode === 'explore' ? 'free' : 'echo';
    let coarse = isCoarsePointer();
    /** The beam dim the learner asked for; Explore forces it off without losing it. */
    let beamStrength = 1;
    /** The frame the probe, the highlight and the echo-synced cutter share. */
    let currentFrame: ImagingFrame | null = null;

    /* --- the free anatomical cutter --------------------------------------- */
    const cut: CutPlaneState = initialCutPlane(pack.interaction?.free_cut);
    /**
     * The slider's value, in the current mode's terms. Mirrors React state; the
     * plane's actual `s` is derived from it in `applyCut`.
     */
    let depth = pack.interaction?.free_cut?.offset ?? 0;
    /**
     * The rectangle's long-edge direction.
     *
     * Not part of the cutter's mathematics — `{N, s}` has no in-plane
     * orientation — but part of what the rectangle MEANS: in echo-synced mode
     * it is the sector's lateral axis, so the rectangle reads as the same slice
     * the echo panel shows. Free mode carries whatever it last held, which is
     * what makes the switch out of echo mode continuous.
     */
    const inPlaneU = new THREE.Vector3(1, 0, 0);
    let basis = { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) };
    /*
     * ONE plane object, mutated in place. Materials hold a reference to this
     * array, so replacing the plane would mean walking every material on every
     * slider tick; mutating it means the next draw simply sees the new value.
     * This is the "the slider, the wheel, the readout and reset are views of one
     * `s`" requirement made structural rather than maintained by hand.
     */
    const planes: THREE.Plane[] = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)];
    /**
     * The same plane, reversed: the half the cutter took away.
     *
     * Mutated in place beside `planes` for the same reason — the ghost
     * materials hold a reference to this array, so the next draw simply sees
     * the new value instead of every material being walked on every tick.
     */
    const ghostPlanes: THREE.Plane[] = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
    let cutActive = false;

    /* --- orbit state, pivoting on C -------------------------------------- */
    /*
     * The axis the horizon lock holds vertical: the model's own long axis, in
     * WORLD space.
     *
     * It comes from the pack — `meshes.orientation.up`, which for a labelled
     * substrate is the derived cardiac frame recorded in `meshes.anatomical_frame`
     * and measured rather than declared — carried through `canonical_pose` the
     * way the pivot is. World up would be the wrong axis: it is the same thing
     * only while the heart happens to be upright, and holding the heart upright
     * is the entire job.
     */
    /*
     * The axis the horizon lock holds vertical.
     *
     * The pack's declared `orientation.up`, carried through `canonical_pose` —
     * and MUTABLE, because authoring can replace it with the long axis the
     * apical four-chamber measured. Eight of the nine packs declare
     * `up=+y` with no derivation behind it, so on those the declared axis is
     * the ingest's default and the four-chamber's is the only measurement
     * there is; a lock that went on levelling the guess would be levelling
     * nothing.
     *
     * Mutated in place rather than reassigned, so the two call sites that
     * closed over it — the locked drag and `levelled` — keep working without
     * either of them having to be told.
     */
    const packUp = new THREE.Vector3(...axisVector(pack.meshes.orientation.up))
      .applyEuler(new THREE.Euler(
        ...(pack.meshes.canonical_pose.rotation_euler_xyz_deg.map(
          (degrees) => (degrees * Math.PI) / 180,
        ) as [number, number, number]),
      ))
      .normalize();
    const lockAxis = packUp.clone();
    const poseEuler = new THREE.Euler(
      ...(pack.meshes.canonical_pose.rotation_euler_xyz_deg.map(
        (degrees) => (degrees * Math.PI) / 180,
      ) as [number, number, number]),
    );
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

    /* --- explanatory view transition ------------------------------------- */
    /* One clock owns the camera and, in authoring, the transient probe pose.
     * That is what makes interruption atomic and keeps the wedge and echo on
     * the same eased progress rather than running two nearly-equal animations. */
    type Glide = {
      from: THREE.Quaternion;
      to: THREE.Quaternion;
      start: number;
      duration: number;
      pose?: {
        from: ProbePose;
        to: ProbePose;
        centre: readonly [number, number, number];
        /** A categorical echo convention gets one fully transparent paint before switching. */
        blankedAt: number | null;
      };
    };
    let glide: Glide | null = null;

    const clearHeldProbePress = () => {
      const held = holdRef.current;
      if (!held) return;
      window.clearTimeout(held.delay);
      window.clearInterval(held.repeat);
      holdRef.current = null;
    };

    const setPoseTransitionState = (active: boolean, echoOpacity = 1) => {
      if (!AUTHORING_ENABLED) return;
      poseTransitioningRef.current = active;
      if (active) clearHeldProbePress();
      if (active) host.dataset.probeTransition = 'true';
      else delete host.dataset.probeTransition;
      setPoseTransitioning(active);
      onViewTransitionRef.current?.({ active, echoOpacity });
    };

    const stepGlide = (now: number) => {
      if (!glide) return false;
      const active = glide;
      const elapsed = now - active.start;
      const step = AUTHORING_ENABLED && active.pose
        ? glideStep(
          active.from,
          active.to,
          elapsed,
          active.duration,
          authoringGlideEasing,
        )
        : glideStep(active.from, active.to, elapsed, active.duration);
      orientation.copy(step.orientation);
      applyCamera();
      let displayFadeDone = true;
      if (AUTHORING_ENABLED && active.pose) {
        const poseStep = viewPoseTransitionStep(
          active.pose.from,
          active.pose.to,
          elapsed,
          active.duration,
          active.pose.centre,
        );
        const handoff = echoDisplayHandoff(
          active.pose.from.display,
          active.pose.to.display,
          elapsed,
          active.duration,
        );
        if (handoff.changed && handoff.phase === 'target' && active.pose.blankedAt === null) {
          /*
           * A dropped frame can cross the mathematical zero-opacity instant.
           * Force one real painted source frame at zero before the categorical
           * convention changes, so vertex/left-right can never flash at full
           * opacity merely because the renderer was busy.
           */
          const blankPose = structuredClone(poseStep.pose) as ProbePose;
          blankPose.display = structuredClone(active.pose.from.display);
          publishAuthoringPose(blankPose, false);
          active.pose.blankedAt = now;
          setPoseTransitionState(true, 0);
          return true;
        }

        let echoOpacity = handoff.opacity;
        if (active.pose.blankedAt !== null) {
          const fadeIn = Math.min(1, Math.max(0, (now - active.pose.blankedAt) / 150));
          echoOpacity = authoringGlideEasing(fadeIn);
          displayFadeDone = fadeIn >= 1;
        }
        publishAuthoringPose(poseStep.pose, false);
        setPoseTransitionState(true, echoOpacity);
      }
      if (step.done && displayFadeDone) {
        glide = null;
        delete host.dataset.cameraGlide;
        if (AUTHORING_ENABLED && active.pose) setPoseTransitionState(false, 1);
        return false;
      }
      return true;
    };

    const cancelGlide = (finishPose: boolean) => {
      const active = glide;
      if (!active) return;
      if (AUTHORING_ENABLED && finishPose && active.pose) {
        publishAuthoringPose(structuredClone(active.pose.to) as ProbePose, false);
      }
      glide = null;
      delete host.dataset.cameraGlide;
      if (AUTHORING_ENABLED && active.pose) setPoseTransitionState(false, 1);
    };

    const glideTo = (target: THREE.Quaternion) => {
      // A direct camera command takes over, but the selected view remains the
      // selected view: finish its probe pose before changing camera course.
      cancelGlide(true);
      glide = {
        from: orientation.clone(),
        to: shortestTarget(orientation, target),
        start: performance.now(),
        duration: GLIDE_MS,
      };
      // Announced on the host so a caller can tell a move is in flight.
      host.dataset.cameraGlide = 'true';
      schedule();
    };

    const glideToAuthoringPose = AUTHORING_ENABLED ? (input: {
      source: ProbePose;
      target: ProbePose;
      centre: readonly [number, number, number];
      targetFrame: ImagingFrame;
    }) => {
      // Selection retargets from the currently rendered intermediate pose; it
      // does not finish or queue the superseded destination.
      cancelGlide(false);
      const source = structuredClone(input.source) as ProbePose;
      const target = structuredClone(input.target) as ProbePose;
      publishAuthoringPose(source, false);
      glide = {
        from: orientation.clone(),
        to: shortestTarget(orientation, echoOrientation(input.targetFrame)),
        start: performance.now(),
        duration: AUTHORING_GLIDE_MS,
        pose: { from: source, to: target, centre: input.centre, blankedAt: null },
      };
      host.dataset.cameraGlide = 'true';
      setPoseTransitionState(true, 1);
      schedule();
    } : null;

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
      const fit = framedReach || reach;
      if (fit === 0) return radius;
      const vertical = (camera.fov * Math.PI) / 180;
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      return (fit / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
    };

    /**
     * Recompute what the camera has to fit.
     *
     * The probe's whole travel, not its pose at the current `t`: the framing is
     * set once and must not re-zoom as the sweep scrubs, which would make the
     * heart breathe under the scrubber.
     */
    const measureFraming = () => {
      framedReach = reach;
      if (viewerMode !== 'echo') return;
      const view = pack.views[viewIndex];
      if (!view) return;
      for (const point of probeTravelPath(view.probe, view.sweep)) {
        framedReach = Math.max(framedReach, new THREE.Vector3(...point).distanceTo(pivot));
      }
      /*
       * Capped, and the cap is the interesting part. A probe sits on the chest
       * wall, so fitting its whole travel exactly would pull the camera back
       * far enough to shrink the heart to a third of the panel — and the heart
       * is what the learner came to look at. This buys back enough room for the
       * transducer and its scrub arrow while the anatomy stays the subject. The
       * number is a judgement call between two things the learner needs at once
       * and is logged in `docs/observations.md`.
       */
      framedReach = Math.min(framedReach, reach * 1.5);
    };

    /* --- screen-space affordances ----------------------------------------- */

    /** Where each live handle is on the panel, in CSS pixels. */
    const handleScreenPositions = (): { id: HandleId; x: number; y: number }[] => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!gizmo || !gizmo.handlesEnabled || !cutActive || width === 0) return [];
      const out: { id: HandleId; x: number; y: number }[] = [];
      for (const id of HANDLE_IDS) {
        const world = gizmo.handlePositions.get(id);
        if (!world) continue;
        const point = projectToScreen(world, camera, width, height);
        if (point.inFront) out.push({ id, x: point.x, y: point.y });
      }
      return out;
    };

    /**
     * Keep the cut handles the size of their own hit targets.
     *
     * They are drawn in world space and grabbed in screen space, so the two
     * numbers have to be derived from one: a handle that draws smaller than it
     * grabs swallows drags meant for the camera, and one that draws larger
     * misses when aimed at.
     */
    const rescaleAffordances = () => {
      const height = host.clientHeight;
      if (height === 0) return;
      if (!gizmo) return;
      const anchor = planeAnchor(cut, pivot);
      gizmo.setScreenScale(
        unitsPerPixel(camera, camera.position.distanceTo(anchor), height), hitRadiusPx(coarse),
      );
    };

    /**
     * Reveal the affordances for a pointer at `(x, y)` in panel pixels, or at
     * `null` for "the pointer is not here".
     *
     * The fine/coarse rule is `pointerClass.revealFor` and lives there; this
     * only measures distances and hands them over. On a coarse pointer every
     * distance resolves to full opacity, which is why a finger never has to
     * find an invisible control.
     */
    const applyReveal = (x: number | null, y: number | null) => {
      rescaleAffordances();
      const reveal = new Map<HandleId, number>();
      let hovered: HandleId | null = null;
      let nearest = Infinity;
      const grab = hitRadiusPx(coarse);

      for (const handle of handleScreenPositions()) {
        const distance = x === null || y === null
          ? Infinity
          : Math.hypot(handle.x - x, handle.y - y);
        reveal.set(handle.id, revealFor(distance, coarse));
        if (distance <= grab && distance < nearest) {
          nearest = distance;
          hovered = handle.id;
        }
      }
      gizmo?.setHandleReveal(reveal, hovered);

      // The depth arrow follows the same reveal rule, from the same module.
      const depthAway = x === null || y === null ? Infinity : depthDistance(x, y);
      gizmo?.setDepthReveal(
        revealFor(hovered === null ? depthAway : Infinity, coarse),
        hovered === null && depthAway <= grab,
      );
      schedule();
    };

    /**
     * What the pointer is over, in the order a drag resolves it.
     *
     * Hit-tested at pointerdown rather than read off a hover state, because a
     * coarse pointer has no hover: the first contact a finger makes with the
     * screen is already the press.
     */
    /** Distance in panel pixels from `(x, y)` to a projected world segment. */
    const distanceToSegment = (
      from: THREE.Vector3, to: THREE.Vector3, x: number, y: number,
    ): number => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      const a = projectToScreen(from, camera, width, height);
      const b = projectToScreen(to, camera, width, height);
      if (!a.inFront || !b.inFront) return Infinity;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq < 1e-9) return Math.hypot(a.x - x, a.y - y);
      const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
      return Math.hypot(a.x + dx * u - x, a.y + dy * u - y);
    };

    const depthDistance = (x: number, y: number): number => {
      if (!gizmo || !gizmo.handlesEnabled || !cutActive || host.clientWidth === 0) return Infinity;
      const ends = gizmo.depthEnds();
      return distanceToSegment(ends.from, ends.to, x, y);
    };

    const hitTest = (x: number, y: number):
      | { kind: 'handle'; id: HandleId }
      | { kind: 'depth' }
      | null => {
      const grab = hitRadiusPx(coarse);
      let best: HandleId | null = null;
      let bestDistance = grab;
      for (const handle of handleScreenPositions()) {
        const distance = Math.hypot(handle.x - x, handle.y - y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = handle.id;
        }
      }
      /*
       * The cut handles are the only thing in the panel a drag can grab.
       *
       * The probe used to have one — an arrow that scrubbed the sweep — and it
       * is gone. Positioning a transducer is not a drag: the probe turns about
       * three of its OWN axes, a drag has two degrees of freedom and no way to
       * say which it meant, and even the one motion a drag can express
       * unambiguously is better served by a button that steps a known amount.
       * The probe control pad is the control now, and a drag anywhere that is
       * not a cut handle orbits the camera.
       */
      if (best !== null) return { kind: 'handle', id: best };

      /*
       * The depth arrow. Tested after the edge handles because they are drawn
       * on top and are the smaller target: a drag aimed at a handle that
       * happens to pass near the shaft must move the handle.
       */
      if (depthDistance(x, y) <= grab) return { kind: 'depth' };
      return null;
    };

    /*
     * WHICH STRUCTURE IS UNDER THE POINTER.
     *
     * Only visible meshes are tested, so a click cannot isolate something the
     * learner cannot see — which is the whole point of the gesture. The
     * raycaster does not honour clipping planes, so with the cutter on it can
     * return a structure whose near half has been clipped away; that is a known
     * limitation rather than a design, and it is recorded in the observations
     * rather than papered over with a second depth pass.
     */
    const raycaster = new THREE.Raycaster();
    const structureAt = (x: number, y: number): string | null => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return null;
      raycaster.setFromCamera(
        new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1),
        camera,
      );
      const targets = [...byStructure.values()].filter((object) => object.visible);
      const hit = raycaster.intersectObjects(targets, false)[0];
      return hit ? hit.object.name : null;
    };

    /**
     * Pre-highlight what a click would isolate.
     *
     * The same rule the cut handles follow, and from the same reasoning: a fine
     * pointer gets the affordance revealed on approach, and a coarse pointer
     * gets nothing here at all, because a touch screen has no hover and the
     * first contact a finger makes is already the press.
     */
    let highlighted: string | null = null;
    const setHighlight = (id: string | null): void => {
      if (id === highlighted) return;
      for (const candidate of [highlighted, id]) {
        if (candidate === null) continue;
        const object = byStructure.get(candidate);
        if (!(object instanceof THREE.Mesh)) continue;
        const material = object.material as THREE.MeshStandardMaterial;
        material.emissive?.setHex(candidate === id ? HIGHLIGHT_EMISSIVE : 0x000000);
      }
      highlighted = id;
      setHoveredRef.current(id);
      if (id === null) delete host.dataset.hoveredStructure;
      else host.dataset.hoveredStructure = id;
      schedule();
    };

    /*
     * Where the affordances are, published on the host element.
     *
     * A test seam, and a deliberate one: "the handles are present and hittable
     * under a coarse pointer" is a gate, and a gate that can only be checked by
     * guessing at pixel coordinates is not a gate. These are the same numbers
     * the hit test uses, so a test that drags to them exercises the real
     * dispatch rather than a parallel one. The probe control pad needs no such
     * seam — it is buttons, and a test can click a button.
     */
    const publishAffordances = (): void => {
      host.dataset.pointerClass = coarse ? 'coarse' : 'fine';
      host.dataset.cutterMode = cutter;
      host.dataset.viewerMode = viewerMode;
      const handles = handleScreenPositions();
      if (handles.length > 0) {
        host.dataset.cutHandles = JSON.stringify(
          handles.map((handle) => ({
            id: handle.id, x: Math.round(handle.x), y: Math.round(handle.y),
          })),
        );
      } else {
        delete host.dataset.cutHandles;
      }
      host.dataset.probeLock = freePoseRef.current ? 'free' : 'onTrack';

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
      publishAffordances();
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

    /**
     * Push the cutter's state into the clipping plane, the caps and the gizmo.
     *
     * The mode decides where `s` comes from, and this is the only place it does:
     *
     * * **Echo plane** — `N` is the view's imaging-plane normal and the
     *   rectangle's long edge is the sector's lateral axis, both refreshed on
     *   every frame the sweep produces, so the cutter FOLLOWS rather than having
     *   been aligned once. The slider then slides the cut along that plane's own
     *   normal, which is a real thing a learner wants and is not a reason to
     *   leave the mode.
     * * **Free** — `s` is the slider, straight through, and `N` is whatever the
     *   handles last made it.
     */
    const applyCut = () => {
      if (cutter === 'echo' && currentFrame) {
        const copied = alignedToPlane(
          new THREE.Vector3(...currentFrame.normal),
          new THREE.Vector3(...currentFrame.origin),
          pivot,
        );
        cut.normal.copy(copied.normal);
        cut.offset = copied.offset + depth;
        inPlaneU.set(...currentFrame.lateral);
      } else {
        cut.offset = depth;
      }

      planes[0].copy(clippingPlane(cut, pivot));
      // The ghost is the other half-space of the same plane.
      ghostPlanes[0].copy(planes[0]).negate();
      ghosts.visible = cutActive && ghostOn;
      caps?.setPlane(planeAnchor(cut, pivot), cut.normal);
      if (gizmo) {
        gizmo.handlesEnabled = cutter === 'free';
        basis = gizmo.update(planeAnchor(cut, pivot), cut.normal, inPlaneU, cut.flipped);
        inPlaneU.copy(basis.u);
        /*
         * Echo-synced: the rectangle is not drawn at all. The wedge already
         * shows where that plane is, and a second outline on the same plane
         * says there are two objects there when the whole claim of the mode is
         * that the cut IS the echo's plane. It comes back in Free mode, where
         * the plane is a separate object again and has to be grabbable.
         */
        gizmo.visible = cutActive && cutter === 'free';
      }
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

    /** The probe and its arrow exist only in echo mode, and only with a sweep. */
    const syncProbeObjects = () => {
      const view = pack.views[viewIndex];
      /*
       * EXPLORE HAS NO PROBE, in any build. Echo is where a probe lives.
       *
       * Both halves of that are load-bearing. A transducer floating beside the
       * model in the mode that is defined as "the heart on its own" is a mode
       * saying two things at once — the owner's rule, and the same reasoning
       * that made isolate Explore-only.
       *
       * And in ECHO an authoring pose is drawn even when the pack has no
       * `views[]`. That is the five packs with no `echo_volume`, which are
       * exactly the ones with no authored pose: an author is in Echo to place a
       * PROBE, and a placement needs no volume — the wedge on the model is the
       * feedback. Without this the tool would place blind on the packs it
       * exists for. Folded out with the flag off, where a pack with no views
       * cannot reach Echo at all.
       */
      const authoringPose = AUTHORING_ENABLED && freePoseRef.current !== null;
      const wanted = loaded
        && viewerMode === 'echo'
        && (view !== undefined || authoringPose);

      if (!wanted) {
        if (probe) {
          scene.remove(probe.object);
          probe.dispose();
          probe = null;
        }
        host.dataset.probe = 'absent';
        return;
      }

      if (!probe && currentFrame) {
        probe = new ProbeIndicator(currentFrame);
        scene.add(probe.object);
      }
      /*
       * A test seam, for the same reason the cut handles and the structure
       * count have one: "Explore draws no probe" is a rule, and checking it by
       * reading pixels out of a WebGL canvas measures the readback as much as
       * the scene. This is the scene's own answer.
       */
      host.dataset.probe = probe ? 'present' : 'absent';
    };

    /** Apply one pose-derived frame to every 3D consumer. */
    const applyImagingFrame = (frame: ImagingFrame, requestDraw: boolean) => {
      currentFrame = frame;
      if (AUTHORING_ENABLED) syncProbeObjects();
      probe?.update(frame);
      for (const uniforms of dimUniforms) setBeamFrame(uniforms, frame);
      if (cutter === 'echo') applyCut();
      if (requestDraw) schedule();
    };

    /** Publish the exact transient pose used by both the 3D and echo panels. */
    const publishAuthoringPose = (pose: ProbePose, requestDraw: boolean) => {
      freePoseRef.current = pose;
      onFreePoseRef.current?.(pose);
      applyImagingFrame(imagingFrame(pose), requestDraw);
    };

    /* --- input ------------------------------------------------------------ */
    let horizonLocked = false;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    /** Where the press started, so a pointerup can tell a click from a drag. */
    let pressX = 0;
    let pressY = 0;

    /**
     * The state a gesture freezes at pointerdown.
     *
     * A rotation gesture freezes its pivot so the plane cannot drift from a
     * continuously recomputed one, and it freezes the START NORMAL for a
     * related reason: the rotation is applied to it from the drag's TOTAL
     * offset, so the same gesture lands in the same place whatever rate the
     * pointer was sampled at, and dragging back to where you started returns
     * the plane. The arrow freezes `t` and its screen tangent for exactly the
     * same reason.
     */
    let gesture:
      | {
          kind: 'handle';
          normal: THREE.Vector3;
          direction: THREE.Vector3;
          right: THREE.Vector3;
          up: THREE.Vector3;
          startX: number;
          startY: number;
        }
      | {
          kind: 'depth';
          startOffset: number;
          normal: THREE.Vector3;
          right: THREE.Vector3;
          up: THREE.Vector3;
          unitsPerPixel: number;
          startX: number;
          startY: number;
        }
      | { kind: 'camera' }
      | null = null;

    /** Pointer position in panel pixels. */
    const localPoint = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      pressX = event.clientX;
      pressY = event.clientY;
      // The learner's hand outranks an animation in flight. The selected pose
      // lands exactly, while the camera stays where the hand took control.
      cancelGlide(true);
      lastX = event.clientX;
      lastY = event.clientY;

      const local = localPoint(event);
      const hit = hitTest(local.x, local.y);

      if (hit?.kind === 'handle') {
        gesture = {
          kind: 'handle',
          normal: cut.normal.clone(),
          direction: handleDirection(hit.id, basis.u, basis.v),
          right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
          up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
          startX: event.clientX,
          startY: event.clientY,
        };
        // Hold the grabbed handle lit for the whole drag, so the object being
        // moved stays identified while the pointer wanders off it.
        gizmo?.setHandleReveal(
          new Map(HANDLE_IDS.map((id) => [id, id === hit.id ? 1 : 0.35])), hit.id,
        );
      } else if (hit?.kind === 'depth') {
        gesture = {
          kind: 'depth',
          startOffset: depth,
          normal: cut.normal.clone(),
          right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
          up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
          // Frozen with the rest of the gesture, so the plane does not change
          // gear if the camera moves under a drag that is already running.
          unitsPerPixel: unitsPerPixel(
            camera,
            camera.position.distanceTo(planeAnchor(cut, pivot)),
            host.clientHeight,
          ),
          startX: event.clientX,
          startY: event.clientY,
        };
        gizmo?.setDepthReveal(1, true);
      } else {
        gesture = { kind: 'camera' };
      }

      renderer.domElement.setPointerCapture(event.pointerId);
      schedule();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || !gesture) {
        const local = localPoint(event);
        applyReveal(local.x, local.y);
        // A handle under the pointer outranks the anatomy behind it: what a
        // press does there is tip the plane, so that is what to pre-announce.
        if (onStructureClickRef.current && !coarse) {
          setHighlight(hitTest(local.x, local.y) ? null : structureAt(local.x, local.y));
        }
        return;
      }
      // A drag has begun; the click it might have been is off, and so is the
      // hint that it was coming.
      setHighlight(null);

      if (gesture.kind === 'handle') {
        /*
         * Tip `N` about the frozen pivot, holding `s`. Only reachable in Free
         * mode, because the handles are neither drawn nor hittable when the
         * cutter is following the echo plane.
         */
        cut.normal.copy(tiltedNormal(
          gesture.normal,
          gesture.direction,
          gesture.right,
          gesture.up,
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
          HANDLE_RADIANS_PER_PIXEL,
        ));
        applyCut();
      } else if (gesture.kind === 'depth') {
        /*
         * Slide the plane along its own normal. It writes the same `s` the
         * readout shows and the shift-wheel writes — one value, and now one
         * control in the picture rather than a slider outside it.
         */
        onCutOffset(draggedOffset(
          gesture.startOffset,
          gesture.normal,
          gesture.right,
          gesture.up,
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
          gesture.unitsPerPixel,
        ));
      } else {
        /*
         * No clamp anywhere: the model turns all the way over. See `orbit.ts`.
         * With the horizon LOCKED — Echo mode only, off by default — horizontal
         * drag turns about the model's own long axis instead and the result is
         * re-levelled, so the heart cannot accumulate roll while a trainee is
         * being taught which way up it goes.
         */
        orientation = horizonLocked
          ? lockedDragOrientation(
            orientation, event.clientX - lastX, event.clientY - lastY, lockAxis,
          )
          : dragOrientation(
            orientation, event.clientX - lastX, event.clientY - lastY,
          );
        applyCamera();
      }

      lastX = event.clientX;
      lastY = event.clientY;
      schedule();
    };

    const onPointerUp = (event: PointerEvent) => {
      const wasCamera = dragging && gesture?.kind === 'camera';
      dragging = false;
      gesture = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      const local = localPoint(event);
      /*
       * A CLICK WITHOUT A DRAG ISOLATES what is under it, and empty space shows
       * everything again.
       *
       * Only a gesture that would have orbited the camera can become a click: a
       * press that grabbed a cut handle or the depth arrow was aiming at that
       * object, and a short one is a nudge that did nothing rather than a click
       * on the anatomy behind it.
       */
      const travel = Math.hypot(event.clientX - pressX, event.clientY - pressY);
      if (wasCamera && travel <= CLICK_SLOP_PX && onStructureClickRef.current) {
        onStructureClickRef.current(structureAt(local.x, local.y));
      }
      applyReveal(local.x, local.y);
    };

    const onPointerLeave = () => {
      if (dragging) return;
      setHighlight(null);
      applyReveal(null, null);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelGlide(true);
      /*
       * Wheel WITHOUT a modifier always zooms — in every mode, no exceptions.
       * Shift-wheel translates the cutter along `N`, and only when the cutter
       * is actually on; otherwise the modifier falls through to zoom rather
       * than silently doing nothing.
       */
      if (event.shiftKey && cutActive) {
        const step = reach * 0.02;
        onCutOffset(Math.max(-reach, Math.min(reach, depth - Math.sign(event.deltaY) * step)));
        return;
      }
      /*
       * Zoom step per notch. Deliberately small: a wheel that crosses the whole
       * useful range of distances in three notches is a wheel that cannot be
       * used to look at something slightly closer.
       */
      radius = Math.max(40, Math.min(3000, radius * (1 + Math.sign(event.deltaY) * 0.04)));
      applyCamera();
      applyReveal(null, null);
      schedule();
    };

    /*
     * The wheel writes back through React state rather than mutating `cut`
     * directly, so the depth arrow and readout move with it. One `s`, two
     * interaction paths, no reconciliation step.
     */
    let onCutOffset: (value: number) => void = () => {};

    const element = renderer.domElement;
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('pointerleave', onPointerLeave);
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
      rescaleAffordances();
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
        /*
         * Which structures the PACK says it has identified. Not "which ones the
         * palette knows": every BodyParts3D part is identified and none of them
         * is in the palette, and rendering those two states the same grey said
         * something false about 82 of 86 structures (observation 24).
         */
        const unidentified = new Set(
          pack.meshes.structures.filter((s) => !s.identified).map((s) => s.id),
        );
        const capSources: CapSource[] = [];

        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          byStructure.set(object.name, object);
          const isPool = bloodPool.has(object.name);
          const colour = structureColour(object.name, isPool, !unidentified.has(object.name));
          object.material = new THREE.MeshStandardMaterial({
            // Blood pool reads as lumen, not tissue: translucent and cool, so a
            // cast-shaped pack cannot be mistaken for a wall-shaped one.
            color: colour,
            roughness: 0.55,
            metalness: 0.05,
            /*
             * TRANSLUCENT ONLY WHERE IT MEANS SOMETHING — blood pool, and
             * nothing else.
             *
             * Unnamed structures used to be drawn at 0.95 opacity, as a hint
             * that they had not been identified. That hint cost more than it
             * was worth. A `transparent` material goes into three.js's
             * transparent pass, which sorts per OBJECT and never per triangle;
             * with `DoubleSide` geometry that makes a mesh's own far surface
             * blend over its near one in an order that changes as the camera
             * turns. On a pack of fourteen unnamed structures it was a
             * shimmer. On BodyParts3D, where all 86 are unnamed, it read as
             * structures popping in and out of existence under orbit.
             *
             * Five per cent of alpha was never visible anyway. If "we have not
             * identified this" needs saying, it needs saying in something a
             * viewer can actually see — a hue or a hatch — and that is a
             * palette decision, not a reason to keep a rendering hazard.
             *
             * Blood pool stays genuinely translucent at 0.45, because seeing
             * the wall through the lumen is the whole point of it, and it is a
             * handful of objects rather than most of them.
             */
            transparent: isPool,
            opacity: isPool ? 0.45 : 1,
            side: THREE.DoubleSide,
          });
          dimUniforms.push(applyBeamDim(object.material));
          /*
           * The removed half, as a ghost. It shares the SAME geometry — a
           * second Mesh over one BufferGeometry costs a draw call, not a second
           * copy of 180k vertices — and carries the reversed clipping plane, so
           * the two halves are exactly complementary by construction rather
           * than by two numbers being kept in agreement.
           *
           * `depthWrite: false` because a ghost must not hide the cut face
           * behind it; unlit because a faintly shaded shell reads as tissue,
           * and this is a hint about what was taken away.
           */
          const ghost = new THREE.Mesh(object.geometry, new THREE.MeshBasicMaterial({
            color: colour,
            transparent: true,
            opacity: 0.07,
            depthWrite: false,
            side: THREE.DoubleSide,
            clippingPlanes: ghostPlanes,
          }));
          ghost.matrixAutoUpdate = false;
          ghost.matrix.copy(object.matrixWorld);
          ghost.renderOrder = -1;
          ghosts.add(ghost);
          ghostFor.set(object.name, ghost);
          /*
           * BLOOD POOL IS NOT CAPPED.
           *
           * A cast source models a chamber as a solid — BodyParts3D's left
           * ventricular cavity is a 98 mL lump of geometry — so capping it at
           * the cut plane paints a solid disc of "blood" across the opening and
           * the chamber reads as filled. It is filled, in the file. It is not
           * filled in a heart.
           *
           * Leaving the cut face open is the honest rendering: the clip removes
           * the near half of the cast and the learner looks straight into the
           * chamber, through the translucent lumen shell, at the wall and the
           * papillary muscles behind it. Tissue still caps, because tissue cut
           * across really does present a face.
           *
           * Nothing else changes for these structures — they still draw, still
           * ghost, still clip. The cap is the only thing withheld.
           */
          if (capsAtCut({ blood_pool: isPool })) {
            capSources.push({
              id: object.name,
              geometry: object.geometry,
              matrix: object.matrixWorld.clone(),
              color: new THREE.Color(colour),
            });
          }
        });
        scene.add(gltf.scene);
        modelRoot = gltf.scene;

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
        surfacePoints = sampleSurface(gltf.scene);
        measureFraming();
        radius = framingRadius();

        // The cap quad only has to cover the model's cross-section from any
        // angle; the bounding-sphere diameter is the smallest size that always
        // does. The clipping itself remains infinite — this is just a mesh.
        const span = bounds.getBoundingSphere(new THREE.Sphere()).radius * 2.2;
        caps = new StencilCaps(capSources, span);
        caps.setClippingPlanes(planes);
        dimUniforms.push(caps.beamUniforms);

        // The cutter, drawn as the rectangle a cross-section actually is, with
        // the four edge handles that turn it.
        gizmo = new CutPlaneGizmo(reach);
        scene.add(gizmo.object);
        // Seed the long edge from the pack's own plane so the first frame is
        // not an arbitrary roll.
        inPlaneU.copy(planeBasis(cut.normal).u);

        const view = pack.views[viewIndex];
        if (view) {
          currentFrame = freePoseRef.current
            ? imagingFrame(freePoseRef.current)
            : frameAt(view.probe, view.sweep, scrubRef.current);
          for (const uniforms of dimUniforms) setBeamFrame(uniforms, currentFrame);
        }

        loaded = true;
        syncProbeObjects();

        /*
         * The remaining keyframes, loaded BEHIND the standing scene.
         *
         * Frame 0 is already built, framed and interactive; the rest arrive
         * afterwards and only then does the cine control come alive. Loading
         * them first would hold the viewer black for the whole set, and the
         * first frame alone is a perfectly good static model in the meantime.
         *
         * Only geometry is taken from them. Materials, ghosts, caps and the
         * camera framing all stay frame 0's, so playback swaps the surfaces and
         * changes nothing else — in particular the camera does not re-frame per
         * frame, which would make the heart pulse in the viewport for reasons
         * that have nothing to do with the heart.
         */
        cineGeometry.push(new Map([...byStructure].flatMap(([id, object]) =>
          object instanceof THREE.Mesh ? [[id, object.geometry] as const] : [])));
        const rest = (frameUrls ?? []).slice(1);
        if (rest.length > 0) {
          const loader = new GLTFLoader();
          Promise.all(rest.map((url) => loader.loadAsync(url)))
            .then((frames) => {
              if (controller.signal.aborted || disposed) return;
              for (const frame of frames) {
                const geometry = new Map<string, THREE.BufferGeometry>();
                frame.scene.traverse((object) => {
                  if (object instanceof THREE.Mesh) geometry.set(object.name, object.geometry);
                });
                cineGeometry.push(geometry);
              }
              host.dataset.cineFrames = String(cineGeometry.length);
              setCineReady(true);
            })
            .catch(() => {
              // A missing frame leaves the pack a static model rather than a
              // broken one. `validate:packs` checks every frame file exists, so
              // reaching here means a transport failure, not a bad pack.
              host.dataset.cineFrames = 'failed';
            });
        }
        applyCut();
        applyCamera();
        resize();
        applyReveal(null, null);
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
      clearanceMm: (point) => {
        let nearest = Infinity;
        for (let i = 0; i < surfacePoints.length; i += 3) {
          const dx = surfacePoints[i] - point[0];
          const dy = surfacePoints[i + 1] - point[1];
          const dz = surfacePoints[i + 2] - point[2];
          const squared = dx * dx + dy * dy + dz * dz;
          if (squared < nearest) nearest = squared;
        }
        return nearest === Infinity ? Infinity : Math.sqrt(nearest);
      },
      /*
       * Which half to remove, so the cut opens TOWARD the viewer.
       *
       * `clippingPlane` keeps `dot(N, X - C) <= s`, so it discards the `+N`
       * half. That is the right half to lose when the camera is on the `+N`
       * side and the wrong one when it is not — and on the wrong side the
       * learner sees an intact heart from the back of the cut and reasonably
       * concludes the cutter is broken. (Until the cap quads were depth-tested
       * this was invisible, because the cut faces painted straight over the
       * tissue in front of them.)
       *
       * Evaluated when the cut is set up rather than continuously: a cut that
       * flipped itself halfway through an orbit would be worse than one facing
       * the wrong way, and `Reverse` is right there.
       */
      cutShouldFaceCamera: () => {
        const toCamera = camera.position.clone().sub(pivot);
        return cut.normal.dot(toCamera) < 0;
      },
      setFrame: (frame) => {
        applyImagingFrame(frame, true);
      },
      setHidden: (next) => {
        let index = 0;
        for (const [id, object] of byStructure) {
          object.visible = !next.has(id);
          caps?.setVisible(id, !next.has(id));
          const ghost = ghosts.children[index];
          if (ghost) ghost.visible = !next.has(id);
          index += 1;
        }
        /*
         * A test seam, for the same reason the cut handles have one: "isolating
         * a structure actually takes the others off the model" is a gate, and
         * checking it by reading pixels out of a WebGL canvas measures the
         * readback as much as the scene. This is the scene's own answer.
         */
        const drawn = [...byStructure.keys()].filter((id) => !next.has(id));
        host.dataset.drawnStructures = String(drawn.length);
        host.dataset.structureCount = String(byStructure.size);
        // A highlight on something no longer drawn would outlive its object.
        if (highlighted !== null && next.has(highlighted)) setHighlight(null);
        schedule();
      },
      setCut: (next) => {
        cutActive = next.enabled;
        depth = next.offset;
        cut.flipped = next.flipped;
        applyCut();
        applyReveal(null, null);
        schedule();
      },
      setHorizonLock: (on) => {
        horizonLocked = on;
        host.dataset.horizonLock = on ? 'on' : 'off';
        /*
         * Turning it ON levels what is already on screen rather than jumping to
         * a canonical pose: the learner keeps looking at what they were looking
         * at and the horizon comes straight under it. `levelled` moves the
         * screen's up and never the view direction, which is what makes that
         * true rather than merely close.
         */
        if (on) {
          const level = levelled(orientation, lockAxis);
          if (level) {
            orientation = level;
            applyCamera();
          }
        }
        schedule();
      },
      setPointerClass: (next) => {
        coarse = next;
        applyReveal(null, null);
      },
      setMode: (next) => {
        cancelGlide(true);
        const wasFramedFor = framedReach;
        viewerMode = next;
        measureFraming();
        // Explore has no probe, so it can hold the model closer. Re-frame only
        // when the thing to fit actually changed.
        if (framed && framedReach !== wasFramedFor) {
          radius = framingRadius();
          applyCamera();
        }
        if (next === 'explore') cutter = 'free';
        // Explore has no beam, so nothing is marked as outside one — and the
        // learner's own choice is kept, not overwritten, so it returns with the
        // mode.
        const strength = next === 'explore' ? 0 : beamStrength;
        for (const uniforms of dimUniforms) uniforms.uBeamDim.value = strength;
        syncProbeObjects();
        applyCut();
        applyReveal(null, null);
        schedule();
      },
      /*
       * Switching modes moves the NUMBER, never the plane.
       *
       * Echo -> Free adopts the plane the learner is looking at, expressed as
       * `s` from the pivot, so the rectangle does not jump at the moment it
       * becomes draggable. Free -> Echo re-acquires the view's plane, and the
       * depth resets to zero because zero is now "coincident with the echo".
       */
      setCutterMode: (next) => {
        if (next === cutter) return depth;
        depth = next === 'free' ? cut.offset : 0;
        cutter = next;
        applyCut();
        applyReveal(null, null);
        schedule();
        return depth;
      },
      resetCutPlane: () => {
        cut.normal.copy(initialCutPlane(pack.interaction?.free_cut).normal);
        inPlaneU.copy(planeBasis(cut.normal).u);
        applyCut();
        schedule();
      },
      /*
       * AUTHORING ONLY. Folded to `() => null` with the flag off, which drops
       * the body — and with it every reference the authoring modules have into
       * the scene — out of the learner bundle.
       *
       * The radius is the EXACT enclosing radius about the bounds centre, the
       * same walk `reach` uses about `C`, rather than the half-diagonal of the
       * bounding box. The box diagonal overstates an elongated heart by a long
       * way, and a standoff derived from an overstated radius parks the
       * transducer needlessly far out.
       */
      viewAnchor: AUTHORING_ENABLED
        ? () => {
          if (!loaded || !modelRoot || bounds.isEmpty()) return null;
          const centreWorld = bounds.getCenter(new THREE.Vector3());
          const radiusWorld = enclosingRadius(modelRoot, centreWorld);

          const toModel = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
          const centre = centreWorld.clone().applyMatrix4(toModel);
          const forward = new THREE.Vector3(0, 0, -1)
            .applyQuaternion(camera.quaternion).transformDirection(toModel);
          const right = new THREE.Vector3(1, 0, 0)
            .applyQuaternion(camera.quaternion).transformDirection(toModel);

          // `canonical_pose.scale` is a single uniform number by schema, so one
          // division carries a world length back into model units.
          const scale = pack.meshes.canonical_pose.scale || 1;

          return {
            forward: [forward.x, forward.y, forward.z],
            right: [right.x, right.y, right.z],
            centre: [centre.x, centre.y, centre.z],
            radius: radiusWorld / scale,
          };
        }
        : () => null,
      /*
       * AUTHORING ONLY: level the axis the four-chamber measured, not the one
       * the pack declares.
       *
       * Null puts the pack's own declaration back. Folded to a no-op with the
       * flag off, where there is no derived axis for it to be handed.
       */
      setLevelAxis: AUTHORING_ENABLED
        ? (axis) => {
          if (axis === null) {
            lockAxis.copy(packUp);
          } else {
            const next = new THREE.Vector3(...axis);
            if (next.lengthSq() === 0) return;
            lockAxis.copy(next.applyEuler(poseEuler).normalize());
          }
          if (horizonLocked) {
            // Null at the poles, where the axis has no screen direction to
            // level to. Leaving the camera alone is the honest answer there.
            const level = levelled(orientation, lockAxis);
            if (level) {
              orientation = level;
              applyCamera();
            }
            schedule();
          }
        }
        : () => {},
      setGhost: (on) => {
        ghostOn = on;
        ghosts.visible = cutActive && ghostOn;
        schedule();
      },
      setBeamDim: (strength) => {
        beamStrength = strength;
        const value = viewerMode === 'explore' ? 0 : strength;
        for (const uniforms of dimUniforms) uniforms.uBeamDim.value = value;
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
       * cutter's `{N, s}` and the saved `views[]` are both untouched.
       */
      matchEchoOrientation: (frame) => glideTo(echoOrientation(frame)),
      transitionAuthoringPose: AUTHORING_ENABLED && glideToAuthoringPose
        ? (input) => glideToAuthoringPose(input)
        : () => {},
      setCineFrame: (index) => {
        const geometry = cineGeometry[index];
        if (!geometry) return;
        for (const [id, replacement] of geometry) {
          const object = byStructure.get(id);
          if (object instanceof THREE.Mesh) object.geometry = replacement;
          const ghost = ghostFor.get(id);
          if (ghost) ghost.geometry = replacement;
          caps?.setGeometry(id, replacement);
        }
        schedule();
      },
    };
    onCutOffset = (value) => setCutOffset(value);

    return () => {
      disposed = true;
      controller.abort();
      if (AUTHORING_ENABLED && glide?.pose) {
        poseTransitioningRef.current = false;
        onViewTransitionRef.current?.({ active: false, echoOpacity: 1 });
      }
      apiRef.current = null;
      if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
      observer.disconnect();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('wheel', onWheel);
      // Ghost geometry is SHARED with the anatomy mesh, which the scene walk
      // below disposes. Only the materials belong to the ghosts.
      for (const ghost of ghosts.children) {
        if (ghost instanceof THREE.Mesh) (ghost.material as THREE.Material).dispose();
      }
      probe?.dispose();
      caps?.dispose();
      gizmo?.dispose();
      /*
       * Keyframe geometry is NOT reached by the scene walk below: only one
       * frame is attached to a mesh at a time, so the other nine would leak.
       * Frame 0's entry is shared with the scene and disposing it twice is
       * harmless — `dispose()` on an already-disposed geometry is a no-op.
       */
      for (const frame of cineGeometry) {
        for (const geometry of frame.values()) geometry.dispose();
      }
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
      if (AUTHORING_ENABLED) delete host.dataset.probeTransition;
      delete host.dataset.cutHandles;
    };
    // `mode` is read once here to seed the scene and is applied thereafter
    // through `setMode`; listing it would reload a five-megabyte glTF on a
    // mode switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltfUrl, pack, viewIndex]);

  /*
   * The cine axis.
   *
   * `cineDirection` is a ref rather than state because it is not something the
   * screen shows: playback bouncing off the end of a half-cycle is a fact about
   * the next tick, and rendering on it would re-render every frame for nothing.
   */
  const cineDirection = useRef<1 | -1>(1);
  const keyframes = pack.meshes.keyframes;
  /** The cine is Explore's. Echo has a probe and a sweep, and this is neither. */
  const cineAvailable = keyframes !== undefined && mode === 'explore';
  const cineCount = keyframes?.frames.length ?? 0;

  // A new pack starts at rest on its first frame. Carrying a frame index across
  // packs would land on a frame the next pack may not have.
  useEffect(() => {
    setCineFrame(0);
    setCinePlaying(false);
    setCineReady(false);
    cineDirection.current = 1;
  }, [gltfUrl]);

  useEffect(() => {
    apiRef.current?.setCineFrame(cineFrame);
  }, [cineFrame, cineReady, status]);

  // Playing stops when the control is not on screen, so leaving Explore does
  // not leave a clock running against a viewer nobody is looking at.
  useEffect(() => {
    if (!cineAvailable) setCinePlaying(false);
  }, [cineAvailable]);

  useEffect(() => {
    if (!cinePlaying || !cineReady || cineCount < 2) return;
    const loop = keyframes?.loop ?? false;
    const timer = window.setInterval(() => {
      setCineFrame((current) => {
        const next = nextCineState({ frame: current, direction: cineDirection.current },
          cineCount, loop);
        cineDirection.current = next.direction;
        return next.frame;
      });
    }, cineIntervalMs(keyframes?.fps));
    return () => window.clearInterval(timer);
  }, [cinePlaying, cineReady, cineCount, keyframes]);

  /*
   * The probe follows the scrubber — or the free pose, when there is one. Same
   * frame the echo renders either way, which is what keeps the wedge and the
   * image one object rather than two that agree.
   */
  useEffect(() => {
    const view = pack.views[viewIndex];
    if (!view) {
      // AUTHORING: a pose placed on a pack with no views still drives the
      // wedge, in Echo. Folded out with the flag off.
      if (AUTHORING_ENABLED && freePose) apiRef.current?.setFrame(imagingFrame(freePose));
      return;
    }
    apiRef.current?.setFrame(
      freePose ? imagingFrame(freePose) : frameAt(view.probe, view.sweep, scrub),
    );
  }, [scrub, pack, viewIndex, status, freePose]);

  useEffect(() => {
    apiRef.current?.setHidden(new Set(hiddenKey === '' ? [] : hiddenKey.split('\u0000')));
  }, [hiddenKey, status]);

  useEffect(() => {
    apiRef.current?.setCut({ enabled: cutEnabled, offset: cutOffset, flipped: cutFlipped });
  }, [cutEnabled, cutOffset, cutFlipped, status]);

  /*
   * Open the cut toward the viewer when it is switched on, and once the model
   * is ready. Not on every change: the learner's own `Reverse` has to stick.
   */
  useEffect(() => {
    if (status !== 'ready' || !cutEnabled) return;
    const shouldFlip = apiRef.current?.cutShouldFaceCamera();
    if (shouldFlip !== undefined) setCutFlipped(shouldFlip);
  }, [cutEnabled, status]);

  useEffect(() => {
    apiRef.current?.setBeamDim(beamDim ? 1 : 0);
  }, [beamDim, status]);

  useEffect(() => {
    apiRef.current?.setGhost(ghostCutaway);
  }, [ghostCutaway, status]);

  /*
   * The lock is Echo's, so leaving Echo drops it rather than carrying a mode's
   * behaviour into a mode that does not offer it. Explore's orbit is a
   * trackball, always, and free inspection is the point there.
   */
  useEffect(() => {
    apiRef.current?.setHorizonLock(mode === 'echo' && horizonLock);
  }, [horizonLock, mode, status]);

  // Explore has no probe, so it has nothing to sync a cut plane to.
  useEffect(() => {
    apiRef.current?.setMode(mode);
    if (mode === 'explore') setCutterModeState('free');
  }, [mode, status]);

  useEffect(() => {
    apiRef.current?.setPointerClass(coarsePointer);
  }, [coarsePointer, status]);

  // The pointer class really does change under a running page.
  useEffect(() => watchPointerClass(setCoarsePointer), []);

  const view = pack.views[viewIndex];
  const echoMode = mode === 'echo';
  /**
   * In Echo plane mode the cut IS the imaging plane, so there is no depth to
   * choose: the slider is disabled rather than removed, so the control the
   * learner will look for is where they left it and its state says why it does
   * nothing. The Cut checkbox stays live in both modes — turning the cut off to
   * see the whole heart WITH the echo fan on it is a thing worth doing.
   */
  const depthLocked = echoMode && cutterMode === 'echo';

  /**
   * Unlock the probe from its view's sweep track, or lock it again.
   *
   * Unlocking SEEDS from the pose the learner is looking at, so the probe does
   * not jump at the moment it becomes draggable — the same continuity rule the
   * cutter's mode switch follows.
   *
   * Locking discards the free pose rather than merging it, so the probe returns
   * to `frameAt(probe, sweep, t)` exactly, for whatever `t` the scrubber holds.
   * That is the invariant the rest of the app depends on, and it is restored
   * bit for bit rather than approximately.
   */
  /*
   * The probe control pad's press-and-hold repeat.
   *
   * A press is two degrees, which is small enough to settle a plane with and
   * far too small to cross a sweep by clicking. Holding repeats it, after a
   * pause long enough that a deliberate single press does not become two.
   *
   * The pose is read from a ref and written back to it as well as through the
   * callback, so a repeat that fires before React has re-rendered still
   * compounds from the value the previous repeat produced rather than from a
   * stale prop.
   */
  /**
   * Whether the probe may still be pressed closer, or lifted further.
   *
   * Both stops are expressed as a CLEARANCE from tissue, which is the physical
   * quantity they are about: the probe must not end up inside the heart, and it
   * must not be pulled so far that its sector no longer reaches anything. A
   * bound measured from the authored pose instead would sit inside the heart on
   * one view and nowhere near it on another, because how far a window stands
   * off the epicardium differs per view.
   */
  const [standOffRoom, setStandOffRoom] = useState({ closer: true, further: true });

  /**
   * The active authoring slot's pose, published up from the authoring block.
   *
   * A plain nullable pose held here rather than a call into the authoring
   * modules, so the pad — which is learner UI — grows no dependency on a
   * surface that does not exist in a learner build. With the flag off nothing
   * ever writes it, it stays null, and the button below it folds away with the
   * constant.
   */
  const [slotPose, setSlotPose] = useState<ProbePose | null>(null);
  const [slotView, setSlotView] = useState<AuthoringViewIdentity | null>(null);
  const setActiveAuthoringSlot = useCallback((
    pose: ProbePose | null,
    identity: AuthoringViewIdentity | null,
  ) => {
    setSlotPose(pose);
    setSlotView((current) => (
      current?.label === identity?.label && current?.source === identity?.source
        ? current
        : identity
    ));
  }, []);

  /**
   * The axis the horizon lock holds vertical, when authoring has measured one.
   *
   * A plain nullable triple held here rather than a call into the authoring
   * modules, for the same reason `slotPose` is: the lock is learner UI and
   * grows no dependency on a surface that does not exist in a learner build.
   * With the flag off nothing ever writes it and the effect below is a no-op.
   */
  const [levelAxis, setLevelAxis] = useState<readonly [number, number, number] | null>(null);

  useEffect(() => {
    apiRef.current?.setLevelAxis(levelAxis);
  }, [levelAxis, status]);

  /*
   * AUTHORING: the pack's authored views, reduced to frozen slot seeds.
   *
   * Memoised because the authoring block reloads its store when the seeds
   * change, and a fresh array on every render would reload it on every render.
   * Folded to a constant empty array with the flag off, which drops the
   * reference and lets the whole slots module leave the bundle.
   */
  const authoringSeeds = useMemo(
    () => (AUTHORING_ENABLED
      ? seedsFromViews(pack.views.map((packView) => ({
        name: packView.name,
        view_id: packView.view_id,
        probe: packView.probe,
      })))
      : []),
    [pack],
  );

  // A new model or same-id pack revision cannot inherit presentation state.
  useEffect(() => {
    poseTransitioningRef.current = false;
    setPoseTransitioning(false);
    if (AUTHORING_ENABLED) onViewTransitionRef.current?.({ active: false, echoOpacity: 1 });
    if (AUTHORING_ENABLED) onAuthoringWorkingViewRef.current?.(null);
  }, [gltfUrl, pack.meta.pack_version, viewIndex]);

  /**
   * AUTHORING: make a stored view the working pose and explain the change by
   * turning the camera toward its imaging plane.
   *
   * The camera, wedge and echo share one duration and easing curve. Intermediate
   * probe poses exist only long enough to render the transition: nothing here
   * stores, exports or names them as views. The final frame is an exact clone
   * of the stored pose rather than an approximation accumulated over time.
   */
  const activateAuthoringPose = (pose: ProbePose, identity: AuthoringViewIdentity) => {
    const target = structuredClone(pose) as ProbePose;
    const source = freePoseRef.current
      ?? (view
        ? (view.sweep ? poseAt(view.probe, view.sweep, scrubRef.current) : view.probe)
        : target);
    const api = apiRef.current;
    const anchor = api?.viewAnchor();
    if (!api || !anchor || status !== 'ready') return;
    onAuthoringWorkingViewRef.current?.(identity);
    api.transitionAuthoringPose({
      source,
      target,
      centre: anchor.centre,
      targetFrame: withApexFlip(imagingFrame(target), apexFlipped),
    });
  };

  /**
   * Whether one press may move the probe from `from` to `to`.
   *
   * The rule itself lives in `freeProbe.ts`, where it can be tested; this is
   * the measurement it is applied to.
   */
  const standOffAllowed = (from: ProbePose, to: ProbePose) => {
    const measure = (pose: ProbePose) =>
      apiRef.current?.clearanceMm(pose.origin as [number, number, number]);
    return standOffStepAllowed(measure(from), measure(to));
  };

  /**
   * Which of the two stand-off buttons may be pressed from here.
   *
   * Measured by asking the SAME question a press asks, of the SAME candidate
   * poses — not by adding the step to the current clearance and comparing. The
   * two are not the same number: clearance is the distance to the nearest
   * surface point, and moving 2 mm along the beam changes it by 2 mm only when
   * the beam happens to point at that point. A button that is enabled and inert
   * is worse than one that is disabled, and predicting the answer differently
   * from the way it is computed is how that happens.
   */
  const roomAround = (pose: ProbePose) => ({
    closer: standOffAllowed(pose, movedAlongBeam(pose, STANDOFF_STEP_MM)),
    further: standOffAllowed(pose, movedAlongBeam(pose, -STANDOFF_STEP_MM)),
  });

  /**
   * Re-measure the room whenever the pose changes, whoever changed it.
   *
   * The second half of the same defect. The room used to be recomputed only by
   * the three places inside this component that move the probe, so a pose
   * arriving from ANYWHERE else left the two buttons showing the enabled state
   * they had for a pose that is no longer on screen. That was unreachable while
   * the pad was the only thing that could set a free pose, and it stopped being
   * unreachable the moment an anchored pose could arrive from outside.
   *
   * Through a ref so the effect depends on the pose and nothing else: the
   * measurement closes over `apiRef`, which is a ref, and over the component's
   * own helpers, which are new functions on every render and would otherwise
   * re-run this on every render.
   */
  const roomAroundRef = useRef(roomAround);
  roomAroundRef.current = roomAround;

  useEffect(() => {
    // Transition frames are presentation-only and arrive every animation
    // frame. Measuring two nearest-surface scans for each one would stall the
    // shared camera/echo clock; the exact landing pose is measured below when
    // the transition flag clears.
    if (freePose === null || poseTransitioning) return;
    const next = roomAroundRef.current(freePose);
    // Same values, same object: a fresh object each time would re-render on
    // every step of a held button for no change.
    setStandOffRoom((current) => (
      current.closer === next.closer && current.further === next.further ? current : next
    ));
  }, [freePose, poseTransitioning]);

  /**
   * Hold the pointer for the duration of a press.
   *
   * Capture so that a pointerup off the button still stops the repeat — a
   * finger that slides off a repeating button and lifts elsewhere would
   * otherwise leave it running. Guarded because `setPointerCapture` throws for
   * a pointer id the browser does not consider active, and a throw here would
   * take the press down with it.
   */
  const capturePress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Nothing to hold on to; the press still works, it just cannot follow a
      // pointer that leaves the button.
    }
  };

  const stopHold = () => {
    if (!holdRef.current) return;
    window.clearTimeout(holdRef.current.delay);
    window.clearInterval(holdRef.current.repeat);
    holdRef.current = null;
  };

  useEffect(() => stopHold, []);

  /**
   * One press of the stand-off pair: slide the probe along its own beam.
   *
   * The ONE translation offered, and it is not the one that would be a problem:
   * sliding the probe ACROSS the chest would claim a different acoustic window,
   * which is authored content, while sliding it along the beam only changes how
   * far the transducer stands off the tissue. On this substrate that gap is
   * empty space anyway — the mesh is heart-only, so there is no skin, fat,
   * intercostal muscle or pericardium to stand off from, and the pipeline parks
   * the probe 8 mm clear of the epicardium and says so in the view's landmark.
   *
   * Bounded against the pose the view authored, so the probe cannot be pushed
   * out through the far side of the heart or pulled until the sector reaches
   * nothing.
   */
  const pressStandOff = (sign: -1 | 1) => {
    if (poseTransitioningRef.current) return;
    const pose = freePoseRef.current;
    if (!pose || !view) return;
    const next = movedAlongBeam(pose, sign * STANDOFF_STEP_MM);
    if (!standOffAllowed(pose, next)) return;
    freePoseRef.current = next;
    onAuthoringWorkingViewRef.current?.(null);
    onFreePoseChange?.(next);
    /*
     * Kept alongside the effect above rather than left to it. A held button
     * repeats every 55 ms and reads `freePoseRef`, not the prop, so it can
     * compound faster than React re-renders; this keeps the two buttons'
     * enabled state in step with the presses that are actually landing.
     */
    setStandOffRoom(roomAround(next));
  };

  /** One authoring-only depth step: resize the sector without moving it. */
  const pressFanDepth = (sign: -1 | 1) => {
    if (poseTransitioningRef.current || !AUTHORING_ENABLED) return;
    const pose = freePoseRef.current;
    if (!pose) return;
    const next = steppedFanDepth(pose, sign);
    if (!next) return;
    freePoseRef.current = next;
    onAuthoringWorkingViewRef.current?.(null);
    onFreePoseChange?.(next);
  };

  /** One press: step the sweep when the probe is locked, turn it when it is not. */
  const pressProbe = (axis: ProbeAxis, sign: -1 | 1) => {
    if (poseTransitioningRef.current) return;
    const pose = freePoseRef.current;
    if (pose === null) {
      // LOCKED: the press writes `t` and nothing else, so the pose it produces
      // is `frameAt(probe, sweep, t)` by construction and stays on the track.
      onScrubChange?.(steppedT(scrubRef.current, sign, view?.sweep));
      return;
    }
    const next = nudgedPose(pose, axis, sign * NUDGE_DEG);
    freePoseRef.current = next;
    onAuthoringWorkingViewRef.current?.(null);
    onFreePoseChange?.(next);
  };

  const beginHold = (step: () => void) => {
    if (poseTransitioningRef.current) return;
    stopHold();
    step();
    const delay = window.setTimeout(() => {
      const repeat = window.setInterval(step, 55);
      if (holdRef.current) holdRef.current.repeat = repeat;
    }, 320);
    holdRef.current = { delay, repeat: 0 };
  };

  const beginPress = (axis: ProbeAxis, sign: -1 | 1) => beginHold(() => pressProbe(axis, sign));

  /**
   * Put the probe back on the view's saved track, without locking it.
   *
   * The same pose the unlock seeds from, so recentring and unlocking afresh are
   * the same operation — and neither of them merges anything: the free pose is
   * replaced outright by a pose the pack authored.
   */
  const recentreProbe = () => {
    if (poseTransitioningRef.current) return;
    if (!view) return;
    const onTrack = view.sweep ? poseAt(view.probe, view.sweep, scrub) : view.probe;
    freePoseRef.current = onTrack;
    onAuthoringWorkingViewRef.current?.(null);
    onFreePoseChange?.(onTrack);
  };

  const setProbeFree = (free: boolean) => {
    if (poseTransitioningRef.current) return;
    onAuthoringWorkingViewRef.current?.(null);
    if (!free || !view) {
      freePoseRef.current = null;
      onFreePoseChange?.(null);
      return;
    }
    const seeded = view.sweep ? poseAt(view.probe, view.sweep, scrub) : view.probe;
    freePoseRef.current = seeded;
    onFreePoseChange?.(seeded);
  };

  /**
   * The pad's buttons, in render order.
   *
   * The `fan` pair is present in BOTH modes, because it is the same motion
   * either way: locked it steps along the view's saved sweep, unlocked it turns
   * the probe about the same axis the sweep turns it about. The other four are
   * free-probe only — there is no on-track meaning for aiming within the plane
   * or rolling the probe, so offering them locked would be offering a control
   * that cannot do anything.
  */
  const probeFree = freePose !== null;
  const canIncreaseFanDepth = freePose !== null && steppedFanDepth(freePose, 1) !== null;
  const canDecreaseFanDepth = freePose !== null && steppedFanDepth(freePose, -1) !== null;
  const hasSweep = view?.sweep !== undefined;
  const padPresent = echoMode && (probeFree || (hasSweep && onScrubChange !== undefined));

  const chooseCutterMode = (next: CutterMode) => {
    const adopted = apiRef.current?.setCutterMode(next);
    setCutterModeState(next);
    if (adopted !== undefined) setCutOffset(adopted);
  };

  /*
   * WHAT AM I LOOKING AT — the anatomy panel's own header, matching the echo's.
   *
   * The two panels are read side by side and one of them was titled and the
   * other was not, which made the model look like an illustration beside a
   * named image. It names, in order of what the learner is most likely to be
   * asking: the structure under the pointer, then the one they isolated, then
   * the model itself.
   */
  const structureLabel = (id: string | null): string | null =>
    id === null
      ? null
      : pack.meshes.structures.find((structure) => structure.id === id)?.display_label ?? id;
  const hoveredLabel = structureLabel(hoveredId);
  const title = hoveredLabel ?? isolatedLabel ?? pack.meta.display_name;
  const note = hoveredLabel !== null
    ? 'under the pointer'
    : isolatedLabel !== null ? 'showing only this' : '3D anatomy';

  return (
    <section className="anatomy-panel">
      <header className="panel-head anatomy__header">
        {/* The full name in `title`, because a long derived structure name
            truncates in a column this wide and the ellipsis must not be the
            only place it exists. */}
        <h2 data-testid="anatomy-title" title={title}>{title}</h2>
        <p className="panel-head__note" data-testid="anatomy-note">{note}</p>
      </header>
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

        {/*
          * The probe control pad.
          *
          * Buttons rather than a drag, because the probe turns about three of
          * its OWN axes and a drag has two degrees of freedom and no way to say
          * which one it meant. Each button is a named anatomical motion, which
          * is also what a learner has to be able to name.
          *
          * It sits over the panel rather than under it so the probe and its
          * effect are in one place, and only the buttons take pointer events —
          * the rest of the overlay lets a drag through to the camera.
          */}
        {status === 'ready' && padPresent && (
          <div className="probe-pad" data-testid="probe-pad" data-probe-pad={probeFree ? 'free' : 'sweep'}>
            <p className="probe-pad__title">Probe control</p>

            <div className="probe-pad__controls">
              {AUTHORING_ENABLED && probeFree && (
                <div className="probe-depth-rocker" role="group" aria-label="Fan depth">
                  <button
                    type="button"
                    className="probe-depth-rocker__button"
                    title={`Increase fan depth by ${FAN_DEPTH_STEP_CM} cm`}
                    aria-label={`Increase fan depth by ${FAN_DEPTH_STEP_CM} cm`}
                    data-testid="probe-depth-up"
                    disabled={poseTransitioning || !canIncreaseFanDepth}
                    onClick={() => pressFanDepth(1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="probe-depth-rocker__button"
                    title={`Decrease fan depth by ${FAN_DEPTH_STEP_CM} cm`}
                    aria-label={`Decrease fan depth by ${FAN_DEPTH_STEP_CM} cm`}
                    data-testid="probe-depth-down"
                    disabled={poseTransitioning || !canDecreaseFanDepth}
                    onClick={() => pressFanDepth(-1)}
                  >
                    ▼
                  </button>
                </div>
              )}

            {/*
              * One 3x3 grid, laid out as a game controller's d-pad: a fat cross
              * of five filled cells, with the two roll buttons in the corners
              * the cross leaves empty. Corners rather than a row of their own,
              * so adding them costs no height — the pad covers the same amount
              * of anatomy locked or free.
              */}
            <div className={probeFree ? 'probe-pad__grid' : 'probe-pad__grid probe-pad__grid--fan'}>
              {probeFree && ([[-1, '↺', 'Roll the probe anticlockwise about its beam, turning the imaging plane'],
                [1, '↻', 'Roll the probe clockwise about its beam, turning the imaging plane'],
              ] as [-1 | 1, string, string][]).map(([sign, glyph, hint]) => (
                <button
                  key={sign}
                  type="button"
                  className={`probe-pad__roll probe-pad__roll--${sign > 0 ? 'cw' : 'ccw'}`}
                  title={hint}
                  aria-label={hint}
                  data-testid={`probe-roll-${sign > 0 ? 'cw' : 'ccw'}`}
                  disabled={poseTransitioning}
                  onPointerDown={(event) => {
                    capturePress(event);
                    beginPress('rotate', sign);
                  }}
                  onPointerUp={stopHold}
                  onPointerCancel={stopHold}
                >
                  {glyph}
                </button>
              ))}

              {/*
                * Up and down are the FAN: the plane sweeps through the heart.
                * Locked, that is a step along the view's own saved sweep; free,
                * it is the same turn with nothing claiming it is the view.
                */}
              <button
                type="button"
                className="probe-pad__button probe-pad__button--up"
                title={probeFree
                  ? 'Fan the imaging plane through the heart, about the probe\u2019s lateral axis'
                  : 'Step the sweep forward'}
                aria-label={probeFree ? 'Fan the imaging plane one way' : 'Step the sweep forward'}
                data-testid="probe-fan-up"
                disabled={poseTransitioning}
                onPointerDown={(event) => {
                  capturePress(event);
                  beginPress('fan', 1);
                }}
                onPointerUp={stopHold}
                onPointerCancel={stopHold}
              >
                ▲
              </button>

              {probeFree && (
                <button
                  type="button"
                  className="probe-pad__button probe-pad__button--left"
                  title="Aim the beam left within the same imaging plane"
                  aria-label="Aim the beam left within the same imaging plane"
                  data-testid="probe-aim-left"
                  disabled={poseTransitioning}
                  onPointerDown={(event) => {
                    capturePress(event);
                    beginPress('aim', -1);
                  }}
                  onPointerUp={stopHold}
                  onPointerCancel={stopHold}
                >
                  ◀
                </button>
              )}

              {/*
                * The middle of the cross. It is what makes four arms read as
                * one control, and when there is a free angle to undo it is also
                * the way back: it returns the probe to the view's saved track at
                * the current sweep position, WITHOUT locking it — so a learner
                * who has turned the probe somewhere unrecognisable can recentre
                * and carry on rather than having to toggle off and on.
                *
                * Locked there is no free angle, so it is a plain cell.
                */}
              {/*
                * AUTHORING takes the centre, in BOTH pad states.
                *
                * The brief asked for the centre on the LOCKED pad, and in a
                * placing session the pad is never locked: anchoring sets a free
                * pose, so the author is always in the free pad and the button
                * they actually press is the learner's recentre — which returns
                * the probe to the VIEW'S TRACK and ignores the slot entirely.
                * Reported from the app as "save centre didn't save it", because
                * from the outside that is exactly what it looks like.
                *
                * So in authoring the centre always means the active slot. For a
                * standard slot with no override that IS the pack's authored
                * pose, so nothing is taken away; the two differ only once the
                * author has overridden the slot or selected a custom one, which
                * is precisely when the slot is the thing they meant.
                */}
              {AUTHORING_ENABLED ? (
                /*
                 * AUTHORING: the locked pad's dead centre cell becomes the way
                 * back to the active slot.
                 *
                 * The restore is EXACT — `restoredPose` hands back a clone of
                 * the stored value and the pose is REPLACED, never merged, the
                 * same rule re-locking the free probe follows. A restore that
                 * merged would leave a position that is nearly the saved one,
                 * and "nearly" is not a position anybody saved.
                 *
                 * It unlocks the probe as a side effect, and it has to: a
                 * saved slot is an arbitrary pose, and the locked probe is
                 * pinned to `frameAt(probe, sweep, t)` by construction. The
                 * echo panel then withdraws the view's name, which is correct
                 * — it is not that view until the pose is put back in the pack.
                 */
                /*
                 * ALWAYS rendered in authoring, disabled when there is nothing
                 * to recall.
                 *
                 * It used to render only when the selected view held a pose, so
                 * selecting an empty canon view — which is most of them on a
                 * pack that has just been opened — made the centre of the pad
                 * disappear. Reported as "the centre d-pad button is gone". A
                 * control that comes and goes is one you have to re-find; a
                 * disabled one that says why is not.
                 */
                <button
                  type="button"
                  className="probe-pad__core probe-pad__core--reset"
                  disabled={status !== 'ready' || slotPose === null || slotView === null
                    || poseTransitioning}
                  title={slotPose === null
                    ? 'Nothing is stored for the selected view yet. Place the probe and save it.'
                    : 'Recall: put the probe back exactly where the selected view has it'}
                  aria-label="Recall the probe to the selected view"
                  data-testid="probe-restore-slot"
                  onClick={() => {
                    if (slotPose === null || slotView === null) return;
                    activateAuthoringPose(slotPose, slotView);
                  }}
                >
                  <span className="probe-pad__dot" aria-hidden="true" />
                </button>
              ) : probeFree ? (
                <button
                  type="button"
                  className="probe-pad__core probe-pad__core--reset"
                  title="Recentre: put the probe back on this view's saved track, still unlocked"
                  aria-label="Recentre the probe on this view's saved track"
                  data-testid="probe-recentre"
                  onClick={recentreProbe}
                >
                  <span className="probe-pad__dot" aria-hidden="true" />
                </button>
              ) : (
                /*
                 * LOCKED, and it is a home button rather than a dead cell.
                 *
                 * It was a `<span>`: the middle of the cross existed only to
                 * make four arms read as one control, and the learner's pad
                 * therefore had no way back from a scrub except pressing the
                 * opposite arrow the same number of times. The fan buttons step
                 * the sweep, so the centre returns it to the view's own
                 * REFERENCE position — the middle, not the start, because a
                 * sweep runs from one extreme to the other through the view.
                 * The same meaning the free pad's centre already has, which is
                 * "put me back where this view puts me".
                 *
                 * Disabled at the start rather than hidden, so the pad does not
                 * change shape under the hand and the control says what it
                 * would do before it can do it.
                 */
                <button
                  type="button"
                  className="probe-pad__core probe-pad__core--reset"
                  disabled={atSweepHome(scrub)}
                  title={atSweepHome(scrub)
                    ? 'The sweep is already at this view\u2019s reference position'
                    : 'Back to this view\u2019s reference position on its sweep'}
                  aria-label="Back to this view's reference position on its sweep"
                  data-testid="probe-home"
                  onClick={() => onScrubChange?.(SWEEP_HOME_T)}
                >
                  <span className="probe-pad__dot" aria-hidden="true" />
                </button>
              )}

              {probeFree && (
                <button
                  type="button"
                  className="probe-pad__button probe-pad__button--right"
                  title="Aim the beam right within the same imaging plane"
                  aria-label="Aim the beam right within the same imaging plane"
                  data-testid="probe-aim-right"
                  disabled={poseTransitioning}
                  onPointerDown={(event) => {
                    capturePress(event);
                    beginPress('aim', 1);
                  }}
                  onPointerUp={stopHold}
                  onPointerCancel={stopHold}
                >
                  ▶
                </button>
              )}

              {/*
                * Stand-off. A chevron against a BAR — the bar is the tissue —
                * rather than an arrow, because an arrow encodes a screen
                * direction and a screen direction is only right for one camera:
                * the heart sits above the probe in an apical view and elsewhere
                * in others, so an arrow pointing at the tissue in one view
                * points away from it in the next. Chevron and bar together are
                * about the gap, which is what actually changes.
                *
                * The bar is a CSS border rather than a character, so it is crisp
                * at this size and does not depend on a font having a glyph for
                * whatever combining mark would otherwise be needed.
                */}
              {probeFree && ([[1, 'closer', 'Press the probe closer to the tissue'],
                [-1, 'further', 'Lift the probe away from the tissue'],
              ] as [-1 | 1, 'closer' | 'further', string][]).map(([sign, key, hint]) => (
                <button
                  key={key}
                  type="button"
                  className={`probe-pad__roll probe-pad__roll--${key}`}
                  disabled={poseTransitioning || !standOffRoom[key]}
                  title={`${hint}. The only translation offered — it changes the stand-off, not the window, and it stops before the probe reaches tissue.`}
                  aria-label={hint}
                  data-testid={`probe-${key}`}
                  onPointerDown={(event) => {
                    capturePress(event);
                    beginHold(() => pressStandOff(sign));
                  }}
                  onPointerUp={stopHold}
                  onPointerCancel={stopHold}
                >
                  {/*
                    * The SAME glyph and the same bar in both buttons, with one
                    * of them flipped, so the pair are exact mirror images. Two
                    * different arrowhead characters are not: they sit at
                    * different heights on the baseline and have different
                    * metrics, so the two buttons came out visibly mismatched.
                    */}
                  <span className={`probe-pad__gap probe-pad__gap--${key}`} aria-hidden="true">
                    {'\u2303'}
                  </span>
                </button>
              ))}

              <button
                type="button"
                className="probe-pad__button probe-pad__button--down"
                title={probeFree
                  ? 'Fan the imaging plane the other way, about the probe\u2019s lateral axis'
                  : 'Step the sweep back'}
                aria-label={probeFree ? 'Fan the imaging plane the other way' : 'Step the sweep back'}
                data-testid="probe-fan-down"
                disabled={poseTransitioning}
                onPointerDown={(event) => {
                  capturePress(event);
                  beginPress('fan', -1);
                }}
                onPointerUp={stopHold}
                onPointerCancel={stopHold}
              >
                ▼
              </button>
            </div>
            </div>
          </div>
        )}
      </div>

      {status === 'ready' && (
        <>
        {/*
          * What the cut plane IS, named on screen at all times.
          *
          * This replaces both the drag-target selector and the one-shot align
          * button. There is no state a learner has to have set before a drag
          * does what they meant — the handles say what is grabbable — and the
          * relationship to the view is a live mode rather than a claim that
          * silently decays the first time the plane is nudged.
          */}
        <div className="cutter-mode" data-testid="cutter-mode">
          {echoMode ? (
            <div role="radiogroup" aria-label="What the cut plane follows" className="cutter-mode__group">
              {([
                ['echo', 'Echo plane', "Follows this view's imaging plane as the sweep scrubs"],
                ['free', 'Free', 'Yours to turn. Claims no relationship to the view'],
              ] as [CutterMode, string, string][]).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={cutterMode === value}
                  className={
                    cutterMode === value
                      ? 'cutter-mode__button cutter-mode__button--on'
                      : 'cutter-mode__button'
                  }
                  onClick={() => chooseCutterMode(value)}
                  title={hint}
                  data-testid={`cutter-mode-${value}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <span className="cutter-mode__button cutter-mode__button--on">Free</span>
          )}
          {/*
            * Unlocking the probe is the one learner-reachable way off the saved
            * sweep track, and it is an explicit owner decision rather than a
            * drift. It is paid for by LABELLING: while it is on, the echo panel
            * withdraws the view's name and its draft flag and says the plane is
            * unvetted. Nothing here writes to `views[]` — the free pose is
            * runtime state and dies with the session.
            */}
          {echoMode && onFreePoseChange && view?.sweep && (
            <label className="cutter__toggle" title="Turn the probe by hand with the control pad, off this view's saved sweep. The echo then stops claiming to be this view.">
              <input
                type="checkbox"
                checked={freePose !== null}
                onChange={(event) => setProbeFree(event.target.checked)}
                disabled={poseTransitioning}
                data-testid="probe-free"
              />
              Free probe
            </label>
          )}

          <span className="cutter-mode__state" data-testid="cutter-mode-state">
            {/*
              * Kept to one short line each. These sit above the control row, so
              * a string long enough to wrap pushes every control below it down
              * the moment a mode is toggled — and a control that moves under
              * the hand is a control you have to re-find. The detail these used
              * to carry is in the buttons' own titles, where it does not cost
              * layout.
              */}
            {!echoMode
              ? 'Explore — no probe, so the cut is free.'
              : freePose !== null
                ? 'Probe unlocked — not a saved view once moved.'
                : cutterMode === 'echo'
                  ? "Cut follows the view's imaging plane."
                  : 'Free cut — no relationship to the view claimed.'}
          </span>
        </div>

        <div className="cutter" data-testid="cutter-controls">
          <label className="cutter__toggle" data-hint="Cut the model open on the plane.">
            <input
              type="checkbox"
              checked={cutEnabled}
              onChange={(event) => setCutEnabled(event.target.checked)}
              data-testid="cut-enabled"
            />
            Cut
          </label>

          {/*
            * The readout, and no slider.
            *
            * The depth arrow in the scene replaced it. A slider is a fine
            * control for a number and a poor one for a plane: it sits outside
            * the picture, so the learner has to look away from the thing they
            * are moving, and its travel means nothing in the scene. The arrow
            * is in the picture and tracks the hand at 1:1. Shift-wheel still
            * works, and the readout is still the one value all of them write.
            *
            * What this costs is keyboard reach — a range input is operable
            * without a pointer and a 3D drag is not. Logged in
            * `docs/observations.md` rather than traded away silently.
            */}
          <output className="cutter__readout" data-testid="cut-readout">
            {depthLocked ? 'on echo plane' : `${cutOffset.toFixed(1)} ${pack.meshes.units}`}
          </output>

          {/*
            * The removed half, put back as a faint shell. A toggle rather than
            * always-on: the point of a cut is to see inside it, and a ghost is
            * one more thing between the eye and the cut face — but read against
            * the whole heart it came out of, a section says more.
            */}
          <label
            className="cutter__toggle"
            data-hint="Draw the half the cut removes as a faint shell."
          >
            <input
              type="checkbox"
              checked={ghostCutaway}
              onChange={(event) => setGhostCutaway(event.target.checked)}
              disabled={!cutEnabled}
              data-testid="ghost-cutaway"
            />
            Ghost
          </label>

          {echoMode && (
            <label
              className="cutter__toggle"
              data-hint="Dim the tissue the beam does not reach."
            >
              <input
                type="checkbox"
                checked={beamDim}
                onChange={(event) => setBeamDim(event.target.checked)}
                data-testid="beam-dim"
              />
              Beam
            </label>
          )}

          {/*
            * WHICH WAY IS UP. Echo only, off by default.
            *
            * Trackball orbit is the default everywhere and the only option in
            * Explore, where free inspection is the point and the turntable was
            * removed because it could not reach every angle. Here, which way is
            * up is diagnostic rather than cosmetic, so holding the heart's own
            * long axis vertical is offered — as an option, not as the
            * behaviour, because the reason the turntable went is still true.
            */}
          {echoMode && (
            <label
              className="cutter__toggle"
              title="Hold the heart's long axis vertical while orbiting"
            >
              <input
                type="checkbox"
                checked={horizonLock}
                onChange={(event) => setHorizonLock(event.target.checked)}
                disabled={poseTransitioning}
                data-testid="horizon-lock"
              />
              Level
            </label>
          )}

          <button
            type="button"
            onClick={() => setCutFlipped((value) => !value)}
            disabled={!cutEnabled}
            data-hint="Swap which half of the model the cut removes."
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
          {echoMode && (view !== undefined || freePose !== null) && (
            <button
              type="button"
              onClick={() => {
                /*
                 * The frame ON SCREEN, not the one the pack authored.
                 *
                 * It read `view.probe` unconditionally, so the one button whose
                 * whole job is agreement between the two panels turned the model
                 * to face a plane that was not being imaged the moment the probe
                 * was unlocked — and did nothing at all on a pack with no views,
                 * which in an authoring build is where a placed pose most needs
                 * looking at. Same rule as the wedge and the echo: whatever is
                 * driving the image is what this faces.
                 */
                const frame = freePose !== null
                  ? imagingFrame(freePose)
                  : view
                    ? frameAt(view.probe, view.sweep, scrub)
                    : null;
                if (frame) {
                  apiRef.current?.matchEchoOrientation(withApexFlip(frame, apexFlipped));
                }
              }}
              title="Turn the model to face the echo's imaging plane. Camera only."
              data-testid="match-echo"
            >
              Match echo
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setCutOffset(cutterMode === 'echo' ? 0 : (pack.interaction?.free_cut?.offset ?? 0));
              apiRef.current?.resetCutPlane();
              apiRef.current?.resetCamera();
              setCutFlipped(apiRef.current?.cutShouldFaceCamera() ?? false);
            }}
            data-hint="Camera and cut plane back to their defaults."
            data-testid="cut-reset"
          >
            Reset
          </button>
        </div>

        {/*
          * AUTHORING. Behind a build-time literal, so with the flag off this
          * folds to `false` and the module reference goes with it — there is no
          * disabled control in a learner build, and no module either.
          *
          * It sits with the other buttons rather than inside the probe pad,
          * which is deliberate: its destructive control writes over a saved
          * slot, and a destructive control must not be adjacent to buttons that
          * are pressed repeatedly.
          */}
        {AUTHORING_ENABLED && (
          <AuthoringControls
            packId={pack.meta.id}
            packVersion={pack.meta.pack_version}
            packSchemaVersion={pack.meta.schema_version}
            seeds={authoringSeeds}
            template={view ? { fan: view.probe.fan, display: view.probe.display } : undefined}
            standoffOverrideMm={pack.interaction?.authoring_standoff_mm}
            readAnchor={() => apiRef.current?.viewAnchor() ?? null}
            currentPose={freePose}
            transitioning={poseTransitioning}
            ready={status === 'ready'}
            onActivatePose={activateAuthoringPose}
            onPose={(pose) => {
              if (poseTransitioningRef.current) return;
              freePoseRef.current = pose;
              onAuthoringWorkingViewRef.current?.(null);
              onFreePoseChange?.(pose);
            }}
            onActiveSlotPose={setActiveAuthoringSlot}
            onLevelAxis={setLevelAxis}
          />
        )}

        {/*
          * The cine row: a SEPARATE control from the sweep scrubber, on a
          * separate axis.
          *
          * The scrubber moves a probe over a static heart. This moves the heart
          * and has no probe in it. Sharing one slider between them would make
          * one number mean two different things, and the meaning would change
          * under the learner as they switched modes.
          */}
        {cineAvailable && cineCount > 1 && (
          <div className="cine" data-testid="cine-controls">
            <button
              type="button"
              onClick={() => setCinePlaying((playing) => !playing)}
              disabled={!cineReady}
              title={
                cineReady
                  ? keyframes?.loop
                    ? 'Play the cycle on a loop'
                    : 'Play back and forth — these frames are half a cycle, so a loop '
                      + 'would snap the heart open at the end'
                  : 'Loading the remaining frames'
              }
              data-testid="cine-play"
            >
              {cinePlaying ? 'Pause' : 'Play'}
            </button>

            <label className="cine__scrub">
              <span className="cine__label">Frame</span>
              <input
                type="range"
                min={0}
                max={cineCount - 1}
                step={1}
                value={cineFrame}
                disabled={!cineReady}
                onChange={(event) => {
                  setCinePlaying(false);
                  setCineFrame(Number(event.target.value));
                }}
                aria-label="Cardiac phase — which geometry frame is shown"
                data-testid="cine-scrub"
              />
            </label>

            <output className="cine__readout" data-testid="cine-readout">
              {cineReady
                ? `${cineFrame + 1}/${cineCount} · ${keyframes?.frames[cineFrame]?.label ?? ''}`
                : `loading ${cineCount} frames…`}
            </output>

            {/*
              * What the motion is and is not, on screen rather than in a
              * tooltip. A learner watching a heart move will read it as a
              * recording of a beat unless told otherwise, and this one is half
              * a beat with no stated rate.
              */}
            <span className="cine__note">
              {keyframes?.coverage}
              {keyframes?.fps === undefined && ' · no rate stated by the source'}
            </span>
          </div>
        )}
        </>
      )}
    </section>
  );
}
