"""The blocking facade: the same client, driven from code that cannot `await`."""

from __future__ import annotations

import asyncio
import threading

import httpx
import pytest

from deepnote import DeepnoteRunError, outputs
from deepnote.sync import Deepnote
from tests.conftest import FakeApi


@pytest.fixture
def deepnote_sync(api: FakeApi):
    client = httpx.AsyncClient(transport=httpx.MockTransport(api.handler()))
    with Deepnote(token="test-token", base_url="https://api.test", client=client) as instance:
        yield instance


def worker_threads() -> list[threading.Thread]:
    return [thread for thread in threading.enumerate() if thread.name == "deepnote-sdk"]


def test_runs_a_notebook_without_an_event_loop_in_sight(deepnote_sync: Deepnote, api: FakeApi) -> None:
    api.statuses = ["running", "success"]
    seen: list[str] = []
    extract = deepnote_sync.notebooks.define(
        "nb_extract",
        outputs={"rows": outputs.json("stats-block", "row_count")},
    )

    run = extract.run(inputs={"region": "eu"})
    assert run.id == "run-nb_extract"
    assert run.status == "running"
    assert run.is_terminal is False

    result = run.wait(poll_interval=0, on_status=seen.append)
    assert result.success is True
    assert result.values["rows"] == 182451
    assert seen == ["running", "success"]


def test_the_shorter_forms_are_there_too(deepnote_sync: Deepnote, api: FakeApi) -> None:
    assert deepnote_sync.notebooks["nb_extract"].run_and_wait(poll_interval=0).run_id == "run-nb_extract"
    assert deepnote_sync.run_and_wait("nb_other", inputs={"region": "eu"}, poll_interval=0).run_id == "run-nb_other"

    picked_up = deepnote_sync.runs.get("run-earlier", bindings={"uri": outputs.text("uri-block")})
    assert picked_up.wait(poll_interval=0).values["uri"] == "s3://bucket/data.parquet"
    assert picked_up.refresh().is_terminal is True


def test_a_failed_run_raises_the_same_error(deepnote_sync: Deepnote, api: FakeApi) -> None:
    api.statuses = ["error"]

    with pytest.raises(DeepnoteRunError) as caught:
        deepnote_sync.notebooks["nb_extract"].run_and_wait(poll_interval=0)

    assert caught.value.run_id == "run-nb_extract"


async def test_works_while_the_calling_thread_already_runs_an_event_loop(deepnote_sync: Deepnote, api: FakeApi) -> None:
    """The kernel case: a cell runs inside a loop, so `asyncio.run` is unavailable and nothing here awaits."""
    assert asyncio.get_running_loop().is_running()
    never_run = asyncio.sleep(0)
    with pytest.raises(RuntimeError, match="cannot be called from a running event loop"):
        asyncio.run(never_run)
    never_run.close()

    result = deepnote_sync.notebooks["nb_extract"].run_and_wait(poll_interval=0)

    assert result.run_id == "run-nb_extract"
    assert result.block("uri-block").text == "s3://bucket/data.parquet"


def test_the_worker_thread_starts_on_first_use_and_stops_on_close(api: FakeApi) -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(api.handler()))
    deepnote_sync = Deepnote(token="test-token", base_url="https://api.test", client=client)
    assert worker_threads() == []

    deepnote_sync.notebooks["nb_extract"].run_and_wait(poll_interval=0)
    assert len(worker_threads()) == 1

    deepnote_sync.close()
    assert worker_threads() == []
    deepnote_sync.close()  # idempotent


def test_from_env_reads_the_same_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPNOTE_TOKEN", "from-env")
    monkeypatch.setenv("DEEPNOTE_API_URL", "https://api.example.test")

    with Deepnote.from_env() as deepnote_sync:
        assert deepnote_sync.base_url == "https://api.example.test"

    monkeypatch.delenv("DEEPNOTE_TOKEN")
    with pytest.raises(ValueError, match="DEEPNOTE_TOKEN"):
        Deepnote.from_env()
