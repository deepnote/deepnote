"""
Direct Python runner for Deepnote CLI.

Executes Python code blocks in a shared namespace via JSON-over-stdio protocol.
Replaces the full Jupyter server + WebSocket + kernel chain for faster execution.

Protocol:
  - Reads newline-delimited JSON from stdin: {"id": "<uuid>", "code": "<python>"}
  - Writes JSON responses to fd 3: {"id": "<uuid>", "success": bool, "outputs": [...], "execution_count": int}
  - Python code's stdout/stderr are captured per-block and included as stream outputs
  - Shutdown: {"id": "<uuid>", "command": "shutdown"} or stdin EOF
"""

import ast
import io
import json
import os
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout

# Protocol output goes to fd 3 to avoid mixing with Python stdout/stderr
_protocol_fd = os.fdopen(3, "w", buffering=1)  # line-buffered

# Shared namespace for variable persistence across blocks
_shared_globals = {"__builtins__": __builtins__, "__name__": "__main__"}

# Execution counter
_execution_count = 0


def _send_response(response):
    """Write a JSON response to the protocol fd."""
    _protocol_fd.write(json.dumps(response, default=str) + "\n")
    _protocol_fd.flush()


def _split_last_expr(code):
    """
    If the last statement in code is a bare expression, return (stmts_code, expr_code).
    Otherwise return (code, None).
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return code, None

    if not tree.body:
        return code, None

    last = tree.body[-1]
    if not isinstance(last, ast.Expr):
        return code, None

    # There's a last expression — split the code
    if len(tree.body) == 1:
        stmts_code = None
    else:
        # Get everything before the last statement
        # Use line numbers to split
        last_lineno = last.lineno  # 1-based
        lines = code.split("\n")
        stmts_code = "\n".join(lines[: last_lineno - 1])

    expr_code = ast.get_source_segment(code, last)
    if expr_code is None:
        # Fallback: use line range
        lines = code.split("\n")
        expr_code = "\n".join(lines[last.lineno - 1 :])

    return stmts_code, expr_code


def _execute_code(code, request_id):
    """Execute a code string and return a response dict."""
    global _execution_count
    _execution_count += 1
    current_count = _execution_count

    outputs = []

    # Skip empty code
    stripped = code.strip()
    if not stripped:
        return {
            "id": request_id,
            "success": True,
            "outputs": [],
            "execution_count": current_count,
        }

    # Capture stdout and stderr
    captured_stdout = io.StringIO()
    captured_stderr = io.StringIO()

    try:
        stmts_code, expr_code = _split_last_expr(stripped)

        with redirect_stdout(captured_stdout), redirect_stderr(captured_stderr):
            # Execute statements (all but last expression)
            if stmts_code is not None:
                compiled_stmts = compile(stmts_code, "<cell>", "exec")
                exec(compiled_stmts, _shared_globals)

            # Evaluate last expression if present
            expr_result = None
            has_expr_result = False
            if expr_code is not None:
                compiled_expr = compile(expr_code, "<cell>", "eval")
                expr_result = eval(compiled_expr, _shared_globals)
                if expr_result is not None:
                    has_expr_result = True

        # Collect stdout
        stdout_text = captured_stdout.getvalue()
        if stdout_text:
            outputs.append(
                {"output_type": "stream", "name": "stdout", "text": stdout_text}
            )

        # Collect stderr
        stderr_text = captured_stderr.getvalue()
        if stderr_text:
            outputs.append(
                {"output_type": "stream", "name": "stderr", "text": stderr_text}
            )

        # Collect expression result
        if has_expr_result:
            result_data = {"text/plain": repr(expr_result)}
            # Try to get HTML representation
            if hasattr(expr_result, "_repr_html_"):
                try:
                    html = expr_result._repr_html_()
                    if html is not None:
                        result_data["text/html"] = html
                except Exception:
                    pass
            outputs.append(
                {
                    "output_type": "execute_result",
                    "data": result_data,
                    "metadata": {},
                    "execution_count": current_count,
                }
            )

        return {
            "id": request_id,
            "success": True,
            "outputs": outputs,
            "execution_count": current_count,
        }

    except Exception as exc:
        # Collect any stdout/stderr produced before the error
        stdout_text = captured_stdout.getvalue()
        if stdout_text:
            outputs.append(
                {"output_type": "stream", "name": "stdout", "text": stdout_text}
            )
        stderr_text = captured_stderr.getvalue()
        if stderr_text:
            outputs.append(
                {"output_type": "stream", "name": "stderr", "text": stderr_text}
            )

        # Format the error
        tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
        outputs.append(
            {
                "output_type": "error",
                "ename": type(exc).__name__,
                "evalue": str(exc),
                "traceback": tb_lines,
            }
        )

        return {
            "id": request_id,
            "success": False,
            "outputs": outputs,
            "execution_count": current_count,
        }


def main():
    """Main loop: read JSON commands from stdin, execute, respond on fd 3."""
    # Signal readiness
    _send_response({"type": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            _send_response({"error": f"Invalid JSON: {e}"})
            continue

        request_id = request.get("id", "unknown")

        # Handle shutdown command
        if request.get("command") == "shutdown":
            _send_response({"id": request_id, "type": "shutdown_ack"})
            break

        # Handle execute command
        code = request.get("code", "")
        response = _execute_code(code, request_id)
        _send_response(response)

    _protocol_fd.close()


if __name__ == "__main__":
    main()
