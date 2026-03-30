#!/usr/bin/env python3
"""Ultra-minimal daemon client. Avoids importing deepnote_runtime entirely.

Usage: python fast_client.py <file.deepnote> [--notebook NAME] [--var KEY=VALUE ...]
"""

import json
import os
import socket
import sys

SOCKET_PATH = os.path.join(os.path.expanduser("~"), ".deepnote", "daemon.sock")


def main():
    argv = sys.argv[1:]
    if not argv:
        print("Usage: fast_client.py <file.deepnote> [--notebook NAME] [--var K=V]", file=sys.stderr)
        sys.exit(1)

    file_path = None
    notebook = None
    variables = {}
    i = 0
    while i < len(argv):
        if argv[i] == "--notebook" and i + 1 < len(argv):
            notebook = argv[i + 1]
            i += 2
        elif argv[i] == "--var" and i + 1 < len(argv):
            k, _, v = argv[i + 1].partition("=")
            # Simple type coercion
            if v.lower() == "true":
                variables[k] = True
            elif v.lower() == "false":
                variables[k] = False
            else:
                try:
                    variables[k] = int(v)
                except ValueError:
                    try:
                        variables[k] = float(v)
                    except ValueError:
                        variables[k] = v
            i += 2
        else:
            file_path = os.path.abspath(argv[i])
            i += 1

    if not file_path:
        print("Error: No file specified", file=sys.stderr)
        sys.exit(1)

    request = {"file": file_path}
    if notebook:
        request["notebook"] = notebook
    if variables:
        request["vars"] = variables

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(SOCKET_PATH)
    except (FileNotFoundError, ConnectionRefusedError):
        print("Error: Daemon not running. Start with: deepnote daemon start", file=sys.stderr)
        sys.exit(1)

    sock.sendall(json.dumps(request).encode() + b"\n")

    data = b""
    while b"\n" not in data:
        chunk = sock.recv(1048576)
        if not chunk:
            break
        data += chunk
    sock.close()

    response = json.loads(data.decode())

    if "error" in response and not response.get("success", True):
        print(f"Error: {response['error']}", file=sys.stderr)
        sys.exit(1)

    if "deps" in response:
        print(response["deps"], file=sys.stderr)

    for block in response.get("blocks", []):
        for output in block.get("outputs", []):
            otype = output.get("output_type")
            if otype == "stream":
                stream = sys.stdout if output.get("name") == "stdout" else sys.stderr
                print(output.get("text", ""), end="", file=stream)
            elif otype == "execute_result":
                text = output.get("data", {}).get("text/plain", "")
                if text:
                    print(text)
            elif otype == "error":
                for line in output.get("traceback", []):
                    print(line, end="", file=sys.stderr)

    wall = response.get("wall_ms", 0)
    total = response.get("total_blocks", 0)
    print(f"\n--- {total} blocks in {wall:.0f}ms ---", file=sys.stderr)

    sys.exit(0 if response.get("success") else 1)


if __name__ == "__main__":
    main()
