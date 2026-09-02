"""Test fixtures: a client wired to a fake Deepnote API.

Every test here is hermetic. `httpx.MockTransport` answers the requests, so nothing reaches the
network and no token is needed — which is also the repository's rule for tests.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from deepnote import Deepnote
from deepnote import runs as runs_module

SNAPSHOT_TEMPLATE = """metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: project-1
  name: SDK
  notebooks:
    - id: notebook-1
      name: Main
      blocks:
        - blockGroup: group-1
          content: print(uri)
          id: uri-block
          metadata: {{}}
          sortingKey: a0
          type: code
          executionCount: 1
          outputs:
            - output_type: stream
              name: stdout
              text: '{text}'
        - blockGroup: group-2
          content: emit stats
          id: stats-block
          metadata: {{}}
          sortingKey: a1
          type: code
          executionCount: 2
          outputs:
            - output_type: execute_result
              data:
                application/json: {stats}
              metadata: {{}}
version: '1.0.0'
"""


def snapshot(stats: Any = None, text: str = "s3://bucket/data.parquet") -> str:
    if stats is None:
        stats = {"row_count": 182451, "totals": {"eu": 0.96}, "regions": [{"name": "eu"}]}
    return SNAPSHOT_TEMPLATE.format(text=text, stats=json.dumps(stats))


#: A presigned link, as the API hands out. Tests check that its query string never reaches an error.
DOWNLOAD_URL = "https://storage.test/snapshot?X-Amz-Signature=deadbeef"


class FakeApi:
    """A minimal, scriptable stand-in for the v2 runs API."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        #: Statuses each run reports, in order. The last one repeats.
        self.statuses: list[str] = ["success"]
        self.snapshot_yaml: str | None = snapshot()
        #: Serve the snapshot as a download link instead of inline content.
        self.snapshot_as_download = False
        #: Attach the snapshot nested under `snapshot`, or flat on the run as `snapshotContent` /
        #: `snapshotDownloadUrl` — the two shapes deployments are known to use.
        self.snapshot_shape: str = "nested"
        #: What the storage server does when the download link is followed: an HTTP status, or an
        #: exception to raise from the transport.
        self.download_failure: int | Exception | None = None
        #: Responses to serve for successive `GET /v2/runs/{id}` calls before behaving normally: an
        #: HTTP status to return, an exception to raise from the transport, or `"ok"` for a normal one.
        self.poll_failures: list[int | Exception | str] = []
        #: Snapshot placeholders for successive *terminal* run responses before the real one is
        #: attached: `None` serves `snapshot: null`, `"omit"` leaves the key out entirely.
        self.late_snapshot: list[Any] = []
        self.error: Any = None
        self.fail_with: tuple[int, dict[str, Any]] | None = None
        self.run_history: dict[str, Any] = {"runs": [], "hasMore": False}
        self._polls: dict[str, int] = {}

    def handler(self) -> Callable[[httpx.Request], httpx.Response]:
        def handle(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            path = request.url.path

            if request.url.host == "storage.test":
                if isinstance(self.download_failure, Exception):
                    raise self.download_failure
                if self.download_failure is not None:
                    return httpx.Response(self.download_failure, text="denied")
                return httpx.Response(200, text=self.snapshot_yaml or "")

            if self.fail_with and path.startswith("/v2/"):
                status, body = self.fail_with
                return httpx.Response(status, json=body)

            if request.method == "POST" and path == "/v2/runs":
                body = json.loads(request.content)
                return httpx.Response(
                    200,
                    json={
                        "runId": f"run-{body['notebookId']}",
                        "status": self.statuses[0],
                        "notebookId": body["notebookId"],
                        "createdAt": "2026-01-01T00:00:00.000Z",
                    },
                )

            if request.method == "GET" and path.startswith("/v2/runs/"):
                if self.poll_failures:
                    failure = self.poll_failures.pop(0)
                    if isinstance(failure, Exception):
                        raise failure
                    if isinstance(failure, int):
                        return httpx.Response(failure, json={"message": "unavailable"})
                run_id = path.rsplit("/", 1)[-1]
                # `statuses[0]` is what creating the run reported, so polling starts at the next one.
                index = self._polls.get(run_id, 1)
                self._polls[run_id] = index + 1
                status = self.statuses[min(index, len(self.statuses) - 1)]
                return httpx.Response(200, json=self._run(run_id, status))

            if request.method == "GET" and path.endswith("/runs"):
                return httpx.Response(200, json=self.run_history)

            return httpx.Response(404, json={"message": f"unexpected {request.method} {path}"})

        return handle

    def _run(self, run_id: str, status: str) -> dict[str, Any]:
        payload: dict[str, Any] = {"runId": run_id, "status": status}
        if self.error is not None:
            payload["error"] = self.error
        if status not in {"success", "error", "internal_error", "stopped"} or self.snapshot_yaml is None:
            return payload
        if self.late_snapshot:
            placeholder = self.late_snapshot.pop(0)
            if placeholder is None:
                payload["snapshot"] = None
            return payload
        if self.snapshot_shape == "flat":
            payload["snapshotContent"] = None if self.snapshot_as_download else self.snapshot_yaml
            payload["snapshotDownloadUrl"] = DOWNLOAD_URL if self.snapshot_as_download else None
        else:
            payload["snapshot"] = (
                {"downloadUrl": DOWNLOAD_URL} if self.snapshot_as_download else {"snapshotContent": self.snapshot_yaml}
            )
        return payload


@pytest.fixture
def api() -> FakeApi:
    return FakeApi()


@pytest.fixture(autouse=True)
def sleeps(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Make every wait instant, and record what the SDK would have slept so backoff is testable."""
    recorded: list[float] = []

    async def instant(delay: float) -> None:
        recorded.append(delay)

    monkeypatch.setattr(runs_module, "_sleep", instant)
    return recorded


@pytest.fixture
def http_client(api: FakeApi) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(api.handler()))


@pytest.fixture
async def deepnote(api: FakeApi, http_client: httpx.AsyncClient):
    async with Deepnote(token="test-token", base_url="https://api.test", client=http_client) as instance:
        yield instance
    await http_client.aclose()
