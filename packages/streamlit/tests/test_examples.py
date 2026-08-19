from pathlib import Path

import deepnote_streamlit
from deepnote_streamlit import InputBlock, RunnerInfo
from streamlit.testing.v1 import AppTest

REPO_ROOT = Path(__file__).parents[3]


def test_static_example_renders_snapshot_dashboard() -> None:
    app = AppTest.from_file(REPO_ROOT / "examples" / "streamlit" / "static_app.py").run(timeout=60)

    assert not app.exception
    assert app.title[0].value == "Sales performance"
    assert [metric.label for metric in app.metric] == ["Revenue", "To target", "Top region"]


def test_dynamic_example_degrades_cleanly_without_runner(monkeypatch) -> None:
    monkeypatch.delenv("DEEPNOTE_NOTEBOOK_ID", raising=False)
    monkeypatch.setenv("DEEPNOTE_RUNNER_URL", "http://127.0.0.1:1")
    app = AppTest.from_file(REPO_ROOT / "examples" / "streamlit" / "dynamic_app.py").run(timeout=15)

    assert not app.exception
    assert app.title[0].value == "Sales performance"
    assert "Could not reach Deepnote runner" in app.warning[0].value
    assert app.button[0].disabled is True


def test_dynamic_example_disables_run_for_mismatched_input_names(monkeypatch) -> None:
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
    monkeypatch.setattr(deepnote_streamlit, "DeepnoteCloudRunner", MismatchedCloudRunner)
    app = AppTest.from_file(REPO_ROOT / "examples" / "streamlit" / "dynamic_app.py").run(timeout=15)

    assert not app.exception
    assert "different input names or types" in app.warning[0].value
    assert app.button[0].disabled is True
