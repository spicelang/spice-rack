#!/usr/bin/env python3
"""
Installs the Spice packages of Spice Rack (src/spice.toml) to src/spice_packages, as recorded in src/spice.lock.

Spice Shaker is not available as a prebuilt binary, so this script does what `spice-shaker sync` does for the packages in
the lock file: it downloads registry and GitHub packages in their locked version or commit, unpacks them and verifies
their checksums. Packages that are already installed are left alone. It is a copy of bootstrap.py of Spice Shaker
(https://github.com/spicelang/spice-shaker); keep the two in sync.

To add or bump a package, edit src/spice.toml and regenerate src/spice.lock with Spice Shaker
(`cd src && spice-shaker update`), then run this script.

Usage: python3 scripts/install-packages.py [--force]   (--force reinstalls every package)
Needs Python 3.11 or newer. Honors SPICE_RACK_URL like Spice Shaker does.
"""

import hashlib
import io
import json
import os
import shutil
import sys
import tarfile
import tomllib
import urllib.parse
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent / "src"  # Directory of spice.toml
LOCK_FILE = ROOT_DIR / "spice.lock"
PACKAGES_DIR = ROOT_DIR / "spice_packages"
REGISTRY_URL = os.environ.get("SPICE_RACK_URL", "").rstrip("/") or "https://rack.spicelang.com"
CHECKSUM_PREFIX = "sha256-tree:"
USER_AGENT = "spice-rack-install-packages"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def archive_url_and_subdir(package: dict) -> tuple[str, str]:
    """URL of the archive of a locked package and the directory of the package inside it ('' for the root)"""
    name = package["name"]
    source = package["source"]
    if source == "registry":
        quoted_name = urllib.parse.quote(name, safe="")
        details = json.loads(fetch(f"{REGISTRY_URL}/api/v1/packages/{quoted_name}"))
        subdir = details["package"].get("path") or ""
        version = urllib.parse.quote(package["version"], safe="")
        return f"{REGISTRY_URL}/api/v1/packages/{quoted_name}/versions/{version}/download", subdir
    if source.startswith("github:"):
        return f"https://codeload.github.com/{source[len('github:'):]}/tar.gz/{package['commit']}", ""
    raise RuntimeError(f"{name} has a {source} source, which this script cannot install. Use spice-shaker sync.")


def unpack(archive: bytes, subdir: str, target: Path) -> None:
    """Unpack the regular files below the top-level folder (or below `subdir` in it) of a .tar.gz archive into `target`"""
    prefix = subdir.strip("/") + "/" if subdir else ""
    found = False
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue  # Directories are created as needed, links are left out like in the checksum
            parts = member.name.split("/", 1)
            if len(parts) != 2 or not parts[1].startswith(prefix):
                continue
            relative = parts[1][len(prefix):]
            if not relative or relative.startswith("/") or ".." in relative.split("/"):
                continue
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as source, open(destination, "wb") as file:
                shutil.copyfileobj(source, file)
            if member.mode & 0o111:
                destination.chmod(0o755)
            found = True
    if not found:
        raise RuntimeError(f"The archive has no files in {subdir or 'its top-level folder'}")


def tree_checksum(root: Path) -> str:
    """Checksum of a file tree as defined in media/manifest-spec.md of Spice Shaker"""
    files = sorted(
        (path.relative_to(root).as_posix().encode() for path in root.rglob("*") if path.is_file() and not path.is_symlink())
    )
    listing = b"".join(hashlib.sha256((root / file.decode()).read_bytes()).hexdigest().encode() + b"  " + file + b"\n"
                       for file in files)
    return CHECKSUM_PREFIX + hashlib.sha256(listing).hexdigest()


def install(package: dict, force: bool) -> None:
    name = package["name"]
    target = PACKAGES_DIR / name
    label = f"{name}@{package.get('version', '')}"
    if target.exists() and not force:
        print(f"  = {label}", flush=True)
        return
    url, subdir = archive_url_and_subdir(package)
    archive = fetch(url)
    shutil.rmtree(target, ignore_errors=True)
    try:
        unpack(archive, subdir, target)
        checksum = tree_checksum(target)
        if checksum != package.get("checksum"):
            raise RuntimeError(f"Checksum mismatch for {label}: expected {package.get('checksum')}, got {checksum}")
    except BaseException:
        shutil.rmtree(target, ignore_errors=True)
        raise
    print(f"  + {label}", flush=True)


def main(force: bool = False) -> int:
    lock = tomllib.loads(LOCK_FILE.read_text(encoding="utf-8"))
    if lock.get("version") != 1:
        print(f"error: {LOCK_FILE} has an unsupported version", file=sys.stderr)
        return 1
    PACKAGES_DIR.mkdir(exist_ok=True)
    try:
        for package in lock.get("package", []):
            install(package, force)
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main("--force" in sys.argv[1:]))
