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
 * plane as the sweep scrubs and the depth slider slides it along that plane's
 * own normal, and **Free**, where it is the learner's. Switching to Free adopts
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
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Pack, ProbePose } from '../schema/packV0.ts';
import { frameAt, imagingFrame, poseAt, type ImagingFrame } from '../echo/probeFrame.ts';
import { rotatedPose } from './freeProbe.ts';
import { PROBE_LENGTH, ProbeIndicator } from './wedge.ts';
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
  planeBasis,
  tiltedNormal,
  type CutPlaneState,
} from './cutPlane.ts';
import { CutPlaneGizmo, HANDLE_IDS, handleDirection, type HandleId } from './planeHandle.ts';
import {
  TiltArrow,
  nearestOnPath,
  pathScreenLength,
  scrubbedT,
  sweepPath,
} from './tiltArrow.ts';
import { hitRadiusPx, isCoarsePointer, revealFor, watchPointerClass } from './pointerClass.ts';
import { projectToScreen, unitsPerPixel } from './screen.ts';
import { PALETTE, structureColour } from './palette.ts';

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
  freePose?: ProbePose | null;
  /**
   * The one path the tilt arrow writes through — the same one the sweep slider
   * uses. Without it the arrow is not drawn, because an affordance that cannot
   * move anything is worse than no affordance.
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
}

/** Radians of plane rotation per pixel of handle drag. */
const HANDLE_RADIANS_PER_PIXEL = 0.006;

interface ViewerApi {
  setFrame: (frame: ImagingFrame) => void;
  setHidden: (hidden: ReadonlySet<string>) => void;
  setCut: (cut: { enabled: boolean; offset: number; flipped: boolean }) => void;
  setBeamDim: (strength: number) => void;
  setGhost: (on: boolean) => void;
  setPointerClass: (coarse: boolean) => void;
  setMode: (mode: ViewerMode) => void;
  /** Returns the depth the slider should now show, in the new mode's terms. */
  setCutterMode: (mode: CutterMode) => number;
  resetCamera: () => void;
  matchEchoOrientation: (frame: ImagingFrame) => void;
  resetCutPlane: () => void;
}

