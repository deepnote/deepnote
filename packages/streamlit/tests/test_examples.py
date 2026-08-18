from pathlib import Path

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
