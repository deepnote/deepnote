"""Tests for the IPython/Jupyter shim."""

import builtins
import os

import pytest

from deepnote_runtime.shim import (
    DeepnoteInteractiveShell,
    get_ipython,
    install_shim,
    uninstall_shim,
)


@pytest.fixture(autouse=True)
def cleanup_shim():
    """Ensure shim is cleaned up after each test."""
    yield
    uninstall_shim()


class TestDeepnoteInteractiveShell:
    def test_class_name(self):
        shell = DeepnoteInteractiveShell()
        assert shell.__class__.__name__ == "ZMQInteractiveShell"

    def test_class_module(self):
        shell = DeepnoteInteractiveShell()
        assert shell.__class__.__module__ == "ipykernel.zmqshell"

    def test_has_kernel_attr(self):
        shell = DeepnoteInteractiveShell()
        assert hasattr(shell, "kernel")
        assert shell.kernel

    def test_has_config(self):
        shell = DeepnoteInteractiveShell()
        assert hasattr(shell, "config")
        # Config should be falsy but not raise on attribute access
        assert not shell.config
        assert not shell.config.some_nested.deeply.nested_attr

    def test_repr(self):
        shell = DeepnoteInteractiveShell()
        assert "shim" in repr(shell).lower()


class TestGetIpython:
    def test_returns_shell(self):
        shell = get_ipython()
        assert isinstance(shell, DeepnoteInteractiveShell)

    def test_singleton(self):
        s1 = get_ipython()
        s2 = get_ipython()
        assert s1 is s2


class TestInstallShim:
    def test_sets_env_vars(self):
        install_shim()
        assert os.environ.get("DEEPNOTE_RUNTIME") == "1"
        assert os.environ.get("JUPYTER_RUNTIME") == "1"

    def test_installs_get_ipython_in_builtins(self):
        install_shim()
        assert hasattr(builtins, "get_ipython")
        shell = builtins.get_ipython()  # type: ignore
        assert shell.__class__.__name__ == "ZMQInteractiveShell"

    def test_uninstall_removes_env_vars(self):
        install_shim()
        uninstall_shim()
        assert "DEEPNOTE_RUNTIME" not in os.environ
        assert "JUPYTER_RUNTIME" not in os.environ

    def test_uninstall_removes_builtin(self):
        install_shim()
        uninstall_shim()
        assert not hasattr(builtins, "get_ipython")

    def test_library_detection_pattern(self):
        """Test the common pattern libraries use to detect Jupyter."""
        install_shim()
        # Pattern 1: check class name (used by pandas, matplotlib)
        shell = builtins.get_ipython()  # type: ignore
        assert shell.__class__.__name__ == "ZMQInteractiveShell"

        # Pattern 2: check if in IPython (used by tqdm)
        try:
            ip = builtins.get_ipython()  # type: ignore
            in_notebook = ip.__class__.__name__ == "ZMQInteractiveShell"
        except NameError:
            in_notebook = False
        assert in_notebook

    def test_env_var_detection_pattern(self):
        """Test environment variable detection."""
        install_shim()
        assert os.environ.get("JUPYTER_RUNTIME") == "1"
        assert os.environ.get("DEEPNOTE_RUNTIME") == "1"
