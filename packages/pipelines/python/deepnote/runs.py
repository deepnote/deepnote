"""Runs: the primitive worth making excellent.

`POST /v2/runs` returns a run id, and the run continues whether or not anything is watching it.
Everything a caller builds on top — fan-out, gates, retries — is their own control flow awaiting
these handles, which is why this module makes `Run` good rather than making `Pipeline` clever.

`wait()` is polling and nothing more. It holds no state the server does not already have, so a
process that dies mid-wait loses only the waiting: the run carries on, and a later
`(await deepnote.runs.get(run_id)).wait()` picks the result up.
"""

from __future__ import annotations

import asyncio
import dataclasses
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import httpx

from deepnote._http import Transport
from deepnote._snapshot import BlockOutput, parse_snapshot_blocks
from deepnote.errors import DeepnoteAPIError, DeepnoteRunError, DeepnoteRunTimeout
from deepnote.outputs import OutputBinding, resolve

TERMINAL_STATUSES = frozenset({"success", "error", "internal_error", "stopped"})
FAILED_STATUSES = frozenset({"error", "internal_error", "stopped"})

DEFAULT_POLL_INTERVAL = 2.0
DEFAULT_TIMEOUT = 30 * 60.0
#: Consecutive transient poll failures (429, 5xx, network) tolerated before `wait()` gives up.
MAX_TRANSIENT_RETRIES = 5
#: Ceiling on the exponential backoff between retried polls, in seconds.
MAX_BACKOFF = 30.0
#: A terminal run can be reported before its snapshot is attached: re-fetch this many times first.
SNAPSHOT_SETTLE_ATTEMPTS = 3
SNAPSHOT_SETTLE_INTERVAL = 1.5

# Module-level so tests can replace it with something instant and record what would have been slept.
_sleep = asyncio.sleep


@dataclass(frozen=True, slots=True)
class RunResult:
    """What one finished run produced."""

    run_id: str
    status: str
    success: bool
    started_at: float
    finished_at: float
    blocks: tuple[BlockOutput, ...] = field(default=())
    snapshot_yaml: str | None = None
    error: str | None = None
    #: The named outputs the notebook's bindings declared. Empty when there are none.
    values: Mapping[str, Any] = field(default_factory=dict)
    #: `values` as the dataclass passed to `notebooks.define(output_type=...)`, else None.
    output: Any = None
    raw: Any = None

    @property
    def duration(self) -> float:
        """Seconds from starting the run to reading its snapshot."""
        return self.finished_at - self.started_at

    def block(self, block_id: str) -> BlockOutput:
        """One block of the snapshot, by id."""
        for block in self.blocks:
            if block.block_id == block_id:
                return block
        known = ", ".join(block.block_id for block in self.blocks) or "none"
        raise KeyError(f"No block {block_id!r} in run {self.run_id}. Blocks present: {known}.")

    @property
    def text(self) -> str:
        """Every block's textual output, in notebook order."""
        return "".join(block.text for block in self.blocks)


class Run:
    """A started run: an id, a status, and the operations you can perform on it."""

    def __init__(
        self,
        payload: Mapping[str, Any],
        *,
        transport: Transport,
        bindings: Mapping[str, OutputBinding] | None = None,
        output_type: type | None = None,
        started_at: float | None = None,
    ) -> None:
        self._transport = transport
        self._bindings = dict(bindings or {})
        self._output_type = output_type
        self._started_at = started_at if started_at is not None else time.monotonic()
        self.raw = payload
        self.id: str = str(payload.get("runId") or payload.get("id") or "")
        self.status: str = str(payload.get("status") or "pending")
        self.notebook_id: str | None = payload.get("notebookId")
        self.created_at: str | None = payload.get("createdAt")
        if not self.id:
            raise ValueError(f"Deepnote returned a run with no id: {payload!r}")

    def __repr__(self) -> str:
        return f"Run(id={self.id!r}, status={self.status!r})"

    @property
    def is_terminal(self) -> bool:
        """True once the run has reached a state it will not leave."""
        return self.status in TERMINAL_STATUSES

    async def refresh(self) -> Run:
        """Fetch the run's current state. Returns a new handle; this one is left as it was."""
        payload = await self._transport.request("GET", f"/v2/runs/{self.id}")
        return Run(
            _run_payload(payload),
            transport=self._transport,
            bindings=self._bindings,
            output_type=self._output_type,
            started_at=self._started_at,
        )

    async def wait(
        self,
        *,
        timeout: float | None = DEFAULT_TIMEOUT,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        on_status: Callable[[str], None] | None = None,
        allow_failure: bool = False,
    ) -> RunResult:
        """
        Poll until the run finishes, then read its snapshot.

        Polling tolerates the API being briefly unavailable: a 429, a 5xx, or a network error is
        retried up to `MAX_TRANSIENT_RETRIES` times with exponential backoff (capped at
        `MAX_BACKOFF` seconds) before it is raised. Anything else is raised at once.

        Raises :class:`DeepnoteRunError` for a failed run unless `allow_failure` is set. A failed run
        is still returned with its snapshot in that case, because the snapshot is where the failing
        block's error is.
        """
        deadline = None if timeout is None else time.monotonic() + timeout
        status = self.status
        payload: Mapping[str, Any] = self.raw
        failures = 0
        delay = poll_interval

        if on_status:
            on_status(status)

        while status not in TERMINAL_STATUSES:
            if deadline is not None and time.monotonic() >= deadline:
                raise DeepnoteRunTimeout(self.id, status, timeout or 0)
            await _sleep(delay if deadline is None else min(delay, max(0.0, deadline - time.monotonic())))
            try:
                payload = await self._fetch()
            except DeepnoteAPIError as error:
                if failures >= MAX_TRANSIENT_RETRIES or not _is_transient(error):
                    raise
                failures += 1
                delay = min(poll_interval * 2**failures, MAX_BACKOFF)
                continue
            failures = 0
            delay = poll_interval
            next_status = str(payload.get("status") or status)
            if next_status != status and on_status:
                on_status(next_status)
            status = next_status

        # Read the snapshot even for a failed run: it is usually the only record of what went wrong.
        payload, snapshot_yaml = await self._settle_snapshot(payload)
        blocks = _parse_safely(snapshot_yaml)
        success = status not in FAILED_STATUSES

        result = RunResult(
            run_id=self.id,
            status=status,
            success=success,
            started_at=self._started_at,
            finished_at=time.monotonic(),
            blocks=blocks,
            snapshot_yaml=snapshot_yaml,
            error=None if success else _describe_error(payload, status),
            raw=payload,
        )

        if not success and not allow_failure:
            raise DeepnoteRunError(result)

        # Bindings are only resolvable from a run that produced outputs; a failed run the caller
        # chose to allow gets empty values rather than an error that hides the failure it asked for.
        if not success:
            return result
        values = resolve(self._bindings, blocks, self.id)
        return dataclasses.replace(result, values=values, output=_as_output(self._output_type, values))

    async def _fetch(self) -> Mapping[str, Any]:
        return _run_payload(await self._transport.request("GET", f"/v2/runs/{self.id}"))

    async def _settle_snapshot(self, payload: Mapping[str, Any]) -> tuple[Mapping[str, Any], str | None]:
        """
        A terminal run's snapshot, waiting briefly for it to be attached.

        Deepnote can report a run terminal before its snapshot is attached, and the response that
        created an already-finished run never carries one. So a terminal payload without a snapshot
        (or with `snapshot: null`) is re-fetched up to `SNAPSHOT_SETTLE_ATTEMPTS` times before the
        snapshot is treated as genuinely absent — which is valid for a run that produced nothing.

        A snapshot that is advertised but cannot be downloaded is a different matter: that error is
        raised once the attempts run out, so an unavailable artifact is never mistaken for an empty one.
        """
        read_error: DeepnoteAPIError | None = None
        for attempt in range(SNAPSHOT_SETTLE_ATTEMPTS + 1):
            snapshot = _snapshot_of(payload)
            if snapshot is not None:
                try:
                    content = await self._read_snapshot(snapshot)
                except DeepnoteAPIError as error:
                    read_error = error
                else:
                    if content:
                        return payload, content
            if attempt == SNAPSHOT_SETTLE_ATTEMPTS:
                break
            if attempt > 0:
                await _sleep(SNAPSHOT_SETTLE_INTERVAL)
            try:
                payload = await self._fetch()
            except DeepnoteAPIError as error:
                # A failed re-fetch leaves the last payload in place; the next attempt tries again.
                if not _is_transient(error):
                    raise
        if read_error is not None:
            raise read_error
        return payload, None

    async def _read_snapshot(self, snapshot: Mapping[str, Any]) -> str | None:
        inline = snapshot.get("snapshotContent")
        if isinstance(inline, str):
            return inline
        url = snapshot.get("downloadUrl")
        if isinstance(url, str) and url:
            return await self._transport.get_text(url)
        return None


class RunsResource:
    """`deepnote.runs` — the v2 runs endpoints, one method each."""

    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def create(
        self,
        *,
        notebook_id: str,
        inputs: Mapping[str, Any] | None = None,
        bindings: Mapping[str, OutputBinding] | None = None,
        output_type: type | None = None,
    ) -> Run:
        """Start a detached run. Returns as soon as Deepnote has accepted it."""
        started_at = time.monotonic()
        payload = await self._transport.request(
            "POST",
            "/v2/runs",
            json={"notebookId": notebook_id, "inputs": to_run_inputs(inputs or {})},
        )
        return Run(
            _run_payload(payload),
            transport=self._transport,
            bindings=bindings,
            output_type=output_type,
            started_at=started_at,
        )

    async def get(
        self,
        run_id: str,
        *,
        bindings: Mapping[str, OutputBinding] | None = None,
        output_type: type | None = None,
    ) -> Run:
        """
        Pick up a run this process did not start.

        The whole point of a detached run: the id is enough. A page that reloaded, a retry of a
        failed job, or an entirely different machine can take a run's result from here.
        """
        payload = await self._transport.request("GET", f"/v2/runs/{run_id}")
        return Run(_run_payload(payload), transport=self._transport, bindings=bindings, output_type=output_type)

    async def list(
        self,
        *,
        notebook_id: str,
        page_size: int | None = None,
        page_token: str | None = None,
    ) -> Mapping[str, Any]:
        """One page of a notebook's run history, newest first."""
        params: dict[str, Any] = {}
        if page_size is not None:
            params["pageSize"] = page_size
        if page_token:
            params["pageToken"] = page_token
        return await self._transport.request("GET", f"/v2/notebooks/{notebook_id}/runs", params=params)


def to_run_inputs(inputs: Mapping[str, Any]) -> dict[str, Any]:
    """
    Coerce input values to what `POST /v2/runs` accepts.

    The API takes exactly `str | bool | list[str]`, so numbers and dates are given their obvious
    textual form here rather than rejected — code computing `trailing_months=6` or passing
    `date.today()` should not have to remember to stringify it. Anything without an unambiguous
    textual form is refused instead of guessed at.
    """
    coerced: dict[str, Any] = {}
    for name, value in inputs.items():
        if value is None:
            continue
        if isinstance(value, bool) or isinstance(value, str):
            coerced[name] = value
        elif isinstance(value, (int, float)):
            coerced[name] = str(value)
        elif isinstance(value, (datetime, date)):
            coerced[name] = value.isoformat()
        elif isinstance(value, Sequence) and all(isinstance(part, str) for part in value):
            coerced[name] = list(value)
        else:
            raise TypeError(
                f"Input {name!r} is a {type(value).__name__}. "
                "Deepnote inputs accept a string, boolean, number, date, or list of strings."
            )
    return coerced


def _is_transient(error: DeepnoteAPIError) -> bool:
    """Worth retrying: a rate limit, a server error, or a request that never got a response."""
    if error.status_code is not None:
        return error.status_code == 429 or error.status_code >= 500
    return isinstance(error.__cause__, httpx.TransportError)


def _snapshot_of(payload: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """
    The snapshot in either shape the API uses, or None when none is attached.

    Some deployments nest it under `snapshot`; others return it flat on the run as `snapshotContent`
    (or null) plus `snapshotDownloadUrl` (a presigned URL). Normalized to the nested shape here so
    nothing above has to know.
    """
    nested = payload.get("snapshot")
    if isinstance(nested, Mapping):
        return nested
    content = payload.get("snapshotContent")
    url = payload.get("snapshotDownloadUrl")
    flat: dict[str, Any] = {}
    if isinstance(content, str) and content:
        flat["snapshotContent"] = content
    if isinstance(url, str) and url:
        flat["downloadUrl"] = url
    return flat or None


def _run_payload(body: Any) -> Mapping[str, Any]:
    """The API nests a run under `run` on some responses and returns it bare on others."""
    if isinstance(body, Mapping):
        run = body.get("run")
        if isinstance(run, Mapping):
            return run
        return body
    raise ValueError(f"Expected a run object, got {type(body).__name__}.")


def _parse_safely(snapshot_yaml: str | None) -> tuple[BlockOutput, ...]:
    """
    A snapshot that will not parse must not take the result with it.

    The status, the run id, and the reported error are exactly the diagnostic information a caller
    needs when something is wrong with the run — and a malformed snapshot is when things are most
    likely wrong. Degrade to no blocks; `snapshot_yaml` is still on the result to inspect.
    """
    if not snapshot_yaml:
        return ()
    try:
        return parse_snapshot_blocks(snapshot_yaml)
    except ValueError:
        return ()


def _describe_error(payload: Mapping[str, Any], status: str) -> str:
    error = payload.get("error")
    if isinstance(error, str) and error:
        return error
    if isinstance(error, Mapping):
        message = error.get("message") or error.get("error")
        if isinstance(message, str) and message:
            return message
    return f'the run finished with status "{status}"'


def _as_output(output_type: type | None, values: Mapping[str, Any]) -> Any:
    if output_type is None:
        return None
    try:
        return output_type(**values)
    except TypeError as error:
        raise ValueError(f"Declared outputs {sorted(values)} do not match {output_type.__name__}: {error}") from error


__all__ = ["Run", "RunResult", "RunsResource", "to_run_inputs", "TERMINAL_STATUSES", "FAILED_STATUSES"]
