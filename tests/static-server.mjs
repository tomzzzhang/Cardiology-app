/**
 * Serve `dist/` the way GitHub Pages serves it, for the visual suite.
 *
 *   node tests/static-server.mjs [port]
 *
 * This replaces `vite preview`, which is NOT a faithful stand-in for the
 * deployed artefact: preview serves the project's `publicDir` alongside the
 * build output, so files that the build deliberately excluded are still
 * reachable over HTTP. That difference is not cosmetic here — unpublished packs
 * are licence-blocked and removed from `dist/` at build time, and under preview
 * they were still being served, so a suite asserting they are unreachable
 * passed against a server that was serving them.
 *
 * Pages serves static files only: a path that does not exist 404s rather than
 * falling back to `index.html`. That is reproduced, including the `404.html`
 * body the deploy workflow copies in, so a mistyped URL behaves here as it will
 * in production.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const root = resolve('dist');
const basePath = (() => {
  const raw = process.env.BASE_PATH?.trim() || '/';
  const leading = raw.startsWith('/') ? raw : `/${raw}`;
  return leading.endsWith('/') ? leading : `${leading}/`;
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.raw': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer((request, response) => {
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);

  if (basePath !== '/' && requested !== basePath.slice(0, -1) && !requested.startsWith(basePath)) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  const mounted = basePath === '/'
    ? requested
    : requested === basePath.slice(0, -1)
      ? '/'
      : `/${requested.slice(basePath.length)}`;

  // Resolve inside the root, then verify: a normalized path can still escape
  // via `..`, and this server is handed URLs by tests that deliberately probe
  // for files that should not exist.
  const candidate = resolve(join(root, normalize(mounted)));
  if (!candidate.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  let target = candidate;
  if (existsSync(target) && statSync(target).isDirectory()) {
    target = join(target, 'index.html');
  }

  if (!existsSync(target) || !statSync(target).isFile()) {
    const fallback = join(root, '404.html');
    if (existsSync(fallback)) {
      response.writeHead(404, { 'content-type': TYPES['.html'] });
      createReadStream(fallback).pipe(response);
    } else {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
    return;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    'content-length': statSync(target).size,
  });
  createReadStream(target).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`serving dist/ at http://127.0.0.1:${port}${basePath}`);
});
