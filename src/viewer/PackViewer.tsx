/**
 * The anatomy viewer — first real slice of viewer-core.
 *
 * Loads the pack's glTF, poses it by `meshes.canonical_pose`, orbits around the
 * interaction pivot `C`, and draws the probe wedge from the same `ImagingFrame`
 * the echo panel rasterises.
 *
 * What is deliberately NOT here, because `contracts/viewer-core.md` specifies
 * more than this slice delivers and a half-built cutter is worse than none:
 * the free anatomical cutter `{N, s}` with stencil caps, explicit target
 * selection between heart/cut/echo, plane rotation gizmos, and the
 * "align free cut to echo view" bridge. Those are the rest of wave 1c.
 *
 * Orbit is implemented here rather than pulled from `OrbitControls` so the
 * pivot is unambiguously `C` and the wheel's meaning stays fixed: the contract
 * says wheel without a modifier ALWAYS zooms, and that has to remain true once
 * the cutter's modifier-wheel lands.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Pack } from '../schema/packV0.ts';
import { frameAt, type ImagingFrame } from '../echo/probeFrame.ts';
import { ProbeWedge } from './wedge.ts';

interface PackViewerProps {
  pack: Pack;
  gltfUrl: string;
  /** Scrub position of the selected view's sweep, 0..1. Drives the wedge. */
  scrub: number;
  viewIndex?: number;
  hidden?: ReadonlySet<string>;
}

/** Distinct hues for the named structures; anything unnamed stays neutral grey. */
const PALETTE: Record<string, number> = {
  'lv-myocardium': 0xd94f4f,
  'rv-myocardium': 0x4f8fd9,
  'la-myocardium': 0xe0a33c,
  'ra-myocardium': 0x5fb87a,
  'aortic-wall': 0xc45ec4,
  'pulmonary-artery-wall': 0x46b8b0,
};

export default function PackViewer({
  pack, gltfUrl, scrub, viewIndex = 0, hidden,
}: PackViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const apiRef = useRef<{
    setFrame: (frame: ImagingFrame) => void;
    setHidden: (hidden: ReadonlySet<string>) => void;
  } | null>(null);

  /*
   * The scrub position is read through a ref inside the load effect, not listed
   * as a dependency. Depending on it would tear down the renderer and re-fetch
   * a five-megabyte glTF on every tick of the scrubber; the wedge is updated
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
       */
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (cause) {
      // A hospital desktop with acceleration disabled is a first-class target.
      // Report inside the viewer region; never take the surrounding shell down.
      console.warn('anatomy viewer unavailable: WebGL context creation failed.', cause);
      setStatus('unavailable');
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    let wedge: ProbeWedge | null = null;

    /* --- orbit state, pivoting on C -------------------------------------- */
    let pivot = new THREE.Vector3();
    let radius = 400;
    let yaw = 0.9;
    let pitch = 0.35;

    const applyCamera = () => {
      camera.position.set(
        pivot.x + radius * Math.cos(pitch) * Math.sin(yaw),
        pivot.y + radius * Math.sin(pitch),
        pivot.z + radius * Math.cos(pitch) * Math.cos(yaw),
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(pivot);
    };

    const draw = () => {
      renderer.render(scene, camera);
    };

    const schedule = () => {
      if (disposed || frameHandle !== 0) return;
      frameHandle = requestAnimationFrame(() => {
        frameHandle = 0;
        draw();
      });
    };

    /* --- input ------------------------------------------------------------ */
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      yaw -= (event.clientX - lastX) * 0.008;
      // Clamped so the camera cannot pass through the poles and flip `up`.
      pitch = Math.max(-1.5, Math.min(1.5, pitch + (event.clientY - lastY) * 0.008));
      lastX = event.clientX;
      lastY = event.clientY;
      applyCamera();
      schedule();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    const onWheel = (event: WheelEvent) => {
      // Wheel without a modifier ALWAYS zooms — contracts/viewer-core.md, no
      // exceptions. The cutter's depth control will take modifier-wheel only.
      event.preventDefault();
      radius = Math.max(40, Math.min(3000, radius * (1 + Math.sign(event.deltaY) * 0.1)));
      applyCamera();
      schedule();
    };

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

        const bloodPool = new Set(
          pack.meshes.structures.filter((s) => s.blood_pool).map((s) => s.id),
        );

        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          byStructure.set(object.name, object);
          const named = PALETTE[object.name];
          const isPool = bloodPool.has(object.name);
          object.material = new THREE.MeshStandardMaterial({
            // Blood pool reads as lumen, not tissue: translucent and cool, so a
            // cast-shaped pack cannot be mistaken for a wall-shaped one.
            color: isPool ? 0x8fbcd8 : (named ?? 0x8a8f96),
            roughness: 0.55,
            metalness: 0.05,
            transparent: isPool || named === undefined,
            opacity: isPool ? 0.45 : named === undefined ? 0.85 : 1,
          });
        });
        scene.add(gltf.scene);

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const centre = box.getCenter(new THREE.Vector3());
        // `C` is interaction.pivot when supplied, else the model-bounds centroid.
        pivot = pack.interaction?.pivot
          ? new THREE.Vector3(...(pack.interaction.pivot as [number, number, number]))
          : centre;
        radius = box.getSize(new THREE.Vector3()).length() * 1.15;

        const view = pack.views[viewIndex];
        if (view) {
          wedge = new ProbeWedge(frameAt(view.probe, view.sweep, scrubRef.current));
          scene.add(wedge.object);
        }

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
        wedge?.update(frame);
        schedule();
      },
      setHidden: (next) => {
        for (const [id, object] of byStructure) object.visible = !next.has(id);
        schedule();
      },
    };

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
      wedge?.dispose();
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
    };
  }, [gltfUrl, pack, viewIndex]);

  // The wedge follows the scrubber: same frame the echo renders, by construction.
  useEffect(() => {
    const view = pack.views[viewIndex];
    if (!view) return;
    apiRef.current?.setFrame(frameAt(view.probe, view.sweep, scrub));
  }, [scrub, pack, viewIndex, status]);

  useEffect(() => {
    apiRef.current?.setHidden(hidden ?? new Set());
  }, [hidden, status]);

  return (
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
          The 3D anatomy view needs WebGL, which this browser did not provide. The rest of the page
          still works.
        </p>
      )}
    </div>
  );
}