export default function PackViewer({
  pack, gltfUrl, scrub, viewIndex = 0, hidden, mode = 'echo',
  freePose = null, onScrubChange, onFreePoseChange,
}: PackViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const apiRef = useRef<ViewerApi | null>(null);

  const seeded = pack.interaction?.free_cut;
  const [cutEnabled, setCutEnabled] = useState(seeded !== undefined);
  /**
   * The depth slider's value.
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
   * Whether the half the cutter removes is drawn back as a ghost.
   *
   * Off by default: the point of the cut is to see inside, and a ghost is
   * another thing between the eye and the cut face. On, it puts the removed
   * half back as a faint translucent shell, so the section can be read against
   * the whole heart it came out of.
   */
  const [ghostCutaway, setGhostCutaway] = useState(false);
  /** Slider bound, from model bounds; 0 until the model reports its size. */
  const [cutLimit, setCutLimit] = useState(0);
  /** Explore has no probe to sync to, so the cutter is forced free there. */
  const [cutterMode, setCutterModeState] = useState<CutterMode>(
    mode === 'explore' ? 'free' : 'echo',
  );
  const [coarsePointer, setCoarsePointer] = useState(isCoarsePointer);

  const onScrubRef = useRef(onScrubChange);
  onScrubRef.current = onScrubChange;
  const onFreePoseRef = useRef(onFreePoseChange);
  onFreePoseRef.current = onFreePoseChange;
  const freePoseRef = useRef(freePose);
  freePoseRef.current = freePose;

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
    let arrow: TiltArrow | null = null;
    let caps: StencilCaps | null = null;
    let gizmo: CutPlaneGizmo | null = null;
    /** The half the cutter removes, put back as a faint shell. */
    const ghosts = new THREE.Group();
    let ghostOn = false;
    scene.add(ghosts);
    let bounds = new THREE.Box3();
    /** Enclosing radius about `C`: frames the camera and bounds the slider. */
    let reach = 0;
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
    /** Where the probe body's centre projects, for the free-probe grab. */
    let probeAnchor: THREE.Vector3 | null = null;

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
      for (const point of sweepPath(view.probe, view.sweep)) {
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

    /** The tilt arrow's path, projected to the panel. Empty when there is none. */
    const arrowScreenPath = (): { x: number; y: number }[] => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!arrow || width === 0 || freePoseRef.current !== null) return [];
      const out: { x: number; y: number }[] = [];
      for (const world of arrow.path) {
        const point = projectToScreen(world, camera, width, height);
        if (point.inFront) out.push({ x: point.x, y: point.y });
      }
      return out;
    };

    /**
     * Keep the handles and the arrow the size of their own hit targets.
     *
     * Both are drawn in world space and grabbed in screen space, so the two
     * numbers have to be derived from one: a handle that draws smaller than it
     * grabs swallows drags meant for the camera, and one that draws larger
     * misses when aimed at.
     */
    const rescaleAffordances = () => {
      const height = host.clientHeight;
      if (height === 0) return;
      const grab = hitRadiusPx(coarse);
      if (gizmo) {
        const anchor = planeAnchor(cut, pivot);
        gizmo.setScreenScale(unitsPerPixel(camera, camera.position.distanceTo(anchor), height), grab);
      }
      if (arrow && arrow.path.length > 0) {
        const mid = arrow.path[Math.floor(arrow.path.length / 2)];
        arrow.setScreenScale(unitsPerPixel(camera, camera.position.distanceTo(mid), height), grab);
      }
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

      if (arrow) {
        // No arrow while the probe is free: the sweep is not what is moving it,
        // so a control that says "scrub" would misdescribe the drag.
        arrow.object.visible = freePoseRef.current === null;
        if (freePoseRef.current === null) {
          const path = arrowScreenPath();
          const hit = x === null || y === null ? null : nearestOnPath(path, x, y);
          // A handle under the pointer wins: it is drawn on top and it is the
          // smaller target, so the arrow must not steal a drag aimed at one.
          const distance = hovered !== null || hit === null ? Infinity : hit.distancePx;
          arrow.setReveal(revealFor(distance, coarse), scrubRef.current);
        }
      }
      schedule();
    };

    /**
     * What the pointer is over, in the order a drag resolves it.
     *
     * Hit-tested at pointerdown rather than read off a hover state, because a
     * coarse pointer has no hover: the first contact a finger makes with the
     * screen is already the press.
     */
    const hitTest = (x: number, y: number):
      | { kind: 'handle'; id: HandleId }
      | { kind: 'arrow'; tangent: { x: number; y: number }; tPerPixel: number }
      | { kind: 'probe' }
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
      if (best !== null) return { kind: 'handle', id: best };

      /*
       * An unlocked probe is grabbed by its BODY, and the tilt arrow is not
       * drawn — the sweep is not what is moving it any more, so an affordance
       * that says "scrub" would be lying about what a drag does.
       */
      if (freePoseRef.current && probeAnchor && host.clientWidth > 0) {
        const point = projectToScreen(probeAnchor, camera, host.clientWidth, host.clientHeight);
        // Twice the radius: the target is a transducer a couple of centimetres
        // long, not a dot, and it is the only thing in the panel it can be
        // confused with.
        if (point.inFront && Math.hypot(point.x - x, point.y - y) <= grab * 2) {
          return { kind: 'probe' };
        }
      }

      if (arrow && !freePoseRef.current) {
        const path = arrowScreenPath();
        const hit = nearestOnPath(path, x, y);
        if (hit && hit.distancePx <= grab) {
          // The LOCAL rate of the track: how much `t` a pixel of drag along the
          // drawn window is worth. Taken from the window rather than the whole
          // sweep so the feel does not change as it is clipped short at an end.
          const screenLength = pathScreenLength(path);
          return {
            kind: 'arrow',
            tangent: hit.tangent,
            tPerPixel: screenLength > 1 ? arrow.windowExtent / screenLength : 0,
          };
        }
      }
      return null;
    };

    /*
     * Where the affordances are, published on the host element.
     *
     * A test seam, and a deliberate one: "the handles and the tilt arrow are
     * present and hittable under a coarse pointer" is a gate, and a gate that
     * can only be checked by guessing at pixel coordinates is not a gate. These
     * are the same numbers the hit test uses, so a test that drags to them
     * exercises the real dispatch rather than a parallel one.
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
      if (probeAnchor && host.clientWidth > 0) {
        const point = projectToScreen(probeAnchor, camera, host.clientWidth, host.clientHeight);
        if (point.inFront) {
          host.dataset.probe = JSON.stringify({
            x: Math.round(point.x), y: Math.round(point.y),
          });
        } else {
          delete host.dataset.probe;
        }
      } else {
        delete host.dataset.probe;
      }
      host.dataset.probeLock = freePoseRef.current ? 'free' : 'onTrack';

      const path = arrowScreenPath();
      if (arrow && path.length > 1) {
        const mid = path[Math.floor(path.length / 2)];
        host.dataset.tiltArrow = JSON.stringify({
          x: Math.round(mid.x), y: Math.round(mid.y),
        });
      } else {
        delete host.dataset.tiltArrow;
      }
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
      const wanted = viewerMode === 'echo' && view !== undefined && loaded;

      if (!wanted) {
        if (probe) {
          scene.remove(probe.object);
          probe.dispose();
          probe = null;
        }
        if (arrow) {
          scene.remove(arrow.object);
          arrow.dispose();
          arrow = null;
        }
        return;
      }

      if (!probe && currentFrame) {
        probe = new ProbeIndicator(currentFrame);
        scene.add(probe.object);
      }
      /*
       * No sweep, no arrow. A view whose probe pose is a single point has
       * nothing for the arrow to scrub, and drawing a control that cannot move
       * anything is worse than drawing none.
       *
       * Likewise no `onScrubChange`: the arrow's whole contract is that it
       * writes `t` through the same path the slider does, so without that path
       * it must not appear.
       */
      if (!arrow && view?.sweep && onScrubRef.current) {
        arrow = new TiltArrow(view.probe, view.sweep);
        scene.add(arrow.object);
      }
    };

    /* --- input ------------------------------------------------------------ */
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

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
          kind: 'arrow';
          startT: number;
          tangent: { x: number; y: number };
          tPerPixel: number;
          startX: number;
          startY: number;
        }
      | {
          kind: 'probe';
          start: ProbePose;
          right: THREE.Vector3;
          up: THREE.Vector3;
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
      // The learner's hand outranks an animation in flight.
      glide = null;
      delete host.dataset.cameraGlide;
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
      } else if (hit?.kind === 'probe' && freePoseRef.current) {
        gesture = {
          kind: 'probe',
          start: freePoseRef.current,
          right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
          up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
          startX: event.clientX,
          startY: event.clientY,
        };
      } else if (hit?.kind === 'arrow') {
        gesture = {
          kind: 'arrow',
          startT: scrubRef.current,
          tangent: hit.tangent,
          tPerPixel: hit.tPerPixel,
          startX: event.clientX,
          startY: event.clientY,
        };
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
        return;
      }

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
      } else if (gesture.kind === 'probe') {
        /*
         * The unlocked probe, turned about its own origin. This is the ONE
         * learner-reachable path that leaves the saved sweep track, and it is
         * an explicit owner decision (2026-08-19) paid for by the echo panel
         * withdrawing the view's name while it is in force. It still cannot
         * write to `views[]`: `rotatedPose` takes a pose and returns a pose,
         * and the result lives in React state until the probe is locked again.
         */
        onFreePoseRef.current?.(rotatedPose(
          gesture.start,
          [gesture.right.x, gesture.right.y, gesture.right.z],
          [gesture.up.x, gesture.up.y, gesture.up.z],
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        ));
      } else if (gesture.kind === 'arrow') {
        /*
         * The arrow writes `t` and nothing else, through the same callback the
         * sweep slider writes through. It cannot reposition the probe: there is
         * no code path from here to `views[].probe`, and the pose that results
         * is `frameAt(probe, sweep, t)` by construction.
         */
        onScrubRef.current?.(scrubbedT(
          gesture.startT,
          gesture.tangent,
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
          gesture.tPerPixel,
        ));
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
      const local = localPoint(event);
      applyReveal(local.x, local.y);
    };

    const onPointerLeave = () => {
      if (dragging) return;
      applyReveal(null, null);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
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
     * directly, so the slider and the readout move with it. One `s`, three
     * controls, no reconciliation step.
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
          probeAnchor = new THREE.Vector3(...currentFrame.origin)
            .addScaledVector(new THREE.Vector3(...currentFrame.beam), -PROBE_LENGTH / 2);
          for (const uniforms of dimUniforms) setBeamFrame(uniforms, currentFrame);
        }

        loaded = true;
        syncProbeObjects();
        setCutLimit(reach);
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
      setFrame: (frame) => {
        currentFrame = frame;
        // The body's midpoint, which is what a learner aims at to take hold of
        // the probe. Recomputed with the frame rather than stored per view,
        // because the probe moves.
        probeAnchor = new THREE.Vector3(...frame.origin)
          .addScaledVector(new THREE.Vector3(...frame.beam), -PROBE_LENGTH / 2);
        probe?.update(frame);
        // One frame drives the probe geometry AND the highlight, for the same
        // reason the wedge and the echo share it: they cannot be allowed to
        // disagree about where the beam is.
        for (const uniforms of dimUniforms) setBeamFrame(uniforms, frame);
        // Echo-synced: the cutter FOLLOWS, so it moves with every frame rather
        // than having been aligned once.
        if (cutter === 'echo') applyCut();
        // The heads dim at the ends of the sweep, so they follow `t`.
        arrow?.refresh(scrubRef.current);
        schedule();
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
      setPointerClass: (next) => {
        coarse = next;
        applyReveal(null, null);
      },
      setMode: (next) => {
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
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('wheel', onWheel);
      // Ghost geometry is SHARED with the anatomy mesh, which the scene walk
      // below disposes. Only the materials belong to the ghosts.
      for (const ghost of ghosts.children) {
        if (ghost instanceof THREE.Mesh) (ghost.material as THREE.Material).dispose();
      }
      probe?.dispose();
      arrow?.dispose();
      caps?.dispose();
      gizmo?.dispose();
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
      delete host.dataset.cutHandles;
      delete host.dataset.tiltArrow;
    };
    // `mode` is read once here to seed the scene and is applied thereafter
    // through `setMode`; listing it would reload a five-megabyte glTF on a
    // mode switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltfUrl, pack, viewIndex]);

  /*
   * The probe follows the scrubber — or the free pose, when there is one. Same
   * frame the echo renders either way, which is what keeps the wedge and the
   * image one object rather than two that agree.
   */
  useEffect(() => {
    const view = pack.views[viewIndex];
    if (!view) return;
    apiRef.current?.setFrame(
      freePose ? imagingFrame(freePose) : frameAt(view.probe, view.sweep, scrub),
    );
  }, [scrub, pack, viewIndex, status, freePose]);

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
    apiRef.current?.setGhost(ghostCutaway);
  }, [ghostCutaway, status]);

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
   * The slider's travel.
   *
   * Normally the model's enclosing radius, which is as far as the plane can go
   * and still touch anything. But switching out of Echo plane mode ADOPTS the
   * imaging plane's offset, and a probe sits outside the model — so the adopted
   * `s` can be larger than the radius. Widening the travel to hold it keeps the
   * control honest: the alternative is a handle pinned at an end while the value
   * it reports is somewhere past it, which is a slider that lies about where the
   * plane is.
   */
  const depthLimit = Math.max(cutLimit, Math.abs(cutOffset));

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
  const setProbeFree = (free: boolean) => {
    if (!free || !view) {
      onFreePoseChange?.(null);
      return;
    }
    onFreePoseChange?.(view.sweep ? poseAt(view.probe, view.sweep, scrub) : view.probe);
  };

  const chooseCutterMode = (next: CutterMode) => {
    const adopted = apiRef.current?.setCutterMode(next);
    setCutterModeState(next);
    if (adopted !== undefined) setCutOffset(adopted);
  };

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
            <label className="cutter__toggle" title="Turn the probe by hand, off this view's saved sweep. The echo then stops claiming to be this view.">
              <input
                type="checkbox"
                checked={freePose !== null}
                onChange={(event) => setProbeFree(event.target.checked)}
                data-testid="probe-free"
              />
              Free probe
            </label>
          )}

          <span className="cutter-mode__state" data-testid="cutter-mode-state">
            {!echoMode
              ? 'Explore — no probe, so the cut is always free'
              : freePose !== null
                ? 'Probe unlocked — drag it to turn it. Once moved, this is not a saved view.'
                : cutterMode === 'echo'
                  ? "Cut follows the view's imaging plane."
                  : 'Free cut — the plane is yours, and claims no relationship to the view.'}
          </span>
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
            min={-depthLimit}
            max={depthLimit}
            step={depthLimit / 400 || 0.1}
            value={cutOffset}
            disabled={!cutEnabled || depthLocked}
            onChange={(event) => setCutOffset(Number(event.target.value))}
            aria-label="Cut depth along the plane normal"
            title={
              depthLocked
                ? 'The cut is the echo plane in this mode. Switch to Free to move it.'
                : undefined
            }
            data-testid="cut-offset"
          />

          {/* The readout is the same value the slider and shift-wheel write. */}
          <output className="cutter__readout" data-testid="cut-readout">
            {depthLocked ? 'on echo plane' : `${cutOffset.toFixed(1)} ${pack.meshes.units}`}
          </output>

          {/*
            * The removed half, put back as a faint shell. A toggle rather than
            * always-on: the point of a cut is to see inside it, and a ghost is
            * one more thing between the eye and the cut face — but read against
            * the whole heart it came out of, a section says more.
            */}
          <label className="cutter__toggle">
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
            <label className="cutter__toggle">
              <input
                type="checkbox"
                checked={beamDim}
                onChange={(event) => setBeamDim(event.target.checked)}
                data-testid="beam-dim"
              />
              Beam
            </label>
          )}

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
          {echoMode && (
            <button
              type="button"
              onClick={() => {
                if (view) apiRef.current?.matchEchoOrientation(frameAt(view.probe, view.sweep, scrub));
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
              setCutFlipped(false);
              apiRef.current?.resetCutPlane();
              apiRef.current?.resetCamera();
            }}
            data-testid="cut-reset"
          >
            Reset
          </button>
        </div>
        </>
      )}
    </div>
  );
}
