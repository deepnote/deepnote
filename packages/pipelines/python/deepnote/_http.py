"""The transport: one thin wrapper over httpx, and the error mapping.

Boring on purpose. This layer knows about HTTP and nothing about runs, so the resource classes above
it stay a readable map of the v2 API.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from deepnote.errors import DeepnoteAPIError

DEFAULT_BASE_URL = "https://api.deepnote.com"


class Transport:
    """Authenticated JSON calls against one Deepnote API origin."""

    def __init__(
        self,
        *,
        token: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._token = token
        self.base_url = base_url.rstrip("/")
        # A caller-supplied client is how tests inject a mock transport, and how an application
        # shares one connection pool with the rest of its own HTTP traffic.
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout)

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Mapping[str, Any] | None = None,
    ) -> Any:
        try:
            response = await self._client.request(
                method,
                f"{self.base_url}{path}",
                json=json,
                params=dict(params or {}),
                headers={"authorization": f"Bearer {self._token}", "accept": "application/json"},
            )
        except httpx.HTTPError as error:
            raise DeepnoteAPIError(f"{method} {path} failed: {error}") from error

        if response.status_code >= 400:
            raise DeepnoteAPIError(
                _message(method, path, response),
                status_code=response.status_code,
                body=_body(response),
            )
        return _body(response)

    async def get_text(self, url: str) -> str:
        """
        Fetch a URL as text. Used for a snapshot the API hands back as a download link.

        The link is presigned, so the error deliberately reports the status or the failure type and
        never the URL itself — httpx's own messages would otherwise put the credential in a log.
        """
        try:
            response = await self._client.get(url)
        except httpx.HTTPError as error:
            raise DeepnoteAPIError(f"Failed to download snapshot: {type(error).__name__}") from error
        if response.status_code >= 400:
            raise DeepnoteAPIError(
                f"Failed to download snapshot: the storage server returned {response.status_code}",
                status_code=response.status_code,
            )
        return response.text

    async def aclose(self) -> None:
        """Close the client, unless the caller supplied it and therefore owns it."""
        if self._owns_client:
            await self._client.aclose()


def _body(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text


def _message(method: str, path: str, response: httpx.Response) -> str:
    body = _body(response)
    detail = None
    if isinstance(body, dict):
        detail = body.get("message") or body.get("error") or body.get("detail")
    message = f"{method} {path} returned {response.status_code}"
    if detail:
        message = f"{message}: {detail}"
    if response.status_code in (401, 403):
        # By far the most common cause, and the one the status code alone does not distinguish:
        # a token that is valid but not scoped to this notebook or project.
        message = f"{message}. Check that the token is valid and has access to this notebook."
    return message
