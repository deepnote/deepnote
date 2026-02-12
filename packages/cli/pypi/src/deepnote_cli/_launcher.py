from __future__ import annotations

import os
import subprocess
import sys
from importlib.resources import files


def _binary_path() -> str:
    executable = "deepnote.exe" if os.name == "nt" else "deepnote"
    path = files("deepnote_cli").joinpath("bin", executable)

    if not path.is_file():
        raise FileNotFoundError(
            f"Bundled executable not found at {path}. "
            "This wheel may be incomplete or built incorrectly."
        )

    # Ensure executable bit is set on POSIX systems.
    if os.name != "nt":
        path_str = str(path)
        if not os.access(path_str, os.X_OK):
            current_mode = os.stat(path_str).st_mode
            os.chmod(path_str, current_mode | 0o111)

    return str(path)


def main() -> int:
    binary = _binary_path()
    argv = [binary, *sys.argv[1:]]

    if os.name == "nt":
        completed = subprocess.run(argv, check=False)
        return completed.returncode

    os.execv(binary, argv)
    return 0
