from pathlib import Path

import pytest

from deepnote_streamlit import DATAFRAME_MIME, DeepnoteDocument, InputBlock, RunResult, join_text

REPO_ROOT = Path(__file__).parents[3]


def test_loads_inputs_and_structured_outputs_from_real_snapshot() -> None:
    snapshot = DeepnoteDocument.load(REPO_ROOT / "examples" / "snapshot-showcase.snapshot.deepnote")

    assert snapshot.project_name == "Sales performance"
    assert [input_block.variable_name for input_block in snapshot.inputs] == [
        "report_title",
        "region",
        "trailing_months",
        "target_revenue_k",
        "show_forecast",
        "as_of",
        "period",
        "analyst_notes",
    ]
    dataframe = snapshot.first_dataframe()
    assert dataframe is not None
    assert dataframe.data_columns == ("Revenue ($k)", "Avg / mo ($k)", "Share")
    assert dataframe.records()[0]["_deepnote_index_column"] == "North America"
    assert snapshot.images()[0].startswith(b"\x89PNG\r\n\x1a\n")
    assert snapshot.agent_text().startswith("Executive readout")


def test_reads_input_metadata_from_file_and_api_shapes() -> None:
    file_input = InputBlock.from_block(
        {
            "type": "input-slider",
            "metadata": {
                "deepnote_variable_name": "limit",
                "deepnote_input_label": "Row limit",
                "deepnote_variable_value": "20",
                "deepnote_slider_min_value": 10,
                "deepnote_slider_max_value": 100,
                "deepnote_slider_step": 10,
            },
        }
    )
    api_input = InputBlock.from_api(
        {
            "variableName": "countries",
            "type": "input-select",
            "label": "Countries",
            "value": ["Panama"],
            "options": ["Panama", "Colombia"],
            "multiple": True,
        }
    )

    assert file_input == InputBlock(
        variable_name="limit",
        type="input-slider",
        label="Row limit",
        value="20",
        min=10,
        max=100,
        step=10,
    )
    assert api_input.options == ("Panama", "Colombia")
    assert api_input.multiple is True


def test_run_result_prefers_snapshot_outputs_and_preserves_cloud_fields() -> None:
    snapshot_yaml = """
project:
  name: Tiny
  notebooks:
    - blocks:
        - id: agent-1
          type: agent
          outputs:
            - output_type: display_data
              data:
                text/markdown: "**Done**"
"""

    result = RunResult(
        {
            "target": "cloud",
            "success": True,
            "runId": "run-1",
            "status": "completed",
            "created": True,
            "viewUrl": "https://deepnote.com/project/example",
            "snapshotYaml": snapshot_yaml,
            "outputs": [],
        }
    )

    assert result.success is True
    assert result.target == "cloud"
    assert result.run_id == "run-1"
    assert result.created is True
    assert result.agent_text() == "**Done**"


def test_run_result_falls_back_to_inline_outputs_without_snapshot() -> None:
    result = RunResult(
        {
            "target": "local",
            "success": True,
            "outputs": [
                {
                    "blockId": "code-1",
                    "outputs": [
                        {
                            "output_type": "execute_result",
                            "data": {
                                DATAFRAME_MIME: {
                                    "columns": [{"name": "value", "dtype": "int64"}],
                                    "rows": [{"value": 42}],
                                }
                            },
                        }
                    ],
                }
            ],
        }
    )

    assert result.first_dataframe().records() == [{"value": 42}]


@pytest.mark.parametrize(
    ("value", "expected"),
    [(["hello", " ", "world"], "hello world"), ("hello", "hello"), (None, "")],
)
def test_join_text(value: object, expected: str) -> None:
    assert join_text(value) == expected


def test_rejects_non_deepnote_yaml() -> None:
    with pytest.raises(ValueError, match="project.notebooks"):
        DeepnoteDocument.parse("hello: world")
