"""Persistent daemon for near-instant notebook execution.

Keeps Python warm in a background process. Accepts requests over a Unix
socket, executes notebooks, and returns JSON results. After the first
cold start (~200ms), subsequent executions take ~5-10ms.

Protocol (newline-delimited JSON over Unix socket):
    Request:  {"file": "/path/to.deepnote", "notebook": "name", "vars": {"k": "v"}}
    Response: {"success": bool, "blocks": [...], "duration_ms": float, "error": str|null}
"""

from __future__ import annotations

import json
import os
import signal
import socket
import sys
import threading
import time
import warnings
from pathlib import Path
from typing import Any

# Pre-import everything at daemon startup so requests are instant
from deepnote_runtime.deps import ensure_dependencies
from deepnote_runtime.models import DeepnoteFile, Notebook
from deepnote_runtime.parser import ParseError, parse_file
from deepnote_runtime.reactive import ExecutionResult, ReactiveEngine
from deepnote_runtime.shim import install_shim

SOCKET_DIR = Path(os.environ.get("DEEPNOTE_DAEMON_DIR", Path.home() / ".deepnote"))
SOCKET_PATH = SOCKET_DIR / "daemon.sock"
PID_PATH = SOCKET_DIR / "daemon.pid"


def _select_notebook(
    deepnote_file: DeepnoteFile,
    notebook_name: str | None,
) -> Notebook:
    notebooks = deepnote_file.project.notebooks
    if not notebooks:
        raise ValueError("No notebooks found in .deepnote file")
    if len(notebooks) == 1:
        return notebooks[0]
    if notebook_name:
        for nb in notebooks:
            if nb.name == notebook_name:
                return nb
        names = ", ".join(nb.name for nb in notebooks)
        raise ValueError(f"Notebook {notebook_name!r} not found. Available: {names}")
    # Multiple notebooks, no selection — run all sequentially
    # (return first, caller can iterate)
    raise ValueError(
        f"Multiple notebooks found. Specify --notebook. "
        f"Available: {', '.join(nb.name for nb in notebooks)}"
    )


def _result_to_dict(result: ExecutionResult) -> dict[str, Any]:
    blocks = []
    for br in result.block_results:
        blocks.append({
            "block_id": br.block_id,
            "success": br.success,
            "execution_count": br.execution_count,
            "duration_ms": br.duration_ms,
            "outputs": [o.to_dict() for o in br.outputs],
        })
    return {
        "success": result.success,
        "blocks": blocks,
        "total_blocks": len(result.block_results),
        "duration_ms": sum(br.duration_ms for br in result.block_results),
    }


def _handle_request(request: dict[str, Any]) -> dict[str, Any]:
    """Handle a single execution request."""
    cmd = request.get("command", "run")

    if cmd == "ping":
        return {"pong": True}

    if cmd == "stop":
        return {"stopped": True}

    file_path = request.get("file")
    if not file_path:
        return {"success": False, "error": "Missing 'file' field"}

    notebook_name = request.get("notebook")
    input_vars = request.get("vars", {})

    t0 = time.perf_counter()

    try:
        deepnote_file = parse_file(file_path)

        # Auto-install missing dependencies from environment spec
        deps_ok, deps_msg = ensure_dependencies(deepnote_file.environment)
        if not deps_ok:
            return {"success": False, "error": f"Dependency installation failed: {deps_msg}"}

        notebook = _select_notebook(deepnote_file, notebook_name)

        engine = ReactiveEngine()
        with warnings.catch_warnings(record=True):
            warnings.simplefilter("always")
            result = engine.execute_notebook(
                notebook,
                input_variables=input_vars or None,
                stop_on_error=True,
            )

        response = _result_to_dict(result)
        response["wall_ms"] = (time.perf_counter() - t0) * 1000
        if deps_msg:
            response["deps"] = deps_msg
        return response

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "wall_ms": (time.perf_counter() - t0) * 1000,
        }


def _handle_client(conn: socket.socket) -> bool:
    """Handle one client connection. Returns False if daemon should stop."""
    try:
        data = b""
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                break
            data += chunk
            if b"\n" in data:
                break

        if not data:
            return True

        request = json.loads(data.decode())
        response = _handle_request(request)
        conn.sendall(json.dumps(response).encode() + b"\n")

        if request.get("command") == "stop":
            return False

    except Exception as e:
        try:
            conn.sendall(json.dumps({"success": False, "error": str(e)}).encode() + b"\n")
        except Exception:
            pass
    finally:
        conn.close()

    return True


def start_daemon(foreground: bool = False) -> None:
    """Start the daemon process."""
    install_shim()

    SOCKET_DIR.mkdir(parents=True, exist_ok=True)

    # Clean up stale socket
    if SOCKET_PATH.exists():
        SOCKET_PATH.unlink()

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(str(SOCKET_PATH))
    sock.listen(5)
    sock.settimeout(1.0)  # Allow periodic shutdown checks

    # Write PID file
    PID_PATH.write_text(str(os.getpid()))

    if not foreground:
        # Detach from terminal
        if os.fork() > 0:
            sys.exit(0)
        os.setsid()
        if os.fork() > 0:
            sys.exit(0)
        # Redirect stdio
        devnull = os.open(os.devnull, os.O_RDWR)
        os.dup2(devnull, 0)
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        os.close(devnull)
        # Update PID after fork
        PID_PATH.write_text(str(os.getpid()))

    running = True

    def _sigterm(signum, frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, _sigterm)
    signal.signal(signal.SIGINT, _sigterm)

    if foreground:
        print(f"Daemon listening on {SOCKET_PATH} (pid {os.getpid()})", file=sys.stderr)

    while running:
        try:
            conn, _ = sock.accept()
            if not _handle_client(conn):
                running = False
        except socket.timeout:
            continue
        except OSError:
            break

    sock.close()
    SOCKET_PATH.unlink(missing_ok=True)
    PID_PATH.unlink(missing_ok=True)


def stop_daemon() -> bool:
    """Stop a running daemon. Returns True if it was running."""
    if PID_PATH.exists():
        try:
            pid = int(PID_PATH.read_text().strip())
            os.kill(pid, signal.SIGTERM)
            # Wait briefly for cleanup
            for _ in range(20):
                try:
                    os.kill(pid, 0)
                    time.sleep(0.05)
                except ProcessLookupError:
                    break
            PID_PATH.unlink(missing_ok=True)
            SOCKET_PATH.unlink(missing_ok=True)
            return True
        except (ProcessLookupError, ValueError):
            PID_PATH.unlink(missing_ok=True)
            SOCKET_PATH.unlink(missing_ok=True)
    return False


def is_daemon_running() -> bool:
    """Check if the daemon is running."""
    if not PID_PATH.exists():
        return False
    try:
        pid = int(PID_PATH.read_text().strip())
        os.kill(pid, 0)  # Check if process exists
        return True
    except (ProcessLookupError, ValueError, PermissionError):
        return False


def ensure_daemon() -> None:
    """Start the daemon if it's not already running."""
    if is_daemon_running():
        return
    start_daemon(foreground=False)
    # Wait for socket to appear
    for _ in range(50):  # up to 2.5s
        if SOCKET_PATH.exists():
            time.sleep(0.05)  # Small extra wait for accept()
            return
        time.sleep(0.05)
    raise RuntimeError("Daemon failed to start")
