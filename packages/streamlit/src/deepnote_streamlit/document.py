"""Typed, deliberately small views over `.deepnote` YAML and run responses."""

from __future__ import annotations

import base64
import binascii
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

DATAFRAME_MIME = "application/vnd.deepnote.dataframe.v3+json"
INDEX_COLUMN = "_deepnote_index_column"


def join_text(value: Any) -> str:
    """Normalize nbformat's string-or-list text values to one string."""

    if isinstance(value, list):
        return "".join(str(part) for part in value)
    return "" if value is None else str(value)


@dataclass(frozen=True)
class InputBlock:
    """The metadata a UI needs to render one Deepnote input block."""

    variable_name: str
    type: str
    value: Any
    label: str | None = None
    options: tuple[str, ...] = ()
    multiple: bool = False
    min: float | int | None = None
    max: float | int | None = None
    step: float | int | None = None

    @classmethod
    def from_block(cls, block: Mapping[str, Any]) -> InputBlock | None:
        block_type = str(block.get("type", ""))
        metadata = block.get("metadata")
        if not block_type.startswith("input-") or not isinstance(metadata, Mapping):
            return None
        variable_name = metadata.get("deepnote_variable_name")
        if not isinstance(variable_name, str) or not variable_name:
            return None
        options = metadata.get("deepnote_variable_options")
        return cls(
            variable_name=variable_name,
            type=block_type,
            label=_optional_string(metadata.get("deepnote_input_label")),
            value=metadata.get("deepnote_variable_value"),
            options=tuple(str(option) for option in options) if isinstance(options, list) else (),
            multiple=metadata.get("deepnote_allow_multiple_values") is True,
            min=_optional_number(metadata.get("deepnote_slider_min_value")),
            max=_optional_number(metadata.get("deepnote_slider_max_value")),
            step=_optional_number(metadata.get("deepnote_slider_step")),
        )

    @classmethod
    def from_api(cls, value: Mapping[str, Any]) -> InputBlock:
        """Read the camelCase shape returned by `GET /api/info`."""

        options = value.get("options")
        return cls(
            variable_name=str(value["variableName"]),
            type=str(value["type"]),
            label=_optional_string(value.get("label")),
            value=value.get("value"),
            options=tuple(str(option) for option in options) if isinstance(options, list) else (),
            multiple=value.get("multiple") is True,
            min=_optional_number(value.get("min")),
            max=_optional_number(value.get("max")),
            step=_optional_number(value.get("step")),
        )


@dataclass(frozen=True)
class DeepnoteDataframe:
    """A structured Deepnote dataframe output, independent of pandas."""

    columns: tuple[Mapping[str, Any], ...]
    rows: tuple[Mapping[str, Any], ...]
    raw: Mapping[str, Any]

    @classmethod
    def from_value(cls, value: Any) -> DeepnoteDataframe | None:
        if not isinstance(value, Mapping):
            return None
        columns = value.get("columns")
        rows = value.get("rows")
        if not isinstance(columns, list) or not isinstance(rows, list):
            return None
        if not all(isinstance(column, Mapping) for column in columns):
            return None
        if not all(isinstance(row, Mapping) for row in rows):
            return None
        return cls(columns=tuple(columns), rows=tuple(rows), raw=value)

    @property
    def data_columns(self) -> tuple[str, ...]:
        return tuple(str(column["name"]) for column in self.columns if column.get("name") != INDEX_COLUMN)

    def records(self, *, include_index: bool = True) -> list[dict[str, Any]]:
        """Return rows ready for `st.dataframe`, optionally omitting Deepnote's index column."""

        if include_index:
            return [dict(row) for row in self.rows]
        return [{key: value for key, value in row.items() if key != INDEX_COLUMN} for row in self.rows]


@dataclass(frozen=True)
class NotebookOutput:
    """One nbformat-compatible output emitted by a Deepnote block."""

    block_id: str
    block_type: str | None
    raw: Mapping[str, Any]

    @property
    def output_type(self) -> str:
        return str(self.raw.get("output_type", ""))

    @property
    def data(self) -> Mapping[str, Any]:
        value = self.raw.get("data")
        return value if isinstance(value, Mapping) else {}

    def text(self, mime: str = "text/plain") -> str:
        if self.output_type == "stream" and mime == "text/plain":
            return join_text(self.raw.get("text"))
        return join_text(self.data.get(mime))

    def image_bytes(self, mime: str = "image/png") -> bytes | None:
        value = self.data.get(mime)
        if value is None:
            return None
        encoded = "".join(join_text(value).split())
        try:
            return base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            return None

    @property
    def dataframe(self) -> DeepnoteDataframe | None:
        return DeepnoteDataframe.from_value(self.data.get(DATAFRAME_MIME))


