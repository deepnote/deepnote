"""CLI entry point for deepnote-runtime.

Usage:
    deepnote run <file.deepnote> [--var key=value ...] [--notebook name] [--snapshot]
    deepnote info <file.deepnote>
"""

from __future__ import annotations

import argparse
import sys
import warnings
from pathlib import Path
from typing import Any

from deepnote_runtime.deps import ensure_dependencies
from deepnote_runtime.models import DeepnoteFile, Notebook
from deepnote_runtime.parser import ParseError, parse_file
from deepnote_runtime.reactive import ExecutionResult, ReactiveEngine
from deepnote_runtime.shim import install_shim
from deepnote_runtime.snapshot import snapshot_path_for, write_snapshot


def main(argv: list[str] | None = None) -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        prog="deepnote",
        description="Execute .deepnote files",
    )
    subparsers = parser.add_subparsers(dest="command")

    # run command
    run_parser = subparsers.add_parser("run", help="Execute a .deepnote file")
    run_parser.add_argument("file", type=str, help="Path to .deepnote file")
    run_parser.add_argument(
        "--var",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="Override input variable (can be repeated)",
    )
    run_parser.add_argument(
        "--notebook",
        type=str,
        default=None,
        help="Name of notebook to execute (required if multiple notebooks)",
    )
    run_parser.add_argument(
        "--snapshot",
        action="store_true",
        help="Write a snapshot file with execution outputs",
    )
    run_parser.add_argument(
        "--no-stop-on-error",
        action="store_true",
        help="Continue execution even if a block fails",
    )
    run_parser.add_argument(
        "--daemon",
        action="store_true",
        help="Execute via the daemon (fast mode, ~5ms)",
    )

    # info command
    info_parser = subparsers.add_parser("info", help="Show info about a .deepnote file")
    info_parser.add_argument("file", type=str, help="Path to .deepnote file")

    # daemon commands
    daemon_parser = subparsers.add_parser("daemon", help="Manage the execution daemon")
    daemon_sub = daemon_parser.add_subparsers(dest="daemon_command")
    daemon_sub.add_parser("start", help="Start the daemon")
    daemon_sub.add_parser("stop", help="Stop the daemon")
    daemon_sub.add_parser("status", help="Check daemon status")
    daemon_sub.add_parser("restart", help="Restart the daemon")

    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return 1

    if args.command == "run":
        if getattr(args, "daemon", False):
            return _cmd_run_daemon(args)
        return _cmd_run(args)
    elif args.command == "info":
        return _cmd_info(args)
    elif args.command == "daemon":
        return _cmd_daemon(args)

    return 1


def _parse_var_args(var_args: list[str]) -> dict[str, Any]:
    """Parse --var KEY=VALUE arguments into a dict."""
    variables: dict[str, Any] = {}
    for var_str in var_args:
        if "=" not in var_str:
            print(f"Error: Invalid --var format: {var_str!r} (expected KEY=VALUE)",
                  file=sys.stderr)
            sys.exit(1)
        key, _, value = var_str.partition("=")
        key = key.strip()
        value = value.strip()

        # Try to parse as Python literal
        variables[key] = _parse_value(value)
    return variables


def _parse_value(value: str) -> Any:
    """Try to interpret a string value as a Python literal."""
    # Booleans
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False

    # Numbers
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass

    # String (default)
    return value


