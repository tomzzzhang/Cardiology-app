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
 *
 * The second honesty requirement is newer and points the other way. The learner
 * can unlock the probe and turn it off this view's saved sweep track, and this
 * panel keeps rendering — but the moment the pose has actually left the track it
 * stops CLAIMING to be the view: the name goes, the draft flag goes, and the
 * provenance line says the plane is unvetted. Rendering an arbitrary plane under
 * a vetted view's name is the failure the pack's refusal to author A3 and A4
 * exists to avoid, and it stays forbidden.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pack, ProbePose } from '../schema/packV0.ts';
import { describePack, resolveTuning } from './acoustics.ts';
import { DEFAULT_POLAR, EchoRenderer, EchoRendererError, fetchVolume } from './EchoRenderer.ts';
import { frameAt, imagingFrame, withApexFlip } from './probeFrame.ts';

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
  /**
   * The probe, when the learner has unlocked it from the view's sweep track.
   *
   * The image still renders — seeing what a plane images is the whole point of
   * being able to move it — but the panel stops CLAIMING to be the saved view
   * while it is set. Rendering an arbitrary plane under a vetted view's name is
   * the one thing this must not do.
   */
  freePose?: ProbePose | null;
  /**
   * UI-6: show the apex the other way up.
   *
   * The PANEL only. The pack's authored `display.vertex` remains the default
   * and this layers on top of it. Owned by the shell rather than by this
   * component because "Match echo" has to orient the 3D camera to what the
   * panel is actually SHOWING, and that is the one place both are known.
   */
  apexFlipped?: boolean;
  onApexFlip?: (flipped: boolean) => void;
  /**
   * Whether that free pose has ACTUALLY left the view's track.
   *
   * Separate from `freePose` being set, because a learner can unlock the probe
   * and never drag it — and while the pose is still the view's pose, withdrawing
   * the view's name would be retracting a claim that is still true. Computed by
   * the shell, which is the only place that holds both the free pose and the
   * pose the sweep would have produced.
   */
  offTrack?: boolean;
  onScrubChange: (scrub: number) => void;
}

/**
 * `?polar=` — scale the renderer's internal polar working resolution.
 *
 * A developer control, like `?freeze=1`, and it exists for one measurement:
 * the PSF's coherent pass normalises by `sqrt(sum(w^2))`, which makes
 * INDEPENDENT scatterers resolution-invariant, while a specular boundary return
 * is correlated across the kernel and so is not. Whether that matters can only
 * be settled by rendering the same view at different sampling and comparing, and
 * a claim about resolution invariance that cannot be measured is a claim nobody
 * will check. See `tests/perf/echo-fill.mjs` and `docs/observations.md`.
 *
 * Clamped, because the polar targets are allocated from it: a typo should not
 * ask the driver for a 40k-wide render target.
 */
function polarScale(): number {
  if (typeof window === 'undefined') return 1;
  const raw = new URLSearchParams(window.location.search).get('polar');
  if (raw === null) return 1;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.min(4, Math.max(0.25, value)) : 1;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'unavailable'; message: string };

export default function EchoPanel({
  pack, volumeUrl, viewIndex = 0, scrub, freePose = null, offTrack = false, onScrubChange,
  apexFlipped = false, onApexFlip,
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
        const scale = polarScale();
        if (scale !== 1) {
          renderer.setPolarResolution({
            scanlines: Math.round(DEFAULT_POLAR.scanlines * scale),
            samples: Math.round(DEFAULT_POLAR.samples * scale),
          });
        }
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
      renderer.render(
        withApexFlip(
          freePose ? imagingFrame(freePose) : frameAt(view.probe, view.sweep, scrub),
          apexFlipped,
        ),
        tuning,
      );
      canvas.dataset.echoFrame = String(Number(canvas.dataset.echoFrame ?? '0') + 1);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scrub, status, tuning, view, freePose, apexFlipped]);

  if (!view) return null;

  const sweep = view.sweep;
  const sweepValue = sweep
    ? sweep.range.from + (sweep.range.to - sweep.range.from) * scrub
    : null;

  return (
    <section className="echo" data-testid="echo-panel" data-status={status.kind}>
      <header className="echo__header">
        {/*
          * The name is the view's CLAIM, so it is withdrawn the moment the
          * probe leaves the saved track. The image still renders — the point of
          * being able to move the probe is to see what the plane images — but
          * it is no longer this view, and saying so is what makes unlocking the
          * probe defensible at all.
          */}
        <h2 data-testid="echo-view-name">
          {offTrack ? 'Free probe — not a saved view' : view.name}
        </h2>
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

      {/*
        * UI-6, and it is the PANEL that flips.
        *
        * The pack's authored `display.vertex` is the default and stays it; this
        * is a preference laid over it, and pressing it twice is the authored
        * value back exactly. The 3D camera does not move: flipping the scene is
        * more disorienting than helpful, and "Match echo" is the control that
        * reconciles the two panels when a learner wants them to agree.
        */}
      {onApexFlip && (
        <div className="echo__display">
          <button
            type="button"
            className={apexFlipped ? 'echo__flip echo__flip--on' : 'echo__flip'}
            aria-pressed={apexFlipped}
            onClick={() => onApexFlip(!apexFlipped)}
            data-testid="apex-flip"
            title="Show the apex the other way up. The panel only — the model does not move."
          >
            Flip apex
          </button>
          <span className="echo__display-note">
            {apexFlipped
              ? 'flipped — the pack authors the other way up'
              : 'as the pack authored it'}
          </span>
        </div>
      )}

      {sweep && (
        <div className="echo__scrub">
          <label htmlFor="echo-scrub">
            {freePose
              ? `Sweep (${sweep.mode}) — the probe is off this track`
              : `Sweep (${sweep.mode}) ${sweepValue?.toFixed(1)} ${sweep.range.unit}`}
          </label>
          <input
            id="echo-scrub"
            data-testid="echo-scrub"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={scrub}
            // The sweep does not drive a probe that has left its track. Disabled
            // rather than removed, so the control stays where the learner left
            // it and its state says why it does nothing.
            disabled={freePose !== null}
            onChange={(event) => onScrubChange(Number(event.target.value))}
          />
        </div>
      )}

      <footer className="echo__provenance" data-testid="echo-provenance">
        {/*
          * Provenance is a statement about THIS image. A free pose has none —
          * no one reviewed it, because no one authored it — so the draft flag
          * is replaced rather than carried over onto a plane it was never
          * granted to. The pack's own attribution stays: the anatomy is still
          * the anatomy, whatever plane is cutting it.
          */}
        <span>
          {offTrack
            ? 'Unvetted plane — moved by you, not a reviewed view'
            : view.provenance.vetted.status === 'vetted' ? 'Vetted' : 'Draft — not vetted'}
        </span>
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
