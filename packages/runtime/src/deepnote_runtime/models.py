"""Data models for .deepnote files."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class BlockType(str, Enum):
    CODE = "code"
    MARKDOWN = "markdown"
    SQL = "sql"
    VISUALIZATION = "visualization"
    DATAFRAME = "dataframe"
    IMAGE = "image"
    BUTTON = "button"
    BIG_NUMBER = "big-number"
    NOTEBOOK_FUNCTION = "notebook-function"
    AGENT = "agent"
    INPUT_TEXT = "input-text"
    INPUT_TEXTAREA = "input-textarea"
    INPUT_SELECT = "input-select"
    INPUT_SLIDER = "input-slider"
    INPUT_CHECKBOX = "input-checkbox"
    INPUT_DATE = "input-date"
    INPUT_DATE_RANGE = "input-date-range"
    INPUT_FILE = "input-file"
    TEXT_H1 = "text-cell-h1"
    TEXT_H2 = "text-cell-h2"
    TEXT_H3 = "text-cell-h3"
    TEXT_P = "text-cell-p"
    TEXT_BULLET = "text-cell-bullet"
    TEXT_TODO = "text-cell-todo"
    TEXT_CALLOUT = "text-cell-callout"
    SEPARATOR = "separator"


class ExecutionMode(str, Enum):
    BLOCK = "block"
    ALL = "all"


INPUT_BLOCK_TYPES = frozenset({
    BlockType.INPUT_TEXT,
    BlockType.INPUT_TEXTAREA,
    BlockType.INPUT_SELECT,
    BlockType.INPUT_SLIDER,
    BlockType.INPUT_CHECKBOX,
    BlockType.INPUT_DATE,
    BlockType.INPUT_DATE_RANGE,
    BlockType.INPUT_FILE,
})

EXECUTABLE_BLOCK_TYPES = frozenset({
    BlockType.CODE,
    BlockType.SQL,
    BlockType.BUTTON,
    BlockType.BIG_NUMBER,
    BlockType.VISUALIZATION,
    BlockType.AGENT,
})


@dataclass
class BlockOutput:
    """A single output from block execution (Jupyter-compatible format)."""

    output_type: str  # "stream", "execute_result", "display_data", "error"
    data: dict[str, Any] | None = None
    text: str | None = None  # for stream outputs
    name: str | None = None  # "stdout" or "stderr" for stream
    execution_count: int | None = None
    ename: str | None = None  # for error outputs
    evalue: str | None = None
    traceback: list[str] | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"output_type": self.output_type}
        if self.output_type == "stream":
            result["name"] = self.name or "stdout"
            result["text"] = self.text or ""
        elif self.output_type in ("execute_result", "display_data"):
            result["data"] = self.data or {}
            if self.execution_count is not None:
                result["execution_count"] = self.execution_count
        elif self.output_type == "error":
            result["ename"] = self.ename or ""
            result["evalue"] = self.evalue or ""
            result["traceback"] = self.traceback or []
        return result


@dataclass
class Block:
    """A content block within a notebook."""

    id: str
    type: BlockType
    content: str = ""
    block_group: str = ""
    sorting_key: str = ""
    content_hash: str | None = None
    execution_count: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    outputs: list[BlockOutput] = field(default_factory=list)

    @property
    def is_executable(self) -> bool:
        return self.type in EXECUTABLE_BLOCK_TYPES

    @property
    def is_input(self) -> bool:
        return self.type in INPUT_BLOCK_TYPES

    @property
    def variable_name(self) -> str | None:
        """For input blocks, return the variable name they produce."""
        if not self.is_input:
            return None
        return self.metadata.get("deepnote_variable_name")

    @property
    def variable_value(self) -> Any:
        """For input blocks, return the current variable value."""
        if not self.is_input:
            return None
        return self.metadata.get("deepnote_variable_value")


@dataclass
class Notebook:
    """A notebook containing ordered blocks."""

    id: str
    name: str
    blocks: list[Block] = field(default_factory=list)
    execution_mode: ExecutionMode = ExecutionMode.BLOCK

    @property
    def sorted_blocks(self) -> list[Block]:
        return sorted(self.blocks, key=lambda b: b.sorting_key)

    @property
    def code_blocks(self) -> list[Block]:
        return [b for b in self.sorted_blocks if b.is_executable]

    @property
    def input_blocks(self) -> list[Block]:
        return [b for b in self.sorted_blocks if b.is_input]


@dataclass
class Project:
    """A .deepnote project containing notebooks."""

    id: str
    name: str
    notebooks: list[Notebook] = field(default_factory=list)
    settings: dict[str, Any] = field(default_factory=dict)


@dataclass
class DeepnoteFile:
    """Parsed representation of a .deepnote file."""

    version: str
    project: Project
    metadata: dict[str, Any] = field(default_factory=dict)
    integrations: list[dict[str, Any]] = field(default_factory=list)
    environment: dict[str, Any] | None = None
