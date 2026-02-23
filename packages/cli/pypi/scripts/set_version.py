from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
CLI_PACKAGE_JSON = REPO_ROOT / "packages" / "cli" / "package.json"
INIT_FILE = REPO_ROOT / "packages" / "cli" / "pypi" / "src" / "deepnote_cli" / "__init__.py"


def main() -> None:
    package = json.loads(CLI_PACKAGE_JSON.read_text(encoding="utf-8"))
    version = package["version"]
    INIT_FILE.write_text(f'__version__ = "{version}"\n', encoding="utf-8")
    print(f"Set PyPI package version to {version}")


if __name__ == "__main__":
    main()
