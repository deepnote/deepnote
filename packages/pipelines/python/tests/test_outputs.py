"""Named outputs: a client-side contract, and what happens when it does not hold."""

from __future__ import annotations

import pytest

from deepnote import Deepnote, outputs, parse_snapshot_blocks
from tests.conftest import FakeApi, snapshot


def extract(deepnote: Deepnote):
    return deepnote.notebooks.define(
        "nb_extract",
        outputs={
            "dataset_uri": outputs.text("uri-block"),
            "row_count": outputs.json("stats-block", "row_count"),
            "eu_share": outputs.json("stats-block", "totals.eu"),
            "first_region": outputs.json("stats-block", "regions[0].name"),
            "whole_stats": outputs.last_json(),
        },
    )


async def test_reads_each_declared_value_off_the_snapshot(deepnote: Deepnote, api: FakeApi) -> None:
    result = await extract(deepnote).run_and_wait(poll_interval=0)

    assert result.values["dataset_uri"] == "s3://bucket/data.parquet"
    assert result.values["row_count"] == 182451
    assert result.values["eu_share"] == 0.96
    assert result.values["first_region"] == "eu"
    assert result.values["whole_stats"]["row_count"] == 182451


async def test_names_the_binding_not_the_block_when_a_value_is_missing(deepnote: Deepnote, api: FakeApi) -> None:
    api.snapshot_yaml = snapshot(stats={"row_count": 1})

    with pytest.raises(ValueError, match="Output 'eu_share'"):
        await extract(deepnote).run_and_wait(poll_interval=0)


async def test_says_which_blocks_are_present_when_the_id_is_wrong(deepnote: Deepnote, api: FakeApi) -> None:
    notebook = deepnote.notebooks.define("nb_extract", outputs={"value": outputs.text("no-such-block")})

    with pytest.raises(ValueError, match="uri-block, stats-block"):
        await notebook.run_and_wait(poll_interval=0)


async def test_refuses_a_path_expression_it_does_not_implement(deepnote: Deepnote, api: FakeApi) -> None:
    notebook = deepnote.notebooks.define("nb_extract", outputs={"bad": outputs.json("stats-block", "regions[*].name")})

    with pytest.raises(ValueError, match="not a dotted path"):
        await notebook.run_and_wait(poll_interval=0)


async def test_all_text_needs_no_block_ids(deepnote: Deepnote, api: FakeApi) -> None:
    notebook = deepnote.notebooks.define("nb_extract", outputs={"everything": outputs.all_text()})
    result = await notebook.run_and_wait(poll_interval=0)

    assert "s3://bucket/data.parquet" in result.values["everything"]


async def test_derived_reads_whatever_the_caller_wants(deepnote: Deepnote, api: FakeApi) -> None:
    notebook = deepnote.notebooks.define(
        "nb_extract",
        outputs={"block_count": outputs.derived(lambda blocks: len(blocks), "the number of blocks")},
    )
    result = await notebook.run_and_wait(poll_interval=0)

    assert result.values["block_count"] == 2


async def test_bindings_attach_to_an_existing_ref(deepnote: Deepnote, api: FakeApi) -> None:
    notebook = deepnote.notebooks.ref("nb_extract").with_outputs({"rows": outputs.json("stats-block", "row_count")})
    result = await notebook.run_and_wait(poll_interval=0)

    assert result.values["rows"] == 182451


class TestSnapshotParsing:
    """Parsing is pure: no kernel, no network, no execution."""

    def test_reads_blocks_in_notebook_order(self) -> None:
        blocks = parse_snapshot_blocks(snapshot())

        assert [block.block_id for block in blocks] == ["uri-block", "stats-block"]
        assert blocks[0].execution_count == 1

    def test_falls_back_to_parsing_printed_json(self) -> None:
        yaml = snapshot().replace(
            """            - output_type: execute_result
              data:
                application/json: {"row_count": 182451, "totals": {"eu": 0.96}, "regions": [{"name": "eu"}]}
              metadata: {}""",
            """            - output_type: stream
              name: stdout
              text: '{"row_count": 7}'""",
        )
        blocks = parse_snapshot_blocks(yaml)

        assert blocks[1].json == {"row_count": 7}

    def test_reports_a_block_whose_output_is_not_json(self) -> None:
        blocks = parse_snapshot_blocks(snapshot())

        with pytest.raises(ValueError, match="not JSON"):
            _ = blocks[0].json

    def test_rejects_content_that_is_not_a_deepnote_snapshot(self) -> None:
        with pytest.raises(ValueError, match="not a valid .deepnote snapshot"):
            parse_snapshot_blocks("just: yaml")

    def test_reads_an_error_output_as_its_traceback(self) -> None:
        yaml = snapshot().replace(
            """            - output_type: stream
              name: stdout
              text: 's3://bucket/data.parquet'""",
            """            - output_type: error
              ename: ValueError
              evalue: bad
              traceback:
                - 'Traceback (most recent call last):'
                - 'ValueError: bad'""",
        )
        blocks = parse_snapshot_blocks(yaml)

        assert "ValueError: bad" in blocks[0].text
