"""Tests for snapshot management."""

from pathlib import Path

import yaml
import pytest

from deepnote_runtime.models import (
    Block,
    BlockOutput,
    BlockType,
    DeepnoteFile,
    ExecutionMode,
    Notebook,
    Project,
)
from deepnote_runtime.snapshot import (
    build_snapshot_data,
    compute_content_hash,
    compute_snapshot_hash,
    snapshot_path_for,
    write_snapshot,
)


def _make_deepnote_file(**kwargs) -> DeepnoteFile:
    defaults = dict(
        version="1.0.0",
        project=Project(
            id="test-project-id",
            name="Test",
            notebooks=[
                Notebook(
                    id="nb-1",
                    name="Main",
                    blocks=[
                        Block(
                            id="b-1",
                            type=BlockType.CODE,
                            content="x = 1",
                            sorting_key="a0",
                            execution_count=1,
                            outputs=[
                                BlockOutput(
                                    output_type="stream",
                                    name="stdout",
                                    text="hello\n",
                                ),
                            ],
                        ),
                    ],
                ),
            ],
        ),
        metadata={"createdAt": 1000000},
    )
    defaults.update(kwargs)
    return DeepnoteFile(**defaults)


class TestComputeContentHash:
    def test_deterministic(self):
        h1 = compute_content_hash("x = 1")
        h2 = compute_content_hash("x = 1")
        assert h1 == h2

    def test_different_content(self):
        h1 = compute_content_hash("x = 1")
        h2 = compute_content_hash("x = 2")
        assert h1 != h2

    def test_returns_hex_string(self):
        h = compute_content_hash("test")
        assert len(h) == 64  # SHA-256 hex
        assert all(c in "0123456789abcdef" for c in h)


class TestComputeSnapshotHash:
    def test_deterministic(self):
        df = _make_deepnote_file()
        h1 = compute_snapshot_hash(df)
        h2 = compute_snapshot_hash(df)
        assert h1 == h2

    def test_changes_with_content(self):
        df1 = _make_deepnote_file()
        df2 = _make_deepnote_file()
        df2.project.notebooks[0].blocks[0].content = "y = 2"
        h1 = compute_snapshot_hash(df1)
        h2 = compute_snapshot_hash(df2)
        assert h1 != h2


class TestBuildSnapshotData:
    def test_structure(self):
        df = _make_deepnote_file()
        data = build_snapshot_data(df)

        assert data["version"] == "1.0.0"
        assert "snapshotHash" in data["metadata"]
        assert data["project"]["id"] == "test-project-id"
        assert len(data["project"]["notebooks"]) == 1

    def test_includes_outputs(self):
        df = _make_deepnote_file()
        data = build_snapshot_data(df)

        block = data["project"]["notebooks"][0]["blocks"][0]
        assert len(block["outputs"]) == 1
        assert block["outputs"][0]["output_type"] == "stream"
        assert block["outputs"][0]["text"] == "hello\n"

    def test_includes_content_hash(self):
        df = _make_deepnote_file()
        data = build_snapshot_data(df)

        block = data["project"]["notebooks"][0]["blocks"][0]
        assert "contentHash" in block


class TestWriteSnapshot:
    def test_write_and_read(self, tmp_path):
        df = _make_deepnote_file()
        out_path = tmp_path / "test.snapshot.deepnote"
        result_path = write_snapshot(df, out_path)

        assert result_path == out_path
        assert out_path.exists()

        # Verify it's valid YAML
        content = yaml.safe_load(out_path.read_text())
        assert content["version"] == "1.0.0"
        assert content["project"]["name"] == "Test"

    def test_creates_parent_dirs(self, tmp_path):
        df = _make_deepnote_file()
        out_path = tmp_path / "snapshots" / "nested" / "test.snapshot.deepnote"
        write_snapshot(df, out_path)
        assert out_path.exists()

    def test_atomic_write(self, tmp_path):
        """Verify no partial files are left on success."""
        df = _make_deepnote_file()
        out_path = tmp_path / "test.snapshot.deepnote"
        write_snapshot(df, out_path)

        # No .tmp files should remain
        tmp_files = list(tmp_path.glob("*.tmp"))
        assert len(tmp_files) == 0


class TestSnapshotPathFor:
    def test_latest(self):
        path = snapshot_path_for("/project/source.deepnote", "proj-id-123")
        assert path == Path("/project/snapshots/source_proj-id-123_latest.snapshot.deepnote")

    def test_with_timestamp(self):
        path = snapshot_path_for(
            "/project/source.deepnote",
            "proj-id-123",
            timestamp="2025-01-08T10-30-00",
        )
        assert path == Path(
            "/project/snapshots/source_proj-id-123_2025-01-08T10-30-00.snapshot.deepnote"
        )
