"""Notebook handles.

Notebooks are addressed by id and are never created here: running a notebook needs permission to run
it, not to create one, which is what lets a published page do this with a viewer's short-lived
token.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from deepnote._http import Transport
from deepnote.outputs import OutputBinding
from deepnote.runs import Run, RunResult, RunsResource


class NotebookRef:
    """A handle on a notebook that already exists in Deepnote."""

    def __init__(
        self,
        notebook_id: str,
        *,
        runs: RunsResource,
        bindings: Mapping[str, OutputBinding] | None = None,
        output_type: type | None = None,
    ) -> None:
        if not notebook_id:
            raise ValueError("A notebook id is required.")
        self.id = notebook_id
        self._runs = runs
        self._bindings = dict(bindings or {})
        self._output_type = output_type

    def __repr__(self) -> str:
        return f"NotebookRef(id={self.id!r})"

    async def run(self, *, inputs: Mapping[str, Any] | None = None) -> Run:
        """
        Start a run and return as soon as Deepnote has accepted it.

        The run is detached: it continues in Deepnote whether or not this process stays alive, so the
        returned id is a durable handle and not just a local one.
        """
        return await self._runs.create(
            notebook_id=self.id,
            inputs=inputs,
            bindings=self._bindings,
            output_type=self._output_type,
        )

    async def run_and_wait(
        self,
        *,
        inputs: Mapping[str, Any] | None = None,
        timeout: float | None = None,
        poll_interval: float | None = None,
        on_status: Callable[[str], None] | None = None,
        allow_failure: bool = False,
    ) -> RunResult:
        """Start a run and wait for it. The common case, and exactly `run()` then `wait()`."""
        started = await self.run(inputs=inputs)
        wait_kwargs: dict[str, Any] = {"on_status": on_status, "allow_failure": allow_failure}
        if timeout is not None:
            wait_kwargs["timeout"] = timeout
        if poll_interval is not None:
            wait_kwargs["poll_interval"] = poll_interval
        return await started.wait(**wait_kwargs)

    async def list_runs(self, *, page_size: int | None = None, page_token: str | None = None) -> Mapping[str, Any]:
        """One page of this notebook's run history, newest first."""
        return await self._runs.list(notebook_id=self.id, page_size=page_size, page_token=page_token)

    def with_outputs(
        self,
        outputs: Mapping[str, OutputBinding],
        *,
        output_type: type | None = None,
    ) -> NotebookRef:
        """The same notebook with named outputs declared. See `deepnote.outputs`."""
        return NotebookRef(self.id, runs=self._runs, bindings=outputs, output_type=output_type)


class NotebooksResource:
    """`deepnote.notebooks` — how you get a handle on one."""

    def __init__(self, *, transport: Transport, runs: RunsResource) -> None:
        self._transport = transport
        self._runs = runs

    def ref(self, notebook_id: str) -> NotebookRef:
        """A handle on a notebook by id."""
        return NotebookRef(notebook_id, runs=self._runs)

    def define(
        self,
        notebook_id: str,
        *,
        outputs: Mapping[str, OutputBinding] | None = None,
        output_type: type | None = None,
    ) -> NotebookRef:
        """
        A handle on a notebook with its named outputs declared up front.

        Pass `output_type` a dataclass whose fields match the binding names and the result carries a
        typed `output` alongside the `values` mapping.
        """
        return NotebookRef(notebook_id, runs=self._runs, bindings=outputs, output_type=output_type)

    def __getitem__(self, notebook_id: str) -> NotebookRef:
        """`deepnote.notebooks["nb_extract"]`, for the shortest possible reference."""
        return self.ref(notebook_id)
