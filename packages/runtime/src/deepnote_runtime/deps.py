"""Dependency checking and installation for .deepnote files.

Reads the environment.packages section and ensures all listed
packages are importable, installing missing ones via pip.
"""

from __future__ import annotations

import importlib
import subprocess
import sys
from typing import Any

# Map PyPI package names to their Python import names when they differ
_IMPORT_NAME_MAP: dict[str, str] = {
    "scikit-learn": "sklearn",
    "pillow": "PIL",
    "pyyaml": "yaml",
    "python-dateutil": "dateutil",
    "beautifulsoup4": "bs4",
    "google-cloud-bigquery": "google.cloud.bigquery",
    "google-cloud-core": "google.cloud",
    "google-auth": "google.auth",
    "pyopenssl": "OpenSSL",
    "pymysql": "pymysql",
    "psycopg2-binary": "psycopg2",
    "ipython": "IPython",
    "ipykernel": "ipykernel",
    "jupyter-core": "jupyter_core",
    "jupyter-server": "jupyter_server",
    "snowflake-connector-python": "snowflake.connector",
    "snowflake-sqlalchemy": "snowflake.sqlalchemy",
    "sqlalchemy-bigquery": "sqlalchemy_bigquery",
    "vl-convert-python": "vl_convert",
    "deepnote-toolkit": "deepnote_toolkit",
}

# Packages that should not be installed (internal, meta, or system-only)
_SKIP_PACKAGES: frozenset[str] = frozenset({
    "deepnote-toolkit",
    "deepnote-python-lsp-server",
    "deepnote_vegafusion",
    "deepnote-sqlalchemy-redshift",
})


def _import_name(package_name: str) -> str:
    """Get the Python import name for a PyPI package."""
    if package_name in _IMPORT_NAME_MAP:
        return _IMPORT_NAME_MAP[package_name]
    # Default: replace hyphens with underscores
    return package_name.replace("-", "_")


def check_missing(packages: dict[str, str]) -> list[str]:
    """Return list of PyPI package names that are not importable."""
    missing = []
    for pkg_name in packages:
        if pkg_name in _SKIP_PACKAGES:
            continue
        import_name = _import_name(pkg_name)
        # Try just the top-level module
        top_module = import_name.split(".")[0]
        try:
            importlib.import_module(top_module)
        except ImportError:
            missing.append(pkg_name)
    return missing


def install_packages(packages: list[str]) -> tuple[bool, str]:
    """Install packages via pip. Returns (success, output)."""
    if not packages:
        return True, ""
    cmd = [sys.executable, "-m", "pip", "install", "--quiet"] + packages
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    output = result.stdout + result.stderr
    return result.returncode == 0, output


_checked_envs: set[str] = set()


def ensure_dependencies(environment: dict[str, Any] | None) -> tuple[bool, str]:
    """Check and install missing dependencies from a .deepnote environment spec.

    Returns (all_ok, message). Caches by package set so each env is only checked once.
    """
    if not environment:
        return True, ""

    packages = environment.get("packages", {})
    if not packages:
        return True, ""

    # Cache: skip re-checking the same package set
    cache_key = frozenset(packages.keys())
    if cache_key in _checked_envs:
        return True, ""

    missing = check_missing(packages)
    if not missing:
        _checked_envs.add(cache_key)
        return True, ""

    ok, output = install_packages(missing)
    if ok:
        _checked_envs.add(cache_key)
        return True, f"Installed {len(missing)} packages: {', '.join(missing)}"
    else:
        return False, f"Failed to install packages: {output}"
