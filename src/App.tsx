/**
 * The app shell: mode, layout, and the composition of the other modules.
 *
 * It composes and does not implement — viewer behaviour is viewer-core's, the
 * echo image is echo-renderer's — with two exceptions that are genuinely the
 * shell's, because they are the only place both panels can be seen at once:
 *
 * * **the scrub position**, so the wedge on the anatomy and the echo image are
 *   two renderings of ONE sweep position rather than two that agree;
 * * **the free probe pose**, for the same reason, plus the judgement of whether
 *   it has actually left the view's track — which needs both the free pose and
 *   the pose the sweep would have produced.
 *
 * The view rail, the pinned provenance strip and the full `?a=`/`?v=`/`?s=`
 * deep-link scheme are `contracts/app-shell.md`, wave 2.
 */
import { useEffect, useState } from 'react';
import PackViewer, { type ViewerMode } from './viewer/PackViewer.tsx';
import EchoPanel from './echo/EchoPanel.tsx';
import type { ProbePose } from './schema/packV0.ts';
import { poseAt } from './echo/probeFrame.ts';
import { hasLeftTrack } from './viewer/freeProbe.ts';
import { loadPackById, PackLoadError, resolveAsset, type LoadedPack } from './packs/loadPack.ts';
import { DEFAULT_PACK_ID } from './packs/published.ts';
import { SCHEMA_VERSION, isExploreOnly } from './schema/packV0.ts';

/**
 * Which pack the shell shows. `?pack=` exists so the visual suite can hold the
 * synthetic stub while the echo slice develops against the real one; the real
 * deep-link scheme (`?a=`/`?v=`/`?s=`) is `contracts/app-shell.md`, wave 2.
 */
function requestedPackId(): string {
  if (typeof window === 'undefined') return DEFAULT_PACK_ID;
  return new URLSearchParams(window.location.search).get('pack') ?? DEFAULT_PACK_ID;
}

/**
 * Which view the shell shows, as an index or a `view_id`.
 *
 * `?view=` exists for the same reason `?pack=` does: the content is in the pack
 * and there is no way to reach it yet. The view rail is
 * `contracts/view-rail-sweep-scrubber.md` and the real deep-link scheme
 * (`?a=`/`?v=`/`?s=`) is `contracts/app-shell.md`, both later — but a view
 * nobody can open is a view nobody can review, and every view in this pack is
 * draft and needs reviewing. Out of range falls back to the first view rather
 * than rendering nothing.
 */
function requestedViewIndex(pack: LoadedPack['pack']): number {
  if (typeof window === 'undefined') return 0;
  const requested = new URLSearchParams(window.location.search).get('view');
  if (requested === null) return 0;

  const byId = pack.views.findIndex((view) => view.view_id === requested);
  if (byId >= 0) return byId;

  const index = Number.parseInt(requested, 10);
  return Number.isInteger(index) && index >= 0 && index < pack.views.length ? index : 0;
}

/**
 * Which top-level mode the shell is in.
 *
 * **Echo** is the default with no param, so the open-link-to-an-oriented-view
 * path is unchanged for someone arriving cold. **Explore** drops the probe
 * entirely and leaves the learner a heart model to orbit, cut and inspect —
 * a first-class mode, not a tool: the app is a free heart-model explorer as
 * well as an echo trainer.
 *
 * It is a deep-link param so an Explore link is shareable, which is the whole
 * point of the params existing (`contracts/app-shell.md`, "Deep links").
 */
function requestedMode(): ViewerMode {
  if (typeof window === 'undefined') return 'echo';
  return new URLSearchParams(window.location.search).get('mode') === 'explore'
    ? 'explore'
    : 'echo';
}

/** Said on the disabled control and again in words beneath it. */
const EXPLORE_ONLY_REFUSAL =
  'This pack is EXPLORE-ONLY: geometry with no labelled echo volume, so there is nothing '
  + 'to image and Echo mode is unavailable for it.';

