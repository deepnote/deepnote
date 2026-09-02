"""The client.

Two layers, and only two: a boring map of the v2 API, and ergonomic handles over it. There is no
third layer, because the composition layer is Python.

That boundary is deliberate and worth stating plainly: this SDK does not schedule work, persist
workflow state, replay steps, or run workers. Each Deepnote run is independently addressable and
continues according to Deepnote's own execution semantics. Which means the same code runs from cron,
GitHub Actions, a Lambda, a FastAPI route, a CLI, Temporal, Airflow, Prefect, Dagster, or another
Deepnote notebook — with Deepnote competing with none of them.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

import httpx

from deepnote._http import DEFAULT_BASE_URL, Transport
from deepnote.notebooks import NotebooksResource
from deepnote.runs import RunsResource
from deepnote.workflow import Event, Workflow

TOKEN_ENV = "DEEPNOTE_TOKEN"
API_URL_ENV = "DEEPNOTE_API_URL"


class Deepnote:
    """A Deepnote client. Use it as an async context manager so its connections are closed."""

    def __init__(
        self,
        *,
        token: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not token:
            raise ValueError(
                f"A Deepnote API token is required. Pass token=..., or set {TOKEN_ENV} and use Deepnote.from_env()."
            )
        self._transport = Transport(token=token, base_url=base_url, timeout=timeout, client=client)
        self.base_url = self._transport.base_url
        self.runs = RunsResource(self._transport)
        self.notebooks = NotebooksResource(transport=self._transport, runs=self.runs)

    @classmethod
    def from_env(cls, **overrides: Any) -> Deepnote:
        """
        A client configured from the environment.

        Reading the token from the environment rather than an argument is the same choice Deepnote's
        durable step makes: a credential that is never an argument cannot end up in a log of
        arguments.
        """
        token = overrides.pop("token", None) or os.environ.get(TOKEN_ENV)
        if not token:
            raise ValueError(f"Set {TOKEN_ENV} to a Deepnote API token, or pass token=... explicitly.")
        base_url = overrides.pop("base_url", None) or os.environ.get(API_URL_ENV) or DEFAULT_BASE_URL
        return cls(token=token, base_url=base_url, **overrides)

    def workflow(self, name: str, *, on_event: Callable[[Event], None] | None = None) -> Workflow:
        """
        A named piece of work whose steps emit events.

        Observability, not orchestration — see `deepnote.workflow`. Skip it entirely and call
        `notebooks` directly; nothing else needs it.
        """
        return Workflow(name, notebooks=self.notebooks, on_event=on_event)

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> Deepnote:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()
