"""The run handle: starting, waiting, picking one up, and failing."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date

import httpx
import pytest

from deepnote import Deepnote, DeepnoteAPIError, DeepnoteRunError, DeepnoteRunTimeout, outputs, to_run_inputs
from tests.conftest import FakeApi, snapshot


def polls(api: FakeApi) -> int:
    return sum(1 for request in api.requests if request.method == "GET" and "/v2/runs/" in request.url.path)


async def test_run_returns_a_handle_without_waiting(deepnote: Deepnote, api: FakeApi) -> None:
    api.statuses = ["running", "success"]
    run = await deepnote.notebooks.ref("nb_extract").run(inputs={"region": "eu"})

    assert run.id == "run-nb_extract"
    assert run.status == "running"
    assert run.is_terminal is False
    # Starting a run is one call. Waiting is a separate operation on the handle.
    assert [request.method for request in api.requests] == ["POST"]


async def test_wait_polls_until_terminal_and_reports_status_changes(deepnote: Deepnote, api: FakeApi) -> None:
    api.statuses = ["running", "running", "success"]
    seen: list[str] = []
    run = await deepnote.notebooks.ref("nb_extract").run()
    result = await run.wait(poll_interval=0, on_status=seen.append)

    assert result.success is True
    assert result.status == "success"
    assert seen == ["running", "success"]
    assert result.duration >= 0


async def test_run_and_wait_is_the_two_together(deepnote: Deepnote, api: FakeApi) -> None:
    result = await deepnote.notebooks.ref("nb_extract").run_and_wait(inputs={"region": "eu"}, poll_interval=0)

    assert result.status == "success"
    assert result.snapshot_yaml is not None
    assert [block.block_id for block in result.blocks] == ["uri-block", "stats-block"]


async def test_snapshot_served_as_a_download_link_is_fetched(deepnote: Deepnote, api: FakeApi) -> None:
    api.snapshot_as_download = True
    result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

    assert result.block("uri-block").text == "s3://bucket/data.parquet"


async def test_a_failed_run_raises_with_the_result_attached(deepnote: Deepnote, api: FakeApi) -> None:
    api.statuses = ["error"]
    api.error = {"message": "cell 3 raised ValueError"}

    with pytest.raises(DeepnoteRunError) as caught:
        await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

    assert caught.value.status == "error"
    assert caught.value.run_id == "run-nb_extract"
    # The snapshot is usually the only record of what the failing block said, so it survives.
    assert caught.value.result.blocks != ()
    assert "ValueError" in str(caught.value)


async def test_allow_failure_returns_the_failed_run_instead(deepnote: Deepnote, api: FakeApi) -> None:
    api.statuses = ["error"]
    result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0, allow_failure=True)

    assert result.success is False
    assert result.status == "error"
    assert result.error
    # Bindings are not resolved for a failure the caller asked to see: an unreadable output must not
    # mask the failure it was going to explain.
    assert result.values == {}


async def test_a_malformed_snapshot_does_not_destroy_the_result(deepnote: Deepnote, api: FakeApi) -> None:
    api.snapshot_yaml = "this is not a deepnote snapshot"
    result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

    assert result.success is True
    assert result.run_id == "run-nb_extract"
    assert result.blocks == ()
    # Still there for a caller to inspect, which is the whole reason not to raise.
    assert result.snapshot_yaml == "this is not a deepnote snapshot"


async def test_timeout_names_the_run_so_it_can_be_picked_up_later(deepnote: Deepnote, api: FakeApi) -> None:
    api.statuses = ["running"]
    run = await deepnote.notebooks.ref("nb_extract").run()

    with pytest.raises(DeepnoteRunTimeout) as caught:
        await run.wait(timeout=0, poll_interval=0)

    assert caught.value.run_id == "run-nb_extract"
    assert "continues in Deepnote" in str(caught.value)


async def test_refresh_reads_the_current_state_without_waiting(deepnote: Deepnote, api: FakeApi) -> None:
    api.statuses = ["running", "success"]
    run = await deepnote.notebooks.ref("nb_extract").run()
    refreshed = await run.refresh()

    assert run.status == "running"
    assert refreshed.status == "success"
    assert refreshed.is_terminal is True


async def test_get_picks_up_a_run_this_process_did_not_start(deepnote: Deepnote, api: FakeApi) -> None:
    run = await deepnote.runs.get("run-earlier", bindings={"rows": outputs.json("stats-block", "row_count")})
    result = await run.wait(poll_interval=0)

    assert run.id == "run-earlier"
    assert result.values["rows"] == 182451
    assert all(request.method == "GET" for request in api.requests)


async def test_list_runs_reads_the_notebook_history(deepnote: Deepnote, api: FakeApi) -> None:
    api.run_history = {"runs": [{"runId": "run-1", "status": "success"}], "hasMore": False}
    page = await deepnote.notebooks.ref("nb_extract").list_runs(page_size=5)

    assert page["runs"][0]["runId"] == "run-1"
    assert api.requests[-1].url.params["pageSize"] == "5"


async def test_an_api_error_carries_the_status_code_and_a_hint(deepnote: Deepnote, api: FakeApi) -> None:
    api.fail_with = (403, {"message": "forbidden"})

    with pytest.raises(DeepnoteAPIError) as caught:
        await deepnote.notebooks.ref("nb_extract").run()

    assert caught.value.status_code == 403
    assert "access to this notebook" in str(caught.value)


async def test_an_empty_notebook_id_is_refused_before_any_request(deepnote: Deepnote, api: FakeApi) -> None:
    with pytest.raises(ValueError, match="notebook id is required"):
        deepnote.notebooks.ref("")

    assert api.requests == []


def test_a_token_is_required_and_the_error_says_how_to_supply_one() -> None:
    with pytest.raises(ValueError, match="DEEPNOTE_TOKEN"):
        Deepnote(token="")


def test_from_env_reads_the_token_and_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPNOTE_TOKEN", "from-env")
    monkeypatch.setenv("DEEPNOTE_API_URL", "https://api.example.test")

    assert Deepnote.from_env().base_url == "https://api.example.test"

    monkeypatch.delenv("DEEPNOTE_TOKEN")
    with pytest.raises(ValueError, match="DEEPNOTE_TOKEN"):
        Deepnote.from_env()


def test_defaults_to_deepnote_cloud(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPNOTE_API_URL", raising=False)
    assert Deepnote(token="t").base_url == "https://api.deepnote.com"


class TestInputCoercion:
    """`POST /v2/runs` takes exactly str | bool | list[str]. Everything else is decided here."""

    def test_gives_numbers_and_dates_their_obvious_textual_form(self) -> None:
        assert to_run_inputs({"months": 6, "ratio": 0.5, "day": date(2026, 3, 1)}) == {
            "months": "6",
            "ratio": "0.5",
            "day": "2026-03-01",
        }

    def test_passes_through_what_the_api_already_accepts(self) -> None:
        assert to_run_inputs({"region": "eu", "live": True, "tags": ["a", "b"]}) == {
            "region": "eu",
            "live": True,
            "tags": ["a", "b"],
        }

    def test_drops_none_rather_than_sending_null(self) -> None:
        assert to_run_inputs({"region": None}) == {}

    def test_refuses_a_value_with_no_unambiguous_textual_form(self) -> None:
        with pytest.raises(TypeError, match="portfolio"):
            to_run_inputs({"portfolio": {"total": 1}})


async def test_a_pipeline_is_just_python(deepnote: Deepnote, api: FakeApi) -> None:
    """Fan out with `asyncio.gather`, gate with a comprehension. No pipeline API involved."""
    regions = ["na", "eu", "apac"]

    results = await asyncio.gather(
        *(
            deepnote.notebooks.define(f"nb_{region}", outputs={"reading": outputs.last_json()}).run_and_wait(
                inputs={"region": region}, poll_interval=0
            )
            for region in regions
        )
    )
    below = [r.values["reading"] for r in results if r.values["reading"]["totals"]["eu"] < 0.97]

    assert [result.run_id for result in results] == ["run-nb_na", "run-nb_eu", "run-nb_apac"]
    assert len(below) == 3


@dataclass
class ExtractOutput:
    dataset_uri: str
    row_count: int


async def test_a_dataclass_output_type_is_populated(deepnote: Deepnote, api: FakeApi) -> None:
    extract = deepnote.notebooks.define(
        "nb_extract",
        outputs={
            "dataset_uri": outputs.text("uri-block"),
            "row_count": outputs.json("stats-block", "row_count"),
        },
        output_type=ExtractOutput,
    )
    result = await extract.run_and_wait(poll_interval=0)

    assert result.output == ExtractOutput(dataset_uri="s3://bucket/data.parquet", row_count=182451)


async def test_an_output_type_that_does_not_match_the_bindings_says_so(deepnote: Deepnote, api: FakeApi) -> None:
    extract = deepnote.notebooks.define(
        "nb_extract",
        outputs={"dataset_uri": outputs.text("uri-block")},
        output_type=ExtractOutput,
    )

    with pytest.raises(ValueError, match="do not match ExtractOutput"):
        await extract.run_and_wait(poll_interval=0)


async def test_snapshot_with_no_content_leaves_blocks_empty(deepnote: Deepnote, api: FakeApi) -> None:
    api.snapshot_yaml = None
    result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

    assert result.blocks == ()
    assert result.snapshot_yaml is None


class TestPollingResilience:
    """`wait()` outlives a flaky API, and mirrors the TypeScript client's `pollRunUntilComplete`."""

    async def test_retries_transient_failures_with_capped_exponential_backoff(
        self, deepnote: Deepnote, api: FakeApi, sleeps: list[float]
    ) -> None:
        api.statuses = ["running", "success"]
        api.poll_failures = [503, 429, httpx.ConnectError("connection reset"), 502]
        run = await deepnote.notebooks.ref("nb_extract").run()
        result = await run.wait(poll_interval=10)

        assert result.success is True
        # The poll interval, then 20s, 40s capped to 30s, and 30s twice more before the poll that worked.
        assert sleeps == [10, 20, 30, 30, 30]
        assert polls(api) == 5

    async def test_gives_up_after_five_transient_failures_in_a_row(self, deepnote: Deepnote, api: FakeApi) -> None:
        api.statuses = ["running", "success"]
        api.poll_failures = [503] * 6
        run = await deepnote.notebooks.ref("nb_extract").run()

        with pytest.raises(DeepnoteAPIError) as caught:
            await run.wait(poll_interval=0)

        assert caught.value.status_code == 503
        assert polls(api) == 6

    async def test_a_successful_poll_resets_the_failure_budget(self, deepnote: Deepnote, api: FakeApi) -> None:
        api.statuses = ["running", "running", "success"]
        # Five failures, one good poll, five more: the budget is for *consecutive* failures.
        api.poll_failures = [500] * 5 + ["ok"] + [500] * 5
        run = await deepnote.notebooks.ref("nb_extract").run()
        result = await run.wait(poll_interval=0)

        assert result.success is True
        assert polls(api) == 12

    async def test_does_not_retry_an_error_that_will_not_go_away(self, deepnote: Deepnote, api: FakeApi) -> None:
        api.statuses = ["running", "success"]
        api.poll_failures = [404]
        run = await deepnote.notebooks.ref("nb_extract").run()

        with pytest.raises(DeepnoteAPIError) as caught:
            await run.wait(poll_interval=0)

        assert caught.value.status_code == 404
        assert polls(api) == 1


