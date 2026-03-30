"""Snapshot management for .deepnote execution outputs.

Writes .snapshot.deepnote files containing execution results.
Uses atomic writes (temp file + rename) for safety.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
import time
from pathlib import Path
from typing import Any

import yaml

from deepnote_runtime.models import Block, DeepnoteFile, Notebook


def compute_content_hash(content: str) -> str:
    """Compute SHA-256 hash of block content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def compute_snapshot_hash(deepnote_file: DeepnoteFile) -> str:
    """Compute the snapshot hash from all block content hashes.

    Includes: block contentHashes, environment hash, version, integration metadata.
    Excludes: temporal fields, execution metadata, block outputs.
    """
    hasher = hashlib.sha256()

    # Version
    hasher.update(deepnote_file.version.encode())

    # Block content hashes
    for notebook in deepnote_file.project.notebooks:
        for block in notebook.sorted_blocks:
            if block.content_hash:
                hasher.update(block.content_hash.encode())
            elif block.content:
                hasher.update(compute_content_hash(block.content).encode())

    # Environment hash
    if deepnote_file.environment:
        env_hash = deepnote_file.environment.get("hash")
        if env_hash:
            hasher.update(str(env_hash).encode())

    # Integration metadata (id, type, name only)
    for integration in deepnote_file.integrations:
        for key in ("id", "type", "name"):
            val = integration.get(key, "")
            hasher.update(str(val).encode())

    return hasher.hexdigest()


def build_snapshot_data(deepnote_file: DeepnoteFile) -> dict[str, Any]:
    """Build the YAML-serializable snapshot data from a DeepnoteFile."""
    now_ms = int(time.time() * 1000)

    notebooks_data = []
    for notebook in deepnote_file.project.notebooks:
        blocks_data = []
        for block in notebook.sorted_blocks:
            block_data: dict[str, Any] = {
                "id": block.id,
                "type": block.type.value,
                "blockGroup": block.block_group,
                "sortingKey": block.sorting_key,
            }

            if block.content:
                block_data["content"] = block.content
                block_data["contentHash"] = (
                    block.content_hash or compute_content_hash(block.content)
                )

            if block.execution_count is not None:
                block_data["executionCount"] = block.execution_count

            if block.metadata:
                block_data["metadata"] = block.metadata

            if block.outputs:
                block_data["outputs"] = [o.to_dict() for o in block.outputs]

            blocks_data.append(block_data)

        notebooks_data.append({
            "id": notebook.id,
            "name": notebook.name,
            "executionMode": notebook.execution_mode.value,
            "blocks": blocks_data,
        })

    snapshot_data: dict[str, Any] = {
        "version": deepnote_file.version,
        "metadata": {
            **deepnote_file.metadata,
            "modifiedAt": now_ms,
            "snapshotHash": compute_snapshot_hash(deepnote_file),
        },
        "project": {
            "id": deepnote_file.project.id,
            "name": deepnote_file.project.name,
            "notebooks": notebooks_data,
        },
    }

    if deepnote_file.integrations:
        snapshot_data["integrations"] = deepnote_file.integrations

    if deepnote_file.environment:
        snapshot_data["environment"] = deepnote_file.environment

    return snapshot_data


def write_snapshot(
    deepnote_file: DeepnoteFile,
    output_path: str | Path,
) -> Path:
    """Write a .snapshot.deepnote file atomically.

    Uses temp file + rename for crash safety.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    snapshot_data = build_snapshot_data(deepnote_file)
    yaml_content = yaml.dump(
        snapshot_data,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )

    # Atomic write: write to temp, then rename
    fd, tmp_path = tempfile.mkstemp(
        dir=output_path.parent,
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(yaml_content)
        os.replace(tmp_path, output_path)
    except BaseException:
        # Clean up temp file on failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    return output_path


def snapshot_path_for(
    source_path: str | Path,
    project_id: str,
    timestamp: str | None = None,
) -> Path:
    """Generate the snapshot file path for a source .deepnote file.

    Args:
        source_path: Path to the source .deepnote file.
        project_id: The project UUID.
        timestamp: Optional ISO timestamp. If None, uses "latest".
    """
    source_path = Path(source_path)
    stem = source_path.stem  # e.g. "source" from "source.deepnote"
    snapshot_dir = source_path.parent / "snapshots"

    ts = timestamp or "latest"
    filename = f"{stem}_{project_id}_{ts}.snapshot.deepnote"

    return snapshot_dir / filename
