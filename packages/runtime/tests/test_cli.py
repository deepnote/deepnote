"""Tests for CLI."""

import pytest

from deepnote_runtime.cli import _parse_value, _parse_var_args, main


class TestParseValue:
    def test_integer(self):
        assert _parse_value("42") == 42

    def test_float(self):
        assert _parse_value("3.14") == 3.14

    def test_true(self):
        assert _parse_value("true") is True
        assert _parse_value("True") is True

    def test_false(self):
        assert _parse_value("false") is False
        assert _parse_value("False") is False

    def test_string(self):
        assert _parse_value("hello") == "hello"

    def test_string_with_spaces(self):
        assert _parse_value("hello world") == "hello world"


class TestParseVarArgs:
    def test_single_var(self):
        result = _parse_var_args(["x=42"])
        assert result == {"x": 42}

    def test_multiple_vars(self):
        result = _parse_var_args(["x=42", "name=hello", "flag=true"])
        assert result == {"x": 42, "name": "hello", "flag": True}

    def test_value_with_equals(self):
        result = _parse_var_args(["expr=a=b"])
        assert result == {"expr": "a=b"}


class TestMainEntryPoint:
    def test_no_args_returns_1(self):
        assert main([]) == 1

    def test_run_hello_world(self, hello_world_path, capsys):
        ret = main(["run", str(hello_world_path)])
        assert ret == 0
        captured = capsys.readouterr()
        assert "Hello, World!" in captured.out

    def test_run_multi_block(self, multi_block_path, capsys):
        ret = main(["run", str(multi_block_path)])
        assert ret == 0
        captured = capsys.readouterr()
        assert "Sum: 30" in captured.out

    def test_run_with_inputs(self, with_inputs_path, capsys):
        ret = main(["run", str(with_inputs_path)])
        assert ret == 0
        captured = capsys.readouterr()
        assert "Hello #1" in captured.out
        assert "Hello #3" in captured.out

    def test_run_with_var_override(self, with_inputs_path, capsys):
        ret = main(["run", str(with_inputs_path), "--var", "greeting=Hi", "--var", "count=2"])
        assert ret == 0
        captured = capsys.readouterr()
        assert "Hi #1" in captured.out
        assert "Hi #2" in captured.out
        assert "#3" not in captured.out

    def test_run_with_error(self, with_error_path, capsys):
        ret = main(["run", str(with_error_path)])
        assert ret == 1

    def test_run_continue_on_error(self, with_error_path, capsys):
        ret = main(["run", str(with_error_path), "--no-stop-on-error"])
        assert ret == 1  # still fails overall
        captured = capsys.readouterr()
        assert "This should not run" in captured.out

    def test_run_nonexistent_file(self, capsys):
        ret = main(["run", "/nonexistent/file.deepnote"])
        assert ret == 1
        captured = capsys.readouterr()
        assert "Error" in captured.err

    def test_run_with_notebook_selection(self, multi_notebook_path, capsys):
        ret = main(["run", str(multi_notebook_path), "--notebook", "Setup"])
        assert ret == 0

    def test_run_with_wrong_notebook(self, multi_notebook_path, capsys):
        with pytest.raises(SystemExit):
            main(["run", str(multi_notebook_path), "--notebook", "Nonexistent"])

    def test_info_command(self, hello_world_path, capsys):
        ret = main(["info", str(hello_world_path)])
        assert ret == 0
        captured = capsys.readouterr()
        assert "Hello world" in captured.out
        assert "1.0.0" in captured.out

    def test_run_with_snapshot(self, hello_world_path, tmp_path, capsys, monkeypatch):
        # Copy fixture to tmp_path so snapshot goes to a writable location
        import shutil
        dest = tmp_path / "hello.deepnote"
        shutil.copy(hello_world_path, dest)

        ret = main(["run", str(dest), "--snapshot"])
        assert ret == 0
        captured = capsys.readouterr()
        assert "Snapshot written to" in captured.out

        # Verify snapshot file exists
        snapshot_dir = tmp_path / "snapshots"
        assert snapshot_dir.exists()
        snapshots = list(snapshot_dir.glob("*.snapshot.deepnote"))
        assert len(snapshots) == 1