class TestSnapshotSettle:
    """A terminal status can precede the snapshot being attached; the payload comes in two shapes."""

    async def test_re_fetches_a_terminal_run_until_its_snapshot_is_attached(
        self, deepnote: Deepnote, api: FakeApi, sleeps: list[float]
    ) -> None:
        api.statuses = ["running", "success"]
        # The first terminal response has no `snapshot` key at all, the second says `snapshot: null`.
        api.late_snapshot = ["omit", None]
        result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

        assert result.block("uri-block").text == "s3://bucket/data.parquet"
        # One poll interval, then one settle delay: the first re-fetch is immediate.
        assert sleeps == [0, 1.5]
        assert polls(api) == 3

    async def test_treats_a_snapshot_that_never_arrives_as_absent_after_three_re_fetches(
        self, deepnote: Deepnote, api: FakeApi, sleeps: list[float]
    ) -> None:
        api.snapshot_yaml = None
        result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

        assert result.success is True
        assert result.snapshot_yaml is None
        assert polls(api) == 3
        assert sleeps == [1.5, 1.5]

    async def test_reads_the_flat_payload_shape_inline(self, deepnote: Deepnote, api: FakeApi) -> None:
        api.snapshot_shape = "flat"
        result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

        assert "snapshot" not in result.raw and "snapshotContent" in result.raw
        assert result.block("uri-block").text == "s3://bucket/data.parquet"

    async def test_reads_the_flat_payload_shape_as_a_download(self, deepnote: Deepnote, api: FakeApi) -> None:
        api.snapshot_shape = "flat"
        api.snapshot_as_download = True
        result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

        assert result.raw["snapshotContent"] is None
        assert result.block("uri-block").text == "s3://bucket/data.parquet"
        assert api.requests[-1].url.host == "storage.test"

    @pytest.mark.parametrize(
        ("failure", "expected"),
        [(403, "returned 403"), (httpx.ConnectError("connection reset"), "ConnectError")],
    )
    async def test_a_failed_download_names_the_cause_but_never_the_presigned_url(
        self, deepnote: Deepnote, api: FakeApi, failure: int | Exception, expected: str
    ) -> None:
        api.snapshot_as_download = True
        api.download_failure = failure

        with pytest.raises(DeepnoteAPIError) as caught:
            await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

        message = str(caught.value)
        assert expected in message
        assert "storage.test" not in message
        assert "X-Amz-Signature" not in message


async def test_notebooks_can_be_indexed(deepnote: Deepnote, api: FakeApi) -> None:
    result = await deepnote.notebooks["nb_extract"].run_and_wait(poll_interval=0)
    assert result.run_id == "run-nb_extract"


async def test_result_text_concatenates_every_block(deepnote: Deepnote, api: FakeApi) -> None:
    api.snapshot_yaml = snapshot(stats={"row_count": 1}, text="line")
    result = await deepnote.notebooks.ref("nb_extract").run_and_wait(poll_interval=0)

    assert result.text.startswith("line")
    assert result.block("stats-block").json == {"row_count": 1}
