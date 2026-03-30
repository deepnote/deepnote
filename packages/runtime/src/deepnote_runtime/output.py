"""Output capture for code execution.

Captures stdout/stderr and rich display outputs during block execution.
Produces Jupyter-compatible output format (BlockOutput objects).
"""

from __future__ import annotations

import io
import sys
import traceback
from contextlib import contextmanager
from typing import Any, Generator

from deepnote_runtime.models import BlockOutput


class DisplayCollector:
    """Collects rich display outputs from display() calls and repr protocol."""

    def __init__(self) -> None:
        self.outputs: list[BlockOutput] = []

    def display(self, obj: Any, **kwargs: Any) -> None:
        """Display an object using the rich repr protocol.

        Checks for _repr_html_, _repr_png_, _repr_json_, _repr_latex_,
        _repr_markdown_, _repr_svg_, and falls back to repr().
        """
        mime_bundle = build_mime_bundle(obj)
        self.outputs.append(
            BlockOutput(
                output_type="display_data",
                data=mime_bundle,
            )
        )

    def clear(self) -> None:
        self.outputs.clear()


def build_mime_bundle(obj: Any) -> dict[str, Any]:
    """Build a MIME bundle from an object using the repr protocol.

    Supports: _repr_html_, _repr_png_, _repr_json_, _repr_latex_,
    _repr_markdown_, _repr_svg_, _repr_mimebundle_.
    """
    bundle: dict[str, Any] = {}

    # Check for _repr_mimebundle_ first (highest priority)
    if hasattr(obj, "_repr_mimebundle_"):
        try:
            result = obj._repr_mimebundle_()
            if isinstance(result, tuple):
                data, _metadata = result
            else:
                data = result
            if isinstance(data, dict):
                bundle.update(data)
        except Exception:
            pass

    # Individual repr methods
    repr_methods = {
        "text/html": "_repr_html_",
        "text/markdown": "_repr_markdown_",
        "text/latex": "_repr_latex_",
        "image/svg+xml": "_repr_svg_",
        "image/png": "_repr_png_",
        "application/json": "_repr_json_",
    }

    for mime_type, method_name in repr_methods.items():
        if mime_type in bundle:
            continue  # Already set by _repr_mimebundle_
        method = getattr(obj, method_name, None)
        if method is not None:
            try:
                result = method()
                if result is not None:
                    bundle[mime_type] = result
            except Exception:
                pass

    # Always include text/plain as fallback
    if "text/plain" not in bundle:
        bundle["text/plain"] = repr(obj)

    return bundle


class OutputCapture:
    """Captures all outputs from a block execution."""

    def __init__(self) -> None:
        self.stdout_buffer = io.StringIO()
        self.stderr_buffer = io.StringIO()
        self.display_collector = DisplayCollector()
        self._result: Any = None
        self._error: BaseException | None = None

    @property
    def display_fn(self) -> Any:
        return self.display_collector.display

    def collect_outputs(self, execution_count: int | None = None) -> list[BlockOutput]:
        """Collect all outputs into a list of BlockOutput objects."""
        outputs: list[BlockOutput] = []

        # Stdout
        stdout_text = self.stdout_buffer.getvalue()
        if stdout_text:
            outputs.append(
                BlockOutput(
                    output_type="stream",
                    name="stdout",
                    text=stdout_text,
                )
            )

        # Stderr
        stderr_text = self.stderr_buffer.getvalue()
        if stderr_text:
            outputs.append(
                BlockOutput(
                    output_type="stream",
                    name="stderr",
                    text=stderr_text,
                )
            )

        # Display outputs (from display() calls)
        outputs.extend(self.display_collector.outputs)

        # Error
        if self._error is not None:
            tb_lines = traceback.format_exception(
                type(self._error), self._error, self._error.__traceback__
            )
            outputs.append(
                BlockOutput(
                    output_type="error",
                    ename=type(self._error).__name__,
                    evalue=str(self._error),
                    traceback=tb_lines,
                )
            )

        # Execution result (last expression value)
        elif self._result is not None:
            mime_bundle = build_mime_bundle(self._result)
            outputs.append(
                BlockOutput(
                    output_type="execute_result",
                    data=mime_bundle,
                    execution_count=execution_count,
                )
            )

        return outputs

    def set_result(self, result: Any) -> None:
        self._result = result

    def set_error(self, error: BaseException) -> None:
        self._error = error


@contextmanager
def capture_output(capture: OutputCapture) -> Generator[OutputCapture, None, None]:
    """Context manager to capture stdout/stderr during execution."""
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    try:
        sys.stdout = capture.stdout_buffer  # type: ignore[assignment]
        sys.stderr = capture.stderr_buffer  # type: ignore[assignment]
        yield capture
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr
