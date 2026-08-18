"""HTTP client for the unified Deepnote app runner API."""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .document import InputBlock, RunResult

OpenUrl = Callable[..., Any]
TokenProvider = Callable[[], str]
Sleep = Callable[[float], None]

TERMINAL_RUN_STATUSES = frozenset({"success", "error", "internal_error", "stopped"})


class RunnerError(RuntimeError):
    """The Deepnote runner was unavailable or rejected a request."""


@dataclass(frozen=True)
class RunnerInfo:
    notebook: str
    inputs: tuple[InputBlock, ...]
    run_target: str


class DeepnoteRunner:
    """One client for a runner configured for Deepnote Cloud or a local kernel."""

    def __init__(self, base_url: str = "http://127.0.0.1:8787", *, timeout: float = 600, opener: OpenUrl = urlopen):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._open = opener

    def info(self) -> RunnerInfo:
        payload = self._request("GET", "/api/info")
        values = payload.get("inputs")
        inputs = (
            tuple(InputBlock.from_api(value) for value in values if isinstance(value, Mapping))
            if isinstance(values, list)
            else ()
        )
        return RunnerInfo(
            notebook=str(payload.get("notebook", "Untitled project")),
            inputs=inputs,
            run_target=str(payload.get("runTarget", "")),
        )

    def run(self, inputs: Mapping[str, Any]) -> RunResult:
        return RunResult(self._request("POST", "/api/run", {"inputs": dict(inputs)}))

    def _request(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
        encoded = json.dumps(body).encode() if body is not None else None
        request = Request(
            f"{self.base_url}{path}",
            data=encoded,
            method=method,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with self._open(request, timeout=self.timeout) as response:
                payload = json.loads(response.read())
        except HTTPError as error:
            detail = error.read().decode(errors="replace")
            try:
                parsed_detail = json.loads(detail)
                message = parsed_detail.get("error", detail) if isinstance(parsed_detail, Mapping) else detail
            except json.JSONDecodeError:
                message = detail
            raise RunnerError(f"Deepnote runner returned HTTP {error.code}: {message}") from error
        except URLError as error:
            raise RunnerError(f"Could not reach Deepnote runner at {self.base_url}: {error.reason}") from error
        except TimeoutError as error:
            raise RunnerError(f"Deepnote runner at {self.base_url} timed out after {self.timeout:g} seconds") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RunnerError("Deepnote runner returned an invalid JSON response") from error
        if not isinstance(payload, Mapping):
            raise RunnerError("Deepnote runner returned a non-object response")
        return payload


class DeepnoteCloudRunner:
    """Run an existing notebook directly through the Deepnote public API.

    A token provider is called for every request, which lets long-lived Streamlit
    sessions use short-lived credentials without caching them in this library.
    """

    def __init__(
        self,
        notebook_id: str,
        *,
        token: str | None = None,
        token_provider: TokenProvider | None = None,
        base_url: str = "https://api.deepnote.com",
        timeout: float = 600,
        poll_interval: float = 2,
        opener: OpenUrl = urlopen,
        sleep: Sleep = time.sleep,
    ):
        if not notebook_id:
            raise ValueError("notebook_id is required")
        if token is not None and token_provider is not None:
            raise ValueError("Pass token or token_provider, not both")
        self.notebook_id = notebook_id
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.poll_interval = poll_interval
        self._static_token = token
        self._token_provider = token_provider
        self._open = opener
        self._sleep = sleep

    def info(self) -> RunnerInfo:
        payload = self._request("GET", f"/v2/notebooks/{self.notebook_id}")
        notebook = payload.get("notebook")
        if not isinstance(notebook, Mapping):
            raise RunnerError("Deepnote API response did not include a notebook")
        raw_inputs = notebook.get("inputs")
        inputs = tuple(
            InputBlock.from_api(
                {
                    "variableName": value.get("name"),
                    "type": value.get("type"),
                    "value": value.get("value"),
                    "label": value.get("label"),
                }
            )
            for value in raw_inputs or []
            if isinstance(value, Mapping) and isinstance(value.get("name"), str)
        )
        return RunnerInfo(notebook=str(notebook.get("name", "Untitled notebook")), inputs=inputs, run_target="cloud")

    def run(self, inputs: Mapping[str, Any]) -> RunResult:
        started = self._run_payload(
            self._request(
                "POST",
                "/v2/runs",
                {"notebookId": self.notebook_id, "inputs": _normalize_cloud_inputs(inputs)},
            )
        )
        run_id = _required_run_id(started)
        deadline = time.monotonic() + self.timeout
        current = started
        while str(current.get("status", "")) not in TERMINAL_RUN_STATUSES:
            if time.monotonic() >= deadline:
                raise RunnerError(f"Deepnote run {run_id} did not finish within {self.timeout:g} seconds")
            self._sleep(self.poll_interval)
            current = self._run_payload(self._request("GET", f"/v2/runs/{run_id}?snapshotDelivery=inline"))

        status = str(current.get("status", ""))
        snapshot = current.get("snapshot")
        snapshot_yaml = current.get("snapshotContent")
        if snapshot_yaml is None and isinstance(snapshot, Mapping):
            snapshot_yaml = snapshot.get("snapshotContent")
        error = current.get("error")
        if isinstance(error, Mapping):
            error = error.get("message") or json.dumps(error)
        return RunResult(
            {
                "target": "cloud",
                "success": status == "success",
                "runId": run_id,
                "status": status,
                "error": str(error) if error is not None else None,
                "snapshotYaml": snapshot_yaml,
                "viewUrl": current.get("viewUrl"),
            }
        )

    def _request(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
        encoded = json.dumps(body).encode() if body is not None else None
        request = Request(
            f"{self.base_url}{path}",
            data=encoded,
            method=method,
            headers={
                "Authorization": f"Bearer {self._token()}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with self._open(request, timeout=min(self.timeout, 30)) as response:
                payload = json.loads(response.read())
        except HTTPError as error:
            detail = error.read().decode(errors="replace")
            try:
                parsed = json.loads(detail)
                message = (
                    parsed.get("message") or parsed.get("error") or detail if isinstance(parsed, Mapping) else detail
                )
            except json.JSONDecodeError:
                message = detail
            raise RunnerError(f"Deepnote API returned HTTP {error.code}: {message}") from error
        except URLError as error:
            raise RunnerError(f"Could not reach the Deepnote API at {self.base_url}: {error.reason}") from error
        except TimeoutError as error:
            raise RunnerError("Deepnote API request timed out") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RunnerError("Deepnote API returned an invalid JSON response") from error
        if not isinstance(payload, Mapping):
            raise RunnerError("Deepnote API returned a non-object response")
        return payload

    def _token(self) -> str:
        token = (
            self._token_provider() if self._token_provider else self._static_token or os.environ.get("DEEPNOTE_TOKEN")
        )
        if not token:
            raise RunnerError("A Deepnote API token is required")
        return token

    @staticmethod
    def _run_payload(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        run = payload.get("run")
        return run if isinstance(run, Mapping) else payload


def _required_run_id(run: Mapping[str, Any]) -> str:
    run_id = run.get("runId") or run.get("id")
    if not isinstance(run_id, str) or not run_id:
        raise RunnerError("Deepnote API response did not include a run id")
    return run_id


def _normalize_cloud_inputs(inputs: Mapping[str, Any]) -> dict[str, str | bool | list[str]]:
    normalized: dict[str, str | bool | list[str]] = {}
    for name, value in inputs.items():
        if isinstance(value, bool):
            normalized[name] = value
        elif isinstance(value, list):
            normalized[name] = [str(item) for item in value]
        else:
            normalized[name] = str(value)
    return normalized
