"""An optional workflow context — for observability, not orchestration.

Nothing here schedules, persists, replays, supervises, or interprets. It emits an event when a step
starts and another when it settles, so a run of a multi-notebook script can be logged, traced, or
drawn. Sequencing is still `await`; concurrency is still `asyncio`; branching is still `if`.

The reason it is worth having at all is that a step's *name* is otherwise nowhere: a run id tells
you which notebook ran, not what it meant in this piece of work.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from deepnote.errors import DeepnoteRunError
from deepnote.outputs import OutputBinding
from deepnote.runs import RunResult


@dataclass(frozen=True, slots=True)
class StepStarted:
    workflow: str
    step: str
    run_id: str
    notebook_id: str


@dataclass(frozen=True, slots=True)
class StepCompleted:
    workflow: str
    step: str
    run_id: str
    status: str
    duration: float


@dataclass(frozen=True, slots=True)
class StepFailed:
    workflow: str
    step: str
    run_id: str | None
    status: str | None
    error: str


Event = StepStarted | StepCompleted | StepFailed


class Workflow:
    """A named piece of work whose steps emit events. Created by `deepnote.workflow(name)`."""

    def __init__(self, name: str, *, notebooks: Any, on_event: Callable[[Event], None] | None = None) -> None:
        self.name = name
        self._notebooks = notebooks
        self._on_event = on_event
        #: Every event this workflow emitted, in order. Enough to draw what happened afterwards.
        self.events: list[Event] = []

    async def __aenter__(self) -> Workflow:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    def _emit(self, event: Event) -> None:
        self.events.append(event)
        if self._on_event:
            self._on_event(event)

    async def run(
        self,
        step: str,
        *,
        notebook: str,
        inputs: Mapping[str, Any] | None = None,
        outputs: Mapping[str, OutputBinding] | None = None,
        output_type: type | None = None,
        allow_failure: bool = False,
        timeout: float | None = None,
    ) -> RunResult:
        """
        Run one notebook as a named step of this workflow.

        Exactly `notebooks.define(...).run()` then `wait()`, with three events around it. There is no
        registry, no dependency declaration, and no retry policy: whatever `await`s this call is the
        thing that decides what happens next.
        """
        ref = self._notebooks.define(notebook, outputs=outputs, output_type=output_type)
        started = time.monotonic()
        run = await ref.run(inputs=inputs)
        self._emit(StepStarted(workflow=self.name, step=step, run_id=run.id, notebook_id=notebook))

        try:
            kwargs: dict[str, Any] = {"allow_failure": allow_failure}
            if timeout is not None:
                kwargs["timeout"] = timeout
            result = await run.wait(**kwargs)
        except DeepnoteRunError as error:
            self._emit(
                StepFailed(
                    workflow=self.name,
                    step=step,
                    run_id=error.run_id,
                    status=error.status,
                    error=str(error),
                )
            )
            raise
        except Exception as error:  # noqa: BLE001 - re-raised; the event is the only added behavior
            self._emit(StepFailed(workflow=self.name, step=step, run_id=run.id, status=None, error=str(error)))
            raise

        self._emit(
            StepCompleted(
                workflow=self.name,
                step=step,
                run_id=result.run_id,
                status=result.status,
                duration=time.monotonic() - started,
            )
        )
        return result