type PackState =
  | { status: 'loading' }
  | { status: 'ok'; loaded: LoadedPack }
  | { status: 'error'; message: string };

export default function App() {
  const [packState, setPackState] = useState<PackState>({ status: 'loading' });
  /*
   * One scrub position for the whole screen. The wedge drawn on the anatomy and
   * the echo image are two renderings of the SAME sweep position, so the value
   * lives here rather than inside either panel.
   */
  const [scrub, setScrub] = useState(0.5);
  const [mode, setMode] = useState<ViewerMode>(requestedMode);
  /**
   * The probe when it has been unlocked from its view's sweep track, or null.
   *
   * Lifted here for the same reason `scrub` is: the wedge on the anatomy and
   * the echo image are two renderings of ONE probe pose, and two components
   * each holding their own would be exactly the drift the one-to-one match
   * forbids.
   *
   * It is runtime state and dies with the session. There is no path from it
   * into `views[]` — see `src/viewer/freeProbe.ts` for what unlocking gives up
   * and what it does not.
   */
  const [freePose, setFreePose] = useState<ProbePose | null>(null);

  /*
   * The mode is written back into the URL as it changes, so the address bar is
   * always a link to what is on screen. `replaceState` rather than `pushState`:
   * a mode toggle is not a navigation, and filling the back button with it
   * would make Back mean something different here than everywhere else.
   */
  /*
   * Explore has no probe at all, so it cannot have a free one. Re-locking on
   * the way in means coming back to Echo lands on the saved view rather than on
   * whatever pose was left behind in another mode.
   */
  useEffect(() => {
    if (mode === 'explore') setFreePose(null);
  }, [mode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (mode === 'echo') url.searchParams.delete('mode');
    else url.searchParams.set('mode', mode);
    window.history.replaceState(null, '', url);
  }, [mode]);

  useEffect(() => {
    const controller = new AbortController();

    loadPackById(requestedPackId(), { signal: controller.signal })
      .then((loaded) => setPackState({ status: 'ok', loaded }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPackState({
          status: 'error',
          message: error instanceof PackLoadError ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Cardiology app</h1>
        <p className="shell__tagline">
          Anatomy and simulated echo from one vetted probe pose. Content-pack schema v
          {SCHEMA_VERSION} (provisional).
        </p>
      </header>

      {packState.status === 'ok' && (() => {
        const pack = packState.loaded.pack;
        const viewIndex = requestedViewIndex(pack);
        const view = pack.views[viewIndex];
        /*
         * An EXPLORE-ONLY pack has no echo to enter, so Echo mode is REFUSED
         * rather than entered and left blank — and the refusal is on screen
         * with its reason, because a mode button that is pressable and inert
         * is worse than one that is visibly unavailable.
         *
         * The refusal is enforced on the effective mode as well as on the
         * button, so `?mode=echo` on an Explore-only pack lands in Explore
         * instead of on a half-built screen.
         */
        const exploreOnly = isExploreOnly(pack);
        const effectiveMode: ViewerMode = exploreOnly ? 'explore' : mode;
        /*
         * Whether the probe has ACTUALLY left the track, not merely whether the
         * toggle is on. A learner can unlock the probe and never drag it, and
         * while the pose is still the view's pose the panel would be withdrawing
         * a claim that is still true. The distinction matters in the direction
         * that costs nothing: the moment they move it, the claim goes.
         */
        const offTrack = freePose !== null && view !== undefined
          && hasLeftTrack(freePose, view.sweep ? poseAt(view.probe, view.sweep, scrub) : view.probe);
        const echoVolume = pack.echo_volume;
        return (
        <>
        {/*
          * The two top-level modes, named and always visible.
          *
          * Explore is not a hidden power-user route: the app is a free
          * heart-model explorer as well as an echo trainer, and a mode nobody
          * can find is a mode nobody has.
          */}
        <div className="modes" role="radiogroup" aria-label="What this screen is" data-testid="viewer-mode">
          {([
            ['echo', 'Echo', 'Anatomy beside the simulated echo, on one vetted probe pose'],
            ['explore', 'Explore', 'The heart model on its own — orbit, cut and inspect. No probe.'],
          ] as [ViewerMode, string, string][]).map(([value, label, hint]) => {
            const refused = exploreOnly && value === 'echo';
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={effectiveMode === value}
                aria-disabled={refused}
                disabled={refused}
                className={
                  effectiveMode === value ? 'modes__button modes__button--on' : 'modes__button'
                }
                onClick={() => { if (!refused) setMode(value); }}
                title={refused ? EXPLORE_ONLY_REFUSAL : hint}
                data-testid={`mode-${value}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/*
          * The reason, in words, next to the control it disables.
          *
          * A greyed button says "not now"; it does not say why, and the why is
          * a property of the PACK rather than of anything the learner did.
          */}
        {exploreOnly && (
          <p className="modes__refusal" data-testid="echo-refusal">
            {EXPLORE_ONLY_REFUSAL}
          </p>
        )}

        <div className={effectiveMode === 'explore' ? 'stage stage--solo' : 'stage'}>
          <PackViewer
            pack={packState.loaded.pack}
            gltfUrl={resolveAsset(packState.loaded, packState.loaded.pack.meshes.gltf)}
            scrub={scrub}
            viewIndex={viewIndex}
            mode={effectiveMode}
            freePose={freePose}
            onScrubChange={setScrub}
            onFreePoseChange={setFreePose}
          />
          {/*
            * Explore has no echo panel, and therefore no probe, no probe
            * control pad, no beam-dim control and no "Match echo". The notice
            * in the footer stays in BOTH modes: it is not behind a toggle
            * (`contracts/app-shell.md` rule 4).
            */}
          {effectiveMode === 'echo' && echoVolume !== undefined && (
            <EchoPanel
              pack={packState.loaded.pack}
              volumeUrl={resolveAsset(packState.loaded, echoVolume.asset)}
              scrub={scrub}
              viewIndex={viewIndex}
              freePose={freePose}
              offTrack={offTrack}
              onScrubChange={setScrub}
            />
          )}
        </div>
        </>
        );
      })()}

      <section className="panel" data-testid="pack-status" data-status={packState.status}>
        <h2>Content pack</h2>
        {packState.status === 'loading' && <p>Loading…</p>}

        {packState.status === 'error' && (
          <pre className="panel__error" data-testid="pack-error">
            {packState.message}
          </pre>
        )}

        {packState.status === 'ok' && (
          <dl className="panel__facts">
            <div>
              <dt>Pack</dt>
              <dd>
                {packState.loaded.pack.meta.display_name} v{packState.loaded.pack.meta.pack_version}
              </dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>v{packState.loaded.pack.meta.schema_version} — validated</dd>
            </div>
            <div>
              <dt>Structures</dt>
              <dd>{packState.loaded.pack.meshes.structures.length}</dd>
            </div>
            <div>
              <dt>Views</dt>
              <dd>
                {packState.loaded.pack.views.length} (
                {packState.loaded.pack.views.filter((view) => view.sweep).length} with sweeps)
              </dd>
            </div>
            <div>
              <dt>Licence</dt>
              <dd>
                <a href={packState.loaded.pack.provenance.license_url} rel="noreferrer noopener">
                  {packState.loaded.pack.provenance.license}
                </a>
              </dd>
            </div>
            <div>
              <dt>Vetting</dt>
              <dd>{packState.loaded.pack.provenance.vetted.status}</dd>
            </div>
          </dl>
        )}
      </section>

      <footer className="shell__footer">
        Educational tool. Any echo imagery is <strong>simulated</strong>, not a recording of a
        patient, and is not for diagnostic use.
      </footer>
    </main>
  );
}
