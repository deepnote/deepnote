"""The same client, without `await`.

    from deepnote.sync import Deepnote

    with Deepnote.from_env() as deepnote:
        result = deepnote.notebooks["nb_extract"].run_and_wait(inputs={"region": "eu"})

For code that is not itself async: a plain script, and above all a notebook cell. A kernel already
has an event loop running, so `asyncio.run(...)` raises there and awaiting from a cell ties the
pipeline to that kernel's loop. This module sidesteps both by driving the async client on a
dedicated background thread with an event loop of its own, and blocking the caller until each call
settles.

It is a facade and nothing more. Every class here holds its async counterpart and forwards to it;
there is one place that knows how to run a coroutine on the worker loop, and no logic of the SDK's
is repeated.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Coroutine, Mapping
from typing import Any, TypeVar

import httpx

from deepnote._client import Deepnote as AsyncDeepnote
from deepnote._http import DEFAULT_BASE_URL
from deepnote.notebooks import NotebookRef as AsyncNotebookRef
from deepnote.notebooks import NotebooksResource as AsyncNotebooksResource
from deepnote.outputs import OutputBinding
from deepnote.runs import Run as AsyncRun
from deepnote.runs import RunResult
from deepnote.runs import RunsResource as AsyncRunsResource

T = TypeVar("T")


class _Worker:
    """A thread running an event loop of its own. Started on first use, stopped by `stop()`."""

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def started(self) -> bool:
        return self._loop is not None

    def run(self, coroutine: Coroutine[Any, Any, T]) -> T:
        """Run one coroutine on the worker loop and block the calling thread until it settles."""
        with self._lock:
            if self._loop is None:
                self._loop = asyncio.new_event_loop()
                self._thread = threading.Thread(target=self._loop.run_forever, name="deepnote-sdk", daemon=True)
                self._thread.start()
            loop = self._loop
        return asyncio.run_coroutine_threadsafe(coroutine, loop).result()

    def stop(self) -> None:
        with self._lock:
            loop, thread = self._loop, self._thread
            self._loop = self._thread = None
        if loop is None or thread is None:
            return
        loop.call_soon_threadsafe(loop.stop)
        thread.join()
        loop.close()


class Run:
    """A started run. `deepnote.runs.Run`, blocking."""

    def __init__(self, inner: AsyncRun, worker: _Worker) -> None:
        self._inner = inner
        self._worker = worker

    def __repr__(self) -> str:
        return repr(self._inner)

    @property
    def id(self) -> str:
        return self._inner.id

    @property
    def status(self) -> str:
        return self._inner.status

    @property
    def notebook_id(self) -> str | None:
        return self._inner.notebook_id

    @property
    def is_terminal(self) -> bool:
        return self._inner.is_terminal

    @property
    def raw(self) -> Mapping[str, Any]:
        return self._inner.raw

    def refresh(self) -> Run:
        return Run(self._worker.run(self._inner.refresh()), self._worker)

    def wait(self, **kwargs: Any) -> RunResult:
        """
        Block until the run finishes, then read its snapshot. Same arguments as the async `wait()`.

        `on_status` is called on the worker thread, which is fine for printing or logging.
        """
        return self._worker.run(self._inner.wait(**kwargs))


class NotebookRef:
    """A handle on a notebook. `deepnote.notebooks.NotebookRef`, blocking."""

    def __init__(self, inner: AsyncNotebookRef, worker: _Worker) -> None:
        self._inner = inner
        self._worker = worker

    def __repr__(self) -> str:
        return repr(self._inner)

    @property
    def id(self) -> str:
        return self._inner.id

    def run(self, *, inputs: Mapping[str, Any] | None = None) -> Run:
        return Run(self._worker.run(self._inner.run(inputs=inputs)), self._worker)

    def run_and_wait(self, **kwargs: Any) -> RunResult:
        return self._worker.run(self._inner.run_and_wait(**kwargs))

    def list_runs(self, **kwargs: Any) -> Mapping[str, Any]:
        return self._worker.run(self._inner.list_runs(**kwargs))

    def with_outputs(self, outputs: Mapping[str, OutputBinding], *, output_type: type | None = None) -> NotebookRef:
        return NotebookRef(self._inner.with_outputs(outputs, output_type=output_type), self._worker)


class NotebooksResource:
    """`deepnote.notebooks`, blocking."""

    def __init__(self, inner: AsyncNotebooksResource, worker: _Worker) -> None:
        self._inner = inner
        self._worker = worker

    def ref(self, notebook_id: str) -> NotebookRef:
        return NotebookRef(self._inner.ref(notebook_id), self._worker)

    def define(
        self,
        notebook_id: str,
        *,
        outputs: Mapping[str, OutputBinding] | None = None,
        output_type: type | None = None,
    ) -> NotebookRef:
        return NotebookRef(self._inner.define(notebook_id, outputs=outputs, output_type=output_type), self._worker)

    def __getitem__(self, notebook_id: str) -> NotebookRef:
        return self.ref(notebook_id)


class RunsResource:
    """`deepnote.runs`, blocking."""

    def __init__(self, inner: AsyncRunsResource, worker: _Worker) -> None:
        self._inner = inner
        self._worker = worker

    def get(self, run_id: str, **kwargs: Any) -> Run:
        return Run(self._worker.run(self._inner.get(run_id, **kwargs)), self._worker)

    def create(self, **kwargs: Any) -> Run:
        return Run(self._worker.run(self._inner.create(**kwargs)), self._worker)

    def list(self, **kwargs: Any) -> Mapping[str, Any]:
        return self._worker.run(self._inner.list(**kwargs))


class Deepnote:
    """
    A blocking Deepnote client. Same surface as `deepnote.Deepnote`, minus the `await`.

    Use it as a context manager, or call `close()`, so the background thread and the connections it
    holds are released. The thread does not start until the first call.
    """

    def __init__(
        self,
        *,
        token: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._wrap(AsyncDeepnote(token=token, base_url=base_url, timeout=timeout, client=client))

    @classmethod
    def from_env(cls, **overrides: Any) -> Deepnote:
        """A client configured from `DEEPNOTE_TOKEN` and, optionally, `DEEPNOTE_API_URL`."""
        instance = cls.__new__(cls)
        instance._wrap(AsyncDeepnote.from_env(**overrides))
        return instance

    def _wrap(self, inner: AsyncDeepnote) -> None:
        self._inner = inner
        self._worker = _Worker()
        self.base_url = inner.base_url
        self.runs = RunsResource(inner.runs, self._worker)
        self.notebooks = NotebooksResource(inner.notebooks, self._worker)

    def run_and_wait(self, notebook_id: str, *, inputs: Mapping[str, Any] | None = None, **kwargs: Any) -> RunResult:
        """`notebooks[notebook_id].run_and_wait(...)`, for the one-liner."""
        return self.notebooks.ref(notebook_id).run_and_wait(inputs=inputs, **kwargs)

    def close(self) -> None:
        """Close the connections and stop the worker thread. Safe to call more than once."""
        if self._worker.started:
            self._worker.run(self._inner.aclose())
        self._worker.stop()

    def __enter__(self) -> Deepnote:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


__all__ = ["Deepnote", "NotebookRef", "NotebooksResource", "Run", "RunsResource", "RunResult", "OutputBinding"]
