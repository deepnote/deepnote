"""Read a finished run's outputs out of a `.deepnote` snapshot.

Pure parsing: no kernel, no execution, no network. A snapshot is a `.deepnote` file with the block
outputs stored inline, which is why reading one needs nothing but a YAML parser.

Kept small on purpose. The TypeScript side has a full snapshot *view* (inputs with their bounds,
notebook structure) because a page renders it; a script almost always wants one value out of one
block, so that is what this exposes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import yaml


@dataclass(frozen=True, slots=True)
class BlockOutput:
    """One block of a run, and whatever it produced."""

    block_id: str
    type: str
    outputs: tuple[dict[str, Any], ...] = field(default=())
    execution_count: int | None = None

    @property
    def text(self) -> str:
        """All textual output from this block, in output order."""
        return "".join(_output_text(output) for output in self.outputs)

    @property
    def json(self) -> Any:
        """
        This block's structured output.

        Prefers a real `application/json` output; falls back to parsing the block's text, since a
        notebook that ends in `print(json.dumps(...))` is by far the most common way to publish a
        value.
        """
        for output in self.outputs:
            data = output.get("data")
            if isinstance(data, dict) and "application/json" in data:
                return data["application/json"]
        text = self.text.strip()
        if not text:
            raise ValueError(f"Block {self.block_id!r} produced no output to read JSON from.")
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            raise ValueError(f"Block {self.block_id!r} output is not JSON: {text[:200]!r}") from error


def parse_snapshot_blocks(snapshot_yaml: str) -> tuple[BlockOutput, ...]:
    """Every executable block in a snapshot, in notebook order."""
    try:
        parsed = yaml.safe_load(snapshot_yaml)
    except yaml.YAMLError as error:
        raise ValueError("Snapshot is not valid YAML.") from error
    if not isinstance(parsed, dict):
        raise ValueError("Snapshot is not a valid .deepnote snapshot.")

    project = parsed.get("project")
    if not isinstance(project, dict):
        raise ValueError("Snapshot is not a valid .deepnote snapshot: no project.")

    blocks: list[BlockOutput] = []
    for notebook in project.get("notebooks") or []:
        if not isinstance(notebook, dict):
            continue
        for block in notebook.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            outputs = tuple(output for output in (block.get("outputs") or []) if isinstance(output, dict))
            blocks.append(
                BlockOutput(
                    block_id=str(block.get("id", "")),
                    type=str(block.get("type", "code")),
                    outputs=outputs,
                    execution_count=block.get("executionCount"),
                )
            )
    return tuple(blocks)


def _output_text(output: dict[str, Any]) -> str:
    """The textual part of one Jupyter output, whatever shape it arrived in."""
    kind = output.get("output_type")
    if kind == "stream":
        return _joined(output.get("text"))
    if kind == "error":
        return "\n".join(str(line) for line in (output.get("traceback") or []))
    data = output.get("data")
    if isinstance(data, dict):
        for mime in ("text/plain", "text/markdown"):
            if mime in data:
                return _joined(data[mime])
    return ""


def _joined(value: Any) -> str:
    """Jupyter stores text as either a string or a list of lines."""
    if isinstance(value, list):
        return "".join(str(part) for part in value)
    return "" if value is None else str(value)
