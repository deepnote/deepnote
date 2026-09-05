from pathlib import Path

import deepnote_toolkit.streamlit
import pytest
from deepnote_toolkit.streamlit import InputBlock, RunnerInfo
from streamlit.testing.v1 import AppTest

REPO_ROOT = Path(__file__).parents[3]
EXAMPLE_DIR = REPO_ROOT / "examples" / "streamlit"


@pytest.fixture(autouse=True)
def add_example_import_path(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(EXAMPLE_DIR))


def test_static_example_renders_snapshot_dashboard() -> None:
    app = AppTest.from_file(EXAMPLE_DIR / "static_app.py").run(timeout=60)

    assert not app.exception
    assert app.title[0].value == "Sales performance"
    assert [metric.label for metric in app.metric] == [
        "Revenue",
        "To target",
        "Top region",
    ]


def test_dynamic_example_degrades_cleanly_without_runner(monkeypatch) -> None:
    monkeypatch.delenv("DEEPNOTE_NOTEBOOK_ID", raising=False)
    monkeypatch.delenv("DEEPNOTE_RUNNER_URL", raising=False)
    app = AppTest.from_file(EXAMPLE_DIR / "dynamic_app.py").run(timeout=15)

    assert not app.exception
    assert app.title[0].value == "Sales performance"
    assert "Set DEEPNOTE_NOTEBOOK_ID" in app.warning[0].value
    assert app.button[0].disabled is True


def test_dynamic_example_disables_run_for_mismatched_input_names(
    monkeypatch,
) -> None:
    class MismatchedCloudRunner:
        def __init__(self, _notebook_id: str):
            pass

        def info(self) -> RunnerInfo:
            return RunnerInfo(
                notebook="Different notebook",
                inputs=(InputBlock("unexpected_name", "input-text", ""),),
                run_target="cloud",
            )

    monkeypatch.setenv("DEEPNOTE_NOTEBOOK_ID", "different-notebook")
    monkeypatch.delenv("DEEPNOTE_RUNNER_URL", raising=False)
    monkeypatch.setattr(
        deepnote_toolkit.streamlit,
        "DeepnoteCloudRunner",
        MismatchedCloudRunner,
    )
    app = AppTest.from_file(EXAMPLE_DIR / "dynamic_app.py").run(timeout=15)

    assert not app.exception
    assert "different input names or types" in app.warning[0].value
    assert app.button[0].disabled is True
