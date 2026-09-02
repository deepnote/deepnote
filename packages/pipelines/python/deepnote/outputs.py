"""Named outputs, declared by the caller.

Deepnote's API has a clean contract for a notebook's *inputs*: named input blocks, and
`POST /v2/runs` takes values keyed by those names. Outputs are not symmetrical — a finished run
gives you a snapshot of blocks, and which block holds "the answer" is something only the author
knows.

So the contract lives on the client. A binding says where a named value comes from; the SDK reads it
off the snapshot. If Deepnote later grows a server-side notion of named outputs, this surface does
not have to change — only the resolvers below do.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from deepnote._snapshot import BlockOutput

_SEGMENT = re.compile(r"^([A-Za-z_][\w]*)((?:\[\d+\])*)$")
_INDEX = re.compile(r"\[(\d+)\]")


@dataclass(frozen=True, slots=True)
class OutputBinding:
    """Where one named output comes from, and how to read it."""

    read: Callable[[Sequence[BlockOutput]], Any]
    describe: str


def text(block_id: str) -> OutputBinding:
    """A block's textual output."""
    return OutputBinding(
        read=lambda blocks: _block(blocks, block_id).text,
        describe=f"text of block {block_id!r}",
    )


def json(block_id: str, path: str | None = None) -> OutputBinding:
    """
    A block's structured output, optionally one path into it.

    `path` is a dotted path with numeric indexes — `totals.eu`, `regions[0].name` — and deliberately
    not a full JSONPath: a binding that needs filters or wildcards is a computation, and computations
    belong in the notebook that produced the value or in the code that consumes it.
    """
    return OutputBinding(
        read=lambda blocks: _pluck(_block(blocks, block_id).json, path, f"block {block_id!r}"),
        describe=f"{path} of block {block_id!r}" if path else f"JSON of block {block_id!r}",
    )


def last_json(path: str | None = None) -> OutputBinding:
    """
    The run's last structured output, optionally one path into it.

    Prefer this over :func:`json` for a notebook Deepnote created from a file: Deepnote reassigns
    block ids on creation, so a binding that names one is fragile in exactly that case.
    """
    return OutputBinding(
        read=lambda blocks: _pluck(_last_json(blocks), path, "the last JSON output"),
        describe=f"{path} of the run's last JSON output" if path else "the run's last JSON output",
    )


def all_text() -> OutputBinding:
    """Every block's textual output, in notebook order. Portable across remapped block ids."""
    return OutputBinding(
        read=lambda blocks: "".join(block.text for block in blocks),
        describe="the run's textual output",
    )


def derived(read: Callable[[Sequence[BlockOutput]], Any], describe: str = "a derived value") -> OutputBinding:
    """A binding the caller computes from the whole set of blocks."""
    return OutputBinding(read=read, describe=describe)


def resolve(bindings: dict[str, OutputBinding], blocks: Sequence[BlockOutput], run_id: str) -> dict[str, Any]:
    """
    Resolve every binding against a finished run.

    One failing binding fails the whole read, and the error names the binding rather than the block:
    a caller who declared `row_count` should be told `row_count` is missing, not handed a block id
    they may never have typed themselves.
    """
    resolved: dict[str, Any] = {}
    for name, binding in bindings.items():
        try:
            resolved[name] = binding.read(blocks)
        except Exception as error:  # noqa: BLE001 - re-raised with the binding's name attached
            raise ValueError(
                f"Output {name!r} could not be read from {binding.describe} of run {run_id}: {error}"
            ) from error
    return resolved


def _block(blocks: Sequence[BlockOutput], block_id: str) -> BlockOutput:
    for block in blocks:
        if block.block_id == block_id:
            return block
    known = ", ".join(block.block_id for block in blocks) or "none"
    raise KeyError(f"No block {block_id!r} in this run's snapshot. Blocks present: {known}.")


def _last_json(blocks: Sequence[BlockOutput]) -> Any:
    for block in reversed(blocks):
        try:
            return block.json
        except ValueError:
            continue
    raise ValueError("No block in this run produced a JSON output.")


def _pluck(value: Any, path: str | None, source: str) -> Any:
    if path is None:
        return value
    current = value
    for segment in path.split("."):
        match = _SEGMENT.match(segment)
        if not match:
            raise ValueError(f"{path!r} is not a dotted path with numeric indexes.")
        current = _step(current, match.group(1), path, source)
        for index in _INDEX.finditer(match.group(2)):
            current = _step(current, int(index.group(1)), path, source)
    return current


def _step(value: Any, key: str | int, path: str, source: str) -> Any:
    if isinstance(key, int):
        if not isinstance(value, (list, tuple)) or key >= len(value):
            raise ValueError(f"{path!r} does not exist in {source}: no index {key}.")
        return value[key]
    if not isinstance(value, dict) or key not in value:
        raise ValueError(f"{path!r} does not exist in {source}: no key {key!r}.")
    return value[key]
