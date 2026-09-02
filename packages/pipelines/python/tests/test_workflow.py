"""The workflow context: observability, and deliberately nothing else."""

from __future__ import annotations

import asyncio

import pytest

from deepnote import Deepnote, DeepnoteRunError, StepCompleted, StepFailed, StepStarted, outputs
from tests.conftest import FakeApi


async def test_emits_a_started_and_completed_event_per_step(deepnote: Deepnote, api: FakeApi) -> None:
    seen: list[object] = []
    async with deepnote.workflow("daily-revenue", on_event=seen.append) as workflow:
        await workflow.run("extract", notebook="nb_extract", inputs={"region": "eu"})
        await workflow.run("publish", notebook="nb_publish")

    assert [type(event) for event in seen] == [StepStarted, StepCompleted, StepStarted, StepCompleted]
    assert [event.step for event in seen] == ["extract", "extract", "publish", "publish"]
    assert isinstance(seen[0], StepStarted) and seen[0].run_id == "run-nb_extract"
    assert workflow.events == seen


async def test_passes_outputs_through_like_any_other_call(deepnote: Deepnote, api: FakeApi) -> None:
    async with deepnote.workflow("daily-revenue") as workflow:
        result = await workflow.run(
            "extract",
            notebook="nb_extract",
            outputs={"rows": outputs.json("stats-block", "row_count")},
        )

    assert result.values["rows"] == 182451


async def test_emits_a_failed_event_and_re_raises(deepnote: Deepnote, api: FakeApi) -> None:
    api.statuses = ["error"]
    seen: list[object] = []

    with pytest.raises(DeepnoteRunError):
        async with deepnote.workflow("daily-revenue", on_event=seen.append) as workflow:
            await workflow.run("extract", notebook="nb_extract")

    assert [type(event) for event in seen] == [StepStarted, StepFailed]
    assert isinstance(seen[1], StepFailed) and seen[1].status == "error"


async def test_adds_no_sequencing_of_its_own(deepnote: Deepnote, api: FakeApi) -> None:
    """Concurrency is asyncio's, not the workflow's: two steps started together run together."""
    async with deepnote.workflow("daily-revenue") as workflow:
        first, second = await asyncio.gather(
            workflow.run("customers", notebook="nb_customers"),
            workflow.run("products", notebook="nb_products"),
        )

    assert {first.run_id, second.run_id} == {"run-nb_customers", "run-nb_products"}
    # No dependency was declared anywhere, and none was inferred.
    assert len(workflow.events) == 4
