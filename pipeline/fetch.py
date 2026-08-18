"""
Checksum-verified acquisition of raw source assets.

Raw sources are 20-190 MB and are never committed (`.gitignore`). They are
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
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tarfile
import urllib.request
import zipfile
from pathlib import Path

from sources import SOURCES, Source

CACHE = Path(__file__).resolve().parent / ".cache"
SKETCHFAB_API = "https://api.sketchfab.com/v3/models/{uid}/download"


def md5_of(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _download(url: str, destination: Path, headers: dict[str, str] | None = None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=900) as response, destination.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="all", choices=[*SOURCES, "all"])
    args = parser.parse_args()
    for key in (list(SOURCES) if args.source == "all" else [args.source]):
        print(f"{key}: {acquire(SOURCES[key])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
