from pathlib import Path

import deepnote_toolkit.streamlit
import pytest
from deepnote_toolkit.notebooks import (
    DeepnoteDocument,
    InputBlock,
    NotebookOutput,
    RunnerInfo,
    RunResult,
)
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
        "Target attainment",
        "Top region",
    ]


def test_dynamic_example_degrades_cleanly_without_runner(monkeypatch) -> None:
    monkeypatch.delenv("DEEPNOTE_NOTEBOOK_ID", raising=False)
    monkeypatch.delenv("DEEPNOTE_RUNNER_URL", raising=False)
    app = AppTest.from_file(EXAMPLE_DIR / "dynamic_app.py").run(timeout=15)

    assert not app.exception
    assert app.title[0].value == "Sales performance"
    assert "Set NOTEBOOK_ID" in app.warning[0].value
    assert app.button[0].disabled is True


def test_dynamic_example_asks_for_a_token_for_local_runs(monkeypatch) -> None:
    monkeypatch.setenv("DEEPNOTE_NOTEBOOK_ID", "some-notebook")
    for name in ("DEEPNOTE_RUNNER_URL", "DEEPNOTE_TOKEN", "DEEPNOTE_PROJECT_ID"):
        monkeypatch.delenv(name, raising=False)
    app = AppTest.from_file(EXAMPLE_DIR / "dynamic_app.py").run(timeout=15)

    assert not app.exception
    assert "Set DEEPNOTE_TOKEN" in app.warning[0].value
    assert app.button[0].disabled is True


def test_dynamic_example_disables_run_for_mismatched_input_names(
    monkeypatch,
) -> None:
    class MismatchedCloudRunner:
        def __init__(self, _notebook_id: str, **_options):
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
        "StreamlitCloudRunner",
        MismatchedCloudRunner,
    )
    app = AppTest.from_file(EXAMPLE_DIR / "dynamic_app.py").run(timeout=15)

    assert not app.exception
    assert "inputs don't match" in app.warning[0].value
    assert app.button[0].disabled is True


def test_dynamic_example_shows_why_a_run_failed(monkeypatch) -> None:
    notebook = DeepnoteDocument.load(
        REPO_ROOT / "examples" / "local-runner-showcase.deepnote"
    )
    info_calls = []

    class FailingCloudRunner:
        def __init__(self, _notebook_id: str, **_options):
            pass

        def info(self) -> RunnerInfo:
            info_calls.append(1)
            return RunnerInfo(
                notebook="Dashboard", inputs=notebook.inputs, run_target="cloud"
            )

        def run(self, _inputs) -> RunResult:
            error = {
                "output_type": "error",
                "ename": "ModuleNotFoundError",
                "evalue": "No module named 'matplotlib'",
                "traceback": [],
            }
            return RunResult(
                target="cloud",
                success=False,
                status="failed",
                outputs=(NotebookOutput("block", "code", error),),
            )

    monkeypatch.setenv("DEEPNOTE_NOTEBOOK_ID", "notebook")
    monkeypatch.setenv("DEEPNOTE_TOKEN", "token")
    monkeypatch.delenv("DEEPNOTE_RUNNER_URL", raising=False)
    monkeypatch.setattr(
        deepnote_toolkit.streamlit, "StreamlitCloudRunner", FailingCloudRunner
    )
    app = AppTest.from_file(EXAMPLE_DIR / "dynamic_app.py").run(timeout=15)
    assert app.button[0].disabled is False

    app.button[0].click().run(timeout=15)

    assert not app.exception
    assert "ModuleNotFoundError: No module named 'matplotlib'" in app.error[0].value
    assert len(info_calls) == 1
