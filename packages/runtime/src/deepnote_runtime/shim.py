"""Minimal IPython/Jupyter shim for library compatibility.

Many libraries (pandas, matplotlib, tqdm, plotly) check get_ipython()
to detect notebook environments. This module provides a minimal shim
that makes those checks pass without importing IPython.

Environment variables set:
    DEEPNOTE_RUNTIME=1
    JUPYTER_RUNTIME=1

The shim provides a minimal object whose class appears to be
ZMQInteractiveShell, which is what most libraries check for.
"""

from __future__ import annotations

import builtins
import os
from typing import Any


class _ShimConfig:
    """Minimal config object."""

    def __getattr__(self, name: str) -> Any:
        return _ShimConfig()

    def __bool__(self) -> bool:
        return False


class DeepnoteInteractiveShell:
    """Minimal IPython InteractiveShell shim.

    This is NOT a full IPython shell. It provides just enough interface
    for libraries that check `get_ipython()` to detect they're running
    in a notebook-like environment.

    Supported checks:
        - `get_ipython().__class__.__name__` == 'ZMQInteractiveShell'
        - `get_ipython().__class__.__module__` contains 'zmqshell'
        - hasattr(get_ipython(), 'kernel')
        - isinstance checks via __class__.__name__
    """

    # Make class name match what libraries expect
    __qualname__ = "ZMQInteractiveShell"

    def __init__(self) -> None:
        self.config = _ShimConfig()
        self.kernel = True  # Some libs check hasattr(shell, 'kernel')

    @property
    def __class_name__(self) -> str:
        return "ZMQInteractiveShell"

    def __repr__(self) -> str:
        return "<DeepnoteInteractiveShell (IPython shim)>"


# Override __name__ at the class level for isinstance-style checks
DeepnoteInteractiveShell.__name__ = "ZMQInteractiveShell"  # type: ignore[attr-defined]
DeepnoteInteractiveShell.__module__ = "ipykernel.zmqshell"  # type: ignore[attr-defined]

# Singleton
_shell_instance: DeepnoteInteractiveShell | None = None


def get_ipython() -> DeepnoteInteractiveShell:
    """Return the singleton shim shell instance."""
    global _shell_instance
    if _shell_instance is None:
        _shell_instance = DeepnoteInteractiveShell()
    return _shell_instance


def install_shim() -> None:
    """Install the get_ipython() shim into builtins and set env vars.

    After calling this:
        - `get_ipython()` is available globally (like in IPython/Jupyter)
        - `os.environ["DEEPNOTE_RUNTIME"]` == "1"
        - `os.environ["JUPYTER_RUNTIME"]` == "1"
    """
    os.environ["DEEPNOTE_RUNTIME"] = "1"
    os.environ["JUPYTER_RUNTIME"] = "1"
    builtins.get_ipython = get_ipython  # type: ignore[attr-defined]


def uninstall_shim() -> None:
    """Remove the shim. Useful for testing."""
    global _shell_instance
    _shell_instance = None
    os.environ.pop("DEEPNOTE_RUNTIME", None)
    os.environ.pop("JUPYTER_RUNTIME", None)
    if hasattr(builtins, "get_ipython"):
        delattr(builtins, "get_ipython")
