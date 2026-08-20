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
import { useEffect, useMemo, useState } from 'react';
import PackViewer, { type ViewerMode } from './viewer/PackViewer.tsx';
import EchoPanel from './echo/EchoPanel.tsx';
import type { ProbePose } from './schema/packV0.ts';
import { poseAt } from './echo/probeFrame.ts';
import { hasLeftTrack } from './viewer/freeProbe.ts';
import { AUTHORING_ENABLED } from './authoring/flag.ts';
import { loadPackById, PackLoadError, resolveAsset, type LoadedPack } from './packs/loadPack.ts';
import {
  DEFAULT_PACK_ID,
  LICENSE_STATE_LABEL,
  cataloguedPacks,
  isPublishedPack,
  type CatalogueEntry,
} from './packs/published.ts';
import { SCHEMA_VERSION, isExploreOnly, type Pack } from './schema/packV0.ts';
import {
  SHOW_ALL,
  buildTree,
  filterTree,
  hide,
  isEverythingVisible,
  isolate,
  show,
  showAll,
  structureCount,
  visibleIds,
  walk,
  type StructureNode,
  type Visibility,
} from './viewer/visibility.ts';

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
  /**
   * Which pack is on screen.
   *
   * State rather than a page reload: the viewer's scene effect already keys on
   * the pack and its glTF URL, so switching rebuilds the scene and nothing
   * else. `?pack=` is still the deep link, and is kept in step below.
   */
  const [packId, setPackId] = useState<string>(requestedPackId);
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
  /*
   * AUTHORING keeps the pose across the mode switch, and only authoring does.
   * Five packs carry no views, so placing a probe on them happens in Explore —
   * which is the only mode they have — and dropping the pose on the way in
   * would throw away the thing the author just placed. Folded out with the flag
   * off, so the learner rule above stands unchanged.
   */
  useEffect(() => {
    if (mode === 'explore' && !AUTHORING_ENABLED) setFreePose(null);
  }, [mode]);

  /*
   * The URL follows the EFFECTIVE mode, not the requested one. An Explore-only
   * pack refuses Echo, so leaving `?mode=echo` in the address bar would hand
   * out a link to a screen this pack cannot produce.
   */
  const shownMode: ViewerMode =
    packState.status === 'ok' && isExploreOnly(packState.loaded.pack) ? 'explore' : mode;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (shownMode === 'echo') url.searchParams.delete('mode');
    else url.searchParams.set('mode', shownMode);
    window.history.replaceState(null, '', url);
  }, [shownMode]);

  useEffect(() => {
    const controller = new AbortController();
    setPackState({ status: 'loading' });

    loadPackById(packId, { signal: controller.signal })
      .then((loaded) => setPackState({ status: 'ok', loaded }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPackState({
          status: 'error',
          message: error instanceof PackLoadError ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, [packId]);

  /*
   * The pack is written back into the URL the way the mode is, so the address
   * bar is a link to what is on screen. The default pack leaves no param, so a
   * plain link stays plain.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (packId === DEFAULT_PACK_ID) url.searchParams.delete('pack');
    else url.searchParams.set('pack', packId);
    window.history.replaceState(null, '', url);
  }, [packId]);

  /*
   * Per-structure visibility, owned here because the structure list and the
   * model are two views of ONE state — a row that says "hidden" while the mesh
   * is on screen is the same class of bug as the wedge and the echo disagreeing
   * about the probe.
   */
  const [visibility, setVisibility] = useState<Visibility>(SHOW_ALL);
  /*
   * UI-6: the apex toggle, held here because it flips the ECHO PANEL and
   * "Match echo" — which lives in the anatomy panel — has to orient to what the
   * echo panel is showing. This is the only place both are known.
   */
  const [apexFlipped, setApexFlipped] = useState(false);
  // A pack change resets it: the ids in an isolate belong to the old pack.
  useEffect(() => { setVisibility(SHOW_ALL); }, [packId]);

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Cardiology app</h1>
        <p className="shell__tagline">
          Anatomy and simulated echo from one vetted probe pose. Content-pack schema v
          {SCHEMA_VERSION} (provisional).
        </p>
      </header>

      <PackPicker packId={packId} onChoose={setPackId} />

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
        const effectiveMode: ViewerMode = shownMode;
        /*
         * Keyframe URLs are resolved here rather than in the viewer, because
         * resolving a pack-relative asset is the loader's business and
         * `resolveAsset` needs the LoadedPack the shell is holding.
         */
        const frameUrls = pack.meshes.keyframes?.frames.map((frame) =>
          resolveAsset(packState.loaded, frame.gltf));
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
        /*
         * The complement, computed once: viewer-core takes what is HIDDEN and
         * the list ticks what is VISIBLE, and deriving both from one function
         * is what stops them drifting apart.
         */
        /*
         * EXPLORE ONLY, and structurally rather than by hiding a button.
         *
         * Echo is a claim about one vetted probe pose imaging a whole heart:
         * the wedge, the beam dim and the echo raster are all statements about
         * what the beam crosses, and a learner who has isolated one coronary
         * branch would be looking at an echo of a heart that is not the heart
         * on screen. So in Echo nothing is hidden — `hiddenIds` is empty and no
         * click handler is passed, so the gesture does not exist there either.
         *
         * The state SURVIVES the trip: switching to Echo and back returns the
         * learner to what they had isolated, because the isolate was a
         * statement about the model rather than about the mode.
         */
        const roots = buildTree(pack);
        const visible = visibleIds(roots, visibility);
        const hiddenIds = effectiveMode === 'explore'
          ? new Set(
            pack.meshes.structures
              .filter((structure) => structure.mesh_node !== null && !visible.has(structure.id))
              .map((structure) => structure.id),
          )
          : new Set<string>();
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
            frameUrls={frameUrls}
            freePose={freePose}
            hidden={hiddenIds}
            apexFlipped={apexFlipped}
            isolatedLabel={effectiveMode === 'explore' && visibility.isolated !== null
              ? walk(roots).find((node) => node.id === visibility.isolated)?.label ?? null
              : null}
            onScrubChange={setScrub}
            onFreePoseChange={setFreePose}
            /*
             * A click on the model isolates what is under it; empty space shows
             * everything. Settled design decision 13 — the list is the index
             * and the model is the surface. Explore only: in Echo a click has
             * nothing to do, so no handler is passed and nothing is hit-tested
             * or pre-highlighted.
             */
            onStructureClick={effectiveMode === 'explore'
              ? (id) => setVisibility(id === null ? showAll() : isolate(visibility, id))
              : undefined}
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
              apexFlipped={apexFlipped}
              onApexFlip={setApexFlipped}
              onScrubChange={setScrub}
            />
          )}
        </div>

        {effectiveMode === 'explore' && (
          <StructurePanel pack={pack} visibility={visibility} onChange={setVisibility} />
        )}
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
              {/* Drawable structures. A group is a name over its children and
                  counting it here would say the pack has more anatomy in it
                  than it has. */}
              <dd>{structureCount(packState.loaded.pack)}</dd>
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

/**
 * The structure list, and ISOLATE as the gesture that makes 86 of them usable.
 *
 * Hiding converges only when there is one thing in the way — the KIT
 * pericardium is exactly that case. Showing one of 86 by hiding 85 never
 * converges at all, so "show me only this" is the primary action here and on
 * the model, and hide is the secondary one for the lid.
 *
 * The tree is the PACK's. This component reads `parent` and renders whatever it
 * finds, including nothing: a pack that declares no hierarchy gets a flat list,
 * which is every pack here but two. There is no anatomical vocabulary in this
 * file.
 */
function StructurePanel({ pack, visibility, onChange }: {
  pack: Pack;
  visibility: Visibility;
  onChange: (next: Visibility) => void;
}) {
  const [query, setQuery] = useState('');
  const roots = useMemo(() => buildTree(pack), [pack]);
  const shown = useMemo(() => filterTree(roots, query), [roots, query]);
  const visible = useMemo(() => visibleIds(roots, visibility), [roots, visibility]);
  const total = useMemo(
    () => walk(roots).filter((node) => !node.isGroup).length,
    [roots],
  );
  const matched = useMemo(
    () => walk(shown).filter((node) => !node.isGroup).length,
    [shown],
  );

  const isolatedLabel = visibility.isolated === null
    ? null
    : walk(roots).find((node) => node.id === visibility.isolated)?.label ?? null;

  const row = (node: StructureNode) => {
    const drawable = walk([node]).filter((child) => !child.isGroup);
    const onScreen = drawable.filter((child) => visible.has(child.id)).length;
    const isHidden = onScreen === 0;
    return (
      <li key={node.id} style={{ paddingInlineStart: `${node.depth * 0.9}rem` }}>
        <div className="structures__row" data-hidden={isHidden ? 'yes' : 'no'}>
          <button
            type="button"
            className={
              visibility.isolated === node.id
                ? 'structures__name structures__name--on'
                : 'structures__name'
            }
            onClick={() => onChange(isolate(visibility, node.id))}
            title={
              visibility.isolated === node.id
                ? 'Showing only this — click again for the whole model'
                : 'Show only this'
            }
            data-testid={`structure-isolate-${node.id}`}
          >
            {node.label}
            {node.isGroup && <span className="structures__count"> · {node.count}</span>}
            {node.blood_pool && <span className="structures__tag">lumen</span>}
            {!node.identified && <span className="structures__tag">unidentified</span>}
          </button>
          <button
            type="button"
            className="structures__eye"
            aria-pressed={isHidden}
            onClick={() => onChange(isHidden ? show(visibility, node.id) : hide(visibility, node.id))}
            title={isHidden ? 'Show' : 'Hide'}
            data-testid={`structure-hide-${node.id}`}
          >
            {isHidden ? 'Show' : 'Hide'}
          </button>
        </div>
        {node.children.length > 0 && <ul>{node.children.map(row)}</ul>}
      </li>
    );
  };

  return (
    <section className="panel structures" data-testid="structure-panel">
      <div className="structures__head">
        <h2>Structures</h2>
        <span className="structures__total" data-testid="structure-count">
          {query.trim() === '' ? `${total}` : `${matched} of ${total}`}
        </span>
        <button
          type="button"
          className="structures__all"
          disabled={isEverythingVisible(visibility)}
          onClick={() => onChange(showAll())}
          data-testid="structure-show-all"
        >
          Show all
        </button>
      </div>

      {/* The filter earns its place at 86 rows and costs nothing at two. */}
      <label className="structures__filter">
        <span className="visually-hidden">Filter structures</span>
        <input
          type="search"
          value={query}
          placeholder="Filter…"
          onChange={(event) => setQuery(event.target.value)}
          data-testid="structure-filter"
        />
      </label>

      {isolatedLabel !== null && (
        <p className="structures__isolated" data-testid="structure-isolated">
          Showing only <strong>{isolatedLabel}</strong>. Click it again, or empty space on the
          model, for the whole heart.
        </p>
      )}

      <ul className="structures__tree">{shown.map(row)}</ul>
      {shown.length === 0 && <p className="structures__empty">Nothing matches that.</p>}
    </section>
  );
}

/**
 * The model picker, as a DROPLIST.
 *
 * It was a wall of chips, and at nine packs it took about a third of the
 * viewport before the model was reached — `docs/observations.md` entry 28
 * predicted the threshold at ten and it arrived at nine. The structure list now
 * wants that space, and a control whose collapsed height is one row gives it
 * back regardless of how many packs are catalogued.
 *
 * A native `<select>` rather than a custom menu, for one reason that outranks
 * the styling: hospital desktops are a first-class target, and a native select
 * is keyboard-operable, screen-reader-labelled and touch-friendly on every
 * platform without any of that being re-implemented here. `<optgroup>` keeps the
 * two groups the chips had — labelled and echo-capable against Explore-only —
 * because that distinction decides which modes are even available.
 *
 * What a select cannot show is the per-pack detail the chips carried, so the
 * licence state, the publication state and the one-line summary of the SELECTED
 * pack are stated underneath it. Nothing on this shelf ships, and the one thing
 * worse than that would be not being able to tell which is which while looking
 * at them.
 */
function PackPicker({ packId, onChoose }: {
  packId: string;
  onChoose: (id: string) => void;
}) {
  const entries = cataloguedPacks(import.meta.env.PROD);
  if (entries.length === 0) return null;

  const current = entries.find((entry) => entry.id === packId);
  const groups: [string, string, CatalogueEntry[]][] = [
    ['echo', 'Labelled — echo and explore', entries.filter((entry) => entry.kind === 'echo')],
    ['explore', 'Geometry only — explore', entries.filter((entry) => entry.kind === 'explore')],
  ];

  /* The tags for whichever pack is showing, wherever it came from. */
  const detail = (entry: CatalogueEntry) => (
    <p className="picker__detail" data-testid={`pack-detail-${entry.id}`}>
      <span
        className={
          entry.licenseState === 'confirmed' ? 'picker__tag' : 'picker__tag picker__tag--warn'
        }
      >
        {LICENSE_STATE_LABEL[entry.licenseState]}
      </span>
      {!isPublishedPack(entry.id) && (
        <span
          className="picker__tag picker__tag--unpublished"
          data-testid={`pack-unpublished-${entry.id}`}
        >
          not published
        </span>
      )}
      {/* Only ever seen in development — the deployed droplist does not offer
          fixtures at all. Marked rather than merely absent, so nobody debugging
          mistakes it for anatomy. */}
      {entry.fixture && <span className="picker__tag picker__tag--warn">engine fixture</span>}
      {entry.moving && <span className="picker__tag">moves</span>}
      <span className="picker__summary">{entry.summary}</span>
    </p>
  );

  /*
   * ONE VISIBLE PACK IS A LABEL, NOT AN EMPTY CONTROL.
   *
   * This is the deployed state today: exactly one real pack ships, and a
   * droplist offering a single choice is a control that cannot do anything.
   * Rendering nothing at all would be worse — the learner would have no idea
   * which of the models in this repository they were looking at — so it says
   * which one, and says it in the same place the control will appear the moment
   * a second pack is published.
   */
  if (entries.length === 1) {
    return (
      <div className="picker" data-testid="pack-picker" data-picker="single">
        <p className="picker__single">
          <span className="picker__label">Model</span>
          <strong data-testid="pack-only">{entries[0].displayName}</strong>
        </p>
        {detail(entries[0])}
      </div>
    );
  }

  return (
    <div className="picker" data-testid="pack-picker" data-picker="list">
      <label className="picker__control">
        <span className="picker__label">Model</span>
        <select
          value={current ? packId : ''}
          onChange={(event) => onChoose(event.target.value)}
          data-testid="pack-select"
        >
          {/*
            * `?pack=` can name something the droplist does not offer — the
            * engine fixture is exactly that, published so the visual suite can
            * reach it in the production artefact and hidden from the picker so
            * it is not offered beside a heart. Showing an empty selection would
            * be the control lying about what is on screen, so the pack names
            * itself and cannot be chosen.
            */}
          {!current && <option value="" disabled>Not in this list — reached by ?pack=</option>}
          {groups.map(([key, heading, group]) => group.length === 0 ? null : (
            <optgroup label={heading} key={key} data-testid={`pack-group-${key}`}>
              {group.map((entry) => (
                <option key={entry.id} value={entry.id} data-testid={`pack-option-${entry.id}`}>
                  {entry.displayName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {current && detail(current)}
    </div>
  );
}
