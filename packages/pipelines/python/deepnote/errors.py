"""Errors the SDK raises.

Deliberately few, and each one carries what a caller needs to act: an API error carries the status
code, a failed run carries the whole result, and a timeout carries the run id so the caller can
come back to a run that is still going.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from deepnote.runs import RunResult


class DeepnoteError(Exception):
    """Base class for everything this package raises."""


class DeepnoteAPIError(DeepnoteError):
    """The Deepnote API returned an error response."""

    def __init__(self, message: str, *, status_code: int | None = None, body: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class DeepnoteRunError(DeepnoteError):
    """
    A notebook run finished in a failed state.

    Carries the whole result rather than a message: the snapshot is usually the only place the
    failing block's own error is recorded, so a caller that catches this can still show how far the
    run got.
    """

    def __init__(self, result: RunResult) -> None:
        super().__init__(
            f"Deepnote run {result.run_id} finished with status "
            f"{result.status!r}: {result.error or 'no error reported'}"
        )
        self.result = result
        self.run_id = result.run_id
        self.status = result.status


class DeepnoteRunTimeout(DeepnoteError):
    """
    Waiting for a run timed out.

    The run itself is unaffected — it is detached, and continues in Deepnote. `run_id` is enough to
    pick it up later, which is why it is on the exception.
    """

    def __init__(self, run_id: str, status: str, timeout: float) -> None:
        super().__init__(
            f"Deepnote run {run_id} was still {status!r} after {timeout:g}s. "
            "The run is unaffected and continues in Deepnote; wait for it again with "
            f"`await (await deepnote.runs.get({run_id!r})).wait()`."
        )
        self.run_id = run_id
        self.status = status
        self.timeout = timeout