class OutputCollection:
    """Shared output queries for a loaded document and a live run result."""

    outputs: tuple[NotebookOutput, ...]

    def outputs_for_mime(self, mime: str) -> list[NotebookOutput]:
        return [output for output in self.outputs if mime in output.data]

    def first_dataframe(self) -> DeepnoteDataframe | None:
        for output in self.outputs:
            if dataframe := output.dataframe:
                return dataframe
        return None

    def images(self, mime: str = "image/png") -> list[bytes]:
        return [image for output in self.outputs if (image := output.image_bytes(mime)) is not None]

    def text(self, mime: str = "text/plain") -> str:
        return "".join(output.text(mime) for output in self.outputs).strip()

    def agent_text(self) -> str:
        chunks: list[str] = []
        for output in self.outputs:
            if output.block_type != "agent":
                continue
            if output.output_type == "stream":
                chunks.append(output.text())
            else:
                chunks.append(output.text("text/markdown") or output.text())
        return "".join(chunks).strip()


class DeepnoteDocument(OutputCollection):
    """A parsed source or snapshot `.deepnote` file."""

    def __init__(self, raw: Mapping[str, Any]):
        project = raw.get("project")
        if not isinstance(project, Mapping) or not isinstance(project.get("notebooks"), list):
            raise ValueError("Expected a .deepnote document with project.notebooks")
        self.raw = raw
        self.project_name = str(project.get("name", "Untitled project"))
        self.inputs, self.outputs = _read_blocks(project["notebooks"])

    @classmethod
    def load(cls, path: str | Path) -> DeepnoteDocument:
        source = Path(path)
        try:
            raw = yaml.safe_load(source.read_text(encoding="utf-8"))
        except yaml.YAMLError as error:
            raise ValueError(f"Could not parse {source}: {error}") from error
        if not isinstance(raw, Mapping):
            raise ValueError(f"Expected {source} to contain a YAML object")
        return cls(raw)

    @classmethod
    def parse(cls, content: str) -> DeepnoteDocument:
        try:
            raw = yaml.safe_load(content)
        except yaml.YAMLError as error:
            raise ValueError(f"Could not parse .deepnote YAML: {error}") from error
        if not isinstance(raw, Mapping):
            raise ValueError("Expected .deepnote YAML to contain an object")
        return cls(raw)


class RunResult(OutputCollection):
    """The normalized result of `POST /api/run`, for either cloud or local execution."""

    def __init__(self, raw: Mapping[str, Any]):
        self.raw = raw
        self.target = str(raw.get("target", ""))
        self.success = raw.get("success") is True
        self.run_id = _optional_string(raw.get("runId"))
        self.status = _optional_string(raw.get("status"))
        self.created = raw.get("created") is True
        self.view_url = _optional_string(raw.get("viewUrl"))
        self.error = _optional_string(raw.get("error"))
        self.snapshot_yaml = _optional_string(raw.get("snapshotYaml"))
        self.snapshot = DeepnoteDocument.parse(self.snapshot_yaml) if self.snapshot_yaml else None
        if self.snapshot:
            self.outputs = self.snapshot.outputs
        else:
            self.outputs = _outputs_from_run(raw.get("outputs"))


def _read_blocks(notebooks: Sequence[Any]) -> tuple[tuple[InputBlock, ...], tuple[NotebookOutput, ...]]:
    inputs: list[InputBlock] = []
    outputs: list[NotebookOutput] = []
    for notebook in notebooks:
        if not isinstance(notebook, Mapping):
            continue
        blocks = notebook.get("blocks")
        if not isinstance(blocks, list):
            continue
        for block in blocks:
            if not isinstance(block, Mapping):
                continue
            if input_block := InputBlock.from_block(block):
                inputs.append(input_block)
            block_outputs = block.get("outputs")
            if not isinstance(block_outputs, list):
                continue
            block_id = str(block.get("id", ""))
            block_type = _optional_string(block.get("type"))
            outputs.extend(
                NotebookOutput(block_id=block_id, block_type=block_type, raw=output)
                for output in block_outputs
                if isinstance(output, Mapping)
            )
    return tuple(inputs), tuple(outputs)


def _outputs_from_run(value: Any) -> tuple[NotebookOutput, ...]:
    if not isinstance(value, list):
        return ()
    outputs: list[NotebookOutput] = []
    for block in value:
        if not isinstance(block, Mapping):
            continue
        block_id = str(block.get("blockId", ""))
        raw_outputs = block.get("outputs")
        if not isinstance(raw_outputs, list):
            continue
        outputs.extend(
            NotebookOutput(block_id=block_id, block_type=None, raw=output)
            for output in raw_outputs
            if isinstance(output, Mapping)
        )
    return tuple(outputs)


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _optional_number(value: Any) -> float | int | None:
    return value if isinstance(value, (float, int)) and not isinstance(value, bool) else None
