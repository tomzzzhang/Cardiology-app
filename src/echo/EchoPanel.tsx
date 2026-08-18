/**
 * The echo panel — the wave 1b surface.
 *
 * Renders the simulated echo for a pack's selected view, and scrubs its sweep.
 * The scrub control here is the minimum needed to drive a sweep end to end; the
 * real view-family rail and scrubber are wave 1d
 * (`contracts/view-rail-sweep-scrubber.md`), and this is not a stand-in for
 * their interaction design.
 *
 * Honesty requirement, from `contracts/echo-renderer.md`: every simulated frame
 * is labelled simulated, with provenance one tap away. The label is rendered
 * unconditionally alongside the canvas and is not behind a prop.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pack } from '../schema/packV0.ts';
import { describePack, resolveTuning } from './acoustics.ts';
import { EchoRenderer, EchoRendererError, fetchVolume } from './EchoRenderer.ts';
import { frameAt } from './probeFrame.ts';

interface EchoPanelProps {
  pack: Pack;
  /** URL of the pack's `echo_volume.asset`, already resolved by the loader. */
  volumeUrl: string;
  viewIndex?: number;
  /**
   * Scrub position, 0..1, owned by the caller.
   *
   * Lifted out of this component on purpose: the wedge in the 3D scene and the
   * echo image must be the same sweep position, and the only way to guarantee
   * that is for one value to drive both. Two components each holding their own
   * scrub state is precisely the drift the one-to-one match forbids.
   */
  scrub: number;
  onScrubChange: (scrub: number) => void;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'unavailable'; message: string };

export default function EchoPanel({
  pack, volumeUrl, viewIndex = 0, scrub, onScrubChange,
}: EchoPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<EchoRenderer | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  const view = pack.views[viewIndex];
  const descriptor = useMemo(() => describePack(pack), [pack]);
  const tuning = useMemo(() => resolveTuning(view?.echo_tuning), [view]);

  // Set up the renderer and upload the volume once per pack.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;

    const controller = new AbortController();
    let renderer: EchoRenderer | null = null;
    setStatus({ kind: 'loading' });

    (async () => {
      try {
        renderer = new EchoRenderer(canvas);
        const voxels = await fetchVolume(volumeUrl, { signal: controller.signal });
        if (controller.signal.aborted) return;
        renderer.setVolume(descriptor, voxels);
        rendererRef.current = renderer;
        setStatus({ kind: 'ready' });
      } catch (cause) {
        if (controller.signal.aborted) return;
        // WebGL2 or float targets may be missing — a hospital desktop with
        // acceleration disabled is a first-class target. Report and stay mounted;
        // the disclaimer and provenance must not disappear with the image.
        renderer?.dispose();
        rendererRef.current = null;
        setStatus({
          kind: 'unavailable',
          message: cause instanceof EchoRendererError ? cause.message : String(cause),
        });
      }
    })();

    return () => {
      controller.abort();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [descriptor, volumeUrl, view]);

  /*
   * Redraw on scrub, on pose change, and on resize.
   *
   * The resize half is not optional: the canvas is laid out by CSS, so at first
   * paint its backing store is still the 300x150 default and a one-shot measure
   * inside the render effect captures that. A ResizeObserver is the only thing
   * that reliably fires once the element actually has a box.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status.kind !== 'ready' || !view) return;

    const draw = () => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      if (width === 0 || height === 0) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.render(frameAt(view.probe, view.sweep, scrub), tuning);
      canvas.dataset.echoFrame = String(Number(canvas.dataset.echoFrame ?? '0') + 1);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scrub, status, tuning, view]);

  if (!view) return null;

  const sweep = view.sweep;
  const sweepValue = sweep
    ? sweep.range.from + (sweep.range.to - sweep.range.from) * scrub
    : null;

  return (
    <section className="echo" data-testid="echo-panel" data-status={status.kind}>
      <header className="echo__header">
        <h2>{view.name}</h2>
        <p className="echo__badge" data-testid="echo-simulated">
          Simulated — not a recording of a patient
        </p>
      </header>

      <div className="echo__stage">
        <canvas
          ref={canvasRef}
          className="echo__canvas"
          data-testid="echo-canvas"
          role="img"
          aria-label={`Simulated echocardiogram, ${view.name}`}
        />
        {status.kind === 'unavailable' && (
          <p className="echo__message" data-testid="echo-unavailable">
            The simulated echo needs WebGL2 with float render targets, which this browser did not
            provide. Everything else on this page still works.
            <br />
            <small>{status.message}</small>
          </p>
        )}
      </div>

      {sweep && (
        <div className="echo__scrub">
          <label htmlFor="echo-scrub">
            Sweep ({sweep.mode}) {sweepValue?.toFixed(1)} {sweep.range.unit}
          </label>
          <input
            id="echo-scrub"
            data-testid="echo-scrub"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={scrub}
            onChange={(event) => onScrubChange(Number(event.target.value))}
          />
        </div>
      )}

      <footer className="echo__provenance" data-testid="echo-provenance">
        <span>{view.provenance.vetted.status === 'vetted' ? 'Vetted' : 'Draft — not vetted'}</span>
        {' · '}
        <span>{pack.provenance.creator}</span>
        {' · '}
        <a href={pack.provenance.license_url} rel="noreferrer noopener">
          {pack.provenance.license}
        </a>
      </footer>
    </section>
  );
}
