import io
import json
from typing import Any
from urllib.error import HTTPError, URLError

import pytest

from deepnote_streamlit import DeepnoteCloudRunner, DeepnoteRunner, InputBlock, RunnerError, RunnerInfo


class FakeResponse:
    def __init__(self, payload: Any):
        self.payload = payload

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode()


def test_info_parses_runner_contract() -> None:
    calls = []

    def open_request(request: Any, *, timeout: float) -> FakeResponse:
        calls.append((request.full_url, request.method, timeout))
        return FakeResponse(
            {
                "notebook": "Revenue",
                "runTarget": "cloud",
                "inputs": [{"variableName": "region", "type": "input-select", "value": "All"}],
            }
        )

    info = DeepnoteRunner("http://runner/", timeout=12, opener=open_request).info()

    assert calls == [("http://runner/api/info", "GET", 12)]
    assert info.notebook == "Revenue"
    assert info.run_target == "cloud"
    assert info.inputs[0].variable_name == "region"


def test_runner_info_requires_matching_input_names_and_types() -> None:
    info = RunnerInfo(
        notebook="Revenue",
        inputs=(InputBlock("region", "input-select", "All"),),
        run_target="cloud",
    )

    assert info.accepts_inputs([InputBlock("region", "input-select", "Europe")])
    assert not info.accepts_inputs([InputBlock("market", "input-select", "Europe")])
    assert not info.accepts_inputs([InputBlock("region", "input-text", "Europe")])


def test_run_posts_inputs_and_parses_one_result_shape() -> None:
    def open_request(request: Any, *, timeout: float) -> FakeResponse:
        assert timeout == 600
        assert request.method == "POST"
        assert json.loads(request.data) == {"inputs": {"limit": 20}}
        return FakeResponse({"target": "local", "success": True, "outputs": []})

    result = DeepnoteRunner(opener=open_request).run({"limit": 20})

    assert result.target == "local"
    assert result.success is True


def test_http_error_surfaces_runner_message() -> None:
    def open_request(*_: Any, **__: Any) -> FakeResponse:
        raise HTTPError(
            "http://runner/api/run",
            500,
            "Server error",
            {},
            io.BytesIO(b'{"error":"DEEPNOTE_TOKEN is required"}'),
        )

    with pytest.raises(RunnerError, match="DEEPNOTE_TOKEN is required"):
        DeepnoteRunner("http://runner", opener=open_request).run({})


def test_connection_error_names_runner_url() -> None:
    def open_request(*_: Any, **__: Any) -> FakeResponse:
        raise URLError("connection refused")

    with pytest.raises(RunnerError, match="http://runner"):
        DeepnoteRunner("http://runner", opener=open_request).info()


def test_timeout_names_runner_url_and_duration() -> None:
    def open_request(*_: Any, **__: Any) -> FakeResponse:
        raise TimeoutError

    with pytest.raises(RunnerError, match="http://runner.*12 seconds"):
        DeepnoteRunner("http://runner", timeout=12, opener=open_request).info()


def test_cloud_info_reads_public_notebook_contract() -> None:
    def open_request(request: Any, *, timeout: float) -> FakeResponse:
        assert request.full_url == "https://api.deepnote.com/v2/notebooks/notebook-1"
        assert request.headers["Authorization"] == "Bearer token-1"
        assert timeout == 30
        return FakeResponse(
            {
                "notebook": {
                    "name": "Revenue",
                    "inputs": [{"name": "region", "type": "input-select", "value": "All", "label": "Region"}],
                }
            }
        )

    info = DeepnoteCloudRunner("notebook-1", token="token-1", opener=open_request).info()

    assert info.notebook == "Revenue"
    assert info.run_target == "cloud"
    assert info.inputs[0].variable_name == "region"


def test_cloud_run_posts_inputs_polls_and_parses_inline_snapshot() -> None:
    calls = []
    responses = iter(
        [
            {"run": {"runId": "run-1", "status": "pending"}},
            {"run": {"runId": "run-1", "status": "running"}},
            {
                "run": {
                    "runId": "run-1",
                    "status": "success",
                    "snapshot": {"snapshotContent": "project:\n  name: Result\n  notebooks:\n    - blocks: []\n"},
                }
            },
        ]
    )

    def open_request(request: Any, *, timeout: float) -> FakeResponse:
        calls.append((request.full_url, request.method, request.headers["Authorization"], request.data, timeout))
        return FakeResponse(next(responses))

    tokens = iter(["token-1", "token-2", "token-3"])
    sleeps = []
    result = DeepnoteCloudRunner(
        "notebook-1",
        token_provider=lambda: next(tokens),
        opener=open_request,
        sleep=sleeps.append,
        poll_interval=0.25,
    ).run({"limit": 20, "enabled": True, "regions": ["EU"]})

    assert json.loads(calls[0][3]) == {
        "notebookId": "notebook-1",
        "inputs": {"limit": "20", "enabled": True, "regions": ["EU"]},
    }
    assert calls[1][0].endswith("/v2/runs/run-1?snapshotDelivery=inline")
    assert [call[2] for call in calls] == ["Bearer token-1", "Bearer token-2", "Bearer token-3"]
    assert sleeps == [0.25, 0.25]
    assert result.success is True
    assert result.snapshot is not None
    assert result.snapshot.project_name == "Result"


def test_cloud_run_surfaces_terminal_error() -> None:
    def open_request(_request: Any, *, timeout: float) -> FakeResponse:
        assert timeout == 30
        return FakeResponse({"run": {"id": "run-1", "status": "error", "error": {"message": "bad input"}}})

    result = DeepnoteCloudRunner("notebook-1", token="token", opener=open_request).run({})

    assert result.success is False
    assert result.error == "bad input"


def test_cloud_runner_requires_one_token_source() -> None:
    with pytest.raises(ValueError, match="not both"):
        DeepnoteCloudRunner("notebook-1", token="token", token_provider=lambda: "other")

    with pytest.raises(RunnerError, match="token is required"):
        DeepnoteCloudRunner("notebook-1", token="", opener=lambda *_args, **_kwargs: FakeResponse({})).info()
