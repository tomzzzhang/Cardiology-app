"""
Checksum-verified acquisition of raw source assets.

Raw sources are 1-200 MB and are never committed (`.gitignore`). They are
downloaded into `pipeline/.cache/`, verified, unpacked, and reused across runs.

    python pipeline/fetch.py --source rodero

Two different trust models apply, and the difference is deliberate:

* **Zenodo** publishes an immutable record. Its archive has a published md5,
  which is pinned in `sources.py` and checked on every fetch. A mismatch aborts.
* **Sketchfab** re-packs archives server-side, so their bytes are NOT stable and
  pinning a checksum would produce spurious failures rather than protection. The
  checksum of what was actually downloaded is recorded in
  `pipeline/.cache/checksums.json` so a run is reproducible after the fact, and
  the bundled `license.txt` is retained as the licence evidence.

The Sketchfab download API needs a personal token, read from `SKETCHFAB_API_TOKEN`.
The token is a credential: it is never written to the cache, never logged, and
never committed.

`acquire_files` is the multi-file path, used by the geometry-only sources: those
arrive as a set of time steps or as an archive of parts rather than as one
archive with one member. It applies the same two trust models per file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tarfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from sources import GEOMETRY_SOURCES, SOURCES, GeometrySource, RemoteFile, Source

CACHE = Path(__file__).resolve().parent / ".cache"
SKETCHFAB_API = "https://api.sketchfab.com/v3/models/{uid}/download"


def md5_of(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


#: Transient HTTP statuses worth another attempt. Zenodo returns 504 under load
#: for several seconds at a time, which is a slow host rather than a wrong URL.
RETRY_STATUSES = (429, 500, 502, 503, 504)


def _download(url: str, destination: Path, headers: dict[str, str] | None = None,
              attempts: int = 5) -> None:
    """
    Download to a `.part` file and rename on success.

    Writing straight to the destination would leave a truncated file behind on a
    dropped connection, and the next run would find it, treat it as cached, and
    fail the checksum instead of simply fetching it again. Retries are for
    transient server errors only: a 404 is a wrong URL and retrying it wastes
    time while looking like a network problem.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers=headers or {})

    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=900) as response, \
                    partial.open("wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            partial.replace(destination)
            return
        except urllib.error.HTTPError as error:
            partial.unlink(missing_ok=True)
            if error.code not in RETRY_STATUSES or attempt == attempts:
                raise
            delay = 2 ** attempt
            print(f"  HTTP {error.code} from the host; retrying in {delay}s "
                  f"({attempt}/{attempts - 1})")
            time.sleep(delay)
        except urllib.error.URLError:
            partial.unlink(missing_ok=True)
            if attempt == attempts:
                raise
            delay = 2 ** attempt
            print(f"  connection failed; retrying in {delay}s ({attempt}/{attempts - 1})")
            time.sleep(delay)


def _sketchfab_url(source: Source) -> str:
    token = os.environ.get("SKETCHFAB_API_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            f"{source.key}: SKETCHFAB_API_TOKEN is not set.\n"
            "Create a token at https://sketchfab.com/settings/password and export it:\n"
            "  export SKETCHFAB_API_TOKEN=...\n"
            "The token is a credential; do not commit it."
        )
    request = urllib.request.Request(
        SKETCHFAB_API.format(uid=source.sketchfab_uid),
        headers={"Authorization": f"Token {token}"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.load(response)
    entry = payload.get(source.sketchfab_format)
    if not entry or not entry.get("url"):
        raise SystemExit(f"{source.key}: Sketchfab offers no {source.sketchfab_format} download")
    return entry["url"]


def _record_checksum(source: Source, digest: str, size: int) -> None:
    ledger_path = CACHE / "checksums.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
    ledger[source.key] = {"md5": digest, "bytes": size}
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n")


def _fetch_one(cache_dir: Path, remote: RemoteFile, key: str) -> Path:
    """Download, verify and (where asked) unpack one file into the cache."""
    destination = cache_dir / remote.name
    if not destination.exists():
        print(f"{key}: downloading {remote.name}")
        _download(remote.url, destination)

    digest, size = md5_of(destination), destination.stat().st_size
    if remote.md5 is not None:
        if digest != remote.md5:
            destination.unlink()
            raise SystemExit(
                f"{key}/{remote.name}: checksum mismatch — expected {remote.md5}, got "
                f"{digest}. The cached file has been removed; re-run to fetch again."
            )
        if remote.size_bytes is not None and size != remote.size_bytes:
            raise SystemExit(
                f"{key}/{remote.name}: expected {remote.size_bytes} bytes, got {size}"
            )
    else:
        # No published checksum to check against. Recording what arrived is the
        # only reproducibility available, and saying so is better than implying
        # a verification that did not happen.
        print(f"{key}/{remote.name}: md5 {digest} ({size} bytes) recorded; no published checksum")

    ledger_path = CACHE / "checksums.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
    ledger[f"{key}/{remote.name}"] = {"md5": digest, "bytes": size}
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n")

    if remote.unpack:
        marker = cache_dir / f".unpacked-{remote.name}"
        if not marker.exists():
            with zipfile.ZipFile(destination) as archive:
                archive.extractall(cache_dir, members=_without_apple_junk(archive))
            marker.write_text(digest + "\n")
    return destination


def _without_apple_junk(archive: zipfile.ZipFile) -> list[str]:
    """
    Archive members minus macOS AppleDouble sidecars.

    A zip built on macOS carries a `__MACOSX/` tree and a `._name` sidecar for
    every file. They are not the data and they are not readable as it: extracted
    alongside the real files they match every glob the real files match, so the
    CobivecoX ingest tried to parse `._CHD0017001_av.ply` as a PLY and failed on
    its first byte. Dropped at unpack, where the fix is one place rather than in
    every reader.
    """
    return [
        name for name in archive.namelist()
        if not name.startswith("__MACOSX/")
        and not any(part.startswith("._") for part in name.split("/"))
    ]


def acquire(source: Source) -> Path:
    """
    Fetch, verify, and unpack one source. Returns the path to the file the
    pipeline reads. Cached results are reused and re-verified, not re-downloaded.
    """
    unpacked = CACHE / source.key
    target = unpacked / source.member
    if target.exists():
        return target

    suffix = ".tar.gz" if source.url and source.url.endswith(("tar.gz", "content")) else ".zip"
    archive = CACHE / f"{source.key}{suffix}"

    if not archive.exists():
        if source.url:
            print(f"{source.key}: downloading from {source.source_url}")
            _download(source.url, archive)
        else:
            print(f"{source.key}: resolving Sketchfab download for uid {source.sketchfab_uid}")
            _download(_sketchfab_url(source), archive)

    digest, size = md5_of(archive), archive.stat().st_size
    if source.md5 is not None:
        if digest != source.md5:
            archive.unlink()
            raise SystemExit(
                f"{source.key}: checksum mismatch — expected {source.md5}, got {digest}. "
                "The cached archive has been removed; re-run to fetch again."
            )
        if source.size_bytes is not None and size != source.size_bytes:
            raise SystemExit(f"{source.key}: expected {source.size_bytes} bytes, got {size}")
        print(f"{source.key}: md5 {digest} verified against the pinned checksum")
    else:
        print(f"{source.key}: md5 {digest} ({size} bytes) recorded; this source is not byte-stable")
    _record_checksum(source, digest, size)

    unpacked.mkdir(parents=True, exist_ok=True)
    if suffix == ".tar.gz":
        with tarfile.open(archive) as tar:
            tar.extractall(unpacked, filter="data")
    else:
        with zipfile.ZipFile(archive) as zip_file:
            zip_file.extractall(unpacked)
        # A Sketchfab "source" archive nests the creator's own upload.
        for nested in list(unpacked.rglob("*.zip")):
            with zipfile.ZipFile(nested) as inner:
                inner.extractall(nested.parent)

    if not target.exists():
        matches = list(unpacked.rglob(source.member))
        if not matches:
            raise SystemExit(f"{source.key}: {source.member} not found in the archive")
        target = matches[0]
    return target


def acquire_files(source: GeometrySource) -> Path:
    """
    Fetch every file a geometry-only source needs. Returns its cache directory.

    Nothing here reaches the repository: the cache is gitignored, and only the
    derived pack under `public/packs/` is ever committed.
    """
    cache_dir = CACHE / source.key
    cache_dir.mkdir(parents=True, exist_ok=True)
    for remote in source.files:
        _fetch_one(cache_dir, remote, source.key)
    return cache_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="all",
                        choices=[*SOURCES, *GEOMETRY_SOURCES, "all"])
    args = parser.parse_args()
    if args.source in GEOMETRY_SOURCES:
        print(f"{args.source}: {acquire_files(GEOMETRY_SOURCES[args.source])}")
        return 0
    for key in (list(SOURCES) if args.source == "all" else [args.source]):
        print(f"{key}: {acquire(SOURCES[key])}")
    if args.source == "all":
        for key, geometry in GEOMETRY_SOURCES.items():
            print(f"{key}: {acquire_files(geometry)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