def _select_notebook(
    deepnote_file: DeepnoteFile,
    notebook_name: str | None,
) -> Notebook:
    """Select which notebook to execute."""
    notebooks = deepnote_file.project.notebooks

    if not notebooks:
        print("Error: No notebooks found in .deepnote file", file=sys.stderr)
        sys.exit(1)

    if len(notebooks) == 1:
        return notebooks[0]

    if notebook_name:
        for nb in notebooks:
            if nb.name == notebook_name:
                return nb
        print(
            f"Error: Notebook {notebook_name!r} not found. "
            f"Available: {', '.join(nb.name for nb in notebooks)}",
            file=sys.stderr,
        )
        sys.exit(1)

    # Multiple notebooks, no selection — ask interactively
    print("Multiple notebooks found. Select one:")
    for i, nb in enumerate(notebooks, 1):
        block_count = len(nb.code_blocks)
        print(f"  {i}. {nb.name} ({block_count} code blocks)")

    while True:
        try:
            choice = input("Enter number: ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(notebooks):
                return notebooks[idx]
            print(f"  Invalid choice. Enter 1-{len(notebooks)}.")
        except (ValueError, EOFError, KeyboardInterrupt):
            print("\nAborted.", file=sys.stderr)
            sys.exit(1)


def _print_result(result: ExecutionResult) -> None:
    """Print execution summary."""
    total = len(result.block_results)
    succeeded = sum(1 for r in result.block_results if r.success)
    failed = total - succeeded
    total_ms = sum(r.duration_ms for r in result.block_results)

    print(f"\n--- Execution complete ---")
    print(f"Blocks: {succeeded}/{total} succeeded", end="")
    if failed:
        print(f" ({failed} failed)", end="")
    print(f" in {total_ms:.0f}ms")


def _cmd_run(args: argparse.Namespace) -> int:
    """Execute a .deepnote file."""
    # Install IPython shim
    install_shim()

    # Parse file
    try:
        deepnote_file = parse_file(args.file)
    except (FileNotFoundError, ParseError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    # Auto-install missing dependencies from environment spec
    deps_ok, deps_msg = ensure_dependencies(deepnote_file.environment)
    if deps_msg:
        print(deps_msg, file=sys.stderr)
    if not deps_ok:
        print(f"Error: {deps_msg}", file=sys.stderr)
        return 1

    # Select notebook
    notebook = _select_notebook(deepnote_file, args.notebook)

    # Parse variable overrides
    input_vars = _parse_var_args(args.var)

    # Execute
    engine = ReactiveEngine()

    with warnings.catch_warnings(record=True) as caught_warnings:
        warnings.simplefilter("always")
        result = engine.execute_notebook(
            notebook,
            input_variables=input_vars,
            stop_on_error=not args.no_stop_on_error,
        )

    # Print warnings
    for w in caught_warnings:
        print(f"Warning: {w.message}", file=sys.stderr)

    # Print outputs
    for block_result in result.block_results:
        for output in block_result.outputs:
            if output.output_type == "stream":
                stream = sys.stdout if output.name == "stdout" else sys.stderr
                print(output.text or "", end="", file=stream)
            elif output.output_type == "execute_result":
                if output.data:
                    # Prefer text/plain for CLI output
                    text = output.data.get("text/plain", "")
                    if text:
                        print(text)
            elif output.output_type == "error":
                if output.traceback:
                    for line in output.traceback:
                        print(line, end="", file=sys.stderr)

    _print_result(result)

    # Write snapshot if requested
    if args.snapshot:
        snap_path = snapshot_path_for(
            args.file,
            deepnote_file.project.id,
        )
        write_snapshot(deepnote_file, snap_path)
        print(f"Snapshot written to: {snap_path}")

    return 0 if result.success else 1


def _cmd_run_daemon(args: argparse.Namespace) -> int:
    """Execute a .deepnote file via the daemon."""
    from deepnote_runtime.client import print_result, run_file
    from deepnote_runtime.daemon import ensure_daemon

    try:
        ensure_daemon()
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    input_vars = _parse_var_args(args.var) if args.var else None

    try:
        response = run_file(
            args.file,
            notebook=args.notebook,
            variables=input_vars,
        )
    except (ConnectionRefusedError, FileNotFoundError):
        print("Error: Cannot connect to daemon. Try: deepnote daemon start", file=sys.stderr)
        return 1

    return print_result(response)


def _cmd_daemon(args: argparse.Namespace) -> int:
    """Handle daemon subcommands."""
    from deepnote_runtime.daemon import (
        is_daemon_running,
        start_daemon,
        stop_daemon,
    )

    subcmd = args.daemon_command

    if subcmd == "start":
        if is_daemon_running():
            print("Daemon is already running.", file=sys.stderr)
            return 0
        print("Starting daemon...", file=sys.stderr)
        start_daemon(foreground=False)
        print("Daemon started.", file=sys.stderr)
        return 0

    elif subcmd == "stop":
        if stop_daemon():
            print("Daemon stopped.", file=sys.stderr)
        else:
            print("Daemon was not running.", file=sys.stderr)
        return 0

    elif subcmd == "status":
        if is_daemon_running():
            print("Daemon is running.")
        else:
            print("Daemon is not running.")
        return 0

    elif subcmd == "restart":
        stop_daemon()
        print("Starting daemon...", file=sys.stderr)
        start_daemon(foreground=False)
        print("Daemon restarted.", file=sys.stderr)
        return 0

    else:
        print("Usage: deepnote daemon {start|stop|status|restart}", file=sys.stderr)
        return 1


def _cmd_info(args: argparse.Namespace) -> int:
    """Show info about a .deepnote file."""
    try:
        deepnote_file = parse_file(args.file)
    except (FileNotFoundError, ParseError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    print(f"Version: {deepnote_file.version}")
    print(f"Project: {deepnote_file.project.name} ({deepnote_file.project.id})")
    print(f"Notebooks: {len(deepnote_file.project.notebooks)}")

    for nb in deepnote_file.project.notebooks:
        code_count = len(nb.code_blocks)
        input_count = len(nb.input_blocks)
        total = len(nb.blocks)
        print(f"  - {nb.name}: {total} blocks ({code_count} code, {input_count} input)")

    if deepnote_file.environment:
        print(f"Environment: {deepnote_file.environment}")

    return 0
