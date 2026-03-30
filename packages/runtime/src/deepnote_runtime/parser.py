"""Parse .deepnote YAML files into model objects."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from deepnote_runtime.models import (
    Block,
    BlockOutput,
    BlockType,
    DeepnoteFile,
    ExecutionMode,
    Notebook,
    Project,
)


class ParseError(Exception):
    """Raised when a .deepnote file is malformed."""


def parse_file(path: str | Path) -> DeepnoteFile:
    """Parse a .deepnote file from disk."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    if not path.suffix == ".deepnote":
        raise ParseError(f"Expected .deepnote file, got: {path.suffix}")
    text = path.read_text(encoding="utf-8")
    return parse_string(text)


def parse_string(text: str) -> DeepnoteFile:
    """Parse a .deepnote YAML string into a DeepnoteFile."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise ParseError(f"Invalid YAML: {e}") from e

    if not isinstance(data, dict):
        raise ParseError("Top-level YAML must be a mapping")

    return _parse_deepnote_file(data)


def _parse_deepnote_file(data: dict[str, Any]) -> DeepnoteFile:
    version = data.get("version")
    if not version:
        raise ParseError("Missing required field: version")

    project_data = data.get("project")
    if not project_data:
        raise ParseError("Missing required field: project")

    return DeepnoteFile(
        version=str(version),
        project=_parse_project(project_data),
        metadata=data.get("metadata", {}),
        integrations=data.get("integrations", []),
        environment=data.get("environment"),
    )


def _parse_project(data: dict[str, Any]) -> Project:
    if "id" not in data:
        raise ParseError("Project missing required field: id")
    if "name" not in data:
        raise ParseError("Project missing required field: name")

    notebooks = [
        _parse_notebook(nb) for nb in data.get("notebooks", [])
    ]

    return Project(
        id=data["id"],
        name=data["name"],
        notebooks=notebooks,
        settings=data.get("settings", {}),
    )


def _parse_notebook(data: dict[str, Any]) -> Notebook:
    if "id" not in data:
        raise ParseError("Notebook missing required field: id")
    if "name" not in data:
        raise ParseError("Notebook missing required field: name")

    blocks = [_parse_block(b) for b in data.get("blocks", [])]

    execution_mode = ExecutionMode.BLOCK
    raw_mode = data.get("executionMode", "block")
    try:
        execution_mode = ExecutionMode(raw_mode)
    except ValueError:
        pass  # default to BLOCK

    return Notebook(
        id=data["id"],
        name=data["name"],
        blocks=blocks,
        execution_mode=execution_mode,
    )


def _parse_block(data: dict[str, Any]) -> Block:
    if "id" not in data:
        raise ParseError("Block missing required field: id")
    if "type" not in data:
        raise ParseError("Block missing required field: type")

    try:
        block_type = BlockType(data["type"])
    except ValueError:
        raise ParseError(f"Unknown block type: {data['type']}")

    outputs = [_parse_output(o) for o in data.get("outputs", [])]

    return Block(
        id=data["id"],
        type=block_type,
        content=data.get("content", ""),
        block_group=data.get("blockGroup", ""),
        sorting_key=data.get("sortingKey", ""),
        content_hash=data.get("contentHash"),
        execution_count=data.get("executionCount"),
        metadata=data.get("metadata", {}),
        outputs=outputs,
    )


def _parse_output(data: dict[str, Any]) -> BlockOutput:
    output_type = data.get("output_type", "")
    return BlockOutput(
        output_type=output_type,
        data=data.get("data"),
        text=data.get("text"),
        name=data.get("name"),
        execution_count=data.get("execution_count"),
        ename=data.get("ename"),
        evalue=data.get("evalue"),
        traceback=data.get("traceback"),
    )
