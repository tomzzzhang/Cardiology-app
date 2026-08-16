/**
 * Wave 0 hello-world viewer.
 *
 * This is a build-and-deploy smoke test, NOT viewer-core. It proves that
 * three.js renders through the React shell on the deployed Pages site.
 *
 * The real viewer — orbit/pan/zoom around the interaction pivot `C`, explicit
 * target selection, the infinite radial free cutter `{N, s}` with stencil caps,
 * plane-normal depth control, touch controls, and the copy-only
 * "Align free cut to echo view" bridge — is wave 1c, specified in
 * `contracts/viewer-core.md`. None of it is implemented or stubbed here.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/** `?freeze=1` stops the animation so visual-regression screenshots are stable. */
function prefersStaticFrame(): boolean {
  if (typeof window === 'undefined') return true;
  if (new URLSearchParams(window.location.search).get('freeze') === '1') return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export default function HelloViewer() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1117);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(2.6, 1.8, 3.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: 0xb85a56, roughness: 0.75, metalness: 0.05 }),
      ),
    );
    group.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.001, 1)),
        new THREE.LineBasicMaterial({ color: 0xf0d9d7 }),
      ),
    );
    scene.add(group);

    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x202028, 1.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const isStatic = prefersStaticFrame();
    let frame = 0;
    if (isStatic) {
      group.rotation.set(0.35, 0.6, 0);
      renderer.render(scene, camera);
    } else {
      let previous = performance.now();
      const tick = (now: number) => {
        group.rotation.y += ((now - previous) / 1000) * 0.5;
        group.rotation.x = 0.25;
        previous = now;
        renderer.render(scene, camera);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    host.dataset.viewerReady = 'true';

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      delete host.dataset.viewerReady;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="viewer" ref={hostRef} data-testid="viewer" role="img" aria-label="Hello-world three.js scene" />;
}
