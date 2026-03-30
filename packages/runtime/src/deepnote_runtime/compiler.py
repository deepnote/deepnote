"""Compile and execute Python source code.

Handles:
- compile() + exec() without IPython
- Top-level await detection and wrapping via asyncio.Runner (Python 3.12+)
- Code object caching by source hash
"""

from __future__ import annotations

import ast
import asyncio
import hashlib
import subprocess
from typing import Any


class CompileError(Exception):
    """Raised when code cannot be compiled."""


class CodeCache:
    """Cache compiled code objects by source hash."""

    def __init__(self) -> None:
        self._cache: dict[str, code] = {}

    def get_or_compile(self, source: str, filename: str = "<cell>") -> code:
        key = hashlib.sha256(source.encode()).hexdigest()
        if key not in self._cache:
            self._cache[key] = compile_source(source, filename)
        return self._cache[key]

    def clear(self) -> None:
        self._cache.clear()

    def __len__(self) -> int:
        return len(self._cache)

    def __bool__(self) -> bool:
        return True  # Cache is always "truthy" even when empty


def compile_source(source: str, filename: str = "<cell>") -> code:
    """Compile Python source to a code object.

    If the source contains top-level await expressions, wraps it in an
    async function for execution via asyncio.Runner.
    """
    source = source.rstrip()
    if not source:
        return compile("", filename, "exec")

    try:
        tree = ast.parse(source, filename=filename, mode="exec")
    except SyntaxError as e:
        raise CompileError(str(e)) from e

    return compile(tree, filename, "exec")


def has_top_level_await(source: str) -> bool:
    """Check if source contains top-level await/async for/async with.

    Walks the AST to find Await, AsyncFor, or AsyncWith nodes that are
    at module scope (not nested inside an async function definition).
    """
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError:
        # Normal parse failed — might be top-level await on older Python.
        # Try wrapping in async function to confirm.
        wrapped = _wrap_async(source)
        try:
            ast.parse(wrapped, mode="exec")
            return True
        except SyntaxError:
            return False

    return _has_await_outside_async(tree)


def _has_await_outside_async(node: ast.AST, in_async: bool = False) -> bool:
    """Recursively check for await/async-for/async-with outside async functions."""
    if isinstance(node, ast.Await) and not in_async:
        return True
    if isinstance(node, ast.AsyncFor) and not in_async:
        return True
    if isinstance(node, ast.AsyncWith) and not in_async:
        return True

    for child in ast.iter_child_nodes(node):
        child_in_async = in_async or isinstance(child, ast.AsyncFunctionDef)
        if _has_await_outside_async(child, child_in_async):
            return True

    return False


def _wrap_async(source: str) -> str:
    """Wrap source with top-level await in an async function.

    Uses globals() trick so assignments inside the async function
    propagate back to the module namespace.
    """
    lines = source.split("\n")
    indented = "\n".join("    " + line if line.strip() else line for line in lines)
    return f"async def __async_cell__(_ns_=globals()):\n{indented}\n    _ns_.update(locals())\n"


def _handle_magic(source: str, namespace: dict[str, Any]) -> tuple[bool, Any]:
    """Handle IPython magic syntax. Returns (handled, result).

    Supported:
        %%bash / %%sh  — run body in bash subprocess
        %%time         — strip magic, execute body normally
        !command       — run shell command, print output
        %magic         — line magics are silently skipped
    """
    stripped = source.strip()
    lines = stripped.split("\n")
    first = lines[0].strip()

    # Cell magics: %%bash, %%sh, %%time
    if first.startswith("%%"):
        magic_name = first.split()[0][2:]
        body = "\n".join(lines[1:])

        if magic_name in ("bash", "sh"):
            result = subprocess.run(
                ["bash", "-c", body],
                capture_output=True, text=True, timeout=120,
            )
            if result.stdout:
                print(result.stdout, end="")
            if result.stderr:
                import sys
                print(result.stderr, end="", file=sys.stderr)
            return True, None

        if magic_name == "time":
            # Just strip the %%time line and fall through to normal execution
            return False, "\n".join(lines[1:])

        # Unknown cell magic — skip
        return True, None

    # Shell commands: !pip install foo
    if first.startswith("!"):
        cmd = first[1:]
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=120,
        )
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            import sys
            print(result.stderr, end="", file=sys.stderr)
        return True, None

    # Line magics: %matplotlib inline — skip silently
    if first.startswith("%") and not first.startswith("%%"):
        remaining = "\n".join(lines[1:]).strip()
        if remaining:
            return False, remaining
        return True, None

    return False, None


def execute(
    source: str,
    namespace: dict[str, Any],
    filename: str = "<cell>",
    code_cache: CodeCache | None = None,
) -> Any:
    """Execute Python source in the given namespace.

    Returns the result of the last expression if it's a standalone expression,
    otherwise None.
    """
    source = source.rstrip()
    if not source:
        return None

    # Handle IPython magic syntax before parsing
    handled, magic_result = _handle_magic(source, namespace)
    if handled:
        return None
    if magic_result is not None:
        source = magic_result.rstrip()
        if not source:
            return None

    # Check for top-level await
    if has_top_level_await(source):
        return _execute_async(source, namespace, filename)

    # Parse and compile. If compile fails with await-related SyntaxError,
    # fall back to async execution (ast.parse may accept what compile rejects).
    try:
        tree = ast.parse(source, filename=filename, mode="exec")
    except SyntaxError as e:
        raise CompileError(str(e)) from e

    if not tree.body:
        return None

    result = None

    # If the last statement is an expression, compile it separately
    # so we can capture its value
    last = tree.body[-1]
    if isinstance(last, ast.Expr):
        # Execute everything except the last statement
        if len(tree.body) > 1:
            mod = ast.Module(body=tree.body[:-1], type_ignores=[])
            ast.fix_missing_locations(mod)
            code_obj = compile(mod, filename, "exec")
            exec(code_obj, namespace)

        # Evaluate the last expression
        expr = ast.Expression(body=last.value)
        ast.fix_missing_locations(expr)
        code_obj = compile(expr, filename, "eval")
        result = eval(code_obj, namespace)
    else:
        # All statements, no expression result — cacheable
        if code_cache:
            code_obj = code_cache.get_or_compile(source, filename)
        else:
            code_obj = compile(tree, filename, "exec")
        exec(code_obj, namespace)

    return result


def _execute_async(
    source: str,
    namespace: dict[str, Any],
    filename: str = "<cell>",
) -> Any:
    """Execute source containing top-level await using asyncio.Runner.

    Wraps the source in an async function, executes it, and propagates
    any variable assignments back to the namespace via globals().update(locals()).
    """
    wrapped = _wrap_async(source)

    try:
        tree = ast.parse(wrapped, filename=filename, mode="exec")
    except SyntaxError as e:
        raise CompileError(str(e)) from e

    code_obj = compile(tree, filename, "exec")
    exec(code_obj, namespace)

    async_fn = namespace.pop("__async_cell__")

    with asyncio.Runner() as runner:
        result = runner.run(async_fn())

    # Clean up the _ns_ parameter leak
    namespace.pop("_ns_", None)

    return result
