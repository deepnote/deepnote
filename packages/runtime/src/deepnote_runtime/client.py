"""Thin client for the deepnote-runtime daemon.

Connects to the Unix socket, sends a request, prints results.
This module is designed for minimal import overhead when used standalone.
"""

from __future__ import annotations

import json
import socket
import sys
import time
from pathlib import Path
from typing import Any

SOCKET_DIR = Path.home() / ".deepnote"
SOCKET_PATH = SOCKET_DIR / "daemon.sock"


def send_request(request: dict[str, Any], timeout: float = 120.0) -> dict[str, Any]:
    """Send a request to the daemon and return the response."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(str(SOCKET_PATH))
        sock.sendall(json.dumps(request).encode() + b"\n")
        # Receive response
        data = b""
        while b"\n" not in data:
            chunk = sock.recv(1048576)  # 1MB chunks
            if not chunk:
                break
            data += chunk
        return json.loads(data.decode())
    finally:
        sock.close()


def run_file(
    file_path: str,
    notebook: str | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute a .deepnote file via the daemon."""
    request: dict[str, Any] = {"file": str(Path(file_path).resolve())}
    if notebook:
        request["notebook"] = notebook
    if variables:
        request["vars"] = variables
    return send_request(request)


def print_result(response: dict[str, Any]) -> int:
    """Print execution results to stdout/stderr. Returns exit code."""
    if "error" in response and not response.get("success", True):
        print(f"Error: {response['error']}", file=sys.stderr)
        return 1

    for block in response.get("blocks", []):
        for output in block.get("outputs", []):
            otype = output.get("output_type")
            if otype == "stream":
                stream = sys.stdout if output.get("name") == "stdout" else sys.stderr
                print(output.get("text", ""), end="", file=stream)
            elif otype == "execute_result":
                data = output.get("data", {})
                text = data.get("text/plain", "")
                if text:
                    print(text)
            elif otype == "error":
                tb = output.get("traceback", [])
                for line in tb:
                    print(line, end="", file=sys.stderr)

    total = response.get("total_blocks", 0)
    wall = response.get("wall_ms", 0)
    success = response.get("success", False)
    failed = sum(1 for b in response.get("blocks", []) if not b.get("success", True))

    print(f"\n--- {total} blocks in {wall:.0f}ms ---", file=sys.stderr)

    return 0 if success else 1
