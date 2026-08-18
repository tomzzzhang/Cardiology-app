/**
 * Wave 0 app shell placeholder.
 *
 * Deliberately minimal: it renders the hello-world viewer and reports whether
 * the stub content pack loaded and validated against schema v0. The real shell
 * — URL-param deep links, responsive viewport + echo panel + view rail — is
 * specified in `contracts/app-shell.md` and built later.
 */
import { useEffect, useState } from 'react';
import PackViewer from './viewer/PackViewer.tsx';
import EchoPanel from './echo/EchoPanel.tsx';
import { loadPackById, PackLoadError, resolveAsset, type LoadedPack } from './packs/loadPack.ts';
import { SCHEMA_VERSION } from './schema/packV0.ts';

/**
 * Which pack the shell shows. `?pack=` exists so the visual suite can hold the
 * synthetic stub while the echo slice develops against the real one; the real
 * deep-link scheme (`?a=`/`?v=`/`?s=`) is `contracts/app-shell.md`, wave 2.
 */
function requestedPackId(): string {
  if (typeof window === 'undefined') return 'normal-rodero';
  return new URLSearchParams(window.location.search).get('pack') ?? 'normal-rodero';
}

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

      {packState.status === 'ok' && (
        <div className="stage">
          <PackViewer
            pack={packState.loaded.pack}
            gltfUrl={resolveAsset(packState.loaded, packState.loaded.pack.meshes.gltf)}
            scrub={scrub}
          />
          <EchoPanel
            pack={packState.loaded.pack}
            volumeUrl={resolveAsset(packState.loaded, packState.loaded.pack.echo_volume.asset)}
            scrub={scrub}
            onScrubChange={setScrub}
          />
        </div>
      )}

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
